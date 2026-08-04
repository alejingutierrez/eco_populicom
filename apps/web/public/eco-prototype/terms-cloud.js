// =============================================================================
// TermsCloud — nube de palabras de Menciones
// -----------------------------------------------------------------------------
// Pedido explícito del cliente: "nubes de palabras, algo bien dinámico y bien
// hecho". La honestidad obliga a decir que una nube tipo Wordle es la PEOR forma
// conocida de comparar magnitudes: el área no es perceptualmente lineal, la
// rotación y el empaque azaroso meten dos variables visuales sin significado, y
// no admite orden ni comparación entre términos no adyacentes.
//
// "Bien hecha" tiene entonces una sola definición defendible: un componente de
// DOS VISTAS HERMANAS que comparten datos, selección y estado —
//   · Nube    → reconocimiento de patrón en 300 ms, que es lo que la nube regala
//   · Ranking → la magnitud exacta, ordenable, y de paso la alternativa accesible
// y que la nube gaste sus canales libres en lo que las nubes desperdician:
// color = polaridad del término, punto = término nuevo, tooltip = delta.
//
// DECISIONES (ver docs/auditoria-diseno-2026-07-menciones.md):
//
//  1. Layout DETERMINISTA sin RNG. d3-cloud usa Math.random() internamente, así
//     que el layout salta en cada render y destruye la memoria espacial — que es
//     lo único que una nube regala. Aquí: reparto greedy por rango en filas
//     centradas, con orden `centerOut` dentro de cada fila (el mayor al centro).
//     El mismo input da siempre el mismo layout.
//  2. HTML posicionado, no SVG <text>. Da botones nativos (foco, aria-pressed,
//     Enter/Espacio), permite `.touch-target` para los 44px táctiles, el texto
//     es copiable, y no añade un décimo SVG sin <title> al producto.
//  3. Click hace TOGGLE y filtra la lista de la misma pantalla. NO abre
//     MentionsSliceModal: ese modal existe para agregados que no tienen lista al
//     lado (heatmap, mapa, termómetro); aquí la lista está a ~200px.
//  4. La selección se expresa SUMANDO (relleno + anillo), nunca atenuando el
//     resto: medido, --wc-neg-2 a opacidad 0.70 cae a 3.39:1, bajo AA.
//  5. Términos en Krub, cifras en Besley. Besley tiene contraste 1.675 y se
//     rompe por halación a 14-18px sobre --canvas, justo donde vive media nube.
// =============================================================================

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// --- medición de texto: un solo canvas con caché ---------------------------
const _mctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const _mcache = new Map();
function measure(text, px, weight) {
  const k = `${px}|${weight}|${text}`;
  const hit = _mcache.get(k);
  if (hit != null) return hit;
  if (!_mctx) return text.length * px * 0.55;
  // Krub con fallback al stack del sistema: si la fuente no cargó todavía la
  // medida sale algo distinta, pero el layout es determinista para un estado de
  // carga dado y se re-mide cuando el documento anuncia las fuentes listas.
  _mctx.font = `${weight} ${px}px Krub, -apple-system, BlinkMacSystemFont, sans-serif`;
  const wpx = _mctx.measureText(text).width;
  _mcache.set(k, wpx);
  return wpx;
}

// --- escala de tamaño ------------------------------------------------------
// sqrt del valor NORMALIZADO: crecimiento cóncavo, que corrige parcialmente la
// sobre-lectura del área. Se rechaza la escala por RANGO (posición 1..N): es más
// bonita y miente, porque aplana la cola larga y hace que el #1 con 400
// menciones y el #2 con 12 parezcan vecinos.
function sizeScale(vals, fsMin, fsMax) {
  const finite = vals.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return () => Math.round((fsMin + fsMax) / 2);
  const vMin = Math.min(...finite);
  const vMax = Math.max(...finite);
  if (vMax === vMin) return () => Math.round((fsMin + fsMax) / 2);
  return (v) => {
    const n = (Math.max(vMin, Math.min(vMax, v)) - vMin) / (vMax - vMin);
    return Math.round(fsMin + (fsMax - fsMin) * Math.sqrt(n));
  };
}

// --- color por polaridad ---------------------------------------------------
// `polarity` llega null cuando el término tiene menos de 5 menciones: por debajo
// de esa base el signo es ruido, así que se pinta neutro en vez de afirmar algo
// que el dato no sostiene.
function polarityColor(p) {
  if (p == null) return 'var(--wc-neu)';
  if (p <= -0.5) return 'var(--wc-neg-2)';
  if (p < -0.15) return 'var(--wc-neg-1)';
  if (p < 0.15) return 'var(--wc-neu)';
  if (p < 0.5) return 'var(--wc-pos-1)';
  return 'var(--wc-pos-2)';
}
function polarityWord(p) {
  if (p == null) return 'sin base suficiente';
  if (p <= -0.5) return 'muy negativo';
  if (p < -0.15) return 'negativo';
  if (p < 0.15) return 'neutral';
  if (p < 0.5) return 'positivo';
  return 'muy positivo';
}

// --- layout: filas centradas, orden serpentina ------------------------------
// Reparto greedy en orden de rango. Dentro de cada fila los términos se ordenan
// `centerOut` (el de mayor rango al centro), lo que da la silueta de nube sin
// azar. Devuelve posiciones absolutas en px.
function layoutRows(items, width, gapX, gapY) {
  const rows = [];
  let cur = [];
  let curW = 0;
  for (const it of items) {
    // Un término más ancho que el contenedor (pasa en 340px con frases) se
    // recorta a la fila completa en vez de desbordar.
    if (it.w > width) it.w = width;
    const need = it.w + (cur.length ? gapX : 0);
    if (cur.length && curW + need > width) {
      rows.push(cur);
      cur = [it];
      curW = it.w;
    } else {
      cur.push(it);
      curW += need;
    }
  }
  if (cur.length) rows.push(cur);

  const placed = [];
  let y = 0;
  for (const row of rows) {
    // centerOut: [a,b,c,d,e] → [e,c,a,b,d] para que el mayor quede al centro
    const left = [];
    const right = [];
    row.forEach((it, i) => (i % 2 === 0 ? left.unshift(it) : right.push(it)));
    const ordered = left.concat(right);
    const rowW = ordered.reduce((s, it) => s + it.w, 0) + gapX * (ordered.length - 1);
    const rowH = Math.max(...ordered.map((it) => it.h));
    let x = Math.max(0, (width - rowW) / 2);
    for (const it of ordered) {
      placed.push({ ...it, x, y: y + (rowH - it.h) / 2 });
      x += it.w + gapX;
    }
    y += rowH + gapY;
  }
  return { placed, height: Math.max(0, y - gapY) };
}

// =============================================================================
function TermsCloud({ filters, period, agency, onToggleTerm, selected }) {
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('eco.terms.view') || 'cloud'; } catch (_) { return 'cloud'; }
  });
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem('eco.terms.mode') || 'distinctive'; } catch (_) { return 'distinctive'; }
  });
  const [state, setState] = useState({ phase: 'loading', data: null, error: null });
  const [hover, setHover] = useState(null);
  const [w, setW] = useState(0);
  const boxRef = useRef(null);
  const bp = (window.ecoUseBreakpoint ? window.ecoUseBreakpoint() : 'desktop');
  const isMobile = bp === 'mobile';

  useEffect(() => { try { localStorage.setItem('eco.terms.view', view); } catch (_) {} }, [view]);
  useEffect(() => { try { localStorage.setItem('eco.terms.mode', mode); } catch (_) {} }, [mode]);
  // En móvil el Ranking es la vista por defecto: una nube en 340px de ancho cabe
  // con 12 términos y pierde su única ventaja.
  useEffect(() => { if (isMobile && view === 'cloud') setView('rank'); }, [isMobile]);

  // ancho del contenedor
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const m = () => setW(Math.max(0, Math.floor(el.getBoundingClientRect().width)));
    m();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(m); ro.observe(el); }
    window.addEventListener('resize', m);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', m); };
  }, []);

  // re-medir cuando las fuentes acaben de cargar (Krub cambia los anchos)
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) { setFontsReady(true); return; }
    document.fonts.ready.then(() => { _mcache.clear(); setFontsReady(true); }).catch(() => setFontsReady(true));
  }, []);

  // --- datos: MISMOS filtros que la lista, para que nunca discrepen ---------
  const filterKey = JSON.stringify(filters || {});
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ phase: 'loading', data: null, error: null });
    const p = new URLSearchParams({ mode, limit: isMobile ? '40' : '70' });
    if (agency) p.set('agency', agency);
    if (period) p.set('period', period);
    for (const [k, v] of Object.entries(filters || {})) {
      if (v != null && v !== '' && v !== 'all') p.set(k, String(v));
    }
    fetch('/api/eco-terms?' + p.toString(), { cache: 'no-store', signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((d) => setState({ phase: 'ready', data: d, error: null }))
      .catch((e) => { if (e.name !== 'AbortError') setState({ phase: 'error', data: null, error: String(e.message || e) }); });
    return () => ctrl.abort();
  }, [mode, agency, period, filterKey, isMobile]);

  const terms = (state.data && state.data.terms) || [];
  const selSet = useMemo(() => new Set(selected || []), [selected]);

  // --- layout memoizado ----------------------------------------------------
  const fsMin = isMobile ? 13 : 14;
  const fsMax = isMobile ? 28 : 40;
  const laid = useMemo(() => {
    if (!w || terms.length === 0) return { placed: [], height: 0 };
    const scale = sizeScale(terms.map((t) => (mode === 'frequent' ? t.df : t.score)), fsMin, fsMax);
    const items = terms.map((t, i) => {
      const px = scale(mode === 'frequent' ? t.df : t.score);
      const weight = px >= 24 ? 600 : 500;
      const padX = 9;
      const padY = 5;
      return {
        key: t.term, t, rank: i, px, weight,
        w: Math.ceil(measure(t.term, px, weight)) + padX * 2,
        h: Math.ceil(px * 1.25) + padY * 2,
      };
    });
    // Margen de seguridad: `measure()` mide con canvas y el render real puede
    // diferir un par de píxeles por sub-pixel/kerning. Sin este colchón un
    // término de la última posición de una fila se sale del borde de la card.
    return layoutRows(items, Math.max(80, w - 8), 6, 6);
  }, [terms, w, mode, fsMin, fsMax, fontsReady]);

  const maxDf = terms.reduce((m, t) => Math.max(m, t.df), 0) || 1;
  const nNew = terms.filter((t) => t.isNew).length;

  // --- controles -----------------------------------------------------------
  const header = (
    // En móvil el título y los conmutadores NO caben en una línea: sin esto el
    // título se parte en 3 líneas y el subtítulo en 8. Se apilan.
    <div className="card-hd" style={{
      flexWrap: 'wrap', gap: 'var(--sp-2)',
      flexDirection: isMobile ? 'column' : 'row',
      alignItems: isMobile ? 'stretch' : 'flex-start',
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="card-hd-title">Términos de la conversación</div>
        <div className="card-hd-sub">
          {state.phase === 'ready' && state.data
            ? (mode === 'distinctive'
                ? (state.data.refMode === 'siblings'
                    ? 'Lo que distingue a esta selección del resto del período'
                    : `Lo que distingue este período de los ${state.data.refDays} días anteriores`)
                : 'Los términos más frecuentes del período')
            : 'Cargando…'}
          {nNew > 0 && <> · <strong style={{ color: 'var(--accent)' }}>{nNew} nuevo{nNew === 1 ? '' : 's'}</strong></>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', flexShrink: 0 }}>
        <div className="toggle-group" role="group" aria-label="Criterio de los términos">
          {[['distinctive', 'Distintivos'], ['frequent', 'Frecuentes']].map(([k, l]) => (
            <button key={k} className={`chip ${mode === k ? 'active' : ''}`} aria-pressed={mode === k}
              onClick={() => setMode(k)}>{l}</button>
          ))}
        </div>
        <div className="toggle-group" role="group" aria-label="Forma de ver los términos">
          {[['cloud', 'Nube'], ['rank', 'Ranking']].map(([k, l]) => (
            <button key={k} className={`chip ${view === k ? 'active' : ''}`} aria-pressed={view === k}
              onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );

  // --- selección activa ----------------------------------------------------
  const chips = selSet.size > 0 && (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center',
                  padding: 'var(--sp-2) var(--pad-card)', borderTop: '1px solid var(--hairline)' }}>
      <span className="t-caption">Filtrando por</span>
      {[...selSet].map((t) => (
        <button key={t} className="chip active touch-target" onClick={() => onToggleTerm(t)}
          aria-label={`Quitar el término ${t} del filtro`}>
          {t} <span aria-hidden="true">×</span>
        </button>
      ))}
      {/* El API tope 8 tokens con AND entre ellos (eco-mentions route.ts:226-236).
          Se declara para que la multi-selección no sea un comando fantasma. */}
      {selSet.size >= 8 && (
        <span className="t-caption" style={{ color: 'var(--warn)' }}>
          Máximo 8 términos · se combinan con Y
        </span>
      )}
    </div>
  );

  if (state.phase === 'error') {
    return (
      <div className="card">
        {header}
        <div className="card-bd t-body-sm" style={{ color: 'var(--text-3)' }}>
          No se pudieron cargar los términos: {state.error}
        </div>
      </div>
    );
  }

  if (state.phase === 'ready' && terms.length === 0) {
    return (
      <div className="card">
        {header}
        <div className="card-bd t-body-sm" style={{ color: 'var(--text-3)' }}>
          No hay suficientes menciones en esta selección para extraer términos con confianza.
          {' '}Prueba un período más amplio o quita algún filtro.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {header}
      <div className="card-bd" ref={boxRef} style={{ minHeight: 120 }}>
        {state.phase === 'loading' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[92, 140, 68, 116, 84, 156, 72, 104, 128, 88].map((sw, i) => (
              <div key={i} className="skeleton" style={{ width: sw, height: 30, borderRadius: 'var(--r-sm)' }} />
            ))}
          </div>
        ) : view === 'cloud' ? (
          <div role="listbox" aria-multiselectable="true" aria-label="Términos de la conversación"
            style={{ position: 'relative', height: laid.height, transition: 'height var(--dur) var(--ease)' }}>
            {laid.placed.map((it) => {
              const t = it.t;
              const on = selSet.has(t.term);
              return (
                <button key={it.key} role="option" aria-selected={on}
                  className="wc-term touch-target"
                  onClick={() => onToggleTerm(t.term)}
                  onMouseEnter={() => setHover(t.term)}
                  onMouseLeave={() => setHover((h) => (h === t.term ? null : h))}
                  onFocus={() => setHover(t.term)}
                  onBlur={() => setHover((h) => (h === t.term ? null : h))}
                  aria-label={`${t.term}: ${t.df} menciones, ${polarityWord(t.polarity)}${t.isNew ? ', nuevo en este período' : ''}`}
                  style={{
                    position: 'absolute', left: it.x, top: it.y,
                    width: it.w, height: it.h,
                    fontFamily: 'var(--ff-sans)',
                    fontSize: it.px, fontWeight: it.weight, lineHeight: 1.25,
                    color: polarityColor(t.polarity),
                    background: on ? 'var(--accent-fill)' : 'transparent',
                    boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'none',
                    border: 'none', borderRadius: 'var(--r-sm)',
                    cursor: 'pointer', padding: 0,
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    transition: 'left var(--dur) var(--ease), top var(--dur) var(--ease), background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
                  }}>
                  {t.term}
                  {t.isNew && (
                    <span aria-hidden="true" style={{
                      position: 'absolute', top: 2, right: 2,
                      width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)',
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {terms.map((t) => {
              const on = selSet.has(t.term);
              return (
                <li key={t.term}>
                  <button onClick={() => onToggleTerm(t.term)} aria-pressed={on}
                    className="row-hover"
                    aria-label={`${t.term}: ${t.df} menciones, ${polarityWord(t.polarity)}${t.isNew ? ', nuevo' : ''}`}
                    style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 56px',
                      alignItems: 'center', gap: 'var(--sp-3)', width: '100%',
                      padding: '6px var(--sp-2)', border: 'none', borderRadius: 'var(--r-sm)',
                      background: on ? 'var(--accent-fill)' : 'transparent',
                      boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'none',
                      cursor: 'pointer', textAlign: 'left',
                    }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--ff-sans)', fontSize: 'var(--fs-body)', fontWeight: 500,
                                     color: polarityColor(t.polarity), overflow: 'hidden',
                                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.term}</span>
                      {t.isNew && <span className="pill pill-info" style={{ flexShrink: 0 }}>nuevo</span>}
                    </span>
                    <span className="bar-track" style={{ height: 6 }}>
                      <span style={{ display: 'block', height: '100%', borderRadius: 'inherit',
                                     width: `${Math.max(2, (t.df / maxDf) * 100)}%`,
                                     background: polarityColor(t.polarity) }} />
                    </span>
                    <span className="num t-num-sm" style={{ textAlign: 'right', color: 'var(--text-2)' }}>{t.df}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        {/* Tooltip: se apoya en el hover/foco de arriba, así que funciona con teclado. */}
        {hover && (() => {
          const t = terms.find((x) => x.term === hover);
          if (!t) return null;
          return (
            <div role="status" style={{
              marginTop: 'var(--sp-3)', padding: 'var(--sp-2) var(--sp-3)',
              background: 'var(--surface-raised)', border: '1px solid var(--hairline-strong)',
              borderRadius: 'var(--r-sm)', display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap',
              fontSize: 'var(--fs-caption)',
            }}>
              <span style={{ fontWeight: 600, color: polarityColor(t.polarity) }}>{t.term}</span>
              <span><span className="num" style={{ color: 'var(--text)' }}>{t.df}</span> menciones</span>
              <span style={{ color: 'var(--text-2)' }}>{polarityWord(t.polarity)}</span>
              {t.isNew && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>no aparecía en el período anterior</span>}
              {t.firstSeen && <span style={{ color: 'var(--text-3)' }}>primera vez: {t.firstSeen}</span>}
            </div>
          );
        })()}
      </div>
      {chips}
      {/* Nota de método: la nube es mala para comparar magnitudes y el producto
          lo dice en vez de fingir que no. El Ranking es la vista precisa. */}
      <div className="card-bd" style={{ paddingTop: 0 }}>
        <div className="t-caption" style={{ color: 'var(--text-3)' }}>
          El tamaño indica {mode === 'frequent' ? 'la frecuencia' : 'lo distintivo'} y el color el sentimiento
          medio del término. Para comparar cifras exactas usa el Ranking: en una nube el área
          se lee mal por naturaleza.
        </div>
      </div>
    </div>
  );
}

window.ECO_TERMS = { TermsCloud };
