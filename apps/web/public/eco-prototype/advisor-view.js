// Modo Asesor del chat drawer (spec §3.1–§3.4, §9.2–§9.6). Caminos 1 a 3: selector, progreso
// por rondas con sondeo de la corrida, memorando, «Elegimos», deliberación desplegable y
// recuperación al reabrir una conversación. Se carga antes de chat-drawer.js y expone
// window.ECO_ADVISOR; el drawer sigue funcionando sin él (modo descriptivo intacto).
// Nunca se envía a analítica el texto de la pregunta ni de la respuesta.
(function () {
  const h = React.createElement;
  const { useState } = React;

  const ROUNDS_TOTAL = 5;   // rondas 1 a 5 del consejo (spec §9.7)
  const POLL_MS = 2000;     // sondeo de la corrida (spec §3.2)
  const EVENTS_PAGE = 100;  // tope de eventos por página (contrato de GET events)
  const TERMINAL = ['done', 'error', 'error_budget', 'error_interrupted', 'cancelled'];
  const RESOLVED = ['resuelto', 'resuelta'];
  const CAMINO_NOMBRE = { 1: 'Respuesta directa', 2: 'Panel de asesores', 3: 'Consejo completo' };
  const STATUS_TEXT = {
    queued: 'En cola…',
    r0_running: 'Reuniendo los hechos…',
    rounds_queued: 'Los hechos están listos; el consejo está por deliberar…',
    running: 'En curso…',
    done: 'Listo.',
    error: 'La corrida terminó con error.',
    error_budget: 'La corrida se detuvo por presupuesto; el memorando puede estar incompleto.',
    error_interrupted: 'La corrida se interrumpió. Puedes volver a preguntar.',
    cancelled: 'Corrida cancelada.',
  };

  const CAPTION = { fontSize: 'var(--fs-caption)', color: 'var(--text-3)' };
  const TEXT = { lineHeight: 1.5 };
  const SECTION = { marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', gap: 6 };
  const HEAD = { margin: 0, fontSize: 'var(--fs-caption)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-2)' };
  const BTN = {
    padding: '3px 9px', fontSize: 'var(--fs-caption)', borderRadius: 'var(--r-pill, 999px)',
    border: '1px solid var(--hairline)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer',
  };
  const CARD = { border: '1px solid var(--hairline)', borderRadius: 'var(--r-md, 8px)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 };
  const CARD_BAD = Object.assign({}, CARD, { borderColor: 'var(--neg)' });

  // ---- Utilidades ----

  /** ¿El usuario ve el selector? Capacidad `advise` con la sesión cargada (spec §3.1). */
  function canAdvise() {
    return typeof window.ecoHasCap === 'function' && !!window.ecoHasCap('advise');
  }

  function isTerminal(status) { return TERMINAL.indexOf(status) >= 0; }

  function arr(v) { return Array.isArray(v) ? v : []; }

  /** Lista de textos: acepta arreglo, texto suelto o nada. */
  function asList(v) {
    if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim() !== '').map((x) => String(x));
    return v == null || String(v).trim() === '' ? [] : [String(v)];
  }

  function short(s, n) {
    const max = n || 280;
    const t = String(s == null ? '' : s).trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function fmtRango(r) {
    if (Array.isArray(r)) return r.join(' – ');
    if (r && typeof r === 'object') return Object.keys(r).map((k) => r[k]).join(' – ');
    return String(r);
  }

  /** Analítica: solo nombres y valores cortos; los valores nulos se omiten. */
  function track(name, params) {
    if (!window.ecoTrack) return;
    const clean = {};
    Object.keys(params || {}).forEach((k) => { if (params[k] != null) clean[k] = params[k]; });
    try { window.ecoTrack(name, clean); } catch (_) {}
  }

  /** Duración desde la creación de la corrida, en los rangos de GA4 (spec §3.4). */
  function durationBucket(ms) {
    if (!isFinite(ms) || ms < 0) return null;
    const s = ms / 1000;
    if (s < 30) return '<30s';
    if (s < 60) return '30-60s';
    if (s < 120) return '60-120s';
    return '>120s';
  }

  function trackRunDone(run) {
    const t = Date.parse(run && run.createdAt);
    track('advisor_run_done', {
      advisor_path: run && run.camino,
      advisor_status: run && run.status,
      duration_bucket: isNaN(t) ? null : durationBucket(Date.now() - t),
    });
  }

  /** Mensaje legible para una respuesta HTTP no válida del asesor. */
  function httpErrorText(status, body) {
    const reason = body && body.reason;
    if (status === 401) return 'Sesión expirada. Recarga la página.';
    if (status === 403 && reason === 'staff_only') return 'El asesor está disponible solo para el equipo de Populicom.';
    if (status === 403 && reason === 'agency_not_enabled') return 'El asesor todavía no está habilitado para esta agencia.';
    if (status === 403) return 'Tu cuenta no tiene acceso al asesor.';
    if (status === 404) return 'La conversación o la corrida ya no está disponible.';
    if (status === 429 && body && body.error === 'daily_limit') return 'Llegaste al límite diario de consultas al asesor.';
    if (status === 429) return 'Demasiadas consultas seguidas. Espera un minuto.';
    if (status === 503) return 'El asesor no está disponible en este momento.';
    return 'Error ' + status + '.';
  }

  // ---- Red (corridas) ----

  async function readError(resp) {
    const body = await resp.json().catch(() => null);
    const err = new Error(httpErrorText(resp.status, body));
    err.status = resp.status;
    return err;
  }

  async function getJSON(url) {
    const resp = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!resp.ok) throw await readError(resp);
    return resp.json();
  }

  async function postJSON(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
    if (!resp.ok) throw await readError(resp);
    return resp.json().catch(() => ({}));
  }

  /** GET de la corrida: {run} (spec §9.2). `qs` lleva ?agency=. */
  function fetchRun(qs, id) {
    return getJSON('/api/chat/advisor/runs/' + encodeURIComponent(id) + '?' + qs).then((d) => d.run || {});
  }

  /** GET de eventos con seq > after: {events, done} (spec §9.3). */
  function fetchEvents(qs, id, after) {
    return getJSON('/api/chat/advisor/runs/' + encodeURIComponent(id) + '/events?after=' + Number(after || 0) + '&' + qs);
  }

  // ---- Reductores de estado del mensaje (puros) ----

  /** Agrega eventos nuevos (dedupe por seq). La corrida pasa a «en curso» al llegar el primero. */
  function applyEvents(m, list) {
    const seen = m.lastSeq || 0;
    const fresh = arr(list).filter((e) => e && typeof e.seq === 'number' && e.seq > seen);
    if (!fresh.length) return m;
    const next = { ...m, events: arr(m.events).concat(fresh), lastSeq: fresh[fresh.length - 1].seq };
    if (!m.runStatus || m.runStatus === 'queued') next.runStatus = 'running';
    fresh.forEach((e) => { if (e.type === 'memo' && e.payload && e.payload.memo) next.memo = e.payload.memo; });
    return next;
  }

  /** Aplica el estado de la corrida (run GET): estado, memorando, elección y triaje. */
  function applyRun(m, run) {
    if (!run) return m;
    const next = { ...m, run, runStatus: run.status || m.runStatus, camino: run.camino || m.camino };
    if (run.triage) next.triage = run.triage;
    if (run.memo) next.memo = run.memo;
    return next;
  }

  /** Resume los eventos para la barra de progreso y las líneas por asiento. */
  function summarize(events) {
    const s = { ronda: null, nombreRonda: null, rondasHechas: 0, asientos: [], estado: null, vetos: [], errores: [], review: null, holding: null };
    events.forEach((e) => {
      const p = e.payload || {};
      switch (e.type) {
        case 'round_started': s.ronda = p.ronda; s.nombreRonda = p.nombre || null; break;
        case 'round_done': s.rondasHechas += 1; break;
        case 'seat_done': s.asientos.push(String(p.asiento || 'Asiento')); break;
        case 'status': if (p.texto) s.estado = p.texto; break;
        case 'veto': s.vetos.push(p); break;
        case 'holding_statement': s.holding = p; break;
        case 'error': s.errores.push(p.message || p.code || 'Error'); break;
        case 'review': s.review = arr(p.puntos); break;
        default: break;
      }
    });
    return s;
  }

  // ---- Piezas de presentación ----

  function Badge(props) {
    const tone = props.tone;
    const c = tone === 'ok' ? ['var(--pos)', 'var(--pos-bg)']
      : tone === 'warn' ? ['var(--warn)', 'var(--warn-bg)']
      : tone === 'bad' ? ['var(--neg)', 'var(--neg-bg)']
      : ['var(--text-2)', 'var(--canvas-2)'];
    return h('span', {
      style: {
        display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 'var(--fs-caption)',
        fontWeight: 600, color: c[0], background: c[1], whiteSpace: 'nowrap',
      },
    }, props.children);
  }

  /** Citas y reglas dentro del texto: M-xxxx, N-xxx, [métrica: …], M-xx/G-x/L-x/LC-x. */
  const CITE_RE = /(\[métrica:[^\]]*\]|«sin respaldo»|\b(?:N-\d+|LC-\d+|[MGL]-\d+)\b)/g;
  const CHIP = {
    fontFamily: 'var(--ff-mono, monospace)', fontSize: 'var(--fs-caption)', padding: '0 4px', margin: '0 1px',
    borderRadius: 4, border: '1px solid var(--hairline)', background: 'var(--canvas-2)', color: 'var(--text-2)', whiteSpace: 'nowrap',
  };
  const CHIP_BAD = Object.assign({}, CHIP, { color: 'var(--neg)', borderColor: 'var(--neg)' });

  function rich(text, key) {
    const parts = String(text == null ? '' : text).split(CITE_RE);
    return parts.map((p, i) => {
      if (!p) return null;
      if (i % 2 === 0) return h('span', { key: key + i }, p);
      // «sin respaldo» lo marca el servidor: se muestra como advertencia.
      return h('span', { key: key + i, style: p === '«sin respaldo»' ? CHIP_BAD : CHIP }, p);
    });
  }

  function ListBlock(props) {
    const items = asList(props.items);
    if (!items.length) return null;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
      props.title ? h('div', { key: 't', style: CAPTION }, props.title) : null,
      h('ul', { key: 'l', style: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 } },
        items.map((t, i) => h('li', { key: i, style: TEXT }, rich(t, 'i' + i)))),
    ]);
  }

  function Field(props) {
    if (props.value == null || !String(props.value).trim()) return null;
    return h('div', { style: TEXT }, [
      h('span', { key: 'l', style: { fontWeight: 600 } }, props.label + ': '),
      h('span', { key: 'v' }, rich(props.value, 'f')),
    ]);
  }

  function section(key, title, kids) {
    return h('section', { key, style: SECTION, 'aria-label': title },
      [h('h4', { key: 'h', style: HEAD }, title)].concat(kids.filter(Boolean)));
  }

  function subBlock(title, kids) {
    return h('div', { key: title, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      [h('div', { key: 't', style: CAPTION }, title)].concat(kids.filter(Boolean)));
  }

  function objTone(estado) {
    if (estado === 'resuelta' || estado === 'resuelto') return 'ok';
    if (estado === 'mitigada' || estado === 'aceptada') return 'warn';
    return 'neutral';
  }

  function isResolved(estado) {
    return RESOLVED.indexOf(String(estado || '').toLowerCase()) >= 0;
  }

  /** Veto: visible siempre; sin resolver se marca en rojo. */
  function vetoCard(v, i) {
    const bad = !isResolved(v.estado);
    return h('div', { key: 'v' + i, style: bad ? CARD_BAD : CARD }, [
      h('div', { key: 'h', style: { fontWeight: 600 } }, 'Veto de ' + (v.asiento || 'asiento')),
      h('div', { key: 't', style: TEXT }, rich(v.texto, 'vt' + i)),
      h(Badge, { key: 'b', tone: bad ? 'bad' : 'ok' }, bad ? (v.estado && v.estado !== 'pendiente' ? v.estado : 'sin resolver') : v.estado),
    ]);
  }

  function caminoCard(c0, i) {
    const c = c0 || {};
    const letra = String.fromCharCode(65 + i);
    return h('article', { key: 'c' + i, style: CARD, 'aria-label': 'Camino ' + letra }, [
      h('div', { key: 'h', style: { fontWeight: 700 } }, 'Camino ' + letra + (c.nombre ? ': ' + c.nombre : '')),
      h(Field, { key: 'f1', label: 'Qué', value: c.que }),
      h(Field, { key: 'f2', label: 'Quién', value: c.quien }),
      h(Field, { key: 'f3', label: 'Canal', value: c.canal }),
      h(Field, { key: 'f4', label: 'Cuándo', value: c.cuando }),
      h(Field, { key: 'f5', label: 'Por qué funcionaría', value: c.por_que }),
      h(ListBlock, { key: 'l1', title: 'Reglas citadas', items: c.reglas }),
      h(ListBlock, { key: 'l2', title: 'Efectos esperados', items: c.efectos }),
      h(ListBlock, { key: 'l3', title: 'Riesgos', items: c.riesgos }),
      h(ListBlock, { key: 'l4', title: 'Supuestos críticos', items: c.supuestos }),
      h(ListBlock, { key: 'l5', title: 'Lo apoyan', items: c.apoyos }),
    ]);
  }

  /** Memorando en el orden de spec §3.3. Las secciones vacías se ocultan salvo hechos y recomendación. */
  function MemoView(props) {
    const memo = props.memo || {};
    const enc = memo.encabezado || {};
    const hechos = memo.hechos || {};
    const sabido = arr(hechos.sabido);
    const noClaro = arr(hechos.no_claro);
    const supuesto = arr(hechos.supuesto);
    const caminos = arr(memo.caminos);
    const senales = memo.senales || {};
    const rec = memo.recomendacion || {};
    const vetos = arr(memo.vetos);
    const borradores = arr(memo.borradores);
    const review = arr(props.review);
    const out = [];

    const cam = enc.camino != null
      ? 'Camino ' + enc.camino + (CAMINO_NOMBRE[enc.camino] ? ' · ' + CAMINO_NOMBRE[enc.camino] : '') : null;
    out.push(h('div', { key: 'enc', style: { ...CAPTION, lineHeight: 1.5 } }, [
      h('div', { key: 'a' }, [enc.agencia, enc.fecha, cam].filter(Boolean).join(' · ')),
      enc.motivo ? h('div', { key: 'm' }, enc.motivo) : null,
    ]));

    const hechosKids = [
      sabido.length ? subBlock('Sabemos', sabido.map((x, i) => h('div', { key: 's' + i, style: TEXT }, [
        h('span', { key: 'a' }, rich(x.afirmacion, 'sa' + i)),
        arr(x.citas).length ? h('span', { key: 'c' }, rich(' ' + arr(x.citas).join(' '), 'sc' + i)) : null,
      ]))) : null,
      noClaro.length ? subBlock('No está claro', noClaro.map((x, i) => h('div', { key: 'n' + i, style: TEXT }, [
        h('span', { key: 'p' }, rich(x.pregunta, 'np' + i)),
        h('span', { key: 'q', style: CAPTION }, ' · lo aclararía ' + short(x.que_lo_aclararia, 200) + (x.cuando ? ' (' + x.cuando + ')' : '')),
      ]))) : null,
      supuesto.length ? subBlock('Suponemos', supuesto.map((x, i) => h('div', { key: 'u' + i, style: TEXT }, rich(x.afirmacion, 'ua' + i)))) : null,
    ];
    if (!sabido.length && !noClaro.length && !supuesto.length) {
      hechosKids.push(h('div', { key: 'vacio', style: CAPTION }, 'Sin hechos registrados.'));
    }
    out.push(section('hechos', 'Hechos', hechosKids));

    const lb = memo.linea_base || null;
    if (lb && (lb.descripcion || lb.rango_indice_72h != null)) {
      out.push(section('linea', 'Línea base', [
        lb.descripcion ? h('div', { key: 'd', style: TEXT }, rich(lb.descripcion, 'lb')) : null,
        lb.rango_indice_72h != null
          ? h('div', { key: 'r', style: CAPTION }, 'Rango del índice a 72 h si no se hace nada: ' + fmtRango(lb.rango_indice_72h))
          : null,
      ]));
    }

    if (caminos.length) out.push(section('caminos', 'Caminos', caminos.map((c, i) => caminoCard(c, i))));
    if (memo.sin_camino_b_porque && caminos.length < 2) {
      out.push(section('sinb', 'Sin camino B', [h('div', { key: 't', style: TEXT }, rich(memo.sin_camino_b_porque, 'sb'))]));
    }

    if (senales.h24 || senales.h48 || senales.h72 || senales.cambiar_si) {
      out.push(section('senales', 'Señales', [
        h('div', {
          key: 'g',
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
        }, [['h24', 'A 24 h'], ['h48', 'A 48 h'], ['h72', 'A 72 h']].map(([k, label]) => {
          const s = senales[k] || {};
          return h('div', { key: k, style: CARD }, [
            h('div', { key: 't', style: { fontWeight: 600 } }, label),
            h(ListBlock, { key: 'b', title: 'Va bien si', items: s.va_bien_si }),
            h(ListBlock, { key: 'm', title: 'Va mal si', items: s.va_mal_si }),
          ]);
        })),
        h(ListBlock, { key: 'c', title: 'Cambiar de camino si', items: senales.cambiar_si }),
      ]));
    }

    // La recomendación siempre se muestra.
    out.push(section('rec', 'Recomendación del consejo', [
      h('div', { key: 'c', style: { fontWeight: 600 } },
        (rec.camino != null ? 'Camino ' + rec.camino : 'Sin camino recomendado') +
        (rec.confianza_cualitativa ? ' · confianza ' + rec.confianza_cualitativa : '')),
      rec.porque ? h('div', { key: 'p', style: TEXT }, rich(rec.porque, 'rp')) : null,
    ]));

    const disenso = asList(memo.disenso);
    const objeciones = arr(memo.objeciones_da);
    if (disenso.length || objeciones.length) {
      out.push(section('disenso', 'Disenso y abogado del diablo', [
        disenso.length ? h(ListBlock, { key: 'd', title: 'Disenso', items: disenso }) : null,
        objeciones.length ? subBlock('Objeciones', objeciones.map((o, i) => h('div', { key: 'o' + i, style: CARD }, [
          h('div', { key: 't', style: TEXT }, rich(o.texto, 'ot' + i)),
          h('div', { key: 'b', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } }, [
            h(Badge, { key: 'e', tone: objTone(o.estado) }, o.estado || 'sin estado'),
            o.como ? h('span', { key: 'c', style: CAPTION }, o.como) : null,
          ]),
        ]))) : null,
      ]));
    }

    if (vetos.length) out.push(section('vetos', 'Vetos', vetos.map(vetoCard)));

    if (borradores.length) {
      out.push(section('borradores', 'Borradores', borradores.map((b, i) => {
        const rev = b.revision || null;
        const ok = !!(rev && rev.ok);
        const alertas = rev && rev.alertas ? rev.alertas : 0;
        return h('div', { key: 'b' + i, style: CARD }, [
          h('div', { key: 't', style: { fontWeight: 600 } }, (b.tipo_plantilla || 'Borrador') + (b.canal ? ' · ' + b.canal : '')),
          h('div', { key: 'x', style: { whiteSpace: 'pre-wrap', lineHeight: 1.5 } }, rich(b.texto, 'bt' + i)),
          h(Badge, { key: 'r', tone: ok ? 'ok' : 'warn' },
            ok ? '✓ Revisión sin alertas'
              : '⚠ ' + (alertas ? alertas + ' alerta' + (alertas === 1 ? '' : 's') : 'Sin revisión')),
        ]);
      })));
    }
    if (review.length) {
      out.push(section('revision', 'Revisión automática', review.map((p, i) => h('div', { key: 'p' + i, style: TEXT },
        (/^(ok|pasa|cumple|sí|si|correcto)$/i.test(String(p.estado || '')) ? '✓ ' : '⚠ ') +
        (p.nombre || p.id || 'Punto') + (p.nota ? ' — ' + short(p.nota, 200) : '')))));
    }

    out.push(section('limites', 'Límites', [h(ListBlock, {
      key: 'l', items: asList(memo.limites).concat(['El asesor aconseja; la agencia decide.']),
    })]));

    return h('div', { style: { display: 'flex', flexDirection: 'column' } }, out);
  }

  /**
   * Borrador de contención (ronda C): llega en segundos, antes que el memorando. Siempre se marca
   * como borrador: ninguna declaración se publica sin aprobación humana (spec §3.2).
   */
  function HoldingBlock(props) {
    const hd = (props.holding && props.holding.holding) || {};
    const rev = (props.holding && props.holding.revision) || {};
    const kids = [
      h('div', { key: 'b', style: CAPTION }, [h(Badge, { key: 'bd', tone: 'warn' }, 'Borrador'), ' Para aprobación humana. Complete lo que está entre llaves antes de usarlo.']),
      h('div', { key: 't', style: Object.assign({ whiteSpace: 'pre-wrap' }, TEXT) }, rich(hd.texto_final || '', 'ht')),
    ];
    if (rev.alertas) kids.push(h('div', { key: 'r', style: CAPTION }, '⚠ ' + rev.alertas + ' alerta(s) de la revisión automática'));
    return section('contencion', 'Borrador de contención', kids);
  }

  /** Barra de avance por rondas y líneas por asiento. Sin porcentajes inventados. */
  function ProgressBlock(props) {
    const s = props.sum;
    const done = Math.min(s.rondasHechas, ROUNDS_TOTAL);
    const kids = [];
    if (s.ronda != null) {
      // La ronda 0 (hechos) y la revisión (6) no entran en el conteo de 1 a 5.
      kids.push(h('div', { key: 'lb', style: CAPTION },
        (s.ronda >= 1 && s.ronda <= ROUNDS_TOTAL ? 'Ronda ' + s.ronda + ' de ' + ROUNDS_TOTAL : (s.ronda === 0 ? 'Hechos' : 'Revisión')) +
        (s.nombreRonda && s.ronda >= 1 && s.ronda <= ROUNDS_TOTAL ? ' · ' + s.nombreRonda : '')));
      const segs = [];
      for (let i = 0; i < ROUNDS_TOTAL; i += 1) {
        segs.push(h('span', { key: i, style: { flex: 1, height: 4, borderRadius: 2, background: i < done ? 'var(--accent)' : 'var(--hairline)' } }));
      }
      kids.push(h('div', {
        key: 'bar', role: 'progressbar', 'aria-label': 'Avance por rondas',
        'aria-valuemin': 0, 'aria-valuemax': ROUNDS_TOTAL, 'aria-valuenow': done,
        style: { display: 'flex', gap: 3 },
      }, segs));
    }
    if (s.asientos.length) kids.push(h('div', { key: 'as', style: CAPTION }, s.asientos.map((a) => a + ' ✓').join(' · ') + ' · …'));
    if (s.estado) kids.push(h('div', { key: 'es', style: CAPTION }, s.estado));
    if (!kids.length) kids.push(h('div', { key: 'nx', style: CAPTION }, STATUS_TEXT.running));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, kids);
  }

  function notice(key, text, tone) {
    const color = tone === 'warn' ? 'var(--warn)' : 'var(--neg)';
    return h('div', {
      key,
      style: { border: '1px solid ' + color, borderRadius: 'var(--r-md, 8px)', padding: '6px 9px', fontSize: 'var(--fs-caption)', color: 'var(--text)' },
    }, text);
  }

  function eventLine(e) {
    const p = e.payload || {};
    switch (e.type) {
      case 'round_started': return 'Ronda ' + p.ronda + (p.nombre ? ' · ' + p.nombre : '') + ' iniciada';
      case 'seat_done': return (p.asiento || 'Asiento') + ' ✓' + (p.resumen ? ': ' + short(p.resumen) : '') +
        (p.citasInvalidas ? ' · ' + p.citasInvalidas + ' sin respaldo' : '');
      case 'round_done': return 'Ronda ' + (p.ronda != null ? p.ronda : '') + ' terminada';
      case 'memo': return 'Memorando listo';
      case 'review': return 'Revisión: ' + arr(p.puntos).length + ' puntos';
      case 'veto': return 'Veto de ' + (p.asiento || 'asiento') + ': ' + short(p.texto);
      case 'holding_statement': return 'Borrador de contención listo';
      case 'error': return 'Error: ' + (p.message || p.code || '');
      case 'cancelled': return 'Corrida cancelada';
      case 'status': return short(p.texto);
      default: return short(p.texto || p.text || p.resumen || e.type);
    }
  }

  function choiceLabel(c, caminos) {
    if (c === 'A' || c === 'B') {
      const i = c === 'A' ? 0 : 1;
      const nombre = caminos[i] && caminos[i].nombre;
      return c + (nombre ? ' · ' + nombre : '');
    }
    return c;
  }

  /** Panel de una corrida (caminos 2 y 3): progreso, memorando, elección y deliberación. */
  function RunPanel(props) {
    const m = props.m;
    const actions = props.actions || {};
    const [showDelib, setShowDelib] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);

    const events = arr(m.events);
    const sum = summarize(events);
    const status = m.runStatus || 'queued';
    const running = !isTerminal(status);
    const memo = m.memo || null;
    const run = m.run || {};
    const choice = run.choice || null;
    const caminos = memo ? arr(memo.caminos) : [];
    const kids = [];

    if (running && !m.pollError) {
      kids.push(h(ProgressBlock, { key: 'pb', sum }));
      kids.push(m.cancelRequested
        ? h('div', { key: 'cc', style: CAPTION }, 'Cancelando…')
        : h('button', {
            key: 'cb', type: 'button', style: BTN,
            onClick: () => { if (actions.cancel) actions.cancel(m); },
          }, 'Cancelar'));
    }
    if (m.pollError) kids.push(notice('pe', 'No pudimos seguir la corrida: ' + m.pollError + ' Recarga el chat para reintentar.', 'bad'));
    if (!running && status !== 'done') {
      kids.push(notice('st', STATUS_TEXT[status] || 'Corrida terminada.', status === 'cancelled' ? 'warn' : 'bad'));
    }

    if (sum.holding) kids.push(h(HoldingBlock, { key: 'hold', holding: sum.holding }));

    if (!memo && sum.vetos.length) {
      kids.push(section('vetos-en-curso', 'Vetos pendientes del memorando', sum.vetos.map((v, i) => vetoCard({ asiento: v.asiento, texto: v.texto, estado: 'pendiente' }, i))));
    }

    if (memo) kids.push(h(MemoView, { key: 'memo', memo, review: sum.review || [] }));

    if (memo) {
      const opciones = [];
      if (caminos.length >= 1) opciones.push(['A', 'A']);
      if (caminos.length >= 2) opciones.push(['B', 'B']);
      opciones.push(['otro', 'Otro'], ['ninguno', 'Ninguno']);
      const elegir = (c) => {
        setBusy(true); setErr(null);
        Promise.resolve(actions.choose ? actions.choose(m, c, note.trim()) : null)
          .then(() => setBusy(false))
          .catch((e) => { setErr((e && e.message) || 'No se pudo guardar la elección.'); setBusy(false); });
      };
      kids.push(choice
        ? h('div', { key: 'ch', style: { fontWeight: 600 } },
            'Elegido: ' + choiceLabel(choice, caminos) + (run.choiceNote ? ' — ' + run.choiceNote : ''))
        : h('div', { key: 'ch', style: SECTION }, [
            h('div', { key: 't', style: HEAD }, 'Elegimos'),
            h('textarea', {
              key: 'n', rows: 2, maxLength: 500, value: note, disabled: busy,
              placeholder: 'Nota opcional (máximo 500 caracteres)',
              onChange: (e) => setNote(e.target.value),
              style: { width: '100%', boxSizing: 'border-box', fontSize: 'var(--fs-body-sm)', padding: 6, borderRadius: 6, border: '1px solid var(--hairline)', background: 'var(--canvas)', color: 'var(--text)' },
            }),
            h('div', { key: 'cnt', style: CAPTION }, note.length + '/500'),
            h('div', { key: 'b', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              opciones.map(([val, label]) => h('button', {
                key: val, type: 'button', style: BTN, disabled: busy, onClick: () => elegir(val),
              }, label))),
            err ? h('div', { key: 'e', style: { ...CAPTION, color: 'var(--neg)' } }, err) : null,
          ]));
    }

    if (events.length) {
      kids.push(h('div', { key: 'dl', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
        h('button', {
          key: 'tg', type: 'button', style: BTN, 'aria-expanded': showDelib,
          onClick: () => {
            if (!showDelib) track('advisor_deliberation_open');
            setShowDelib(!showDelib);
          },
        }, showDelib ? 'Ocultar la deliberación' : 'Ver la deliberación'),
        showDelib ? h('ol', {
          key: 'ls', style: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-2)', lineHeight: 1.45 },
        }, events.map((e) => h('li', { key: e.seq }, eventLine(e)))) : null,
      ]));
    }

    return h('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 } }, kids.filter(Boolean));
  }

  function TriageLine(props) {
    const t = props.triage || {};
    const nombre = CAMINO_NOMBRE[t.camino] || ('Camino ' + t.camino);
    return h('div', { style: { fontSize: 'var(--fs-caption)', color: 'var(--text-2)', marginBottom: 6, lineHeight: 1.45 } },
      nombre + (t.motivo ? ' · ' + t.motivo : ''));
  }

  /** Notas de progreso del camino 1 mientras no hay texto. */
  function Progress(props) {
    const items = props.items || [];
    if (items.length === 0) return null;
    return h('ul', { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
      items.map((t, i) => h('li', {
        key: i,
        style: { fontSize: 'var(--fs-caption)', color: 'var(--text-3)', display: 'flex', gap: 6, alignItems: 'center' },
      }, [
        h('span', { key: 'd', 'aria-hidden': true, style: { width: 5, height: 5, borderRadius: 3, background: 'var(--accent)', display: 'inline-block' } }),
        h('span', { key: 't' }, t),
      ])));
  }

  /** Pie del memorando/respuesta: citas y revisión automática (spec §3.3, paso 8). */
  function Footer(props) {
    const meta = props.meta;
    if (!meta) return null;
    const c = meta.citations || { total: 0, invalid: 0 };
    const alertas = (meta.revision && meta.revision.alertas) || 0;
    return h('div', {
      style: { marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' },
    },
      'Citas: ' + c.total + (c.invalid ? ' · ' + c.invalid + ' sin respaldo' : '') +
      ' · Revisión: ' + (alertas ? alertas + ' alerta' + (alertas === 1 ? '' : 's') : 'sin alertas') +
      ' · El asesor aconseja; la agencia decide.');
  }

  /** Selector de dos modos en la cabecera del drawer. */
  function ModeSelector(props) {
    const { mode, onChange } = props;
    const opt = (key, label) => h('button', {
      key,
      className: 'chat-mode-btn' + (mode === key ? ' active' : ''),
      'aria-pressed': mode === key,
      onClick: () => onChange(key),
      style: {
        padding: '3px 9px', fontSize: 'var(--fs-caption)', borderRadius: 'var(--r-pill, 999px)',
        border: '1px solid var(--hairline)',
        background: mode === key ? 'var(--accent-fill)' : 'transparent',
        color: mode === key ? 'var(--text)' : 'var(--text-2)', cursor: 'pointer',
      },
    }, label);
    return h('div', { role: 'group', 'aria-label': 'Modo del chat', style: { display: 'flex', gap: 4 } }, [
      opt('descriptive', 'Descriptivo'),
      opt('advisor', 'Asesor'),
    ]);
  }

  /** Botones de forzado junto al envío (solo en modo Asesor). */
  function ForceButtons(props) {
    const dis = !!props.disabled;
    const style = { ...BTN, opacity: dis ? 0.5 : 1, cursor: dis ? 'default' : 'pointer', whiteSpace: 'nowrap' };
    return h('div', { style: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' } }, [
      h('button', {
        key: 'c', type: 'button', style, disabled: dis, title: 'Pide el consejo completo (camino 3)',
        onClick: () => props.onForce('council'),
      }, 'Convocar al consejo'),
      h('button', {
        key: 'q', type: 'button', style, disabled: dis, title: 'Respuesta rápida, si el piso lo permite',
        onClick: () => props.onForce('quick'),
      }, 'Respuesta rápida'),
    ]);
  }

  /** Elementos extra de una burbuja del asistente en modo Asesor. */
  function renderExtras(m, actions) {
    if (!m || m.role !== 'assistant') return null;
    const parts = [];
    if (m.triage) parts.push(h(TriageLine, { key: 'tr', triage: m.triage }));
    if (!m.content && !m.runId && m.progress && m.progress.length) {
      parts.push(h(Progress, { key: 'p', items: m.progress }));
    }
    // El camino 1 guarda runId pero responde en el propio stream: no tiene panel.
    if (m.runId && m.camino !== 1) parts.push(h(RunPanel, { key: 'run', m, actions: actions || {} }));
    if (m.meta) parts.push(h(Footer, { key: 'f', meta: m.meta }));
    return parts.length ? parts : null;
  }

  window.ECO_ADVISOR = {
    canAdvise,
    ModeSelector,
    ForceButtons,
    renderExtras,
    httpErrorText,
    track,
    durationBucket,
    trackRunDone,
    isTerminal,
    fetchRun,
    fetchEvents,
    postJSON,
    applyEvents,
    applyRun,
    EVENTS_PAGE,
    POLL_MS,
  };
})();
