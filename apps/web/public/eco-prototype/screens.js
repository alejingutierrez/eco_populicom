// Dashboard + screens
const { Sparkline, AreaLineChart, MultiLineChart, SeriesPanels, BandScale, StackedAreaChart, Donut, HBarList, RadialGauge, Heatmap, PRMap, useChartWidth } = window.ECO_CHARTS;
const { EmptyState, Avatar, MentionDrawer, MentionsSliceModal, MetricInsightModal } = window.ECO_SHELL;
const D = window.ECO_DATA;
const I2 = window.Icons;

// Fetch autenticado para los feeds. Si la API responde 401 (sesión expirada),
// intenta renovar UNA vez con el refresh token (/api/auth/refresh) y reintenta.
// Si no se puede renovar, lanza un error con code=401 — así la pantalla puede
// distinguir "sesión caída" de "sin resultados" (antes un 401 se mostraba como
// lista vacía, indistinguible de un período sin menciones).
async function ecoFetchAuthed(url, opts) {
  let res = await fetch(url, opts);
  if (res.status === 401) {
    const renewed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((r) => r.ok)
      .catch(() => false);
    if (!renewed) { const e = new Error('UNAUTHENTICATED'); e.code = 401; throw e; }
    res = await fetch(url, opts);
  }
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.code = res.status; throw e; }
  return res.json();
}

// Redirige al login preservando el destino. Se usa cuando ni el refresh token
// permite renovar la sesión.
function ecoBounceToSignIn() {
  location.href = '/sign-in?next=' + encodeURIComponent(location.pathname + location.search);
}

// Fuente ÚNICA de la banda de Riesgo de Crisis (escala 0–1) para que el
// veredicto NO difiera entre Overview y Scorecard. Cortes: NORMAL <0.25,
// ELEVADO <0.40, ALERTA <0.60, CRISIS ≥0.60 (mismos del backend/termómetro).
// Bandas canónicas de cada métrica, con sus umbrales REALES. Antes cada gauge
// repartía sus etiquetas en cuartos iguales con `justify-content: space-between`,
// así que "ALERTA" quedaba impresa sobre la zona de CRISIS.
// La rampa usa LOS MISMOS TOKENS QUE LA PALABRA. El titular se colorea con
// BAND_TONE de @eco/shared/format (ALERTA → 'neg' → --neg) y el gradiente del
// modal de shell.js también pinta 0.40–1 en --neg; sólo esta banda usaba
// --accent, así que el MISMO estado salía rosa en la palabra y naranja en la
// banda a 300px de distancia. Y --accent es identidad de marca (nav activa,
// chip activo, tokens.css §5), no un nivel de severidad: en naranja la banda
// se leía como "seleccionada". Los dos tramos de alarma comparten hue y se
// separan por saliencia: 0.40–0.60 mezclado con el canvas (menos contraste),
// ≥0.60 a plena saturación — así la escala sigue creciendo hacia la derecha
// tanto en modo claro como en oscuro.
// Color de la banda en la que cae un valor. Es la ÚNICA fuente del color de un
// veredicto, y existe porque el titular y su propia banda venían de dos sitios
// distintos: el `tone` que calcula el backend (BAND_TONE en @eco/shared) y la
// tabla de bandas local, que es la que dibuja la barra. Para el veredicto ALERTA
// no coincidían, así que la palabra y la barra que está 30px debajo discrepaban
// sobre el mismo dato. `scale` divide el valor cuando la tabla está en 0-1 y el
// dato llega en otra escala (polarización llega 0-100).
function bandColorAt(bands, value, scale) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value) / (scale || 1);
  const b = bands.find((x) => v >= x.from && v < x.to) || bands[bands.length - 1];
  return b ? b.color : null;
}

const CRISIS_BANDS = [
  { from: 0,    to: 0.25, label: 'Normal',  color: 'var(--pos)' },
  { from: 0.25, to: 0.40, label: 'Elevado', color: 'var(--warn)' },
  { from: 0.40, to: 0.60, label: 'Alerta',  color: 'color-mix(in oklab, var(--neg) 70%, var(--canvas))' },
  { from: 0.60, to: 1,    label: 'Crisis',  color: 'var(--neg)' },
];
// BHI: cálculo interno 0-1, display 1-10 (1 + v*9). Los cortes 0.4/0.6/0.8
// equivalen a 4.6/6.4/8.2 en la escala mostrada.
// Colores de la rampa de VEREDICTO (tokens.css §6), aplicada al revés porque en
// Brand Health lo bueno está a la DERECHA. 'Fuerte' iba en --info: el mejor tramo
// saltaba fuera de la rampa a un token declarado para estados informativos (con
// su par --info-bg/--on-info), y un azul junto al verde se lee como "otra
// categoría", no como "mejor que verde". Así la rampa es monótona en hue:
// rojo → ámbar → verde-amarillo → verde.
const BHI_BANDS = [
  { from: 0,   to: 0.4, label: 'Crítico', color: 'var(--verdict-4)' },
  { from: 0.4, to: 0.6, label: 'Débil',   color: 'var(--verdict-2)' },
  { from: 0.6, to: 0.8, label: 'Sano',    color: 'var(--verdict-1)' },
  { from: 0.8, to: 1,   label: 'Fuerte',  color: 'var(--verdict-0)' },
];
// Polarización V5 (oct-2026) llega 0-100 y mide que haya DOS bandos:
// 2·mín(positivas, negativas)/total. 0 = una sola postura (o todo neutral);
// 100 = mitad a favor y mitad en contra. Mismos cortes que polarizationBand de
// @eco/shared/format (10/25/50) y colores de la rampa de VEREDICTO.
const POLARIZATION_BANDS = [
  { from: 0,  to: 10,  label: 'Sin división',  color: 'var(--neu)' },
  { from: 10, to: 25,  label: 'División leve', color: 'var(--verdict-2)' },
  { from: 25, to: 50,  label: 'Dividida',      color: 'var(--verdict-3)' },
  { from: 50, to: 100, label: 'Polarizada',    color: 'var(--verdict-4)' },
];

function crisisBand(score) {
  const s = score == null ? 0 : score;
  if (s >= 0.60) return { label: 'CRISIS', tone: 'neg', color: 'var(--neg)' };
  // ALERTA en --neg, no --accent: este fallback se usa cuando el payload no trae
  // `display`, y con --accent el MISMO score pintaba el veredicto naranja o rosa
  // según si la API había adjuntado el formato o no.
  if (s >= 0.40) return { label: 'ALERTA', tone: 'neg', color: 'var(--neg)' };
  if (s >= 0.25) return { label: 'ELEVADO', tone: 'warn', color: 'var(--warn)' };
  return { label: 'NORMAL', tone: 'pos', color: 'var(--pos)' };
}

// Badge de tendencia legible: usa el objeto DeltaDisplay del API
// (@eco/shared/format). Distingue "estable" (cambio ≈ 0) de "sin base"
// (falta período de comparación) — antes ambos salían como "0".
// DeltaBadge — la única forma de pintar un delta (WS-F8).
//
// Acepta dos entradas:
//   · `info`  — el objeto DeltaDisplay que ya calcula @eco/shared/format.
//   · `value` + `metricKey` — para los sitios que sólo tienen el número. La
//     dirección la resuelve `window.ecoDeltaColor`, que es la MISMA regla que
//     usa el resto del producto (WS-F4): el volumen es neutro, la crisis es
//     up-bad, el NSS es up-good. Antes había cuatro sitios dibujando ▲/▼ con su
//     propio criterio de color, y uno de ellos pintaba toda subida de volumen
//     como mala.
function DeltaBadge({ info, value, metricKey = null, suffix = '%', decimals = 0 }) {
  if (!info && value != null && Number.isFinite(Number(value))) {
    const v = Number(value);
    const color = window.ecoDeltaColor(metricKey || 'volume', v);
    const arrow = window.ecoDeltaArrow(v);
    return (
      <span style={{ fontSize: 'var(--fs-overline)', color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-05)' }}>
        {arrow} {Math.abs(v).toFixed(decimals)}{suffix}
      </span>
    );
  }
  if (!info) return null;
  // El `tone` de DeltaDisplay lo calcula formatDelta en el backend, que no conoce
  // métricas NEUTRAS: `totalMentions` va sin `invert`, así que toda bajada de
  // volumen llega con tone 'neg' y se pinta roja — mientras Tópicos pinta de rojo
  // la SUBIDA del mismo dato. La dirección declarada del producto manda.
  const neutralMetric = (window.ECO_METRIC_DIRECTION || {})[metricKey] === 'neutral';
  const toneC = neutralMetric ? 'var(--text-2)'
    : ({ pos: 'var(--pos)', neg: 'var(--neg)', neutral: 'var(--text-3)' }[info.tone] || 'var(--text-3)');
  if (!info.hasBaseline) {
    return <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 500 }}>— sin base</span>;
  }
  if (info.direction === 'flat') {
    return <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 600 }}>· {info.word}</span>;
  }
  return (
    <span style={{ fontSize: 'var(--fs-overline)', color: toneC, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-05)' }}>
      {info.arrow} {info.value}
    </span>
  );
}

// KpiCard: dos modos.
//  • valueWord presente → "palabra protagonista" (coloreada por tono) con
//    `value` como número de apoyo debajo. Para métricas 0–1 / con banda.
//  • si no → modo número clásico (volumen, contadores).
// `deltaInfo` (DeltaDisplay) reemplaza al `delta` numérico cuando está presente.
// `valueColor` gana sobre `valueTone`: el color del veredicto tiene que salir de
// la MISMA tabla de bandas que pinta su barra (ver bandColorAt), porque el `tone`
// del payload lo decide el backend y no coincide con ella.
function KpiCard({ label, value, valueWord, valueTone, valueColor, delta, deltaInfo, sub, icon, trendData, accent = 'var(--accent)', tone, toneLabel, highlight, invertDelta, metricKey, children, onClick }) {
  const IconC = icon ? I2[icon] : null;
  const deltaColor = delta == null ? 'var(--text-3)' : (invertDelta ? (delta < 0 ? 'var(--pos)' : 'var(--neg)') : (delta > 0 ? 'var(--pos)' : delta < 0 ? 'var(--neg)' : 'var(--text-3)'));
  const clickable = !!onClick;
  // Estilo ÚNICO del valor de la card, compartido por las dos ramas (palabra y
  // cifra). Estaba declarado dos veces con lineHeight 1.1 y 1 sobre el mismo
  // --fs-num-xl: a 30px son 3px, y bastaba con que una card de la fila mostrara
  // una PALABRA ("Negativo leve") y sus hermanas un número para que sus líneas
  // base no coincidieran. Compartir el objeto hace que no puedan divergir otra
  // vez. El 1.1 gana porque las palabras tienen descendentes; los dígitos no los
  // tienen, así que el espacio de más es constante y no descuadra nada.
  const valueStyle = {
    fontSize: 'var(--fs-num-xl)', fontWeight: 600, lineHeight: 1.1,
    fontFamily: 'var(--ff-display)',
  };
  // 'neutral' no es un escalón de texto. Con 'var(--text-3)' (5.00:1 sobre
  // --canvas, tokens.css §5) el titular "Neutral" del Net Sentiment Score salía
  // tres veces más apagado que el "1.3K" de la card de al lado (15.30:1), y es la
  // métrica que da nombre a la pantalla. Un veredicto neutro es AUSENCIA de
  // juicio: se dice con el color de texto, no con un gris secundario.
  const TONE_C = { neg: 'var(--neg)', warn: 'var(--warn)', pos: 'var(--pos)', accent: 'var(--accent)', neutral: 'var(--text)' };
  const wordMode = valueWord != null;
  return (
    <div
      className="card"
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        // --pad-card, no --sp-5: el paso crudo de la escala rompía el ritmo de las
        // cards hermanas. Medido: el borde del CONTENIDO de cards en la misma
        // rejilla caía en 248 / 265 / 268 px, un escalón visible de 3px que el ojo
        // lee como desalineación aunque los dos valores estén en la escala.
        padding: 'var(--pad-card)', position: 'relative', overflow: 'hidden',
        // Columna flex para que el pie de la card pueda clavarse abajo con
        // `marginTop:auto`: es lo que da una línea inferior común a las cinco
        // cards de la fila, que hoy terminan a cuatro alturas distintas.
        display: 'flex', flexDirection: 'column',
        borderTop: highlight ? `2px solid ${accent}` : undefined,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.12s var(--ease), box-shadow 0.12s var(--ease)',
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)'; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; } : undefined}
    >
      {/* minWidth:0 en el label y flexShrink:0 en la acción: antes un label largo
          ("POLARIZACIÓN") empujaba "Detalles" fuera del `overflow:hidden` de la
          card y se leía "DETALLE". Ahora el que cede es el label, con ellipsis. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', minWidth: 0 }}>
        {/* El relleno del chip se DERIVA del mismo accent del glifo. Con
            `--accent-fill` fijo (naranja al 14%) un icono verde --pos y otro gris
            --text-2 flotaban sobre un fondo naranja: dos colores peleando por un
            solo indicador. */}
        {/* Acromático («Instrumento»): el icono NOMBRA la métrica, no la juzga. Con el
            color de la métrica, el corazón de Brand Health salía verde y el escudo de
            Crisis rojo con cualquier valor — un veredicto fijo junto al real. */}
        {IconC && <div style={{ width: 26, height: 26, borderRadius: 'var(--r-md)', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}><IconC size={14} color="var(--text-2)" /></div>}
        {/* El label envuelve por PALABRA, nunca por letra. `overflowWrap:'anywhere'`
            resolvía el desborde partiendo el rótulo: en 390px se leía "RIESG/O DE/
            CRISI/S" y en desktop "POLARIZ/ACIÓN". La causa real no era el label sino
            la acción "Detalles", que competía por el mismo renglón y nunca cedía
            (flexShrink:0); ahora vive en el pie de la card, así que aquí sobra ancho. */}
        <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-2)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', minWidth: 0, overflowWrap: 'break-word', hyphens: 'none' }}>{label}</div>
        {tone && <span className={`pill pill-${tone}`} style={{ marginLeft: 'auto', flexShrink: 0 }}>{toneLabel || (tone === 'neg' ? 'Alerta' : tone === 'warn' ? 'Elevado' : 'Normal')}</span>}
      </div>
      {wordMode ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <div className="num" style={{ ...valueStyle, color: valueColor || (valueTone ? (TONE_C[valueTone] || 'var(--text)') : 'var(--text)') }}>{valueWord}</div>
            {deltaInfo ? <DeltaBadge info={deltaInfo} metricKey={metricKey} /> : null}
          </div>
          {(value || sub) && (
            <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', fontWeight: 600, marginTop: 'var(--sp-05)' }}>
              {value && <span className="num">{value}</span>}
              {sub && <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{value ? ' · ' : ''}{sub}</span>}
            </div>
          )}
        </div>
      ) : (
        <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
          <div className="num" style={{ ...valueStyle, color: 'var(--text)' }}>{value}</div>
          {deltaInfo ? <DeltaBadge info={deltaInfo} metricKey={metricKey} /> : (delta != null && (
            <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: deltaColor, display: 'flex', alignItems: 'center', gap: 'var(--sp-05)' }}>
              {delta > 0 ? <I2.ArrowUp size={11} /> : delta < 0 ? <I2.ArrowDown size={11} /> : null}
              {Math.abs(delta)}
            </div>
          ))}
        </div>
        {sub && <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)', fontWeight: 500, marginTop: 'var(--sp-05)' }}>{sub}</div>}
        </>
      )}
      {trendData && <div style={{ marginTop: 'var(--sp-3)' }}><Sparkline data={trendData} width="auto" height={30} color={accent} /></div>}
      {children && <div style={{ marginTop: 'var(--sp-3)' }}>{children}</div>}
      {/* La pista de "esta card se abre" va al PIE. En la cabecera peleaba con el
          rótulo por un renglón de 159px (desktop) o 133px (móvil) y lo partía a
          mitad de palabra. Y `marginTop:auto` la clava contra el borde inferior:
          las cinco cards de la fila terminaban a cuatro alturas distintas (88 /
          85 / 84 / 52 / 20px de vacío medidos en la captura), ahora comparten
          una sola línea de cierre. */}
      {clickable && !tone && (
        <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-3)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--sp-05)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 500, letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)' }}>
          <I2.Sparkles size={10} /> Detalles
        </div>
      )}
    </div>
  );
}

// Abreviador COMPARTIDO (data.js). Se conserva el nombre corto porque lo usan 30+
// sitios de este archivo, pero la implementación —y la regla de cuándo abreviar—
// vive en un solo lugar.
function fmt(n) {
  return window.ecoFmtCompact ? window.ecoFmtCompact(n) : (n == null ? '—' : String(n));
}

/**
 * Ventana efectiva de los agregados de eco-data (D.PERIOD, expuesto por
 * /api/eco-data) como { from, to } — días AST inclusivos, cerrada terminando
 * ayer. Fallback a la ventana global calculada client-side cuando el payload
 * aún no la trae (boot viejo cacheado). Los drill-downs la pasan en
 * `_filter` para que la modal consulte la MISMA ventana que la card que la
 * abrió (auditoría consistencia 2026-08).
 */
function ecoDataWindow() {
  const data = window.ECO_DATA || {};
  if (data.PERIOD && data.PERIOD.startYmd && data.PERIOD.endYmd) {
    return { from: data.PERIOD.startYmd, to: data.PERIOD.endYmd };
  }
  return (window.ecoResolvedWindow && window.ecoResolvedWindow()) || {};
}

/**
 * Helper compartido para abrir un MetricInsightModal desde cualquier pantalla.
 * Construye el slice inicial con headlineValue + subcomponents + skeleton de
 * insight, lo aplica vía setSlice, y dispara un fetch (con polling) al
 * endpoint /api/eco-metric-insight. Al llegar la respuesta actualiza el slice
 * con el texto del insight.
 *
 * @param {Function} setSlice — el setter del state local de cada screen.
 * @param {Object} opts — { metric, value, accent, label, periodStart?, periodEnd?, periodPreset?, agency, subcomponents, filter }
 */
function openMetricInsightShared(setSlice, opts) {
  const headlineValue = opts.value != null && opts.value !== '' ? String(opts.value) : '—';
  setSlice({
    eyebrow: opts.label,
    title: `${opts.label}${opts.periodLabel ? ' · ' + opts.periodLabel : ''}`,
    accent: opts.accent || 'var(--accent)',
    headlineValue,
    headlineLabel: opts.label,
    subcomponents: opts.subcomponents || [],
    insightText: '__loading__',
    mentions: [],
    // La ventana del dato de origen viaja en el _filter para que la lista de
    // menciones del modal consulte el MISMO rango que el valor de la métrica.
    _filter: {
      ...(opts.periodStart && opts.periodEnd ? { from: opts.periodStart, to: opts.periodEnd } : {}),
      ...(opts.filter || {}),
    },
  });

  const params = new URLSearchParams({ metric: opts.metric });
  if (opts.periodStart && opts.periodEnd) {
    params.set('from', opts.periodStart);
    params.set('to', opts.periodEnd);
  } else if (opts.periodPreset) {
    params.set('period', opts.periodPreset);
  }
  if (opts.agency) params.set('agency', opts.agency);

  const startedAt = Date.now();
  const MAX_POLL_MS = 90 * 1000;
  const POLL_MS = 3000;

  async function tick() {
    try {
      const res = await fetch('/api/eco-metric-insight?' + params.toString(), {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (res.status === 202) {
        if (Date.now() - startedAt > MAX_POLL_MS) {
          setSlice((s) => s ? { ...s, insightText: 'Insight no disponible (timeout).' } : s);
          return;
        }
        setTimeout(tick, POLL_MS);
        return;
      }
      if (!res.ok) {
        setSlice((s) => s ? { ...s, insightText: 'No se pudo cargar el insight.' } : s);
        return;
      }
      const json = await res.json();
      setSlice((s) => s ? { ...s, insightText: json.insight || 'Sin insight disponible.' } : s);
    } catch (_) {
      setSlice((s) => s ? { ...s, insightText: 'Error de red al cargar el insight.' } : s);
    }
  }
  tick();
}

// Sanitiza HTML del briefing IA — solo permite <strong>/</strong>. El lambda
// que genera el briefing ya hace este filtro server-side; esta función es
// defensa en profundidad por si una fila vieja escapó el filtro o si en el
// futuro se llena la tabla por otra vía.
function sanitizeBriefingHtml(html) {
  if (!html) return '';
  return String(html).replace(/<(?!\/?strong\b)[^>]*>/gi, '');
}

// =============== DASHBOARD ===============
// ============================================================
// Scorecard (oct-2026): los bloques de siempre, más claros, y al final tres
// lecturas nuevas: indicadores en filas, últimas 12 semanas contra lo usual y
// quién habló.
// ============================================================
// Nombres con prefijo sc/Sc/SC_: los scripts del SPA comparten el ámbito global.
const SC_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const SC_DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const scNum = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('es-PR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const scSgn = (n, d = 1) => (n == null ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + scNum(Math.abs(n), d));
const scT = (ymd) => Date.parse(String(ymd).slice(0, 10) + 'T00:00:00Z');
const scDay = (ymd) => { const d = new Date(scT(ymd)); return `${SC_DIA[d.getUTCDay()]} ${d.getUTCDate()}`; };
const scDate = (ymd) => { const d = new Date(scT(ymd)); return `${d.getUTCDate()} ${SC_MES[d.getUTCMonth()]}`; };
// Un día con menos de 10 menciones va con punto hueco: su índice diario no es estable.
const SC_FEW = 10;

// Los cinco indicadores. dir: si subir es bueno ('up'), malo ('down') o neutro ('flat').
const SC_MET = {
  nss: { label: 'Net Sentiment Score', short: 'NSS', dir: 'up', unit: '', dec: 1, sign: true, dom: [-100, 100], cuts: [-20, -5, 5, 20], dd: 'nss', word: 'nss', ins: 'nss',
    day: (t) => (t.nss == null ? null : Number(t.nss)), prev: (p) => p.nss },
  crisis: { label: 'Riesgo de crisis', short: 'Crisis', dir: 'down', unit: '%', dec: 0, dom: [0, 100], cuts: [25, 40, 60], dd: 'crisis', word: 'crisis', ins: 'crisis',
    day: (t) => (t.crisisRiskScore == null ? null : t.crisisRiskScore * 100), prev: (p) => (p.crisis == null ? null : p.crisis * 100) },
  volume: { label: 'Menciones', short: 'Menciones', dir: 'flat', unit: '', dec: 0, count: true, dd: 'totalMentions', ins: 'volume',
    day: (t) => t.totalMentions, prev: (p) => p.mentions },
  bhi: { label: 'Brand Health', short: 'Brand Health', dir: 'up', unit: '/10', dec: 1, dom: [1, 10], cuts: [4.6, 6.4, 8.2], dd: 'brandHealth', word: 'brandHealth', ins: 'bhi',
    day: (t) => (t.brandHealthIndex == null ? null : 1 + 9 * t.brandHealthIndex), prev: (p) => (p.bhi == null ? null : 1 + 9 * p.bhi) },
  pol: { label: 'Polarización', short: 'Polarización', dir: 'down', unit: '%', dec: 0, dom: [0, 100], cuts: [10, 25, 50], dd: 'polarization', word: 'polarization', ins: 'polarization',
    day: (t) => (t.polarizationIndex == null ? null : Number(t.polarizationIndex)), prev: (p) => p.polarization },
};
const SC_ORDER = ['nss', 'crisis', 'volume', 'bhi', 'pol'];
const scShow = (k, v) => (SC_MET[k].sign ? scSgn(v, SC_MET[k].dec) : scNum(v, SC_MET[k].dec));
function scCurrent(m) {
  // Con menos de 20 menciones la API no publica índices (lowSample): solo el volumen.
  if (m.lowSample) return { nss: null, crisis: null, volume: window.ecoPeriodMentionTotal(), bhi: null, pol: null };
  return {
    nss: m.nss, crisis: m.crisisRiskScore == null ? null : m.crisisRiskScore * 100, volume: window.ecoPeriodMentionTotal(),
    bhi: m.brandHealthIndex == null ? null : 1 + 9 * m.brandHealthIndex, pol: m.polarizationIndex,
  };
}
const SC_LOW = 'muestra insuficiente';
// Cambio contra el periodo previo; el color sale de la dirección del indicador.
function scChange(m, k) {
  const d = m.deltaDisplay && m.deltaDisplay[SC_MET[k].dd];
  if (!d || !d.hasBaseline) return { txt: 'sin base', cls: 'flat' };
  const mag = Number(d.magnitude) || 0;
  const cls = SC_MET[k].dir === 'flat' || mag === 0 ? 'flat' : (mag > 0) === (SC_MET[k].dir === 'up') ? 'good' : 'bad';
  return { txt: `${d.arrow || ''} ${d.value}`.trim(), cls };
}
// El color de la marca es el de la banda canónica de cada índice (las mismas
// bandas que el modal y el Overview).
const scBandTone = (k, v) => {
  if (v == null) return 'var(--text-3)';
  if (k === 'nss') return v < -20 ? 'var(--neg)' : v < -5 ? 'var(--warn)' : v > 5 ? 'var(--pos)' : 'var(--text-2)';
  if (k === 'crisis') return bandColorAt(CRISIS_BANDS, v, 100);
  if (k === 'bhi') return bandColorAt(BHI_BANDS, (v - 1) / 9, 1);
  return bandColorAt(POLARIZATION_BANDS, v, 1);
};
const scNice = (span, n = 4) => { const raw = (span || 1) / n, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((x) => x * p).find((x) => x >= raw); };

// Tendencia de la tarjeta: el periodo previo en gris punteado y este en negro.
function ScSpark({ k, cur, prev, h = 34 }) {
  const [ref, cw] = useChartWidth(160);
  const W = Math.max(60, Math.floor(cw)), m = SC_MET[k];
  const pts = [...(prev || []), ...cur].map((t) => m.day(t));
  const nPrev = (prev || []).length;
  const vals = pts.filter((v) => v != null);
  if (!vals.length) return <div ref={ref} style={{ height: h }} />;
  const lo = m.count ? 0 : Math.min(...vals), hi = Math.max(...vals, lo + 1);
  const x = (i) => 2 + (i * (W - 4)) / Math.max(1, pts.length - 1), y = (v) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  if (m.count) {
    const bw = Math.max(1, Math.min(8, (W - 4) / pts.length - 1));
    return <div ref={ref}><svg width={W} height={h} aria-hidden="true" style={{ display: 'block' }}>{pts.map((v, i) => v == null ? null : <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0.5, h - 3 - y(v))} rx="1" style={{ fill: i < nPrev ? 'var(--hairline-strong)' : 'var(--text-2)' }} />)}</svg></div>;
  }
  const path = (a, b) => { let d = ''; for (let i = a; i <= b; i++) if (pts[i] != null) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(pts[i]).toFixed(1)}`; return d; };
  return (
    <div ref={ref}>
      <svg width={W} height={h} aria-hidden="true" style={{ display: 'block' }}>
        {nPrev > 0 && <path d={path(0, nPrev)} fill="none" style={{ stroke: 'var(--hairline-strong)' }} strokeWidth="1.6" strokeDasharray="3 2" />}
        <path d={path(Math.max(0, nPrev - 0), pts.length - 1)} fill="none" style={{ stroke: 'var(--text)' }} strokeWidth="1.6" />
      </svg>
    </div>
  );
}

// Escala del indicador con sus cortes canónicos y la marca del valor.
function ScScale({ k, v }) {
  const m = SC_MET[k];
  if (!m.dom || v == null) return null;
  const [lo, hi] = m.dom, p = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  const end = (x) => (k === 'nss' ? scSgn(x, 0) : scNum(x, 0)) + (m.unit === '%' ? '%' : '');
  return (
    <div>
      <div className="sc-scale" role="img" aria-label={`${m.label}: ${scShow(k, v)}${m.unit} en una escala de ${end(lo)} a ${end(hi)}`}>
        <span className="sc-scale-track" />
        {m.cuts.map((c) => <i key={c} className="sc-scale-cut" style={{ left: `${p(c)}%` }} />)}
        <i className="sc-scale-mark" style={{ left: `${p(v)}%`, background: scBandTone(k, v) }} />
      </div>
      <div className="sc-scale-ends"><span>{end(lo)}</span><span>{end(hi)}</span></div>
    </div>
  );
}

// Rótulo de la tendencia: «14 días» en 7D; en periodos largos, sin cifra.
const scSpanLabel = (days, prev) => (prev && days <= 92 ? `${days * 2} días` : prev ? 'este periodo y el previo' : 'este periodo');

function ScKpi({ k, m, cur, prev, onDetails, days }) {
  const meta = SC_MET[k], v = scCurrent(m)[k], c = scChange(m, k);
  const low = m.lowSample && k !== 'volume';
  const word = low ? SC_LOW : meta.word && m.display && m.display[meta.word] ? m.display[meta.word].word : null;
  const pv = prev ? meta.prev(prev) : null;
  return (
    <div className="card sc-kpi">
      <div className="sc-kpi-k">{meta.label}</div>
      <div className="sc-kpi-vrow">
        <span className="sc-kpi-v num">{scShow(k, v)}{meta.unit && v != null && <small>{meta.unit}</small>}</span>
        <span className={`sc-dl ${c.cls}`}>{c.txt}</span>
      </div>
      <div className="sc-kpi-w">{word || (pv != null ? `vs ${scNum(pv)} el periodo previo` : 'en el periodo')}</div>
      <ScSpark k={k} cur={cur} prev={prev && prev.timeline} />
      <ScScale k={k} v={v} />
      <div className="sc-kpi-foot"><span>{scSpanLabel(days, prev)}</span><button className="link" onClick={onDetails}>Detalles</button></div>
    </div>
  );
}

// Evolución: un indicador a la vez, con eje; el periodo previo, punteado y alineado por día.
function ScEvolution({ cur, prev, onPointClick }) {
  const [k, setK] = useState('volume');
  const [ref, cw] = useChartWidth(720);
  const m = SC_MET[k], W = Math.max(320, Math.floor(cw)), H = Math.round(Math.max(220, Math.min(300, W * 0.32)));
  const L = 48, R = 12, T = 14, B = 30, n = cur.length;
  const cv = cur.map((t) => m.day(t)), pv = (prev || []).slice(-n).map((t) => m.day(t));
  const vals = [...cv, ...pv].filter((v) => v != null);
  let lo = m.count ? 0 : Math.min(0, ...vals), hi = Math.max(1, ...vals);
  if (k === 'nss') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const st = scNice(hi - lo); lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
  const x = (i) => L + ((i + 0.5) * (W - L - R)) / n, y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const ticks = []; for (let v = lo; v <= hi + 1e-9; v += st) ticks.push(v);
  const every = n <= 14 ? ((W - L - R) / n < 52 ? 2 : 1) : n <= 31 ? Math.ceil(n / Math.max(3, Math.floor((W - L - R) / 70))) : null;
  const xl = cur.map((t, i) => {
    const d = t.fullDate.slice(0, 10), dt = new Date(scT(d));
    if (every) return i % every === 0 || i === n - 1 ? { i, lab: n <= 14 ? scDay(d) : scDate(d) } : null;
    return dt.getUTCDate() === 1 || i === 0 ? { i, lab: `${SC_MES[dt.getUTCMonth()]}${dt.getUTCMonth() === 0 || i === 0 ? ' ' + dt.getUTCFullYear() : ''}` } : null;
  }).filter(Boolean);
  const bars = m.count && n <= 62, bw = Math.max(2, Math.min(28, ((W - L - R) / n) * 0.55));
  const line = (arr) => arr.map((v, i) => (v == null ? '' : `${i && arr[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const fmtTick = (v) => (k === 'nss' ? scSgn(v, 0) : scNum(v, st < 1 ? 1 : 0)) + (m.unit === '%' ? '%' : '');
  return (
    <div className="card">
      <div className="card-hd" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div><div className="card-hd-title">Evolución</div><div className="card-hd-sub">{m.label} por día</div></div>
        <div className="sc-seg" role="group" aria-label="Indicador">
          {SC_ORDER.map((x2) => <button key={x2} aria-pressed={x2 === k} onClick={() => setK(x2)}>{SC_MET[x2].short}</button>)}
        </div>
      </div>
      <div className="card-bd"><div ref={ref}>
        <svg width={W} height={H} className="sc-svg" role="img" aria-label={`${m.label} por día`} style={{ display: 'block' }}>
          {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={{ stroke: Math.abs(v) < 1e-9 && !m.count ? 'var(--hairline-strong)' : 'var(--hairline)' }} /><text x={L - 6} y={y(v) + 4} textAnchor="end">{fmtTick(v)}</text></g>)}
          {xl.map((t) => <text key={t.i} x={x(t.i)} y={H - 8} textAnchor={every ? 'middle' : 'start'}>{t.lab}</text>)}
          {bars ? cur.map((t, i) => {
            const v = cv[i], p = pv[i];
            return (
              <g key={i} className="sc-hit" onClick={() => onPointClick && onPointClick(t, i)}>
                {p != null && <rect x={x(i) - bw / 2 - 2} y={y(p)} width={bw + 4} height={Math.max(0, y(0) - y(p))} fill="none" style={{ stroke: 'var(--hairline-strong)' }} strokeDasharray="3 2"><title>{`Periodo previo: ${scNum(p)}`}</title></rect>}
                {v != null && <rect x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx="2" style={{ fill: 'var(--text-2)' }}><title>{`${scDay(t.fullDate)}: ${scNum(v)} menciones`}</title></rect>}
              </g>
            );
          }) : (
            <g>
              {pv.length > 0 && <path d={line(pv)} fill="none" style={{ stroke: 'var(--hairline-strong)' }} strokeWidth="1.6" strokeDasharray="4 3" />}
              <path d={line(cv)} fill="none" style={{ stroke: 'var(--text)' }} strokeWidth="2" />
              {n <= 62 && cur.map((t, i) => {
                const v = cv[i]; if (v == null) return null;
                const few = (t.totalMentions || 0) < SC_FEW;
                return (
                  <circle key={i} className="sc-hit" cx={x(i)} cy={y(v)} r={few ? 4 : 3.5} strokeWidth="1.6"
                    style={{ fill: few ? 'var(--canvas)' : 'var(--text)', stroke: 'var(--text)' }} onClick={() => onPointClick && onPointClick(t, i)}>
                    <title>{`${scDay(t.fullDate)}: ${scShow(k, v)}${m.unit} · ${scNum(t.totalMentions)} ${t.totalMentions === 1 ? 'mención' : 'menciones'}`}</title>
                  </circle>
                );
              })}
            </g>
          )}
        </svg>
        </div>
        <div className="sc-legend">
          <span><i className="sc-sw" style={{ background: 'var(--text)' }} />este periodo</span>
          {prev && prev.length > 0 && <span><i className="sc-sw" style={{ background: 'var(--hairline-strong)' }} />periodo previo</span>}
          {!m.count && n <= 62 && <span>○ menos de 10 menciones ese día</span>}
        </div>
      </div>
    </div>
  );
}

// Tópicos: la barra es este periodo y la marca, el periodo previo.
function ScTopics({ topics, onOpen, onAll }) {
  const rows = [...(topics || [])].filter((t) => t.slug).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 7);
  const max = Math.max(1, ...rows.map((t) => Math.max(t.count || 0, t.prevCount || 0)));
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">Tópicos</div><div className="card-hd-sub">menciones</div></div><button className="link" onClick={onAll}>Ver todos</button></div>
      <div className="card-bd">
        <div className="sc-trow sc-hd"><span /><span className="num">ahora</span><span /><span className="num">antes</span></div>
        {rows.map((t) => {
          const neg = (t.negative || 0) / Math.max(1, t.count || 0) >= 0.3;
          return (
            <button key={t.slug} className="sc-trow sc-click" onClick={() => onOpen(t)} title={`${t.name}: ${t.count} menciones (antes ${t.prevCount ?? '—'})`}>
              <span className="sc-nm">{t.name}</span>
              <span className="num sc-n">{scNum(t.count)}</span>
              <span className="sc-track"><b style={{ width: `${((t.count || 0) / max) * 100}%`, background: neg ? 'var(--neg)' : 'var(--text-3)' }} />{t.prevCount != null && <i style={{ left: `${(t.prevCount / max) * 100}%` }} />}</span>
              <span className="num sc-p">{t.prevCount != null ? scNum(t.prevCount) : '—'}</span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="sc-empty">Sin tópicos clasificados en el periodo.</div>}
        <div className="sc-legend">
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--text-3)' }} />este periodo</span>
          <span><i className="sc-sw sc-sw-tick" />periodo previo</span>
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--neg)' }} />30% o más negativas</span>
        </div>
      </div>
    </div>
  );
}

// Fuentes: el largo es el volumen y el relleno, la mezcla de tono.
function ScSources({ sources, bySource, onOpen }) {
  const sent = new Map((bySource || []).map((s) => [s.source, s]));
  const rows = (sources || []).map((s) => ({ ...s, ...(sent.get(s.source) || {}) }));
  const max = Math.max(1, ...rows.map((s) => s.count || 0));
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">Fuentes</div><div className="card-hd-sub">por volumen</div></div></div>
      <div className="card-bd">
        {rows.map((s) => {
          const n = s.count || 0, seg = (v, c) => (n && v ? <b style={{ width: `${(v / n) * 100}%`, background: c }} /> : null);
          return (
            <button key={s.key} className="sc-srow sc-click" onClick={() => onOpen({ key: s.key, label: s.source })} title={`${s.source}: ${n} menciones · ${s.negativo || 0} negativas`}>
              <span className="sc-nm">{s.source}</span>
              <span className="num sc-n">{scNum(n)}</span>
              <span className="sc-mix" style={{ width: `${Math.max(2, (n / max) * 100)}%` }}>{seg(s.negativo, 'var(--neg)')}{seg(s.neutral, 'var(--hairline-strong)')}{seg(s.positivo, 'var(--pos)')}</span>
            </button>
          );
        })}
        <div className="sc-legend">
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--neg)' }} />negativas</span><span><i className="sc-sw sc-sw-box" style={{ background: 'var(--hairline-strong)' }} />neutras</span><span><i className="sc-sw sc-sw-box" style={{ background: 'var(--pos)' }} />positivas</span>
        </div>
      </div>
    </div>
  );
}

// Actividad por hora: totales por día y por hora al margen; la hora pico, enmarcada.
const SC_DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function ScHeat({ data, onCellClick }) {
  const H = Array.isArray(data) && data.length === 168 ? data : Array.from({ length: 168 }, () => 0);
  const max = Math.max(...H), total = H.reduce((a, b) => a + b, 0);
  const rowT = SC_DOW.map((_, d) => H.slice(d * 24, d * 24 + 24).reduce((a, b) => a + b, 0));
  const colT = Array.from({ length: 24 }, (_, h) => SC_DOW.reduce((s, _2, d) => s + H[d * 24 + h], 0));
  const mr = Math.max(1, ...rowT), mc = Math.max(1, ...colT);
  // Con empate en el máximo se enmarcan todas las franjas y el rótulo lo dice.
  const peaks = max > 0 ? H.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0) : [];
  const pk = peaks.length ? peaks[0] : -1;
  return (
    <div className="card">
      <div className="card-hd">
        <div><div className="card-hd-title">Actividad por hora</div><div className="card-hd-sub">hora de Puerto Rico · toca una franja para ver sus menciones</div></div>
        {peaks.length === 1 && <div className="card-hd-sub">pico: {SC_DOW[Math.floor(pk / 24)].toLowerCase()} a las {pk % 24}:00 · {max} {max === 1 ? 'mención' : 'menciones'}</div>}
        {peaks.length > 1 && <div className="card-hd-sub">pico: {max} {max === 1 ? 'mención' : 'menciones'} por hora en {peaks.length} franjas</div>}
      </div>
      <div className="card-bd scroll-x">
        {total === 0 ? <div className="sc-empty">Sin menciones en el periodo.</div> : (
          <div className="sc-heat">
            <span />{colT.map((_, h) => <span key={h} className="sc-heat-h">{h % 3 === 0 ? h : ''}</span>)}<span />
            {SC_DOW.map((dn, d) => (
              <React.Fragment key={dn}>
                <span className="sc-heat-d">{dn}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = H[d * 24 + h];
                  return (
                    <span key={h} role="button" tabIndex={0} className={`sc-heat-c${peaks.includes(d * 24 + h) ? ' pk' : ''}`}
                      style={{ background: v ? seqColor(v / max) : undefined }} aria-label={`${dn} ${h}:00: ${v} menciones`} title={`${dn} ${h}:00 · ${v} ${v === 1 ? 'mención' : 'menciones'}`}
                      onClick={() => onCellClick({ day: d, dayLabel: dn, hour: h, hourEnd: h, value: v })}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick({ day: d, dayLabel: dn, hour: h, hourEnd: h, value: v }); } }} />
                  );
                })}
                <span className="sc-heat-rt"><b style={{ width: `${(rowT[d] / mr) * 28}px` }} />{rowT[d]}</span>
              </React.Fragment>
            ))}
            <span />{colT.map((v, h) => <span key={h} className="sc-heat-ct" title={`${h}:00 · ${v} menciones`}><b style={{ height: `${(v / mc) * 22}px` }} /></span>)}<span />
          </div>
        )}
      </div>
    </div>
  );
}

// Indicadores en filas: el mapeo detallado de los cinco.
function ScIndicatorRows({ m, cur, prev, days }) {
  const curV = scCurrent(m);
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">Indicadores</div></div></div>
      <div className="card-bd scroll-x">
        <div className="sc-krow sc-hd"><span>Indicador</span><span>Este periodo</span><span>Cambio</span><span>{scSpanLabel(days, prev)}{prev ? ' · el previo en gris' : ''}</span><span>Escala</span></div>
        {SC_ORDER.map((k) => {
          const meta = SC_MET[k], c = scChange(m, k), low = m.lowSample && k !== 'volume';
          const word = low ? SC_LOW : meta.word && m.display && m.display[meta.word] ? m.display[meta.word].word : null;
          const pv = prev ? meta.prev(prev) : null;
          return (
            <div key={k} className="sc-krow">
              <span><span className="sc-krow-nm">{meta.label}</span>{word && <span className="sc-krow-w">{word}</span>}</span>
              <span className="sc-krow-v num">{scShow(k, curV[k])}{meta.unit && curV[k] != null && <small>{meta.unit}</small>}</span>
              <span><span className={`sc-dl ${c.cls}`}>{c.txt}</span><span className="sc-krow-w num">antes {pv == null ? '—' : `${scShow(k, pv)}${meta.unit}`}</span></span>
              <span><ScSpark k={k} cur={cur} prev={prev && prev.timeline} h={30} /></span>
              <span>{meta.dom ? <ScScale k={k} v={curV[k]} /> : <span className="sc-krow-w">sin escala</span>}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Últimas 12 semanas: cada celda contra lo usual de la agencia.
const SC_WK = { nss: 'nss', crisis: 'crisis', volume: 'n', bhi: 'bhi', pol: 'polarization' };
function scUsual(k, v, usual) {
  const u = usual && usual[SC_WK[k]];
  if (v == null || !u) return { cls: '', txt: 'sin base' };
  if (v >= u.p25 && v <= u.p75) return { cls: '', txt: 'dentro de lo usual' };
  const up = v > u.p75;
  if (SC_MET[k].dir === 'flat') return { cls: 'hi', txt: up ? 'más alto que lo usual' : 'más bajo que lo usual' };
  const good = up === (SC_MET[k].dir === 'up');
  return { cls: good ? 'good' : 'bad', txt: up ? 'más alto que lo usual' : 'más bajo que lo usual' };
}
function ScWeeks({ data }) {
  // Abre en la semana actual: en pantallas angostas la cuadrícula se desplaza y
  // lo primero que se ve debe ser lo más reciente.
  const scroller = React.useRef(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [data]);
  if (!data || !data.weeks || !data.weeks.length) return null;
  const W = data.weeks, last = W[W.length - 1], usual = data.usual;
  const endDow = SC_DIA[new Date(scT(last.end)).getUTCDay()];
  const val = (w, k) => (k === 'volume' ? w.n : w[SC_WK[k]]);
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">Últimas 12 semanas</div><div className="card-hd-sub">cada semana termina el {endDow}</div></div></div>
      <div className="card-bd">
        <div className="scroll-x" ref={scroller}>
          <div className="sc-wk" style={{ gridTemplateColumns: `${window.ecoIsMobile() ? 96 : 130}px repeat(${W.length}, minmax(56px, 1fr))` }}>
            <span className="sc-wk-nm" />{W.map((w, i) => <span key={w.end} className={`sc-wk-h${i === W.length - 1 ? ' cur' : ''}`}>{scDate(w.end)}</span>)}
            {SC_ORDER.map((k) => (
              <React.Fragment key={k}>
                <span className="sc-wk-nm">{SC_MET[k].short}</span>
                {W.map((w, i) => { const v = val(w, k), s = scUsual(k, v, usual), u = usual && usual[SC_WK[k]];
                  return <span key={w.end} className={`sc-wk-c ${s.cls}${i === W.length - 1 ? ' cur' : ''}`} title={`Semana del ${scDate(w.start)} al ${scDate(w.end)}: ${v == null ? '—' : scShow(k, v) + SC_MET[k].unit} · ${s.txt}${u ? ` (lo usual: ${scShow(k, u.p25)} a ${scShow(k, u.p75)})` : ''}`}>{v == null ? '—' : scShow(k, v)}</span>; })}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="sc-legend" style={{ marginTop: 'var(--sp-3)' }}>
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--pos-bg)', border: '1px solid var(--pos)' }} />mejor que lo usual</span>
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--canvas-2)', border: '1px solid var(--hairline-strong)' }} />dentro de lo usual</span>
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--neg-bg)', border: '1px solid var(--neg)' }} />peor que lo usual</span>
          <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--neu-bg)', border: '1px solid var(--neu)' }} />menciones fuera de lo usual</span>
        </div>
        {usual && usual.nss && <div className="sc-note">Lo usual: la mitad central de las {usual.nss.weeks} semanas previas desde el {scDate(data.baselineFrom)}.</div>}
      </div>
    </div>
  );
}

// Quién habló: la agencia, la prensa, gobierno y política, y la ciudadanía.
const SC_VC = { agencia: 0, prensa: 1, gobierno: 2, ciudadania: 3 };
const scVColor = (k) => window.ecoCat(SC_VC[k]);
function ScVoices({ data }) {
  if (!data || !data.cats) return null;
  const cats = data.cats, n = cats.reduce((s, c) => s + c.n, 0), nP = cats.reduce((s, c) => s + c.nPrev, 0), mx = Math.max(1, n, nP);
  const stack = (key, tot) => (
    <div className="sc-stk" style={{ width: `${(tot / mx) * 100}%` }}>
      {cats.map((c) => (c[key] ? <b key={c.k} style={{ width: `${(c[key] / tot) * 100}%`, background: scVColor(c.k) }} title={`${c.label}: ${c[key]}`}>{c[key] / tot >= 0.08 ? c[key] : ''}</b> : null))}
    </div>
  );
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">Quién habló</div><div className="card-hd-sub">{scNum(n)} menciones en este periodo · {scNum(nP)} en el previo</div></div></div>
      <div className="card-bd">
        <div className="sc-vbars">
          <span>Este periodo</span>{n ? stack('n', n) : <span className="sc-krow-w">sin menciones</span>}
          <span className="sc-krow-w">Periodo previo</span>{nP ? stack('nPrev', nP) : <span className="sc-krow-w">sin menciones</span>}
        </div>
        <div className="sc-vrow sc-hd"><span /><span>menciones</span><span>negativas</span><span>antes</span></div>
        {cats.map((c) => (
          <div key={c.k} className="sc-vrow">
            <span><i className="sc-sw sc-sw-box" style={{ background: scVColor(c.k) }} /><span>{c.label}<span className="sc-vrow-prev num">antes {scNum(c.nPrev)} · {scNum(c.negPrev)} neg.</span></span></span>
            <span className="num">{scNum(c.n)}</span>
            <span className="num" style={{ color: c.n && c.neg / c.n >= 0.3 ? 'var(--neg)' : undefined }}>{scNum(c.neg)}</span>
            <span className="num sc-p">{scNum(c.nPrev)} · {scNum(c.negPrev)} neg.</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function ScVoicesDaily({ data }) {
  const [ref, cw] = useChartWidth(420);
  if (!data || !data.daily || !data.daily.length) return null;
  const keys = ['agencia', 'prensa', 'gobierno', 'ciudadania'];
  // Más de 31 días: se agrupa por semana para que las barras sigan leyéndose.
  let rows = data.daily, weekly = false;
  if (rows.length > 31) {
    weekly = true; const out = [];
    rows.forEach((r, i) => { if (i % 7 === 0) out.push({ date: r.date, agencia: 0, prensa: 0, gobierno: 0, ciudadania: 0 }); const b = out[out.length - 1]; keys.forEach((k) => { b[k] += r[k]; }); });
    rows = out;
  }
  const tot = rows.map((r) => keys.reduce((s, k) => s + r[k], 0)), max = Math.max(1, ...tot);
  const W = Math.max(240, Math.floor(cw)), H = 190, L = 34, R = 6, T = 10, B = 26, n = rows.length;
  const x = (i) => L + ((i + 0.5) * (W - L - R)) / n, y = (v) => T + (1 - v / max) * (H - T - B), bw = Math.max(2, ((W - L - R) / n) * 0.6);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 52))));
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">{weekly ? 'Por semana' : 'Por día'}</div><div className="card-hd-sub">menciones según quién habló</div></div></div>
      <div className="card-bd"><div ref={ref}>
        <svg width={W} height={H} className="sc-svg" role="img" aria-label="Menciones por día según quién habló" style={{ display: 'block' }}>
          {[0, Math.round(max / 2), max].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--hairline)' }} /><text x={L - 4} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
          {rows.map((r, i) => { let acc = 0; return (
            <g key={r.date}>
              {keys.map((k) => { if (!r[k]) return null; const y0 = y(acc + r[k]), h = y(acc) - y(acc + r[k]); acc += r[k]; return <rect key={k} x={x(i) - bw / 2} y={y0} width={bw} height={h} style={{ fill: scVColor(k) }}><title>{`${scDate(r.date)} · ${(data.cats.find((c) => c.k === k) || {}).label}: ${r[k]}`}</title></rect>; })}
              {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{n <= 10 ? scDay(r.date) : scDate(r.date)}</text>}
            </g>
          ); })}
        </svg>
        </div>
        <div className="sc-legend">{data.cats.map((c) => <span key={c.k}><i className="sc-sw sc-sw-box" style={{ background: scVColor(c.k) }} />{c.label}</span>)}</div>
      </div>
    </div>
  );
}
function ScInteraction({ data }) {
  if (!data || !data.concentration) return null;
  const c = data.concentration, t = c.total || 0;
  const a = t ? c.top1 / t : 0, b = t ? (c.top5 - c.top1) / t : 0, r = t ? 1 - a - b : 0;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const catLabel = (k) => (data.cats.find((x) => x.k === k) || {}).label;
  return (
    <div className="card">
      <div className="card-hd"><div><div className="card-hd-title">Interacción</div><div className="card-hd-sub">{scNum(t)} likes, comentarios y compartidos en el periodo</div></div></div>
      <div className="card-bd">
        {t > 0 && (
          <>
            <div className="sc-stk">
              <b style={{ width: pct(a), background: 'var(--text)' }}>{a >= 0.08 ? pct(a) : ''}</b>
              <b style={{ width: pct(b), background: 'var(--text-3)' }}>{b >= 0.08 ? pct(b) : ''}</b>
              <b style={{ width: pct(r), background: 'var(--hairline-strong)', color: 'var(--text)' }}>{r >= 0.08 ? pct(r) : ''}</b>
            </div>
            <div className="sc-legend" style={{ marginTop: 'var(--sp-15)' }}>
              <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--text)' }} />la cuenta con más</span>
              <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--text-3)' }} />las 4 siguientes</span>
              <span><i className="sc-sw sc-sw-box" style={{ background: 'var(--hairline-strong)' }} />el resto</span>
            </div>
          </>
        )}
        <div className="sc-stats">
          <div><div className="sc-big num">{scNum(c.zero)}<small> de {scNum(c.n)}</small></div><div className="sc-krow-w">menciones sin interacción</div></div>
          <div><div className="sc-big num">{scNum(data.newVoices)}<small> de {scNum(data.distinct)}</small></div><div className="sc-krow-w">voces nuevas en 5 semanas</div></div>
        </div>
        {(data.top || []).map((v, i) => (
          <div key={i} className="sc-voice">
            <span style={{ minWidth: 0 }}>
              <span className="sc-voice-n">{v.name || 'Una persona'}</span>
              <span className="sc-krow-w"><i className="sc-sw sc-sw-box" style={{ background: scVColor(v.cat) }} />{catLabel(v.cat)} · {v.n} {v.n === 1 ? 'mención' : 'menciones'}</span>
            </span>
            <span className="num" title="interacciones">{scNum(v.inter)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardScreen({ onMentionClick, period, setPeriod, setActive, agency }) {
  const m = D.CURRENT_METRICS || {};
  const [focus, setFocus] = useState('signal');
  const [slice, setSlice] = useState(null);
  const [metricModal, setMetricModal] = useState(null);

  // ── Resumen ejecutivo POR PERIODO ──────────────────────────────────────
  // El bloque leía D.BRIEFING, que para su versión IA sale de
  // `agency_briefings` — una tabla con period_hours=24 fijo que llena un cron.
  // Ahora pedimos /api/eco-executive-summary, que se genera y cachea por
  // (agencia, periodo). D.BRIEFING sigue siendo el fallback rule-based.
  const [periodSummary, setPeriodSummary] = useState({ phase: 'loading', modes: null });
  useEffect(() => {
    let cancelled = false;
    setPeriodSummary({ phase: 'loading', modes: null });
    const params = new URLSearchParams(window.ecoGetPeriodParams());
    const ag = localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || '';
    if (ag) params.set('agency', ag);
    fetch('/api/eco-executive-summary?' + params.toString(), { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        if (cancelled) return;
        if (d && d.status === 'ready' && d.modes) setPeriodSummary({ phase: 'ready', modes: d.modes, generatedAt: d.generatedAt });
        else setPeriodSummary({ phase: 'empty', modes: null });
      })
      .catch(() => { if (!cancelled) setPeriodSummary({ phase: 'error', modes: null }); });
    return () => { cancelled = true; };
  }, [period, agency]);

  // Lo que el Scorecard muestra además de eco-data: el periodo previo, las
  // últimas 12 semanas contra lo usual y quién habló (/api/scorecard).
  const [sc, setSc] = useState({ phase: 'loading', data: null });
  useEffect(() => {
    let cancelled = false;
    setSc({ phase: 'loading', data: null });
    const params = new URLSearchParams(window.ecoGetPeriodParams());
    const ag = localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || '';
    if (ag) params.set('agency', ag);
    ecoFetchAuthed('/api/scorecard?' + params.toString(), { credentials: 'same-origin', cache: 'no-store' })
      .then((d) => { if (!cancelled) setSc({ phase: 'ready', data: d }); })
      .catch((e) => {
        if (cancelled) return;
        if (e && e.code === 401) { ecoBounceToSignIn(); return; }
        setSc({ phase: 'error', data: null });
      });
    return () => { cancelled = true; };
  }, [period, agency]);

  const briefingByMode = (D.BRIEFING && typeof D.BRIEFING === 'object' && D.BRIEFING.signal !== undefined) ? D.BRIEFING : null;
  const fallbackBriefing = briefingByMode ? (briefingByMode[focus] || briefingByMode.signal || null) : D.BRIEFING;
  const periodMode = periodSummary.modes && periodSummary.modes[focus];
  const activeBriefing = periodMode
    ? { ...(fallbackBriefing || {}), narrativeHtml: periodMode.narrativeHtml, points: periodMode.points || [], dominantSignal: periodMode.dominantSignal, source: 'ai', generatedAtLabel: 'este periodo' }
    : fallbackBriefing;

  function openTimelineDaySlice(d) {
    const total = Math.round((d.totalMentions || d.positivo + d.neutral + d.negativo) || 0);
    const bias = d.negativo > d.positivo ? 'negativo' : d.positivo > d.negativo ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)';
    const dayIso = d.fullDate ? d.fullDate.slice(0, 10) : undefined;
    setSlice({
      eyebrow: d.date || (dayIso ? scDate(dayIso) : ''),
      title: d.nss != null ? `NSS ${d.nss > 0 ? '+' : ''}${Number(d.nss).toFixed(1)}` : 'Menciones del día',
      accent, volume: total,
      sentiment: { pos: d.positivo || 0, neu: d.neutral || 0, neg: d.negativo || 0 },
      mentions: [],
      _filter: { day: dayIso },
    });
  }
  function openSourceSlice(src) {
    const colors = window.ECO_SOURCE_COLOR;
    setSlice({ eyebrow: 'Fuente', title: src.label, accent: colors[src.key] || 'var(--accent)', mentions: [], _filter: { ...ecoDataWindow(), source: src.key } });
  }
  function openHeatmapSlice(cell) {
    setSlice({
      eyebrow: `${cell.dayLabel} · ${String(cell.hour).padStart(2, '0')}:00 – ${String(cell.hour).padStart(2, '0')}:59`,
      title: 'Franja horaria', accent: 'var(--accent)', mentions: [],
      _filter: { ...ecoDataWindow(), dow: cell.day, hour: cell.hour },
    });
  }
  function openTopicSlice(t) {
    const palette = window.ECO_CAT;
    const slugIdx = {};
    D.TOPICS.forEach((tp, i) => { slugIdx[tp.slug] = i; });
    const accent = palette[slugIdx[t.slug] % palette.length] || 'var(--accent)';
    setSlice({ eyebrow: 'Tópico', title: t.name, accent, mentions: [], _filter: { ...ecoDataWindow(), topic: t.slug } });
  }
  function openBriefingSlice() {
    const briefingTopicName = (activeBriefing && activeBriefing.dominantSignal || '').split(' · ')[0];
    const topic = (briefingTopicName && D.TOPICS.find((t) => t.name === briefingTopicName)) || D.TOPICS[0];
    if (topic) openTopicSlice(topic);
  }
  function openMetric(k) {
    const meta = SC_MET[k], cur = scCurrent(m);
    const key = meta.ins;
    const value = k === 'bhi' ? (cur.bhi == null ? null : Number(cur.bhi.toFixed(1))) : k === 'crisis' ? m.crisisRiskScore : k === 'volume' ? m.totalMentions : k === 'pol' ? m.polarizationIndex : m.nss;
    const dsp = (m && m.display) || {};
    const valueDisplay = k === 'crisis' ? dsp.crisis : k === 'bhi' ? dsp.brandHealth : k === 'pol' ? dsp.polarization : k === 'nss' ? dsp.nss : null;
    setMetricModal({ metricKey: key, value, label: meta.label, accent: 'var(--accent)', valueDisplay });
  }

  const timeline = D.TIMELINE || [];
  const prev = sc.data && sc.data.prev ? sc.data.prev : null;
  const days = Math.max(1, timeline.length);
  const win = window.ecoResolvedWindow ? window.ecoResolvedWindow() : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* ── Resumen ejecutivo (3 modos) y pulso ── */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('minmax(0, 1.6fr) minmax(0, 1fr)', '1fr'), gap: 'var(--sp-3)', alignItems: 'stretch' }}>
        <div className="card">
          <div className="card-hd">
            <div><div className="card-hd-title">Resumen ejecutivo</div><div className="card-hd-sub">{win && win.from && win.to ? `${scDate(win.from)} – ${scDate(win.to)}` : (period || '7D')}</div></div>
            {periodSummary.phase === 'loading' && <span className="sc-tag">generando…</span>}
            {periodSummary.phase !== 'loading' && activeBriefing && activeBriefing.source === 'ai' && <span className="sc-tag">IA · {activeBriefing.generatedAtLabel || 'reciente'}</span>}
            {periodSummary.phase !== 'loading' && activeBriefing && activeBriefing.source === 'rule' && <span className="sc-tag">Resumen automatizado</span>}
          </div>
          <div className="card-bd">
            <div className="sc-modes" role="group" aria-label="Enfoque del resumen">
              <button className={`chip ${focus === 'signal' ? 'active' : ''}`} aria-pressed={focus === 'signal'} onClick={() => setFocus('signal')}>Señal del día</button>
              <button className={`chip ${focus === 'emerging' ? 'active' : ''}`} aria-pressed={focus === 'emerging'} onClick={() => setFocus('emerging')}>Narrativas emergentes</button>
              <button className={`chip ${focus === 'crisis' ? 'active' : ''}`} aria-pressed={focus === 'crisis'} onClick={() => setFocus('crisis')}>Vigilancia de crisis</button>
            </div>
            <div className="sc-sum">
              {activeBriefing ? <span dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(activeBriefing.narrativeHtml || '') }} /> : <>Sin suficientes menciones en este periodo para generar un resumen.</>}
            </div>
            {activeBriefing && Array.isArray(activeBriefing.points) && activeBriefing.points.length > 0 && (
              <ul className="sc-points">
                {activeBriefing.points.slice(0, 2).map((pt, i) => <li key={i}><span dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(pt) }} /></li>)}
              </ul>
            )}
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <button className="btn btn-primary" onClick={openBriefingSlice} style={{ fontSize: 'var(--fs-caption)' }}><Icons.Eye size={13} /> Ver menciones</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Pulso</div><div className="card-hd-sub">últimas menciones</div></div></div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {(D.PULSE || []).map((e, i) => (
              <button key={i} onClick={() => e.mention && onMentionClick(e.mention)} className="row-hover sc-pulse">
                <span className="sc-pulse-t">{e.time}</span>
                <span className="dot" style={{ background: `var(--${e.dot})`, marginTop: 'var(--sp-15)', flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text)', minWidth: 0 }}>{e.text}</span>
                {/* Mismo formateador que la tabla de menciones (fmt), desde el crudo. */}
                <span className="num sc-p">
                  {e.mention && Number.isFinite(Number(e.mention.engagement)) ? (Number(e.mention.engagement) > 0 ? fmt(Number(e.mention.engagement)) : '—') : e.eng}
                </span>
              </button>
            ))}
            {!(D.PULSE && D.PULSE.length > 0) && <div className="sc-empty">Sin actividad reciente en el periodo.</div>}
          </div>
        </div>
      </div>

      {/* ── Los cinco indicadores: el número primero, su tendencia y su escala ── */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(5, minmax(0, 1fr))', '1fr', 'repeat(3, minmax(0, 1fr))'), gap: 'var(--sp-3)' }}>
        {SC_ORDER.map((k) => <ScKpi key={k} k={k} m={m} cur={timeline} prev={prev} days={days} onDetails={() => openMetric(k)} />)}
      </div>

      <ScEvolution cur={timeline} prev={prev && prev.timeline} onPointClick={(t) => openTimelineDaySlice(t)} />

      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('minmax(0, 1fr) minmax(0, 1fr)', '1fr'), gap: 'var(--sp-3)' }}>
        <ScTopics topics={D.TOPICS} onOpen={openTopicSlice} onAll={() => setActive && setActive('topics')} />
        <ScSources sources={D.TOP_SOURCES} bySource={D.SENTIMENT_BY_SOURCE} onOpen={openSourceSlice} />
      </div>

      <ScHeat data={D.HOUR_HEATMAP} onCellClick={openHeatmapSlice} />

      {/* ── Menciones destacadas ── */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Menciones destacadas</div><div className="card-hd-sub">Más recientes · sin twitter ni baja pertinencia</div></div>
          <a href="#mentions" className="link" style={{ fontSize: 'var(--fs-caption)' }}>Ver todas ({fmt(window.ecoPeriodMentionTotal())})</a>
        </div>
        <div className="scroll-x">
          {(D.MENTIONS || []).slice(0, 7).map((mn, idx) => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const scl = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
            return (
              <div key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover"
                style={{ display: 'grid', gridTemplateColumns: window.ecoCols('20px 2fr 130px 100px 100px', '20px 1fr'), minWidth: window.ecoIsMobile() ? 0 : 560, gap: 'var(--sp-3)', alignItems: 'center', padding: '10px 16px', borderTop: idx > 0 ? '1px solid var(--hairline)' : 'none', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}>
                <SIcon size={14} color="var(--text-3)" />
                <div className="truncate">
                  <div className="truncate" style={{ color: 'var(--text)', fontWeight: 500 }}>{mn.title}</div>
                  <div className="truncate" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.author} · {mn.domain}</div>
                </div>
                <div style={{ display: window.ecoIsMobile() ? 'flex' : 'contents', gridColumn: window.ecoIsMobile() ? '2' : undefined, alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap', minWidth: 0 }}>
                  <span className={`pill ${scl}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
                  <span className="num" style={{ color: 'var(--text-2)', fontWeight: 600, textAlign: 'right' }}>{mn.engagement > 0 ? fmt(mn.engagement) : '—'}</span>
                  <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.publishedAt}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Al final: el mapeo detallado ── */}
      <ScIndicatorRows m={m} cur={timeline} prev={prev} days={days} />
      {sc.phase === 'loading' && <div className="card"><div className="card-bd sc-empty">Cargando las últimas semanas y quién habló…</div></div>}
      {sc.phase === 'error' && <div className="card"><div className="card-bd"><EmptyState reason="error" compact title="No se pudieron cargar las últimas semanas ni quién habló" detail="Recarga la página en unos segundos." /></div></div>}
      {sc.data && <ScWeeks data={sc.data.weeks} />}
      {sc.data && sc.data.voices && (
        <>
          <ScVoices data={sc.data.voices} />
          <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 1fr', '1fr'), gap: 'var(--sp-3)' }}>
            <ScVoicesDaily data={sc.data.voices} />
            <ScInteraction data={sc.data.voices} />
          </div>
        </>
      )}

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
      {metricModal && MetricInsightModal && (
        <MetricInsightModal metricKey={metricModal.metricKey} value={metricModal.value} valueDisplay={metricModal.valueDisplay}
          label={metricModal.label} accent={metricModal.accent} period={period}
          agency={localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || ''}
          onClose={() => setMetricModal(null)} />
      )}
    </div>
  );
}

// Escala secuencial del heatmap y del mapa. Los 6 pasos viven en tokens.css
// (--seq-0..5); aquí sólo está el orden, para que la LEYENDA y las CELDAS no
// puedan divergir (era el hallazgo F6).
const SEQ_STEPS = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
function seqColor(intensity) {
  const t = Math.min(1, Math.max(0, intensity || 0));
  // El paso 0 queda RESERVADO al cero real. Antes cualquier valor bajo (t < 0.1)
  // redondeaba al mismo paso que "sin actividad" y, con --seq-0 a 0.08 de alfa
  // (1.10:1 contra --canvas), una franja CON menciones se pintaba idéntica a una
  // vacía: el heatmap sub-reportaba la actividad de madrugada y el mapa de
  // municipios los municipios con poco volumen. Los valores > 0 arrancan en el
  // paso 1.
  if (t === 0) return SEQ_STEPS[0];
  return SEQ_STEPS[1 + Math.round(t * (SEQ_STEPS.length - 2))];
}

// Variante ATADA A LA DISTRIBUCIÓN, para datos con cola larga. `seqColor`
// normaliza v/max lineal, y con San Juan a 346 contra ocho municipios bajo 100
// eso mete 8 de 12 en el MISMO paso y deja 3 de los 6 pasos sin dibujar nunca:
// la leyenda promete una resolución que el mapa no tiene. Aquí los cortes salen
// de los cuantiles de los valores presentes, así que cada paso lleva
// municipios. Arranca en --seq-1 y no en --seq-0 porque --seq-0 mide 1.09:1
// sobre --canvas: es "sin dato", no un dato bajo.
function seqQuantileScale(values, steps = 5) {
  const tokens = SEQ_STEPS.slice(SEQ_STEPS.length - steps);
  const sorted = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const edges = [];
  for (let i = 1; i < steps && sorted.length > 0; i++) {
    edges.push(sorted[Math.min(sorted.length - 1, Math.floor((i / steps) * sorted.length))]);
  }
  function binOf(v) {
    let i = 0;
    while (i < edges.length && v >= edges[i]) i++;
    return i;
  }
  return {
    tokens,
    edges,
    colorOf: (v) => tokens[binOf(Number(v) || 0)],
    // Rango numérico de cada paso, para que la leyenda pueda decirlo en vez de
    // dejar el color sin unidad.
    rangeOf: (i) => {
      if (sorted.length === 0) return '';
      const lo = i === 0 ? sorted[0] : edges[i - 1];
      const hi = i < edges.length ? edges[i] - 1 : sorted[sorted.length - 1];
      return lo >= hi ? `${lo}` : `${lo}–${hi}`;
    },
  };
}

// =============== MENTIONS ===============
// El feed de menciones ya NO filtra el array `D.MENTIONS` precargado.
// Hace fetch directo a `/api/eco-mentions` con paginación + búsqueda
// server-side para que los filtros funcionen sobre el universo completo y la
// paginación numerada navegue por TODAS las menciones del período, no solo
// las 20-50 que vienen en el cargue inicial del dashboard.
const PAGE_SIZE = 25;
const VIRAL_THRESHOLD = 5000;
// Un umbral es una REGLA, no una estimación: se escribe exacto y con el MISMO
// texto en la etiqueta del KPI y en el título del drill-down que ese KPI abre.
// Antes la etiqueta decía '≥ 5K' y el modal titulaba 'Engagement ≥ 5,000'.
const VIRAL_THRESHOLD_LABEL = '≥ ' + VIRAL_THRESHOLD.toLocaleString('es-PR');

// Opciones canónicas compartidas entre MentionsScreen y SearchScreen para que
// no diverjan dos listas copiadas a mano (la auditoría encontró duplicación).
const SOURCE_OPTIONS = [
  { v: 'all', l: 'Todas las fuentes' },
  { v: 'facebook', l: 'Facebook' },
  { v: 'twitter', l: 'X / Twitter' },
  { v: 'news', l: 'Noticias' },
  { v: 'instagram', l: 'Instagram' },
  { v: 'youtube', l: 'YouTube' },
];
const VIEW_MODES = [
  { k: 'list', l: 'Lista', icon: 'List' },
  { k: 'cards', l: 'Cards', icon: 'Grid' },
  { k: 'table', l: 'Tabla', icon: 'Table' },
];
// Orden respaldado por /api/eco-mentions (recent | engagement | relevance).
// 'relevance' requiere query; sin ella se resuelve a 'recent'. NO existe orden
// por 'sentiment' en la API — se eliminó de la UI porque era opción muerta.
const SORT_OPTIONS = [
  { k: 'relevance', l: 'Relevancia', needsQuery: true },
  { k: 'recent', l: 'Reciente' },
  { k: 'engagement', l: 'Engagement' },
];
// Resuelve el orden efectivo: 'relevance' sin query cae a 'recent', para que el
// control nunca marque una opción que la API ignora.
function resolveSort(sortBy, hasQuery) {
  if (sortBy === 'relevance' && !hasQuery) return 'recent';
  return sortBy || 'recent';
}

function SourceSelect({ value, onChange, style }) {
  return (
    <select className="input" value={value} onChange={onChange} style={style}>
      {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function ViewToggle({ viewMode, setViewMode }) {
  return (
    <div className="toggle-group" style={{ fontSize: 'var(--fs-overline)' }}>
      {VIEW_MODES.map((o) => {
        const IC = Icons[o.icon] || Icons.List;
        return (
          <button key={o.k} onClick={() => setViewMode(o.k)} className={`chip ${viewMode === o.k ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
            <IC size={11} /> {o.l}
          </button>
        );
      })}
    </div>
  );
}

// Control de orden compartido (chips). Deshabilita 'relevance' sin query y
// resalta el orden EFECTIVO. Se agrupa nowrap para que la etiqueta no se
// despegue de sus chips al hacer wrap.
function SortChips({ sortBy, setSortBy, hasQuery }) {
  const effective = resolveSort(sortBy, hasQuery);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'nowrap', marginLeft: 'auto' }}>
      <span className="section-eyebrow" style={{ margin: 0 }}>Ordenar</span>
      <div className="toggle-group">
        {SORT_OPTIONS.map((o) => {
          const disabled = o.needsQuery && !hasQuery;
          return (
            <button key={o.k} className={`chip ${effective === o.k ? 'active' : ''}`}
              onClick={() => { if (!disabled) setSortBy(o.k); }} disabled={disabled}
              style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              title={disabled ? 'Requiere un término de búsqueda' : undefined}>
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MentionsScreen({ onMentionClick }) {
  // Estado de filtros (server-side). `q` se sincroniza con `queryInput` con
  // debounce de 300ms para evitar un fetch por cada tecla.
  const [queryInput, setQueryInput] = useState('');
  const [filters, setFilters] = useState({
    q: '', sentiment: 'all', source: 'all', topic: '', region: '', sortBy: 'recent',
  });
  // Términos seleccionados en la nube. Se envían a /api/eco-mentions dentro de
  // `q` porque el API ya hace AND entre tokens con tope de 8
  // (eco-mentions/route.ts:226-236) — no se inventa un parámetro nuevo ni un
  // conmutador AND/OR que el backend no soporta.
  const [terms, setTerms] = useState([]);
  const toggleTerm = React.useCallback((t) => {
    setTerms((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      if (prev.length >= 8) return prev; // el API topa en 8
      return [...prev, t];
    });
    setPage(1);
  }, []);
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ mentions: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [viralCount, setViralCount] = useState(null); // null = loading
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('eco.viewMode') || 'list');
  const [moreOpen, setMoreOpen] = useState(false);
  const [slice, setSlice] = useState(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  React.useEffect(() => { localStorage.setItem('eco.viewMode', viewMode); }, [viewMode]);

  // Debounce del buscador → filters.q
  React.useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => f.q === queryInput ? f : { ...f, q: queryInput });
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [queryInput]);

  // Cuando cambian los filtros (no la página), reset a página 1.
  // Cuando cambia la página, no reseteamos filtros.
  React.useEffect(() => { setPage(1); }, [filters.sentiment, filters.source, filters.topic, filters.region, filters.sortBy]);

  // Fetch del feed con filtros + paginación.
  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const agency = localStorage.getItem('eco.agency') || '';
    // ecoGetPeriodParams respeta el rango personalizado (eco.from/to); leer
    // eco.period a mano lo ignoraba y /mentions mostraba 30 días rolantes.
    const params = new URLSearchParams({
      ...window.ecoGetPeriodParams(),
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (agency) params.set('agency', agency);
    // La q efectiva combina el buscador y los términos de la nube: un solo
    // parámetro, un solo predicado, así la lista y la nube nunca discrepan.
    const qEff = [filters.q, ...terms].filter(Boolean).join(' ').trim();
    if (qEff) params.set('q', qEff);
    if (filters.sentiment !== 'all') params.set('sentiment', filters.sentiment);
    if (filters.source !== 'all') params.set('source', filters.source);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.region) params.set('region', filters.region);
    const sort = resolveSort(filters.sortBy, !!qEff);
    if (sort !== 'recent') params.set('sortBy', sort);
    ecoFetchAuthed('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then((j) => setData({ mentions: j.mentions || [], total: Number(j.total || 0) }))
      .catch((e) => {
        if (e && e.name === 'AbortError') return;
        if (e && e.code === 401) { ecoBounceToSignIn(); return; }
        setError(true); // un fallo real ya no se confunde con "sin resultados"
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [filters, terms, page, reloadKey]);

  // Conteo de "Virales": una consulta separada con limit=1 (solo nos
  // interesa `total`). Se recalcula cuando cambia el período/agency, pero
  // NO cuando cambian filtros de búsqueda — virales es un agregado global.
  React.useEffect(() => {
    const ctrl = new AbortController();
    const agency = localStorage.getItem('eco.agency') || '';
    // Ventana cerrada explícita (from/to) en vez del `period` rolling: así el
    // conteo de la card y el total del slice modal (que también manda from/to)
    // cuentan exactamente lo mismo.
    const vw = (window.ecoResolvedWindow && window.ecoResolvedWindow()) || {};
    const params = new URLSearchParams({
      ...(vw.from && vw.to ? { from: vw.from, to: vw.to } : window.ecoGetPeriodParams()),
      limit: '1', minEngagement: String(VIRAL_THRESHOLD),
    });
    if (agency) params.set('agency', agency);
    setViralCount(null);
    fetch('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { total: 0 })
      .then((j) => setViralCount(Number(j.total || 0)))
      .catch(() => setViralCount(0));
    return () => ctrl.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const topicsList = (D.TOPICS || []).filter((t) => t && t.slug);
  const regions = Array.from(new Set((D.MUNICIPALITIES || []).map((m) => m && m.region).filter(Boolean))).sort();

  const activeMoreFiltersCount = (filters.topic ? 1 : 0) + (filters.region ? 1 : 0) + (filters.sortBy !== 'recent' ? 1 : 0);
  const searchTerms = [...(filters.q ? filters.q.trim().split(/\s+/) : []), ...terms].filter((t) => t.length >= 2);

  function openViralSlice() {
    setSlice({
      eyebrow: 'Menciones virales',
      title: 'Engagement ' + VIRAL_THRESHOLD_LABEL,
      // Sin `accent`: hereda el naranja de drill-down de los demás slice modals.
      // Mismo motivo que la tarjeta: cruzar el umbral de engagement no tiene signo,
      // y la franja roja daba el corte por negativo antes de leer una sola mención.
      _filter: { minEngagement: String(VIRAL_THRESHOLD) },
    });
  }
  const MentionsSliceModal = (window.ECO_SHELL && window.ECO_SHELL.MentionsSliceModal) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Filter bar */}
      <div className="card" style={{ padding: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Icons.Search size={14} color="var(--text-3)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="input" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="Buscar en menciones…" style={{ paddingLeft: 34 }} />
        </div>
        <div className="toggle-group">
          {/* Los tres VALORES de sentimiento llevan punto de color; 'Todas' no, porque
              no es un valor sino la ausencia de filtro. El neutral usa --neu, el mismo
              token con el que ya se pintan la barra apilada y la leyenda 'Neutral' del
              resto del producto: era el único valor del grupo sin marca, así que se
              leía como 'sin color = sin dato' en el chip que sí filtra. */}
          {[{ k: 'all', l: 'Todas' }, { k: 'positivo', l: 'Positivo', tone: 'pos' }, { k: 'neutral', l: 'Neutral', tone: 'neu' }, { k: 'negativo', l: 'Negativo', tone: 'neg' }].map((x) => (
            <button key={x.k} onClick={() => setFilters((f) => ({ ...f, sentiment: x.k }))} className={`chip ${filters.sentiment === x.k ? 'active' : ''}`}>
              {x.tone && <span className="dot" style={{ background: `var(--${x.tone})` }} />}{x.l}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--hairline)' }} />
        <SourceSelect value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} style={{ width: 160 }} />
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setMoreOpen((v) => !v)}>
            <Icons.Filter size={13} /> Más filtros {activeMoreFiltersCount > 0 && <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-overline)' }}>·{activeMoreFiltersCount}</span>}
          </button>
          {moreOpen && (
            <div className="card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 80, padding: 'var(--sp-3)', minWidth: 260, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}>
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginBottom: 'var(--sp-15)' }}>Tópico</div>
              <select className="input" value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} style={{ width: '100%', marginBottom: 'var(--sp-3)' }}>
                <option value="">Todos los tópicos</option>
                {topicsList.map((t) => <option key={t.slug} value={t.slug}>{t.name || t.slug}</option>)}
              </select>
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginBottom: 'var(--sp-15)' }}>Región</div>
              <select className="input" value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))} style={{ width: '100%', marginBottom: 'var(--sp-3)' }}>
                <option value="">Todas las regiones</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginBottom: 'var(--sp-15)' }}>Ordenar por</div>
              <div className="toggle-group">
                {SORT_OPTIONS.map((o) => {
                  const disabled = o.needsQuery && !filters.q;
                  const effective = resolveSort(filters.sortBy, !!filters.q);
                  return (
                    <button key={o.k} className={`chip ${effective === o.k ? 'active' : ''}`}
                      onClick={() => { if (!disabled) setFilters((f) => ({ ...f, sortBy: o.k })); }} disabled={disabled}
                      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                      title={disabled ? 'Requiere un término de búsqueda' : undefined}>
                      {o.l}
                    </button>
                  );
                })}
              </div>
              {activeMoreFiltersCount > 0 && (
                <button className="chip" style={{ marginTop: 'var(--sp-3)' }} onClick={() => setFilters((f) => ({ ...f, topic: '', region: '', sortBy: 'recent' }))}>
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
          {/* El feed es EN VIVO (ventana rolling que incluye hoy) — a
              diferencia de los agregados, que cierran en ayer. El rótulo lo
              hace explícito para que los dos totales de esta pantalla no
              parezcan contradictorios (auditoría 2026-08, P0-10). */}
          {loading ? 'Cargando…' : `${window.ecoFmtCount(data.total)} menciones · en vivo (incluye hoy)`}
        </span>
      </div>

      {/* Quick metrics — 5 cards. "Velocidad" = cambio % del engagement vs el
          período anterior, con palabra (Acelerada/Estable/Desacelerada). */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(5, 1fr)', 'repeat(2, 1fr)', 'repeat(3, 1fr)'), gap: 12 }}>
        {/* Exacto, no '1.3K': es el mismo número que el contador de la barra de
            filtros y el subtítulo de la lista imprimen a 40px y 200px de aquí. */}
        <QuickMetric label="Total" value={window.ecoFmtCount(D.CURRENT_METRICS.totalMentions)} sub="período · cierre de ayer" />
        <QuickMetric label="Alcance" value={fmt(D.CURRENT_METRICS.totalReach)} />
        <MetricQuick label="Engagement rate" display={D.CURRENT_METRICS.display && D.CURRENT_METRICS.display.engagementRate} />
        <MetricQuick label="Velocidad" display={D.CURRENT_METRICS.display && D.CURRENT_METRICS.display.velocity} note="vs período ant." />
        {/* Sin `tone`: la cifra va en --text. 'Viral' es una MAGNITUD sin polaridad
            —el umbral es minEngagement, sin filtro de sentiment—, así que el rojo
            afirmaba un juicio que el dato no sostiene, y lo hacía en la tarjeta que
            menos decide de la fila mientras Total y Alcance van en blanco. La
            afordancia de click ya la pone el chevron del encabezado. */}
        <QuickMetric
          label={`Virales (${VIRAL_THRESHOLD_LABEL})`}
          value={viralCount == null ? '…' : fmt(viralCount)}
          onClick={viralCount != null && viralCount > 0 ? openViralSlice : null}
        />
      </div>

      {/* Nube de palabras: va entre el resumen y la lista porque su función es
          ORIENTAR antes de leer ("¿de qué se habla?") y su click filtra la lista
          que está justo debajo. */}
      {window.ECO_TERMS && (
        <window.ECO_TERMS.TermsCloud
          filters={{
            sentiment: filters.sentiment, source: filters.source,
            topic: filters.topic, q: filters.q,
          }}
          period={localStorage.getItem('eco.period') || window.ECO_DEFAULT_PERIOD}
          agency={localStorage.getItem('eco.agency') || ''}
          selected={terms}
          onToggleTerm={toggleTerm}
        />
      )}

      {/* Mentions table */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Menciones</div>
            <div className="card-hd-sub">
              {loading ? 'Cargando…' : error ? 'Error de conexión' : (
                data.total === 0
                  ? 'Sin resultados'
                  : `Página ${page} de ${totalPages} · ${window.ecoFmtCount(data.total)} en total`
              )}
            </div>
          </div>
          <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
        </div>
        {!loading && error && (
          <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--neg)', fontSize: 'var(--fs-body-sm)' }}>
            No se pudieron cargar las menciones.
            <button className="chip" style={{ marginLeft: 8 }} onClick={() => setReloadKey((k) => k + 1)}>Reintentar</button>
          </div>
        )}
        {!loading && !error && data.mentions.length === 0 && (
          <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
            No se encontraron menciones con los filtros actuales.
          </div>
        )}
        {!error && viewMode === 'list' && <MentionsList mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
        {!error && viewMode === 'cards' && <MentionsCards mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
        {!error && viewMode === 'table' && <MentionsTable mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
        {!error && data.total > PAGE_SIZE && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' }}>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        )}
      </div>
      {slice && MentionsSliceModal && (
        <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />
      )}
    </div>
  );
}

function QuickMetric({ label, value, sub, tone, valueColor, onClick }) {
  const color = valueColor || (tone === 'neg' ? 'var(--neg)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)');
  const baseStyle = {
    padding: 'var(--sp-4)',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'background 0.15s ease',
  };
  return (
    <div
      className="card"
      style={baseStyle}
      onClick={onClick || undefined}
      onMouseEnter={onClick ? (e) => (e.currentTarget.style.background = 'var(--canvas-2)') : undefined}
      onMouseLeave={onClick ? (e) => (e.currentTarget.style.background = '') : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-2)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)' }}>
        {label}
        {onClick && <Icons.ChevronRight size={10} color="var(--text-3)" style={{ marginLeft: 'auto' }} />}
      </div>
      <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color, marginTop: 'var(--sp-2)', fontFamily: 'var(--ff-display)' }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 600, marginTop: 'var(--sp-05)' }}>{sub}</div>}
    </div>
  );
}

// Un MetricDisplay de @eco/shared (word/value/short/band/color) se pinta SIEMPRE
// por aquí. Antes cada KPI lo desarmaba a su manera: 'Engagement rate' tomaba
// sólo `.word` y 'Velocidad' concatenaba `.value + ' vs período ant.'` a mano,
// así que el caso sin período de comparación (value === null) se quedaba sin la
// explicación que el módulo ya trae en `.short` ('Sin base de comparación') y la
// card mostraba un 'Sin base' huérfano. El signo y la unidad los pone el
// formateador; el sitio de llamada sólo aporta la nota de comparación.
function MetricQuick({ label, display, note, onClick }) {
  const d = display || {};
  const word = d.word || '—';
  // `.value` va al sub sólo si aporta algo: para las métricas de % puro el
  // formateador devuelve word === value ('3.4%') y repetirlo sería ruido.
  const num = d.value != null && d.value !== word ? d.value : null;
  const sub = num ? (note ? `${num} ${note}` : num)
                  : (d.short && d.short !== word ? d.short : '');
  // El color del tono sólo cuando dice algo: con banda (juicio cualitativo) o
  // sin valor (—/sin base, que va atenuado). Las métricas de % puro son tono
  // 'neutral' → --text-3, y bajar una cifra protagonista a --text-3 la lleva de
  // 15.3:1 a 5.0:1 sin significar nada.
  const tint = (d.band || d.value == null) ? d.color : undefined;
  return <QuickMetric label={label} value={word} sub={sub} valueColor={tint} onClick={onClick} />;
}

function Pagination({ page, totalPages, onChange }) {
  // Estilo clásico: Anterior · 1 2 3 … N · Siguiente. Muestra hasta 5 páginas
  // alrededor de la actual con elipses en los extremos cuando hay más.
  const window = 2; // vecinos a cada lado
  const pages = [];
  const push = (p) => { if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p); };
  push(1);
  for (let p = page - window; p <= page + window; p++) push(p);
  push(totalPages);
  pages.sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push({ ellipsis: true, key: 'e-' + prev });
    out.push({ p, key: 'p-' + p });
    prev = p;
  }

  const btnStyle = (active, disabled) => ({
    minWidth: 32,
    padding: '6px 10px',
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--hairline)'),
    background: active ? 'var(--accent-fill)' : 'var(--canvas)',
    color: disabled ? 'var(--text-3)' : (active ? 'var(--accent)' : 'var(--text-2)'),
    borderRadius: 'var(--r-md)',
    fontSize: 'var(--fs-caption)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: active ? 700 : 500,
    fontFamily: 'var(--ff-numeric)',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
      <button
        onClick={() => page > 1 && onChange(page - 1)}
        disabled={page <= 1}
        style={btnStyle(false, page <= 1)}
        aria-label="Página anterior"
      >
        <Icons.ChevronLeft size={12} style={{ verticalAlign: 'middle' }} />
        <span style={{ marginLeft: 4, fontSize: 'var(--fs-overline)' }}>Anterior</span>
      </button>
      {out.map((item) => item.ellipsis ? (
        <span key={item.key} style={{ padding: '6px 4px', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>…</span>
      ) : (
        <button
          key={item.key}
          onClick={() => onChange(item.p)}
          style={btnStyle(item.p === page, false)}
          aria-current={item.p === page ? 'page' : undefined}
        >
          {item.p}
        </button>
      ))}
      <button
        onClick={() => page < totalPages && onChange(page + 1)}
        disabled={page >= totalPages}
        style={btnStyle(false, page >= totalPages)}
        aria-label="Página siguiente"
      >
        <span style={{ marginRight: 4, fontSize: 'var(--fs-overline)' }}>Siguiente</span>
        <Icons.ChevronRight size={12} style={{ verticalAlign: 'middle' }} />
      </button>
    </div>
  );
}

// Resalta los términos de búsqueda dentro de un texto. `terms` es un array de
// tokens (los mismos que se mandan como `q` al API). Si no hay términos,
// devuelve el texto tal cual — así las pantallas que no buscan (o el feed sin
// query) renderizan exactamente igual que antes. Cada token se escapa para que
// caracteres especiales de regex no rompan el match.
function HL({ text, terms }) {
  if (text == null || text === '') return text || null;
  const list = (terms || []).map((t) => String(t).trim()).filter((t) => t.length >= 2);
  if (list.length === 0) return text;
  const escaped = list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let re;
  try { re = new RegExp('(' + escaped.join('|') + ')', 'ig'); } catch (_) { return text; }
  const parts = String(text).split(re);
  return parts.map((part, i) => (i % 2 === 1)
    ? <mark key={i} style={{ background: 'var(--accent-fill)', color: 'var(--accent)', padding: '0 2px', borderRadius: 'var(--r-sm)', fontWeight: 600 }}>{part}</mark>
    : <React.Fragment key={i}>{part}</React.Fragment>);
}

// --- Mentions: List view (dense table-row, sin columnas Engagement ni Pertinencia) ---
// Las columnas viven en UNA constante porque el encabezado y las filas son dos
// grids independientes: la cadena estaba escrita dos veces y basta cambiar una
// para que los rótulos dejen de caer sobre su columna.
// Tópico pasa de 110px fijos a minmax(110px, 1fr): con 110px se recortaban cinco
// de los ocho nombres de la taxonomía ('Energía e infraestructura' mide ~133px a
// 11px) mientras la columna de la mención guardaba ~250px vacíos a 1440px. Se
// reparte por FRACCIONES y no con max-content porque cada grid mediría su propio
// contenido —'Tópico' en el encabezado, el nombre largo en las filas— y las dos
// rejillas dejarían de coincidir. Con 3fr/1fr el sobrante va al tópico sólo donde
// existe: a 1440px tópico 207px y mención 622px; a 1024px, 143px y 429px; y en el
// suelo de 620px la pista de 1fr se clava en sus 110px y la mención conserva los
// 178px que ya tenía, así que la Lista en móvil no pierde ancho de titular.
const LIST_COLS = '20px minmax(0, 3fr) 110px minmax(110px, 1fr) 80px 30px';
function MentionsList({ mentions, onMentionClick, highlight }) {
  return (
    <div className="scroll-x">
      <div style={{ padding: '10px 16px 6px', display: 'grid', gridTemplateColumns: LIST_COLS, minWidth: 620, gap: 'var(--sp-3)', fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', borderBottom: '1px solid var(--hairline)' }}>
        <span /><span>Mención</span><span>Sentimiento</span><span>Tópico</span><span>Hora</span><span />
      </div>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
        return (
          <div key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover"
            style={{ display: 'grid', gridTemplateColumns: LIST_COLS, minWidth: 620, gap: 'var(--sp-3)', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}>
            <SIcon size={14} color="var(--text-3)" />
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', overflow: 'hidden' }}>
              {(mn.image || mn.avatar) && (
                <img src={mn.image || mn.avatar} alt="" loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{ width: 30, height: 30, borderRadius: 'var(--r-md)', objectFit: 'cover', flex: '0 0 auto', background: 'var(--canvas-2)' }} />
              )}
              <div style={{ overflow: 'hidden' }}>
                <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><HL text={mn.title} terms={highlight} /></div>
                <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.author} · {mn.domain}</div>
              </div>
            </div>
            <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
            <span title={mn.topicName || mn.topic || undefined} style={{ color: 'var(--text-2)', fontSize: 'var(--fs-overline)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.topicName || mn.topic || '—'}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.publishedAt}</span>
            <Icons.ChevronRight size={14} color="var(--text-3)" />
          </div>
        );
      })}
    </div>
  );
}

// --- Mentions: Cards view (rich tiles, sin pill de pertinencia) ---
function MentionsCards({ mentions, onMentionClick, highlight }) {
  return (
    <div style={{ padding: 'var(--sp-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--sp-3)' }}>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
        const accent = mn.sentiment === 'positivo' ? 'var(--pos)' : mn.sentiment === 'negativo' ? 'var(--neg)' : 'var(--warn)';
        return (
          <div key={mn.id} onClick={() => onMentionClick(mn)}
            style={{ background: 'var(--canvas)', border: '1px solid var(--hairline)', borderLeft: `3px solid ${accent}`, padding: 'var(--sp-4)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--canvas-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--canvas)'}>
            {mn.image && (
              <img src={mn.image} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 'var(--r-md)', background: 'var(--canvas-2)' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', fontWeight: 500 }}>
              <SIcon size={12} /> {mn.domain}
              <span>·</span>
              <span>{mn.publishedAt}</span>
              <span style={{ marginLeft: 'auto' }} className={`pill ${sc}`}>{mn.sentiment}</span>
            </div>
            <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 500, color: 'var(--text)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}><HL text={mn.title} terms={highlight} /></div>
            {mn.snippet && <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}><HL text={mn.snippet} terms={highlight} /></div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
              {mn.avatar && <img src={mn.avatar} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' }} />}
              <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{mn.author || '—'}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-2)' }}>{mn.topicName || mn.topic || '—'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Mentions: Table view (compact, sin columnas Engagement ni Pertinencia) ---
function MentionsTable({ mentions, onMentionClick, highlight }) {
  const columns = ['', 'Título', 'Autor', 'Dominio', 'Sentim.', 'Tópico', 'Subtópico', 'Municipio', 'Fecha'];
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-overline)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hairline-strong)', background: 'var(--canvas-2)' }}>
            {columns.map((c) => (
              <th key={c} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', whiteSpace: 'nowrap' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mentions.map(mn => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
            return (
              <tr key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover" style={{ borderBottom: '1px solid var(--hairline)', cursor: 'pointer' }}>
                <td style={{ padding: '8px 10px' }}><SIcon size={12} color="var(--text-3)" /></td>
                <td style={{ padding: '8px 10px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}><HL text={mn.title} terms={highlight} /></td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{mn.author || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.domain}</td>
                <td style={{ padding: '8px 10px' }}><span className={`pill ${sc}`}>{mn.sentiment}</span></td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.topicName || mn.topic || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>
                  {(mn.subtopics && mn.subtopics.length > 0) ? (
                    <>
                      {mn.subtopics[0]}
                      {mn.subtopics.length > 1 && (
                        <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>+{mn.subtopics.length - 1}</span>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.municipality || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{mn.publishedAt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// =============== SEARCH (página de resultados global) ===============
// Buscador unificado: el command palette (⌘K) abre esta pantalla con la query
// y aquí viven los resultados completos — facetas con conteos, orden,
// resaltado y paginación. Reusa el mismo /api/eco-mentions que el feed de
// Menciones, así que respeta agencia, período (incl. rango custom) y filtros.
function readRecentSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem('eco.recentSearches') || '[]');
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch (_) { return []; }
}
function pushRecentSearch(term) {
  const t = String(term || '').trim();
  if (t.length < 2) return;
  try {
    const prev = readRecentSearches().filter((s) => s.toLowerCase() !== t.toLowerCase());
    localStorage.setItem('eco.recentSearches', JSON.stringify([t, ...prev].slice(0, 8)));
  } catch (_) {}
}

function SearchScreen({ onMentionClick, agency, searchQuery, setSearchQuery, setActive }) {
  // Query inicial: prop del palette > ?q= de la URL > vacío.
  const initialQ = (() => {
    if (searchQuery && searchQuery.trim()) return searchQuery.trim();
    try { return new URLSearchParams(location.search).get('q') || ''; } catch (_) { return ''; }
  })();
  const [queryInput, setQueryInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [sortBy, setSortBy] = useState('relevance');
  const [filters, setFilters] = useState({ sentiment: 'all', source: 'all', topic: '', region: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('eco.viewMode') || 'list');
  const [recent, setRecent] = useState(readRecentSearches);
  const [moreOpen, setMoreOpen] = useState(false);
  const inputRef = React.useRef(null);

  const filtersActive = filters.sentiment !== 'all' || filters.source !== 'all' || !!filters.topic || !!filters.region;
  const activeMoreFiltersCount = (filters.topic ? 1 : 0) + (filters.region ? 1 : 0);
  const hasCriteria = (!!q && q.length >= 2) || filtersActive;
  const searchTerms = q ? q.trim().split(/\s+/).filter((t) => t.length >= 2) : [];
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const topicsList = (D.TOPICS || []).filter((t) => t && t.slug);
  const popularTopics = topicsList.slice(0, 8);
  const regions = Array.from(new Set((D.MUNICIPALITIES || []).map((m) => m && m.region).filter(Boolean))).sort();

  React.useEffect(() => { localStorage.setItem('eco.viewMode', viewMode); }, [viewMode]);
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  // Si el palette navega de nuevo a /search con otra query estando ya aquí,
  // sincroniza el input.
  React.useEffect(() => {
    if (searchQuery != null && searchQuery.trim() && searchQuery.trim() !== queryInput) {
      setQueryInput(searchQuery.trim());
    }
  }, [searchQuery]);

  // Debounce queryInput -> q. Sincroniza URL (?q=), recientes y estado
  // compartido para que palette y deep-links queden alineados.
  React.useEffect(() => {
    const id = setTimeout(() => {
      const term = queryInput.trim();
      setQ(term);
      setPage(1);
      if (setSearchQuery) setSearchQuery(term);
      try {
        history.replaceState(history.state, '', term ? '/search?q=' + encodeURIComponent(term) : '/search');
      } catch (_) {}
      if (term.length >= 2) { pushRecentSearch(term); setRecent(readRecentSearches()); }
    }, 320);
    return () => clearTimeout(id);
  }, [queryInput]);

  React.useEffect(() => { setPage(1); }, [filters.sentiment, filters.source, filters.topic, filters.region, sortBy]);

  // Fetch de resultados. Se omite cuando no hay criterio (estado vacío).
  React.useEffect(() => {
    const active = (!!q && q.length >= 2) || filters.sentiment !== 'all' || filters.source !== 'all' || !!filters.topic || !!filters.region;
    if (!active) { setData({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }); setLoading(false); setError(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ ...window.ecoGetPeriodParams(), limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (agency) params.set('agency', agency);
    if (q && q.length >= 2) params.set('q', q);
    const sort = resolveSort(sortBy, !!(q && q.length >= 2));
    if (sort !== 'recent') params.set('sortBy', sort);
    if (filters.sentiment !== 'all') params.set('sentiment', filters.sentiment);
    if (filters.source !== 'all') params.set('source', filters.source);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.region) params.set('region', filters.region);
    ecoFetchAuthed('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then((j) => setData({ mentions: j.mentions || [], total: Number(j.total || 0), sentiment: j.sentiment || { pos: 0, neu: 0, neg: 0 } }))
      .catch((e) => {
        if (e && e.name === 'AbortError') return;
        if (e && e.code === 401) { ecoBounceToSignIn(); return; }
        setError(true);
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [q, sortBy, filters, page, agency, reloadKey]);

  const sentChips = [
    { k: 'all', l: 'Todas', tone: null, count: data.total },
    { k: 'positivo', l: 'Positivo', tone: 'pos', count: data.sentiment.pos },
    { k: 'neutral', l: 'Neutral', tone: 'neu', count: data.sentiment.neu }, // --neu: mismo punto que en /mentions
    { k: 'negativo', l: 'Negativo', tone: 'neg', count: data.sentiment.neg },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Hero search */}
      <div className="card" style={{ padding: 'var(--sp-4)' }}>
        {/* Mismo primitivo que el buscador del header, tamaño lg: un solo campo,
            un solo placeholder. El 15px de aquí venía de --fs-title-md, un token
            de TÍTULO puesto en el texto que se escribe. */}
        <SearchField size="lg"
          inputRef={inputRef}
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setQ(queryInput.trim()); setPage(1); } }}
          ariaLabel="Buscar en todas las menciones"
          trailingWidth={queryInput ? 40 : 14}
          trailing={queryInput ? (
            <button onClick={() => { setQueryInput(''); if (inputRef.current) inputRef.current.focus(); }} title="Limpiar búsqueda" aria-label="Limpiar búsqueda"
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 'var(--fs-display-md)', lineHeight: 1 }}>×</button>
          ) : null}
        />
      </div>

      {/* Estado vacío: recientes + tópicos frecuentes */}
      {!hasCriteria && (
        <div className="card" style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)' }}>
          {/* Mismo primitivo que las otras 9 pantallas (antes: icono, título y
              detalle a mano, con el ancho de línea en px). size="lg" porque aquí
              el vacío ES la pantalla, no un hueco dentro de una card; el padding
              vertical lo pone el primitivo, por eso la card baja a --sp-4. */}
          <EmptyState size="lg" reason="empty"
            title="Busca en todas las menciones"
            detail="Escribe una o más palabras clave para encontrar menciones por título o contenido. Combina términos para afinar y usa los filtros para acotar por sentimiento, fuente o tópico." />
          {recent.length > 0 && (
            <div>
              <div className="section-eyebrow">Búsquedas recientes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-15)', marginTop: 'var(--sp-2)' }}>
                {recent.map((s) => (
                  <button key={s} className="chip" onClick={() => { setQueryInput(s); setQ(s); setPage(1); }}>{s}</button>
                ))}
                <button className="chip" style={{ color: 'var(--text-3)' }}
                  onClick={() => { try { localStorage.removeItem('eco.recentSearches'); } catch (_) {} setRecent([]); }}>
                  Limpiar
                </button>
              </div>
            </div>
          )}
          {popularTopics.length > 0 && (
            <div>
              <div className="section-eyebrow">Tópicos frecuentes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-15)', marginTop: 'var(--sp-2)' }}>
                {popularTopics.map((t) => (
                  <button key={t.slug} className="chip" onClick={() => setFilters((f) => ({ ...f, topic: t.slug }))}>
                    <Icons.Hash size={11} /> {t.name || t.slug}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Facet bar + resultados */}
      {hasCriteria && (
        <>
          <div className="card" style={{ padding: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
              {sentChips.map((x) => (
                <button key={x.k} onClick={() => setFilters((f) => ({ ...f, sentiment: x.k }))} className={`chip ${filters.sentiment === x.k ? 'active' : ''}`}>
                  {x.tone && <span className="dot" style={{ background: `var(--${x.tone})` }} />}{x.l}
                  {filters.sentiment === 'all' && <span className="num" style={{ marginLeft: 6, color: 'var(--text-3)' }}>{Number(x.count || 0).toLocaleString('es-PR')}</span>}
                </button>
              ))}
            </div>
            <div style={{ width: 1, height: 24, background: 'var(--hairline)' }} />
            <SourceSelect value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} style={{ width: 160 }} />
            <div style={{ position: 'relative' }}>
              <button className="btn" onClick={() => setMoreOpen((v) => !v)}>
                <Icons.Filter size={13} /> Más filtros {activeMoreFiltersCount > 0 && <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-overline)' }}>·{activeMoreFiltersCount}</span>}
              </button>
              {moreOpen && (
                <div className="card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 80, padding: 'var(--sp-3)', minWidth: 260, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}>
                  <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-15)' }}>Tópico</div>
                  <select className="input" value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} style={{ width: '100%', marginBottom: 'var(--sp-3)' }}>
                    <option value="">Todos los tópicos</option>
                    {topicsList.map((t) => <option key={t.slug} value={t.slug}>{t.name || t.slug}</option>)}
                  </select>
                  <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-15)' }}>Región</div>
                  <select className="input" value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))} style={{ width: '100%', marginBottom: 'var(--sp-3)' }}>
                    <option value="">Todas las regiones</option>
                    {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {(filters.topic || filters.region) && (
                    <button className="chip" onClick={() => setFilters((f) => ({ ...f, topic: '', region: '' }))}>Limpiar</button>
                  )}
                </div>
              )}
            </div>
            {filtersActive && (
              <button className="chip" onClick={() => setFilters({ sentiment: 'all', source: 'all', topic: '', region: '' })}>Limpiar filtros</button>
            )}
            <SortChips sortBy={sortBy} setSortBy={setSortBy} hasQuery={!!(q && q.length >= 2)} />
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-hd-title">{q ? <>Resultados para «{q}»</> : 'Resultados'}</div>
                <div className="card-hd-sub">
                  {loading
                    ? 'Buscando…'
                    : error
                        ? 'Error de conexión'
                        : (data.total === 0
                            ? 'Sin resultados'
                            : `${data.total.toLocaleString('es-PR')} menciones · en vivo (incluye hoy) · página ${page} de ${totalPages}`)}
                </div>
              </div>
              <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
            </div>
            {loading && data.mentions.length === 0 && (
              <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Buscando…</div>
            )}
            {!loading && error && (
              // reason="error" ya trae role="alert" y el botón de acción: el bloque
              // a mano no anunciaba el fallo a lectores de pantalla y metía un
              // `.chip` de 11px dentro de una línea de 13px.
              <EmptyState reason="error"
                title="No se pudo completar la búsqueda"
                detail="Revisa la conexión y vuelve a intentar."
                action={() => setReloadKey((k) => k + 1)} actionLabel="Reintentar" />
            )}
            {!loading && !error && data.total === 0 && (
              // 'filtered' cuando hay filtros puestos y 'empty' cuando la consulta
              // simplemente no trae nada: el mismo primitivo distingue las dos
              // causas, que es la diferencia que el bloque plano no hacía.
              <EmptyState reason={filtersActive ? 'filtered' : 'empty'}
                title={q ? `Sin resultados para «${q}»` : 'Sin resultados'}
                detail={filtersActive ? 'Ninguna mención coincide con los filtros actuales.' : 'Prueba con menos palabras o con sinónimos.'}
                action={filtersActive ? () => setFilters({ sentiment: 'all', source: 'all', topic: '', region: '' }) : undefined}
                actionLabel={filtersActive ? 'Quitar filtros' : undefined} />
            )}
            {!error && data.mentions.length > 0 && viewMode === 'list' && <MentionsList mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
            {!error && data.mentions.length > 0 && viewMode === 'cards' && <MentionsCards mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
            {!error && data.mentions.length > 0 && viewMode === 'table' && <MentionsTable mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
            {data.total > PAGE_SIZE && (
              <div style={{ padding: '14px 16px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' }}>
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// =============== SENTIMENT ===============
function SentimentScreen({ onMentionClick, period, agency }) {
  const [slice, setSlice] = useState(null);
  const [groupBy, setGroupBy] = useState('source');
  const m = D.CURRENT_METRICS;

  // Mapa de dimensiones del breakdown "Sentimiento por X". Las 4 fuentes de
  // datos vienen del API /api/eco-data — ver eco-data/route.ts.
  const GROUP_BY_OPTIONS = [
    { k: 'source',   l: 'Fuente',    dataKey: 'SENTIMENT_BY_SOURCE',   itemKey: 'source' },
    { k: 'topic',    l: 'Tópico',    dataKey: 'SENTIMENT_BY_TOPIC',    itemKey: 'topic' },
    { k: 'subtopic', l: 'Subtópico', dataKey: 'SENTIMENT_BY_SUBTOPIC', itemKey: 'subtopic' },
    { k: 'region',   l: 'Región',    dataKey: 'SENTIMENT_BY_REGION',   itemKey: 'region' },
  ];
  const activeGroup = GROUP_BY_OPTIONS.find((o) => o.k === groupBy) || GROUP_BY_OPTIONS[0];
  const groupRows = (D[activeGroup.dataKey] || []).map((r) => ({
    ...r,
    label: r[activeGroup.itemKey] || r.source || r.topic || r.subtopic || r.region || '—',
  }));

  function openNssInsight() {
    if (m.nss == null) return;
    openMetricInsightShared(setSlice, {
      metric: 'nss',
      value: `${m.nss > 0 ? '+' : ''}${m.nss}`,
      accent: 'var(--accent)',
      label: 'Net Sentiment Score',
      // Ventana explícita de los datos que esta pantalla muestra (D.PERIOD).
      // Con solo periodPreset, el rango personalizado devolvía 400 en
      // /api/eco-metric-insight (sin clave 'custom' — auditoría 2026-08).
      periodStart: ecoDataWindow().from,
      periodEnd: ecoDataWindow().to,
      periodPreset: period || '7D',
      agency,
      subcomponents: [],
      filter: {},
    });
  }

  function openSentimentSlice(name) {
    const row = D.SENTIMENT_BREAKDOWN.find(s => s.name === name);
    if (!row) return;
    const accent = name === 'positivo' ? 'var(--pos)' : name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    const values = D.TIMELINE.map(d => d[name] || 0);
    const xLabels = D.TIMELINE.map(d => d.date);
    setSlice({
      eyebrow: 'Sentimiento',
      title: `Menciones ${row.label.toLowerCase()}`,
      accent,
      histogram: { label: `Evolución diaria · ${row.label.toLowerCase()}`, values, xLabels },
      mentions: [],
      // El donut (SENTIMENT_BREAKDOWN) cuenta la ventana de eco-data en el
      // universo pertinente — la modal hereda la ventana; el universo es el
      // default de ambos.
      _filter: { ...ecoDataWindow(), sentiment: name },
    });
  }

  function openEmotionSlice(e) {
    // El acento del modal se resuelve por la MISMA función que pinta la barra.
    // Antes usaba `e.color` del API, que es 'pos'/'neg'/'warn'/'neu'
    // (eco-data/route.ts:875-882): la fila "Ira" se veía con su token --emo-ira
    // y el modal que abría salía con --neg. Dos colores para el mismo dato a un
    // click de distancia, y era el único camino por el que --neu llegaba a
    // resolverse (construido por plantilla, nunca escrito literal).
    const accent = emotionColor(e.emotion);
    setSlice({
      eyebrow: 'Emoción detectada',
      title: e.emotion,
      accent,
      mentions: [],
      _filter: { ...ecoDataWindow(), emotion: e.emotion },
    });
  }

  function openTimelineDaySlice(d) {
    const bias = d.negativo > d.positivo ? 'negativo' : d.positivo > d.negativo ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--text-3)';
    const dayIso = d.fullDate ? d.fullDate.slice(0, 10) : undefined;
    // Sin histogram: el "Volumen por hora" era una senoide sintética, no
    // datos (auditoría 2026-08).
    setSlice({
      eyebrow: d.date,
      title: bias === 'negativo' ? 'Día negativo' : bias === 'positivo' ? 'Día positivo' : 'Día neutro',
      accent,
      sentiment: { pos: d.positivo || 0, neu: d.neutral || 0, neg: d.negativo || 0 },
      mentions: [],
      _filter: { day: dayIso },
    });
  }

  // openGroupSlice — click en la barra de "Sentimiento por X". Abre TODAS las
  // menciones del grupo, sin filtrar por el segmento donde cayó el click:
  // así el total del modal cuadra con el número de la fila y se pueden
  // explorar los tres sentimientos de una (petición explícita del usuario:
  // "no deberia ser asi, se abren todas, para que los conteos coincidan y
  // sea facil explorarlas"). El desglose pos/neu/neg viaja en `sentiment`
  // para que el modal lo muestre como resumen.
  function openGroupSlice(row) {
    const label = row.label;
    const pos = row.positivo || 0;
    const neu = row.neutral || 0;
    const neg = row.negativo || 0;
    const total = pos + neu + neg;
    const bias = neg > pos ? 'negativo' : pos > neg ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--text-3)';
    // Las tablas "Sentimiento por X" cuentan la ventana de eco-data en el
    // universo pertinente — la modal hereda la ventana.
    const filter = { ...ecoDataWindow() };
    if (groupBy === 'source') {
      filter.source = {
        'Facebook': 'facebook', 'Twitter': 'twitter', 'X / Twitter': 'twitter',
        'Noticias': 'news', 'Instagram': 'instagram', 'YouTube': 'youtube', 'Blogs': 'blog',
      }[label] || String(label || '').toLowerCase();
    } else if (groupBy === 'topic') {
      filter.topic = row.slug || row.topic || label;
    } else if (groupBy === 'subtopic') {
      filter.subtopic = label;
    } else if (groupBy === 'region') {
      filter.region = label;
    }
    const eyebrowLabel = { source: 'Fuente', topic: 'Tópico', subtopic: 'Subtópico', region: 'Región' }[groupBy] || 'Grupo';
    setSlice({
      eyebrow: `${eyebrowLabel} · ${label}`,
      title: label,
      accent,
      volume: total,
      sentiment: { pos, neu, neg },
      mentions: [],
      _filter: filter,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Narrative hero */}
      <div className="card" style={{ padding: 'var(--pad-card)', display: 'grid', gridTemplateColumns: window.ecoCols('1fr auto', '1fr'), gap: 'var(--sp-6)', alignItems: 'center' }}>
        <div>
          <div className="section-eyebrow">NSS (Net Sentiment Score)</div>
          <button onClick={openNssInsight}
            className="row-hover"
            title="Ver insight del NSS para el periodo"
            style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-4)', marginTop: 'var(--sp-2)', padding: '4px 8px', marginInline: -8, borderRadius: 'var(--r-md)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <div className="num" style={{ fontSize: 'var(--fs-num-2xl)', fontWeight: 600, color: (m.display && m.display.nss.color) || 'var(--accent)', lineHeight: 1, fontFamily: 'var(--ff-display)' }}>{(m.display && m.display.nss.word) || 'NSS'}</div>
            {/* --fs-num-sm, no --fs-title-md: mismo 15px, pero --fs-title-md
                está declarado en tokens.css:50 para .card-hd-title. Una cifra
                dimensionada con el token de los títulos de tarjeta hace que
                cualquier ajuste futuro de los títulos mueva este número. */}
            <div className="num" style={{ fontSize: 'var(--fs-num-sm)', fontWeight: 600, color: 'var(--text-2)' }}>{(m.display && m.display.nss.value) || ((m.nss > 0 ? '+' : '') + m.nss)}</div>
            <Icons.ArrowRight size={14} color="var(--text-3)" />
            {m.deltaDisplay && m.deltaDisplay.nss && (
              m.deltaDisplay.nss.hasBaseline ? (
                <div style={{ marginLeft: 8, fontSize: 'var(--fs-caption)', fontWeight: 600, color: m.deltaDisplay.nss.direction === 'flat' ? 'var(--text-3)' : (m.deltaDisplay.nss.tone === 'pos' ? 'var(--pos)' : m.deltaDisplay.nss.tone === 'neg' ? 'var(--neg)' : 'var(--text-3)') }}>
                  {m.deltaDisplay.nss.direction === 'flat' ? `· ${m.deltaDisplay.nss.word}` : `${m.deltaDisplay.nss.arrow} ${m.deltaDisplay.nss.value}`}
                  <span style={{ color: 'var(--text-3)', fontWeight: 500 }}> vs período anterior</span>
                </div>
              ) : (
                <div style={{ marginLeft: 8, fontSize: 'var(--fs-caption)', color: 'var(--text-3)', fontWeight: 500 }}>— sin base de comparación</div>
              )
            )}
          </button>
          {/* Este párrafo era texto HARDCODEADO ("deterioro acelerado por
              discurso sobre infraestructura vial… frustración y enojo") que se
              mostraba igual para cualquier agencia y periodo — análisis
              inventado. Ahora se deriva de los datos del periodo: emociones
              reales del top de D.EMOTIONS y el tópico con más volumen. */}
          {(() => {
            const emos = (D.EMOTIONS || []).filter((e) => (e.count || 0) > 0).slice(0, 2);
            const topTopic = (D.TOPICS || [])[0];
            if (emos.length === 0 && !topTopic) return null;
            return (
              <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', marginTop: 'var(--sp-3)', maxWidth: 640, lineHeight: 1.55 }}>
                {topTopic && (
                  <>El mayor volumen del período se concentra en <strong>{topTopic.name}</strong> ({fmt(topTopic.count)} menciones, {topTopic.negativePct}% negativas).{emos.length > 0 ? ' ' : ''}</>
                )}
                {emos.length > 0 && (
                  <>Emociones dominantes: {emos.map((e, i) => (
                    <React.Fragment key={e.emotion}>
                      {i > 0 ? ' y ' : ''}<strong>{e.emotion}</strong>
                    </React.Fragment>
                  ))}.</>
                )}
              </div>
            );
          })()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)' }}>
          <div>
            <Donut data={D.SENTIMENT_BREAKDOWN} size={110} thickness={14} colors={['var(--pos)', 'var(--neu)', 'var(--neg)']} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', fontSize: 'var(--fs-caption)' }}>
            {D.SENTIMENT_BREAKDOWN.map((s) => {
              // El % debe normalizarse sobre la suma del propio breakdown (no
              // sobre m.totalMentions): SENTIMENT_BREAKDOWN y totalMentions son
              // campos independientes y divergen, lo que hacía que pos+neu+neg
              // sumara ≠100% (p. ej. 112%).
              const sbTotal = D.SENTIMENT_BREAKDOWN.reduce((acc, x) => acc + (x.value || 0), 0) || 1;
              const pct = Math.round((s.value / sbTotal) * 100);
              const c = s.name === 'positivo' ? 'var(--pos)' : s.name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
              return (
                <button key={s.name} onClick={() => openSentimentSlice(s.name)}
                  className="row-hover"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', background: 'transparent',
                    border: 'none', padding: '4px 6px', marginInline: -6, borderRadius: 'var(--r-md)',
                    cursor: 'pointer', textAlign: 'left', minWidth: 160,
                  }}>
                  <span className="dot" style={{ background: c }} />
                  <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                  <span className="num" style={{ fontWeight: 600, marginLeft: 'auto' }}>{pct}%</span>
                  <Icons.ArrowRight size={11} color="var(--text-3)" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Charts */}
      {/* alignItems:'start': con el stretch por defecto la tarjeta del chart se
          estiraba hasta el alto de EmotionsCard y quedaban 216px de canvas
          vacío dentro de ella (el 41% de su cuerpo), porque el chart tiene alto
          fijo y su hermana crece con las filas. El alto del chart sube a 340 en
          la línea del StackedAreaChart. */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1.5fr 1fr', '1fr'), gap: 'var(--sp-3)', alignItems: 'start' }}>
        <div className="card">
          <div className="card-hd">
            <div><div className="card-hd-title">Sentimiento en el tiempo</div><div className="card-hd-sub">Volumen apilado · click un día para ver menciones</div></div>
          </div>
          <div className="card-bd">
            <StackedAreaChart data={D.TIMELINE} keys={['positivo', 'neutral', 'negativo']}
              labels={{ positivo: 'Positivo', neutral: 'Neutral', negativo: 'Negativo' }}
              colors={['var(--pos)', 'var(--neu)', 'var(--neg)']} height={260} onPointClick={openTimelineDaySlice} />
            <div style={{ display: 'flex', gap: 'var(--sp-4)', justifyContent: 'center', marginTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span className="dot" style={{ background: 'var(--pos)' }} /> Positivo</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span className="dot" style={{ background: 'var(--text-3)' }} /> Neutral</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span className="dot" style={{ background: 'var(--neg)' }} /> Negativo</span>
            </div>
          </div>
        </div>

        <EmotionsCard emotions={D.EMOTIONS} onEmotionClick={openEmotionSlice} />
      </div>

      <div className="card">
        <div className="card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div>
            <div className="card-hd-title">Sentimiento por {activeGroup.l.toLowerCase()}</div>
            <div className="card-hd-sub">Distribución normalizada · click una barra para ver TODAS sus menciones</div>
          </div>
          {/* Toggle de dimensión: fuente / tópico / subtópico / región.
              Mismo patrón visual que GeographyScreen (Volumen/Sentimiento). */}
          <div style={{ display: 'flex', gap: 'var(--sp-1)', background: 'var(--canvas-2)', borderRadius: 'var(--r-pill)', padding: 'var(--sp-05)', border: '1px solid var(--hairline)' }}>
            {GROUP_BY_OPTIONS.map((o) => (
              <button key={o.k}
                onClick={() => setGroupBy(o.k)}
                style={{
                  padding: '4px 10px', fontSize: 'var(--fs-overline)', fontWeight: 600,
                  borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer',
                  background: groupBy === o.k ? 'var(--canvas)' : 'transparent',
                  color: groupBy === o.k ? 'var(--text)' : 'var(--text-3)',
                  boxShadow: groupBy === o.k ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="card-bd" style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(2, 1fr)', '1fr'), gap: 'var(--sp-5)' }}>
          {groupRows.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)', padding: '20px 0' }}>
              Sin datos para esta dimensión en el periodo.
            </div>
          )}
          {groupRows.map((s, idx) => {
            const total = (s.positivo || 0) + (s.neutral || 0) + (s.negativo || 0);
            const pos = total > 0 ? Math.round((s.positivo/total)*100) : 0;
            const neu = total > 0 ? Math.round((s.neutral/total)*100) : 0;
            const neg = Math.max(0, 100 - pos - neu);
            return (
              // La fila COMPLETA es un solo botón y abre TODAS las menciones del
              // grupo, no el segmento donde cayó el cursor. Antes cada banda era
              // su propio botón con `sentiment` en el filtro, así que el modal
              // mostraba solo negativas/neutras/positivas y su total no cuadraba
              // con la cifra de la fila. Petición explícita del usuario: "se
              // abren todas, para que los conteos coincidan y sea fácil
              // explorarlas". Beneficio lateral de accesibilidad: un objetivo de
              // fila completa en vez de tres bandas que a 5% de ancho medían
              // 17px, por debajo del mínimo de WCAG 2.2 AA.
              <button key={`${groupBy}-${s.label}-${idx}`}
                onClick={() => openGroupSlice(s)}
                className="row-hover"
                aria-label={`${s.label}: ${fmt(total)} menciones, ${pos}% positivo, ${neu}% neutral, ${neg}% negativo. Ver todas las menciones.`}
                title={`${s.label} · ${fmt(total)} menciones (${pos}% pos · ${neu}% neu · ${neg}% neg) — click para ver TODAS`}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '4px 6px', marginInline: -6, borderRadius: 'var(--r-md)',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-caption)', marginBottom: 'var(--sp-1)' }}>
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 60px)', color: 'var(--text)' }}>{s.label}</span>
                  <span className="num" style={{ color: 'var(--text-3)' }}>{fmt(total)}</span>
                </div>
                {/* 24px de alto: mínimo de objetivo de WCAG 2.2 AA. Antes eran 12px. */}
                <div style={{ display: 'flex', height: 24, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--canvas-2)' }}>
                  <div style={{ width: `${pos}%`, background: 'var(--pos)' }} />
                  <div style={{ width: `${neu}%`, background: 'var(--text-3)' }} />
                  <div style={{ width: `${neg}%`, background: 'var(--neg)' }} />
                </div>
                {/* Pie en ORDEN DE LECTURA, no repartido por la fila. Con
                    justifyContent:'space-between' el "40% neu" quedaba en el
                    centro de la FILA, no del segmento neutral, y coincidía sólo
                    porque el reparto de las seis filas era 30/40/30; con un
                    5/10/85 el rótulo del neutral habría caído sobre el segmento
                    negativo. Anclar cada rótulo a su segmento tampoco sirve: a
                    5% de ancho el span mide 17px y el texto 40px, y se solapan.
                    Un pie fijo no puede desalinearse porque no afirma
                    alineación. --fs-caption y no --fs-overline: son cifras de
                    lectura, no un eyebrow en mayúsculas (tokens.css:63). */}
                <div style={{ display: 'flex', gap: 'var(--sp-3)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-1)' }}>
                  <span><span className="num" style={{ color: 'var(--pos)', fontWeight: 600 }}>{pos}%</span> pos</span>
                  <span><span className="num" style={{ fontWeight: 600 }}>{neu}%</span> neu</span>
                  <span><span className="num" style={{ color: 'var(--neg)', fontWeight: 600 }}>{neg}%</span> neg</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

// --- Emotions card — redesigned (v2) ---
//
// Bug previo: el backend mapeaba emociones como "alivio/gratitud/sarcasmo/
// indiferencia" a `color: 'neu'`, pero `--neu` no existe como CSS var, así
// que `background: var(--neu)` resolvía vacío y la barra quedaba invisible.
//
// Fix: mapeo por NOMBRE de emoción (no confía en `e.color` del backend),
// resuelto contra los tokens --emo-* de tokens.css.
function emotionColor(emotion) {
  // Delegado a window.ecoEmotionColor (data.js), que mapea a los tokens
  // --emo-*. Antes esta función tenía 7 hex escritos a mano y un gris de
  // fallback (#7B8794) que no pertenecía a ninguna paleta del sistema.
  return window.ecoEmotionColor(emotion);
}

function EmotionsCard({ emotions, onEmotionClick }) {
  const sorted = [...(emotions || [])].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, e) => s + e.count, 0);
  const top = sorted[0];

  if (!top) {
    return (
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Emociones detectadas</div>
            <div className="card-hd-sub">Perfil del período</div>
          </div>
          <Icons.Heart size={14} color="var(--text-3)" />
        </div>
        <div className="card-bd">
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)', padding: '20px 0' }}>
            Sin emociones clasificadas en el periodo.
          </div>
        </div>
      </div>
    );
  }

  const topColor = emotionColor(top.emotion);

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Emociones detectadas</div>
          <div className="card-hd-sub">Perfil del período · {fmt(total)} menciones clasificadas</div>
        </div>
        <Icons.Heart size={14} color="var(--text-3)" />
      </div>
      <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {/* Emoción dominante (hero) */}
        <button onClick={() => onEmotionClick(top)}
          className="row-hover"
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
            padding: '12px 14px', borderRadius: 'var(--r-lg)',
            // Cromo NEUTRO a propósito. Antes el fondo y el borde se mezclaban
            // con el color de la emoción dominante, así que con "Sorpresa"
            // (--emo-sorpresa era --warn) el card salía ámbar y era
            // indistinguible de una tarjeta de advertencia — el mismo --warn de
            // la banda "ELEVADO" del riesgo de crisis. El dato es un conteo: no
            // tiene severidad que el cromo pueda codificar. El color de la
            // emoción sigue presente donde sí identifica (halo + disco).
            background: 'var(--canvas-2)',
            border: '1px solid var(--hairline)',
            cursor: 'pointer', textAlign: 'left', width: '100%',
          }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: `color-mix(in oklab, ${topColor} 18%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: topColor }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* .section-eyebrow es la receta de eyebrow del producto (42 usos).
                Esta línea tenía la tercera receta inline (11px/700/0.08em) y
                además la pintaba con el color del dato, que convertía un rótulo
                en un indicador de estado. */}
            <div className="section-eyebrow" style={{ marginBottom: 0 }}>Emoción dominante</div>
            <div style={{ fontSize: 'var(--fs-title-lg)', fontWeight: 600, fontFamily: 'var(--ff-display)', color: 'var(--text)', marginTop: 'var(--sp-05)' }}>{top.emotion}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {/* --fs-num-lg, no --fs-display-lg: es un conteo, no un título.
                Además --fs-display-lg es clamp(20px,2vw,24px), así que en móvil
                este número bajaba a 20px mientras las cifras de las filas de
                abajo (--fs-caption, fijo) no se movían y la jerarquía del card
                se aplanaba justo donde hay menos sitio. */}
            <div className="num" style={{ fontSize: 'var(--fs-num-lg)', fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmt(top.count)}</div>
            <div className="num" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginTop: 'var(--sp-1)' }}>{Math.round((top.count / total) * 100)}% del total</div>
          </div>
          <Icons.ArrowRight size={14} color="var(--text-3)" />
        </button>

        {/* Ranking de emociones — todas pintadas por nombre (no por e.color del
            backend que podía ser 'neu' sin var CSS).

            La barra se normaliza al MÁXIMO DE LA SERIE, no al 100%. Con 7
            categorías que suman 100% el techo real ronda el 30%, así que en una
            pista 0–100% el 70% quedaba vacío por construcción: la barra más
            larga medía 47px de 161 y "Esperanza" (20.9%) y "Tristeza" (16.6%)
            se separaban 7px. El gráfico decía "todas las emociones son bajas"
            en vez de compararlas, que es para lo que existe la tarjeta. El
            share absoluto no se pierde: va impreso en cada fila.

            El piso artificial del 2% se va con la normalización: falseaba el
            extremo bajo (3.0% y 0.5% dibujaban barras casi iguales) y ya no
            hace falta porque el mínimo pasa a ser count/maxCount de la serie. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-05)' }}>
          {sorted.map((e, i) => {
            const pct = total > 0 ? (e.count / total) * 100 : 0;
            const maxCount = sorted[0].count || 1;
            const color = emotionColor(e.emotion);
            const widthPct = e.count > 0 ? (e.count / maxCount) * 100 : 0;
            return (
              <button key={e.emotion} onClick={() => onEmotionClick(e)}
                className="row-hover"
                style={{
                  // En móvil las columnas de TEXTO son proporcionales y el cromo
                  // fijo baja de 266px a 114px. Con la rejilla de desktop
                  // (22+120+64+12 fijos + 4 gaps de 12) la barra se quedaba con
                  // ~66px de los 161 de desktop —el 59% menos— mientras la
                  // etiqueta y las cifras no cedían un píxel. La barra es el
                  // único elemento cuantitativo de la fila: debe ser la que más
                  // crece, no la que más se comprime.
                  display: 'grid',
                  gridTemplateColumns: window.ecoCols('22px 120px 1fr 64px 12px', '20px minmax(0, 1.1fr) minmax(0, 2fr) 52px 10px'),
                  // Dos filas explícitas: la 1 es el renglón que el ojo recorre
                  // (rango · emoción · barra · conteo) y la 2 sólo cuelga el
                  // share bajo su propio conteo. Con una sola fila, la celda de
                  // dos líneas era la más alta y centraba a las demás contra
                  // ella: el conteo salía ~8px por encima de la línea base de su
                  // etiqueta y el % ~7px por debajo, y la barra flotaba en el
                  // hueco entre los dos. La etiqueta y su cifra son el par que
                  // se compara en las 7 filas: tienen que compartir línea.
                  gridTemplateRows: 'auto auto',
                  // gap se abre en dos: el de columna es el de antes, el de fila
                  // reproduce el marginTop que llevaba el % dentro del envoltorio.
                  columnGap: window.ecoCols('var(--sp-3)', 'var(--sp-2)'),
                  rowGap: 'var(--sp-05)', alignItems: 'center',
                  padding: '8px 10px', marginInline: -10, borderRadius: 'var(--r-md)',
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontSize: 'var(--fs-caption)',
                }}>
                <span className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 600 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.emotion}</span>
                <div style={{ height: 8, borderRadius: 'var(--r-sm)', background: 'var(--canvas-2)', overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    height: '100%',
                    width: `${widthPct}%`,
                    background: color,
                    borderRadius: 'inherit',
                    transition: 'width 0.3s var(--ease)',
                  }} />
                </div>
                {/* Conteo y share son hijos DIRECTOS de la rejilla, no un span
                    envoltorio: ese envoltorio de dos líneas era la celda que
                    fijaba el alto de la fila y contra la que se centraba todo lo
                    demás. lineHeight:1.1 se va con él — la altura de la línea la
                    fija ahora la fila 1. */}
                <span className="num" style={{ gridColumn: '4', gridRow: '1', textAlign: 'right', color: 'var(--text-2)', fontWeight: 600, fontSize: 'var(--fs-caption)' }}>{fmt(e.count)}</span>
                {/* La flecha va en la fila 1, no centrada en el bloque: es el
                    renglón que se recorre; centrada volvería a flotar entre las
                    dos líneas. */}
                <Icons.ArrowRight size={11} color="var(--text-3)" style={{ gridColumn: '5', gridRow: '1' }} />
                {/* El share cuelga bajo SU columna: sigue impreso en cada fila
                    (la barra se normaliza al máximo de la serie, no al 100%, así
                    que este % es el único sitio donde se lee el share absoluto)
                    pero ya no empuja la línea de la etiqueta. */}
                <span className="num" style={{ gridColumn: '4', gridRow: '2', textAlign: 'right', color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{pct.toFixed(1)}%</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =============== TOPICS ===============
// ============================================================
// TopicsScreen — orden 1 «Del mapa al detalle» (oct-2026).
// ============================================================
//   01 Panorámica (treemap · burbujas · lista) → 02 Ranking del periodo →
//   03 Cuadrante → 04 Tópico del día.
// Reglas comunes a las cuatro piezas:
//   · Un color por tópico en toda la página (ECO_CAT por posición en
//     D.TOPICS, la misma regla que ya usaba el calendario). El sentimiento va
//     SIEMPRE en la barra de mezcla, nunca en el color del tópico.
//   · El cambio se escribe en menciones (2 → 70, ×35), no en % (+3400%).
//   · Pasar el cursor o enfocar un tópico abre su ficha corta (TopicPeek); el
//     clic sigue abriendo el detalle.
// Conteo: el de siempre — cada mención una vez bajo su tópico principal
// (TOPICS.count de /api/eco-data, igual que correo y Overview).

const TOPIC_VIEW_KEY = 'eco.topics.view';

function topicColorFor(slug) {
  const i = (D.TOPICS || []).findIndex((t) => t.slug === slug);
  return window.ecoCat(i < 0 ? 0 : i);
}

// Normaliza un tópico del payload. Los campos nuevos (negative, prevCount,
// prevNegative, topVoice) pueden faltar en un boot viejo cacheado: entonces se
// derivan de los porcentajes y el cambio queda «—» en vez de inventarse.
function topicRow(t) {
  const count = Number(t.count) || 0;
  const negative = t.negative != null ? Number(t.negative) : Math.round(((t.negativePct || 0) / 100) * count);
  const positive = t.positive != null ? Number(t.positive) : Math.round(((t.positivePct || 0) / 100) * count);
  const neutral = t.neutral != null ? Number(t.neutral) : Math.max(0, count - negative - positive);
  const hasPrev = t.prevCount != null;
  const subs = ((D.SUBTOPICS || {})[t.slug] || []).filter((s) => (s.count || 0) > 0);
  return {
    slug: t.slug, name: t.name, short: String(t.name).split(' / ')[0],
    count, negative, neutral, positive,
    negPct: count ? Math.round((negative / count) * 100) : 0,
    prev: hasPrev ? Number(t.prevCount) : null,
    prevNeg: hasPrev ? Number(t.prevNegative || 0) : null,
    presence: count + (Number(t.secondaryCount) || 0),
    subs, voice: t.topVoice || null, description: t.description || null,
    evolution: t.evolution || [], color: topicColorFor(t.slug),
  };
}

// Serie diaria del tópico en la ventana del payload (días sin menciones = 0).
// Ventanas de más de 35 días se agrupan por semana para que la mini-serie se lea.
function topicSeries(row) {
  const P = (window.ECO_DATA || {}).PERIOD || {};
  if (!P.startYmd || !P.endYmd) return row.evolution.map((e) => e.count);
  const by = {};
  row.evolution.forEach((e) => { by[String(e.fullDate).slice(0, 10)] = e.count; });
  const out = [];
  for (let d = P.startYmd; d <= P.endYmd; d = window.ecoAddDaysYmd ? window.ecoAddDaysYmd(d, 1) : new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    out.push(by[d] || 0);
    if (out.length > 400) break;
  }
  if (out.length <= 35) return out;
  const weeks = [];
  for (let i = 0; i < out.length; i += 7) weeks.push(out.slice(i, i + 7).reduce((a, b) => a + b, 0));
  return weeks;
}

function TopicChange({ count, prev }) {
  if (prev == null) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  if (!prev && !count) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  if (!prev) return <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>nuevo</span>;
  const d = count - prev;
  const mult = prev > 0 && count / prev >= 3 ? Math.round(count / prev) : null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', whiteSpace: 'nowrap' }}>
      <span className="num" style={{ fontWeight: 600, color: d > 0 ? 'var(--text)' : 'var(--text-3)' }}>
        {d > 0 ? '▲ +' : d < 0 ? '▼ ' : '· '}{d}
      </span>
      {mult && <span className="pill pill-neg" style={{ fontSize: 'var(--fs-overline)' }}>×{mult}</span>}
    </span>
  );
}

function TopicMix({ row, scale = 1, height = 8 }) {
  const n = row.count || 1;
  return (
    <div title={`positivo ${row.positive} · neutral ${row.neutral} · negativo ${row.negative}`}
      style={{ display: 'flex', height, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--canvas-2)', width: `${Math.max(3, scale * 100)}%` }}>
      <span style={{ width: `${(row.positive / n) * 100}%`, background: 'var(--pos)' }} />
      <span style={{ width: `${(row.neutral / n) * 100}%`, background: 'var(--neu)' }} />
      <span style={{ flex: 1, background: 'var(--neg)' }} />
    </div>
  );
}

function TopicSpark({ values, color, height = 24 }) {
  const vals = values.length > 1 ? values : [0, ...(values.length ? values : [0])];
  const w = 120, max = Math.max(1, ...vals);
  const x = (i) => 2 + (i * (w - 4)) / (vals.length - 1), y = (v) => height - 3 - (v / max) * (height - 6);
  const p = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block' }}>
      <path d={`${p}L${x(vals.length - 1)},${height - 3}L${x(0)},${height - 3}Z`} fill={color} opacity="0.12" />
      <path d={p} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Ficha corta al pasar el cursor o enfocar un tópico. Un solo estado para toda
// la página: { row, x, y } o null.
function TopicPeek({ peek }) {
  if (!peek) return null;
  const { row } = peek;
  const W = 280;
  const left = Math.min(window.innerWidth - W - 12, peek.x + 14);
  const top = Math.max(8, Math.min(window.innerHeight - 220, peek.y + 14));
  const line = (k, v) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
      <span style={{ color: 'var(--text-2)' }}>{k}</span><span className="num" style={{ fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <div role="tooltip" style={{
      position: 'fixed', left, top, width: W, zIndex: 60, pointerEvents: 'none',
      background: 'var(--surface-pop)', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-pop)', padding: 'var(--sp-3)', fontSize: 'var(--fs-body-sm)', lineHeight: 1.45, color: 'var(--text)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-15)' }}>
        <span style={{ width: 10, height: 10, borderRadius: 'var(--r-sm)', background: row.color, flexShrink: 0 }} />
        <b style={{ fontWeight: 600 }}>{row.name}</b>
      </div>
      {line('Menciones', fmt(row.count))}
      {row.prev != null && line('Ventana previa', `${fmt(row.prev)} → ${fmt(row.count)}`)}
      {line('% negativo', row.count ? `${row.negPct}%` : '—')}
      {row.presence > row.count && line('Aparece en', fmt(row.presence))}
      {row.subs[0] && <div style={{ marginTop: 'var(--sp-15)', color: 'var(--text-2)' }}>{row.subs[0].name} ({fmt(row.subs[0].count)})</div>}
      {row.voice && <div style={{ color: 'var(--text-3)' }}>Lo empuja: {row.voice.name}</div>}
      <div style={{ marginTop: 'var(--sp-15)', color: 'var(--text-3)' }}>Clic para abrir el tópico</div>
    </div>
  );
}

// Handlers de vista previa para cualquier elemento que represente un tópico.
function peekHandlers(row, setPeek, onSelect) {
  return {
    onMouseMove: (e) => setPeek({ row, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPeek(null),
    onFocus: (e) => { const r = e.currentTarget.getBoundingClientRect(); setPeek({ row, x: r.right - 12, y: r.top }); },
    onBlur: () => setPeek(null),
    onClick: () => { setPeek(null); onSelect(row.slug); },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPeek(null); onSelect(row.slug); } },
  };
}

// Treemap squarified: el ÁREA es el volumen. (El de antes era una rejilla de
// fichas iguales: 70 y 1 menciones ocupaban lo mismo.)
function squarifyTopics(items, x, y, w, h) {
  const total = items.reduce((a, t) => a + t.v, 0) || 1;
  const scale = (w * h) / total;
  let rest = items.map((t) => ({ ...t, a: t.v * scale }));
  const out = [];
  const worst = (row, side) => {
    const s = row.reduce((a, r) => a + r.a, 0);
    const mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const row = [rest[0]]; let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
    const s = row.reduce((a, r) => a + r.a, 0);
    if (w >= h) {
      const cw = s / h; let cy = y;
      row.forEach((r) => { const ch = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: ch }); cy += ch; });
      x += cw; w -= cw;
    } else {
      const ch = s / w; let cx = x;
      row.forEach((r) => { const cw2 = r.a / ch; out.push({ ...r, x: cx, y, w: cw2, h: ch }); cx += cw2; });
      y += ch; h -= ch;
    }
    rest = rest.slice(i);
  }
  return out;
}

function TopicTreemap({ rows, onSelect, setPeek }) {
  const [ref, w] = useChartWidth(720);
  const H = Math.round(Math.max(240, Math.min(360, w * 0.42)));
  const rects = squarifyTopics(rows.filter((r) => r.count > 0).map((row) => ({ row, v: row.count })), 0, 0, Math.max(1, w), H);
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', height: H }}>
      {rects.map(({ row, x, y, w: rw, h: rh }) => {
        const big = rw > 130 && rh > 80, mid = rw > 70 && rh > 44;
        return (
          <button key={row.slug} {...peekHandlers(row, setPeek, onSelect)}
            aria-label={`${row.name}: ${row.count} menciones, ${row.negPct}% negativo`}
            className="eco-tm-tile"
            style={{
              position: 'absolute', left: x, top: y, width: rw, height: rh,
              background: row.color, color: 'var(--canvas)', border: '2px solid var(--canvas)', borderRadius: 'var(--r-md)',
              padding: mid ? 'var(--sp-2) var(--sp-3)' : 'var(--sp-1)', textAlign: 'left', cursor: 'pointer', overflow: 'hidden',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}>
            <div style={{ minWidth: 0 }}>
              {mid && <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{big ? row.name : row.short}</div>}
              <div className="num" style={{ fontSize: mid ? 'var(--fs-num-md)' : 'var(--fs-body-sm)', fontWeight: 600, marginTop: mid ? 'var(--sp-1)' : 0 }}>{fmt(row.count)}</div>
            </div>
            {big && (
              <div>
                <div className="num" style={{ fontSize: 'var(--fs-caption)', opacity: 0.9 }}>
                  {row.prev != null ? `${fmt(row.prev)} → ${fmt(row.count)} · ` : ''}{row.negPct}% neg.
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 'var(--r-sm)', overflow: 'hidden', marginTop: 'var(--sp-15)', boxShadow: '0 0 0 1.5px var(--canvas)', background: 'color-mix(in oklab, var(--canvas) 35%, transparent)' }}>
                  <span style={{ width: `${(row.positive / row.count) * 100}%`, background: 'var(--pos)' }} />
                  <span style={{ width: `${(row.neutral / row.count) * 100}%`, background: 'color-mix(in oklab, var(--canvas) 75%, transparent)' }} />
                  <span style={{ flex: 1, background: 'var(--neg)' }} />
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Burbujas empaquetadas sin solapes, de mayor a menor desde el centro; el
// anillo exterior es la mezcla de sentimiento. (Las de antes se colocaban con
// posiciones pseudoaleatorias y podían solaparse.)
function TopicBubbles({ rows, onSelect, setPeek }) {
  const [ref, w] = useChartWidth(720);
  const W = Math.max(280, Math.round(w));
  const H = window.ecoIsMobile() ? 420 : 340;
  const data = rows.filter((r) => r.count > 0);
  const placed = React.useMemo(() => {
    const cx = W / 2, cy = H / 2;
    const maxN = Math.max(1, ...data.map((r) => r.count));
    const rmax = Math.min(H * 0.42, W * 0.2);
    const out = [];
    [...data].sort((a, b) => b.count - a.count).forEach((row, i) => {
      const r = Math.max(14, Math.sqrt(row.count / maxN) * rmax);
      if (!i) { out.push({ row, x: cx, y: cy, r }); return; }
      let best = null;
      for (let a = 0; a < 1440 && !best; a += 4) {
        const ang = (a * Math.PI) / 180, dist = (a / 1440) * Math.min(W, H) * 1.2;
        const x = cx + Math.cos(ang) * dist * (W > H ? 1.35 : 1), y = cy + Math.sin(ang) * dist * (W > H ? 0.75 : 1);
        if (x - r < 4 || x + r > W - 4 || y - r < 4 || y + r > H - 4) continue;
        if (out.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + 4)) best = { row, x, y, r };
      }
      out.push(best || { row, x: cx, y: cy, r });
    });
    return out;
  }, [data.map((r) => r.slug + r.count).join('|'), W, H]);
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Burbujas de tópicos por volumen" style={{ display: 'block' }}>
        {placed.map((p) => {
          const C = 2 * Math.PI * (p.r + 3);
          let off = 0;
          const ring = [[p.row.positive, 'var(--pos)'], [p.row.neutral, 'var(--neu)'], [p.row.negative, 'var(--neg)']].map(([v, c], k) => {
            const L = (v / (p.row.count || 1)) * C;
            const el = <circle key={k} cx={p.x} cy={p.y} r={p.r + 3} fill="none" stroke={c} strokeWidth="4" strokeDasharray={`${L} ${C - L}`} strokeDashoffset={-off} transform={`rotate(-90 ${p.x} ${p.y})`} />;
            off += L; return el;
          });
          const label = p.row.short.length * 7 < p.r * 1.8 ? p.row.short : p.row.short.slice(0, Math.max(3, Math.floor(p.r / 3.8))) + '…';
          return (
            <g key={p.row.slug} {...peekHandlers(p.row, setPeek, onSelect)} tabIndex={0} role="button"
              aria-label={`${p.row.name}: ${p.row.count} menciones`} style={{ cursor: 'pointer' }} className="eco-bubble">
              {ring}
              <circle cx={p.x} cy={p.y} r={p.r} fill={p.row.color} />
              {p.r > 30 ? (
                <>
                  <text x={p.x} y={p.y - 2} textAnchor="middle" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, fill: 'var(--canvas)', pointerEvents: 'none' }}>{label}</text>
                  <text x={p.x} y={p.y + 15} textAnchor="middle" className="num" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, fill: 'var(--canvas)', pointerEvents: 'none' }}>{fmt(p.row.count)}</text>
                </>
              ) : (
                <text x={p.x} y={p.y + 4} textAnchor="middle" className="num" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, fill: 'var(--canvas)', pointerEvents: 'none' }}>{fmt(p.row.count)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Tabla ordenable. `full` = el ranking (con anterior, 14 días, voz y
// presencia); sin `full` = la lista compacta de la panorámica.
function TopicTable({ rows, onSelect, setPeek, full = false }) {
  const [sort, setSort] = React.useState({ k: 'count', dir: -1 });
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const cols = full
    ? [['name', 'Tópico', '24%'], ['count', 'Esta', '7%'], ['prev', 'Anterior', '8%'], ['chg', 'Cambio', '11%'], ['negPct', '% neg.', '7%'], ['mix', 'Mezcla', '17%', false], ['spark', 'Tendencia', '12%', false], ['presence', 'Aparece en', '14%']]
    : [['name', 'Tópico', '38%'], ['count', 'Menciones', '13%'], ['chg', 'Cambio', '17%'], ['negPct', '% neg.', '10%'], ['mix', 'Mezcla', '22%', false]];
  const val = (r, k) => (k === 'chg' ? (r.prev == null ? -Infinity : r.count - r.prev) : k === 'prev' ? (r.prev ?? -1) : k === 'negPct' ? (r.count ? r.negative / r.count : -1) : r[k]);
  const sorted = [...rows].sort((a, b) => {
    const A = val(a, sort.k), B = val(b, sort.k);
    if (typeof A === 'string') return A.localeCompare(B, 'es') * sort.dir;
    return (A > B ? 1 : A < B ? -1 : 0) * sort.dir;
  });
  const th = (k, label, sortable = true) => {
    const active = sort.k === k;
    if (!sortable) return label;
    return (
      <button onClick={() => setSort((s) => (s.k === k ? { k, dir: -s.dir } : { k, dir: k === 'name' ? 1 : -1 }))}
        aria-sort={active ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'}
        style={{ all: 'unset', cursor: 'pointer', color: active ? 'var(--text)' : 'inherit', fontWeight: active ? 600 : 500 }}>
        {label}{active ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
      </button>
    );
  };
  const cell = { padding: 'var(--sp-2)', borderTop: '1px solid var(--hairline)', textAlign: 'right', verticalAlign: 'middle' };
  return (
    <div className="scroll-x">
      <table style={{ width: '100%', minWidth: full ? 900 : 560, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 'var(--fs-body-sm)' }}>
        <colgroup>{cols.map(([k, , w]) => <col key={k} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            {cols.map(([k, label, , sortable]) => (
              <th key={k} style={{ padding: 'var(--sp-2)', textAlign: k === 'name' || k === 'mix' || k === 'spark' ? 'left' : 'right', fontWeight: 500, color: 'var(--text-3)', borderBottom: '1px solid var(--hairline-strong)', whiteSpace: 'nowrap' }}>
                {th(k, label, sortable !== false)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.slug} {...peekHandlers(r, setPeek, onSelect)} tabIndex={0} className="row-hover" style={{ cursor: 'pointer' }}>
              {cols.map(([k]) => {
                if (k === 'name') return (
                  <td key={k} style={{ ...cell, textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontWeight: 600, color: 'var(--text)', minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 'var(--r-sm)', background: r.color, flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    </div>
                    {full && (
                      <div style={{ color: 'var(--text-3)', marginTop: 'var(--sp-05)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[r.subs.slice(0, 2).map((s) => s.name).join(' · '), r.voice ? r.voice.name : null].filter(Boolean).join(' · ') || '—'}
                      </div>
                    )}
                  </td>
                );
                if (k === 'count') return <td key={k} className="num" style={{ ...cell, fontWeight: 600, color: 'var(--text)' }}>{fmt(r.count)}</td>;
                if (k === 'prev') return <td key={k} className="num" style={{ ...cell, color: 'var(--text-3)' }}>{r.prev == null ? '—' : fmt(r.prev)}</td>;
                if (k === 'chg') return <td key={k} style={cell}><TopicChange count={r.count} prev={r.prev} /></td>;
                if (k === 'negPct') return <td key={k} className="num" style={{ ...cell, color: r.negPct >= 20 ? 'var(--neg)' : 'var(--text-2)', fontWeight: r.negPct >= 20 ? 600 : 400 }}>{r.count ? `${r.negPct}%` : '—'}</td>;
                if (k === 'mix') return <td key={k} style={{ ...cell, textAlign: 'left' }}><TopicMix row={r} scale={r.count / maxCount} /></td>;
                if (k === 'spark') return <td key={k} style={{ ...cell, textAlign: 'left' }}><TopicSpark values={topicSeries(r)} color={r.color} /></td>;
                if (k === 'presence') return (
                  <td key={k} className="num" style={cell}>
                    {fmt(r.presence)}{r.presence > r.count && <span style={{ color: 'var(--text-3)' }}> (+{fmt(r.presence - r.count)})</span>}
                  </td>
                );
                return <td key={k} style={cell} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopicPanorama({ rows, onSelect, setPeek }) {
  const [view, setViewRaw] = React.useState(() => {
    try { const v = localStorage.getItem(TOPIC_VIEW_KEY); if (v === 'treemap' || v === 'bubbles' || v === 'list') return v; } catch (e) { /* sin storage */ }
    return window.ecoIsMobile() ? 'list' : 'treemap';
  });
  const setView = (v) => { setViewRaw(v); setPeek(null); try { localStorage.setItem(TOPIC_VIEW_KEY, v); } catch (e) { /* sin storage */ } };
  const views = [['treemap', 'Treemap', 'Grid'], ['bubbles', 'Burbujas', 'Circle'], ['list', 'Lista', 'List']];
  return (
    <div className="card">
      <div className="card-hd" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div>
          <div className="card-hd-title">01 · Panorámica del periodo</div>
          <div className="card-hd-sub">Área = volumen · color = tópico · barra = sentimiento · pasa el cursor para ver la ficha, clic para abrirla</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-15)' }} role="group" aria-label="Vista">
          {views.map(([k, l, icon]) => {
            const IC = Icons[icon];
            return (
              <button key={k} onClick={() => setView(k)} aria-pressed={view === k} className={`chip ${view === k ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                {IC && <IC size={11} />} {l}
              </button>
            );
          })}
        </div>
      </div>
      <div className="card-bd">
        {rows.length === 0 ? (
          <EmptyState reason="empty" title="Sin tópicos clasificados" detail="Ninguna mención del período recibió un tópico con confianza suficiente." />
        ) : view === 'treemap' ? <TopicTreemap rows={rows} onSelect={onSelect} setPeek={setPeek} />
          : view === 'bubbles' ? <TopicBubbles rows={rows} onSelect={onSelect} setPeek={setPeek} />
          : <TopicTable rows={rows} onSelect={onSelect} setPeek={setPeek} />}
      </div>
      <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
        <span style={{ fontWeight: 500, letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)' }}>Sentimiento</span>
        {[['var(--neg)', 'Negativo'], ['var(--neu)', 'Neutral'], ['var(--pos)', 'Positivo']].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span style={{ width: 10, height: 6, borderRadius: 'var(--r-pill)', background: c }} /> {l}</span>
        ))}
        <span style={{ marginLeft: 'auto' }}>Cambio en menciones contra la ventana previa · — sin base de comparación</span>
      </div>
    </div>
  );
}

// Tres hallazgos que el ranking demuestra; cada tarjeta solo aparece si el
// dato la sostiene (con poco volumen no hay «más negativo» que valga).
function TopicHallazgos({ rows, onSelect }) {
  const withPrev = rows.filter((r) => r.prev != null);
  const grew = [...withPrev].filter((r) => r.count - r.prev > 0).sort((a, b) => (b.count - b.prev) - (a.count - a.prev))[0];
  const totalNeg = rows.reduce((a, r) => a + r.negative, 0);
  const worst = [...rows].filter((r) => r.count >= 10 && r.negative > 0).sort((a, b) => b.negPct - a.negPct)[0];
  const hidden = [...rows].filter((r) => r.presence - r.count >= 10).sort((a, b) => (b.presence / Math.max(1, b.count)) - (a.presence / Math.max(1, a.count)))[0];
  const cards = [
    grew && { k: 'Lo que más creció', row: grew, big: `${fmt(grew.prev)} → ${fmt(grew.count)}`, extra: grew.prev > 0 && grew.count / grew.prev >= 3 ? <span className="pill pill-neg">×{Math.round(grew.count / grew.prev)}</span> : null, sub: grew.subs[0] ? grew.subs[0].name : null },
    worst && { k: 'El más negativo', row: worst, big: `${worst.negPct}%`, sub: `${fmt(worst.negative)} de ${fmt(worst.count)}${totalNeg ? ` · ${Math.round((worst.negative / totalNeg) * 100)}% de todo lo negativo` : ''}` },
    hidden && { k: 'Presencia oculta', row: hidden, big: `${fmt(hidden.count)} → ${fmt(hidden.presence)}`, sub: `principal en ${fmt(hidden.count)}, aparece en ${fmt(hidden.presence)}` },
  ].filter(Boolean);
  if (!cards.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols(`repeat(${cards.length}, minmax(0,1fr))`, '1fr'), gap: 'var(--sp-3)' }}>
      {cards.map((c) => (
        <button key={c.k} onClick={() => onSelect(c.row.slug)} className="card row-hover"
          style={{ padding: 'var(--sp-4)', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--hairline)', background: 'var(--canvas)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>{c.k}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-title-md)', fontWeight: 600, color: 'var(--text)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 'var(--r-sm)', background: c.row.color, flexShrink: 0 }} />{c.row.name}
          </span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <span className="num" style={{ fontSize: 'var(--fs-num-lg)', fontWeight: 600, color: 'var(--text)' }}>{c.big}</span>
            {c.extra}
          </span>
          {c.sub && <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)' }}>{c.sub}</span>}
        </button>
      ))}
    </div>
  );
}

// Cuadrante volumen × % negativo, con flecha desde la ventana previa y el
// detalle del tópico en un panel lateral.
function TopicQuadrant({ rows, onSelect }) {
  const [ref, w] = useChartWidth(640);
  const pts = rows.filter((r) => r.count >= 3 || (r.prev || 0) >= 3);
  const [sel, setSel] = React.useState(() => {
    const top = [...rows].filter((r) => r.count >= 10).sort((a, b) => b.negPct - a.negPct || b.count - a.count)[0] || rows[0];
    return top ? top.slug : null;
  });
  if (pts.length === 0) return null;
  const W = Math.max(300, w), H = Math.round(Math.max(300, Math.min(420, W * 0.62)));
  const L = 46, R = 16, Tp = 16, B = 40;
  const maxCount = Math.max(...pts.map((r) => Math.max(r.count, r.prev || 0)));
  const xMax = Math.max(10, Math.ceil(maxCount / 10) * 10);
  const negOf = (n, neg) => (n ? (neg / n) * 100 : 0);
  const maxNeg = Math.max(...pts.map((r) => Math.max(negOf(r.count, r.negative), r.prev ? negOf(r.prev, r.prevNeg || 0) : 0)));
  const yMax = Math.min(100, Math.max(40, Math.ceil((maxNeg + 5) / 20) * 20));
  const volThr = Math.max(5, Math.round(xMax * 0.25));
  const negThr = 20;
  const x = (v) => L + (Math.sqrt(Math.max(0, v)) / Math.sqrt(xMax)) * (W - L - R);
  const y = (p) => Tp + (1 - Math.min(p, yMax) / yMax) * (H - Tp - B);
  const r = (n) => 5 + Math.sqrt(n) * 1.6;
  const yTicks = []; for (let t = 0; t <= yMax; t += 20) yTicks.push(t);
  const xTicks = [0, Math.round(xMax * 0.06), volThr, Math.round(xMax * 0.56), xMax].filter((v, i, a) => a.indexOf(v) === i);
  const labelled = (row) => row.count >= volThr * 0.5 || (row.count && row.negPct >= 15);
  const placed = [];
  const labels = [];
  [...pts].sort((a, b) => b.count - a.count).forEach((row) => {
    if (!labelled(row)) return;
    const cx = x(row.count), cy = y(negOf(row.count, row.negative)), rr = r(row.presence);
    const wT = row.short.length * 7.2;
    const right = cx + rr + 4 + wT < W - R;
    const lx = right ? cx + rr + 4 : cx - rr - 4 - wT;
    let ly = cy - rr - 4 < Tp + 12 ? cy + 4 : cy - rr - 4;
    while (placed.some((q) => Math.abs(q.y - ly) < 14 && lx < q.x + q.w && lx + wT > q.x)) ly -= 14;
    placed.push({ x: lx, y: ly, w: wT });
    labels.push(<text key={'l' + row.slug} x={lx} y={ly} style={{ fontSize: 12, fontWeight: 600, fill: 'var(--text)', pointerEvents: 'none' }}>{row.short}</text>);
  });
  const periphery = pts.filter((row) => !labelled(row));
  const s = rows.find((row) => row.slug === sel) || null;
  const maxSub = s ? Math.max(1, ...s.subs.map((z) => z.count)) : 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('minmax(0,1.6fr) minmax(0,1fr)', '1fr'), gap: 'var(--sp-3)', alignItems: 'start' }}>
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">03 · Cuadrante · volumen × tono</div>
            <div className="card-hd-sub">Flecha desde la ventana previa · tamaño = presencia · clic en un tópico para ver su detalle</div>
          </div>
        </div>
        <div className="card-bd" ref={ref}>
          <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cuadrante de tópicos por volumen y porcentaje negativo" style={{ display: 'block' }}>
            <defs><marker id="eco-q-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--text-3)" /></marker></defs>
            <rect x={x(volThr)} y={Tp} width={Math.max(0, W - R - x(volThr))} height={Math.max(0, y(negThr) - Tp)} fill="var(--neg-bg)" opacity="0.7" />
            {yTicks.map((t) => (
              <g key={'y' + t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--hairline)" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="num" style={{ fontSize: 11, fill: 'var(--text-3)' }}>{t}%</text></g>
            ))}
            {xTicks.map((v) => (
              <g key={'x' + v}><line x1={x(v)} x2={x(v)} y1={Tp} y2={H - B} stroke="var(--hairline)" /><text x={x(v)} y={H - B + 16} textAnchor="middle" className="num" style={{ fontSize: 11, fill: 'var(--text-3)' }}>{v}</text></g>
            ))}
            <line x1={x(volThr)} x2={x(volThr)} y1={Tp} y2={H - B} stroke="var(--hairline-strong)" strokeDasharray="4 3" />
            <line x1={L} x2={W - R} y1={y(negThr)} y2={y(negThr)} stroke="var(--hairline-strong)" strokeDasharray="4 3" />
            <text x={W - R - 6} y={Tp + 16} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: 'var(--neg)' }}>Frente crítico</text>
            <text x={L + 6} y={Tp + 16} style={{ fontSize: 12, fontWeight: 600, fill: 'var(--text-2)' }}>Foco por vigilar</text>
            <text x={W - R - 6} y={y(negThr) + 16} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: 'var(--text-2)' }}>Agenda propia</text>
            <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--text-3)' }}>menciones como tópico principal (escala raíz)</text>
            <text transform={`translate(12 ${(Tp + H - B) / 2}) rotate(-90)`} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--text-3)' }}>% negativo</text>
            {pts.map((row) => {
              if (row.prev == null) return null;
              const x0 = x(row.prev), y0 = y(negOf(row.prev, row.prevNeg || 0));
              const x1 = x(row.count), y1 = y(negOf(row.count, row.negative));
              const d = Math.hypot(x1 - x0, y1 - y0), rr = r(row.presence);
              if (d <= rr + 10) return null;
              return (
                <g key={'a' + row.slug}>
                  <line x1={x0} y1={y0} x2={x1 - ((x1 - x0) * rr) / d} y2={y1 - ((y1 - y0) * rr) / d} stroke="var(--text-3)" strokeWidth="1.2" markerEnd="url(#eco-q-arrow)" />
                  <circle cx={x0} cy={y0} r={3} fill="var(--canvas)" stroke="var(--text-3)" />
                </g>
              );
            })}
            {[...pts].sort((a, b) => b.presence - a.presence).map((row) => (
              <g key={row.slug} tabIndex={0} role="button" aria-label={`${row.name}: ${row.count} menciones, ${row.negPct}% negativo`}
                onClick={() => setSel(row.slug)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(row.slug); } }}
                style={{ cursor: 'pointer' }} className="eco-bubble">
                <title>{`${row.name} · ${row.count} · ${row.negPct}% neg.`}</title>
                <circle cx={x(row.count)} cy={y(negOf(row.count, row.negative))} r={r(row.presence)} fill={row.color} fillOpacity="0.9"
                  stroke={sel === row.slug ? 'var(--text)' : 'var(--canvas)'} strokeWidth={sel === row.slug ? 2 : 1.5} />
              </g>
            ))}
            {labels}
          </svg>
          {periphery.length > 0 && (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-2)' }}>
              Sin rótulo, en la periferia: {periphery.map((row) => `${row.short} ${row.count}`).join(' · ')}.
            </div>
          )}
        </div>
      </div>
      <div className="card">
        {s ? (
          <div className="card-bd" style={{ paddingTop: 'var(--sp-4)' }}>
            <div className="t-overline">Tópico</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-title-lg)', fontWeight: 600, margin: 'var(--sp-1) 0 var(--sp-2)', color: 'var(--text)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 'var(--r-sm)', background: s.color, flexShrink: 0 }} />{s.name}
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>
              <span><b className="num" style={{ color: 'var(--text)' }}>{fmt(s.count)}</b> principal</span>
              {s.presence > s.count && <span><b className="num" style={{ color: 'var(--text)' }}>{fmt(s.presence)}</b> aparece</span>}
              <span><b className="num" style={{ color: s.negPct >= 20 ? 'var(--neg)' : 'var(--text)' }}>{s.negPct}%</b> neg.</span>
              <TopicChange count={s.count} prev={s.prev} />
            </div>
            {s.description && (
              <p style={{ fontSize: 'var(--fs-body-sm)', lineHeight: 1.55, color: 'var(--text-2)', margin: 'var(--sp-3) 0' }}
                dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(s.description.length > 320 ? s.description.slice(0, 317) + '…' : s.description) }} />
            )}
            {s.subs.length > 0 && (
              <div style={{ marginTop: 'var(--sp-2)' }}>
                <div className="t-overline" style={{ marginBottom: 'var(--sp-1)' }}>Subtópicos</div>
                {s.subs.slice(0, 4).map((z) => (
                  <div key={z.slug || z.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 36px', gap: 'var(--sp-2)', alignItems: 'center', padding: 'var(--sp-1) 0', fontSize: 'var(--fs-body-sm)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{z.name}</div>
                      <div style={{ height: 6, borderRadius: 'var(--r-sm)', background: s.color, width: `${(z.count / maxSub) * 100}%`, marginTop: 'var(--sp-05)' }} />
                    </div>
                    <span className="num" style={{ textAlign: 'right' }}>{fmt(z.count)}</span>
                  </div>
                ))}
              </div>
            )}
            {s.voice && (
              <div style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>
                <span className="t-overline" style={{ display: 'block', marginBottom: 'var(--sp-05)' }}>Quién lo empuja</span>
                {s.voice.name} ({fmt(s.voice.count)})
              </div>
            )}
            <button onClick={() => onSelect(s.slug)} className="btn btn-primary" style={{ marginTop: 'var(--sp-4)' }}>Abrir el tópico</button>
          </div>
        ) : (
          <EmptyState reason="empty" title="Elige un tópico" detail="Haz clic en un punto del cuadrante para ver su detalle." />
        )}
      </div>
    </div>
  );
}

function TopicsScreen({ onMentionClick }) {
  const topicSlugFromUrl = () => {
    const m = location.pathname.match(/^\/topics\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const [selected, setSelectedRaw] = useState(topicSlugFromUrl); // null = panorámica; slug = detalle
  const [dayModal, setDayModal] = useState(null);
  const [peek, setPeek] = useState(null);

  const openTopic = React.useCallback((slug) => {
    if (!slug) return;
    setPeek(null);
    history.pushState({ eco: 'topics', topic: slug, fromList: true }, '', '/topics/' + encodeURIComponent(slug));
    setSelectedRaw(slug);
  }, []);
  const closeTopic = React.useCallback(() => {
    if (history.state && history.state.fromList) history.back();
    else { history.replaceState({ eco: 'topics' }, '', '/topics'); setSelectedRaw(null); }
  }, []);
  React.useEffect(() => {
    const sync = () => setSelectedRaw(topicSlugFromUrl());
    window.addEventListener('popstate', sync);
    window.addEventListener('eco:locationchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('eco:locationchange', sync);
    };
  }, []);

  const sel = selected ? D.TOPICS.find((t) => t.slug === selected) : null;
  const subs = sel ? (D.SUBTOPICS[sel.slug] || []) : [];

  React.useEffect(() => {
    if (selected && !sel) {
      history.replaceState({ eco: 'topics' }, '', '/topics');
      setSelectedRaw(null);
    }
  }, [selected, sel]);

  const rows = React.useMemo(() => (D.TOPICS || []).map(topicRow), [D.TOPICS]);

  const calendarData = React.useMemo(() => (D.TOPIC_CALENDAR || []).map((d) => ({
    date: d.date, fullDate: d.fullDate, volume: d.volume, topicSlug: d.topicSlug, topicName: d.topicName, sentiment: d.sentiment,
  })), []);

  if (sel) return <TopicDetail topic={sel} subs={subs} onBack={closeTopic} onMentionClick={onMentionClick} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)' }}>
      <TopicPanorama rows={rows} onSelect={openTopic} setPeek={setPeek} />

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div className="section-eyebrow" style={{ marginBottom: 0 }}>02 · Ranking del periodo · contra la ventana previa</div>
          <TopicHallazgos rows={rows} onSelect={openTopic} />
          <div className="card">
            <div className="card-bd"><TopicTable rows={rows} onSelect={openTopic} setPeek={setPeek} full /></div>
            <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
              «Aparece en» cuenta todas las menciones que tocan el tópico, sea principal o secundario; por eso la suma pasa del total del periodo.
            </div>
          </div>
        </div>
      )}

      {rows.length > 0 && <TopicQuadrant rows={rows} onSelect={openTopic} />}

      {/* 04 · El calendario del tópico del día, al final (pedido explícito). */}
      <TopicCalendar data={calendarData} onSelect={openTopic} onDayClick={setDayModal} />

      {dayModal && (() => {
        const accent = topicColorFor(dayModal.topicSlug) || 'var(--accent)';
        const dateStr = dayModal.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const dayIso = dayModal.dt.toISOString().slice(0, 10);
        return (
          <MentionsSliceModal
            slice={{
              eyebrow: dateStr,
              title: dayModal.topicName,
              accent,
              mentions: [],
              _filter: { topic: dayModal.topicSlug, day: dayIso, topicMode: 'all' },
              ctaLabel: `Ver tópico · ${dayModal.topicName}`,
              ctaIcon: 'Hash',
              onCta: () => { setDayModal(null); openTopic(dayModal.topicSlug); },
            }}
            onClose={() => setDayModal(null)}
            onMentionClick={onMentionClick}
          />
        );
      })()}

      <div style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
        <Icons.Info size={12} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
        <span>
          Cada mención cuenta una vez bajo su tópico de mayor confianza (mismo criterio del correo y del Overview). «Aparece en» suma
          las menciones donde el tópico es tema secundario. Al abrir un tópico verás las primarias por defecto, con un toggle para
          incluir las secundarias.
        </span>
      </div>

      <TopicPeek peek={peek} />
    </div>
  );
}

function TopicDetail({ topic, subs, onBack, onMentionClick }) {
  // pill-neu (no pill-warn): el ámbar del producto significa riesgo.
  const sentPill = topic.dominantSentiment === 'positivo' ? 'pill-pos' : topic.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
  const subMax = Math.max(1, ...subs.map(s => s.count));
  // Suma de los subtópicos — con el conteo consistente (una mención, un
  // subtópico) esto siempre es ≤ topic.count; la diferencia son las menciones
  // primarias sin subtópico asignado.
  const subsTotal = subs.reduce((acc, s) => acc + (s.count || 0), 0);

  // Modal de menciones de un subtópico. Misma ventana y universo que la fila
  // (ecoDataWindow + topicMode primary), así el total del modal cuadra con el
  // número que se muestra en la tabla.
  const [subSlice, setSubSlice] = React.useState(null);
  function openSubSlice(s) {
    const pos = s.positive || 0, neu = s.neutral || 0, neg = s.negative || 0;
    const bias = neg > pos ? 'negativo' : pos > neg ? 'positivo' : 'neutral';
    setSubSlice({
      eyebrow: `Subtópico · ${topic.name}`,
      title: s.name,
      accent: bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)',
      volume: s.count || 0,
      sentiment: { pos, neu, neg },
      mentions: [],
      _filter: { ...ecoDataWindow(), topic: topic.slug, subtopic: s.name, topicMode: 'primary' },
    });
  }

  // --- (5) Descripción IA cacheada por periodo ----------------------
  // En vez de leer `topic.description` (que era un único string por tópico,
  // sobrescrito en cada corrida del cron y sin tracking de fechas), pedimos al
  // endpoint /api/eco-topic-description la descripción correspondiente al
  // periodo activo. Si está en caché → ready inmediato. Si no, el endpoint
  // invoca Bedrock síncronamente (~3-10s) y persiste; al volver, ya queda
  // guardada para futuras peticiones.
  const [desc, setDesc] = React.useState({ status: 'loading', text: null, generatedAt: null });
  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    const agency = localStorage.getItem('eco.agency');
    const period = localStorage.getItem('eco.period') || window.ECO_DEFAULT_PERIOD || '7D';
    const customFrom = localStorage.getItem('eco.from');
    const customTo = localStorage.getItem('eco.to');
    if (agency) params.set('agency', agency);
    if (period === 'custom' && customFrom && customTo) {
      params.set('from', customFrom);
      params.set('to', customTo);
    } else {
      params.set('period', period);
    }
    params.set('topic', topic.slug);
    setDesc({ status: 'loading', text: null, generatedAt: null });
    fetch('/api/eco-topic-description?' + params.toString(), { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.status === 'ready') setDesc({ status: 'ready', text: d.description, generatedAt: d.generatedAt });
        else if (d.status === 'empty') setDesc({ status: 'empty', text: null, generatedAt: null });
        else setDesc({ status: 'error', text: null, generatedAt: null });
      })
      .catch(() => { if (!cancelled) setDesc({ status: 'error', text: null, generatedAt: null }); });
    return () => { cancelled = true; };
  }, [topic.slug]);

  // --- (3) Tabla de menciones del tópico ----------------------------
  const [mentionsState, setMentionsState] = React.useState({ loading: true, mentions: [], total: 0 });
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  React.useEffect(() => {
    let cancelled = false;
    setMentionsState((s) => ({ ...s, loading: true }));
    // topicMode primary: la MISMA base del hero de esta pantalla
    // (TOPICS.count: primario, ventana cerrada, universo pertinente). Antes
    // la tabla contaba multi-clasificación sobre otra ventana y su total
    // contradecía el hero (auditoría 2026-08, P0-5).
    fetchSliceMentions({ ...ecoDataWindow(), topic: topic.slug, topicMode: 'primary', limit: pageSize, offset: (page - 1) * pageSize })
      .then((r) => {
        if (cancelled) return;
        setMentionsState({ loading: false, mentions: r.mentions || [], total: r.total || 0 });
      })
      .catch(() => { if (!cancelled) setMentionsState({ loading: false, mentions: [], total: 0 }); });
    return () => { cancelled = true; };
  }, [topic.slug, page]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Breadcrumb + back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <button className="btn" onClick={onBack}>
          <Icons.ArrowLeft size={13} /> Volver a todos los tópicos
        </button>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          Tópicos / <span style={{ color: 'var(--text)', fontWeight: 600 }}>{topic.name}</span>
        </div>
      </div>

      {/* Hero stats */}
      <div className="card" style={{ padding: 'var(--pad-card)', display: 'grid', gridTemplateColumns: window.ecoCols('2fr 1fr 1fr 1fr', 'repeat(2, 1fr)'), gap: 'var(--sp-5)', alignItems: 'center' }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Tópico</div>
          <div style={{ fontSize: 'var(--fs-num-lg)', fontWeight: 700, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', color: 'var(--text)' }}>{topic.name}</div>
          <div style={{ marginTop: 'var(--sp-2)', display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span className={`pill ${sentPill}`}>{window.ecoSentimentLabel(topic.dominantSentiment)}</span>
            {/* Mismo contrato que la panorámica: el volumen del tópico no es
                bueno ni malo por subir. Este sitio seguía pintando toda subida
                en rojo. */}
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600,
              color: window.ecoDeltaColor('volume', topic.delta) }}>
              {topic.delta == null
                ? 'Sin base de comparación'
                : `${window.ecoDeltaArrow(topic.delta)} ${Math.abs(topic.delta)}% vs. período anterior`}
            </span>
          </div>
        </div>
        <StatBox label="Menciones" value={fmt(topic.count)} />
        <StatBox label="Positivas" value={`${topic.positivePct}%`} tone="pos" />
        <StatBox label="Negativas" value={`${topic.negativePct}%`} tone="neg" />
      </div>

      {/* Descripción IA: cargada del endpoint cacheado por (topic_id,
          period_start, period_end). loading → muestra placeholder; ready →
          texto; empty → mensaje neutral; error → bloque oculto. */}
      <div className="card" style={{ padding: 'var(--pad-card)' }}>
        <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          <Icons.Sparkles size={11} color="var(--accent)" /> Descripción IA · período seleccionado
        </div>
        {desc.status === 'loading' && (
          <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', animation: 'pulse 1.4s ease-in-out infinite' }}>
            Generando descripción para este periodo…
          </div>
        )}
        {desc.status === 'ready' && (
          <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.55, color: 'var(--text)' }}>{desc.text}</div>
        )}
        {desc.status === 'empty' && (
          <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)' }}>
            No hay menciones de este tópico en el periodo seleccionado, así que no se puede describir.
          </div>
        )}
        {desc.status === 'error' && (
          <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)' }}>
            No fue posible generar la descripción. Intenta más tarde.
          </div>
        )}
      </div>

      {/* Subtopics — ahora con descripción del cluster (qué cubre el subtopic)
          y pill de sentimiento dominante, para que el usuario entienda de qué
          va cada subtopic sin tener que abrir las menciones.
          Cada fila es clickeable y abre el modal de menciones (el usuario ya
          espera ese comportamiento del resto del producto). */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Subtópicos detectados</div>
            <div className="card-hd-sub">
              {subs.length} subtópicos · {fmt(subsTotal)} de {fmt(topic.count)} menciones del tópico · click una fila para ver sus menciones
            </div>
          </div>
        </div>
        <div className="scroll-x">
          {subs.length === 0 && <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Sin subtópicos detectados en este periodo</div>}
          {subs.map((s, i) => {
            const subSentPill = s.dominantSentiment === 'positivo' ? 'pill-pos' : s.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
            return (
              // Fila clickeable: abre el modal de menciones del subtópico. Es el
              // comportamiento que el usuario ya espera del resto del producto y
              // que aquí faltaba.
              <button key={s.slug || s.name} className="row-hover"
                onClick={() => openSubSlice(s)}
                aria-label={`${s.name}: ${fmt(s.count)} menciones. Ver menciones.`}
                title={`${s.name} · ${fmt(s.count)} menciones — click para verlas`}
                style={{
                  display: 'grid', gridTemplateColumns: '28px 2fr 110px 110px 1.4fr 24px', minWidth: 640, gap: 'var(--sp-3)', alignItems: 'center',
                  padding: '14px 18px', fontSize: 'var(--fs-body-sm)',
                  width: '100%', textAlign: 'left', background: 'transparent',
                  border: 'none', borderTop: '1px solid var(--hairline)',
                  cursor: 'pointer',
                }}>
                <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)' }} className="mono">{String(i+1).padStart(2,'0')}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                  {s.description && (
                    <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginTop: 'var(--sp-1)', lineHeight: 1.4 }}>{s.description}</div>
                  )}
                </div>
                <div className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{fmt(s.count)}</div>
                <span className={`pill ${subSentPill}`} style={{ justifySelf: 'start' }}>{window.ecoSentimentLabel(s.dominantSentiment || 'mixed')}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                  <div style={{ display: 'flex', height: 6, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--neu-bg)' }}>
                    <div style={{ flexGrow: Math.max(0, s.positivePct || 0), background: 'var(--pos)' }} />
                    <div style={{ flexGrow: Math.max(0, s.neutralPct  || 0), background: 'var(--neu)' }} />
                    <div style={{ flexGrow: Math.max(0, s.negativePct || 0), background: 'var(--neg)' }} />
                  </div>
                  {/* Ahora también el % NEUTRAL: antes solo se mostraban pos y
                      neg, y el resto quedaba sin explicar. Pie en orden de
                      lectura (mismo criterio que "Sentimiento por X"), no
                      repartido por la fila. */}
                  <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', display: 'flex', gap: 'var(--sp-2)' }}>
                    <span><span className="num" style={{ color: 'var(--pos)', fontWeight: 600 }}>{s.positivePct || 0}%</span> pos</span>
                    <span><span className="num" style={{ fontWeight: 600 }}>{s.neutralPct || 0}%</span> neu</span>
                    <span><span className="num" style={{ color: 'var(--neg)', fontWeight: 600 }}>{s.negativePct || 0}%</span> neg</span>
                  </div>
                </div>
                <Icons.ChevronRight size={14} color="var(--text-3)" />
              </button>
            );
          })}
        </div>
        {subs.length > 0 && subsTotal < topic.count && (
          <div style={{ padding: '10px 18px', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <Icons.Info size={12} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Cada mención cuenta una vez, bajo un solo subtópico — el mismo
              criterio de mayor confianza que usa el conteo del tópico. Las{' '}
              {fmt(topic.count - subsTotal)} restantes no tienen subtópico asignado.
            </span>
          </div>
        )}
      </div>
      {subSlice && <MentionsSliceModal slice={subSlice} onClose={() => setSubSlice(null)} onMentionClick={onMentionClick} />}

      {/* Evolution — datos reales por tópico (mention_topics × día AST). */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Evolución del tópico</div><div className="card-hd-sub">Menciones reales (zona AST)</div></div></div>
        <div className="card-bd">
          {(topic.evolution && topic.evolution.length > 0) ? (
            <AreaLineChart data={topic.evolution} accessor={(d) => d.count} height={200} color="var(--accent)" />
          ) : (
            <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
              Sin menciones registradas para este tópico en este periodo.
            </div>
          )}
        </div>
      </div>

      {/* (3) Menciones del tópico — tabla paginada del periodo activo. */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Menciones del tópico</div>
            <div className="card-hd-sub">
              {mentionsState.loading
                ? 'Cargando…'
                : `${fmt(mentionsState.total)} menciones · página ${page} de ${Math.max(1, Math.ceil(mentionsState.total / pageSize))}`}
            </div>
          </div>
        </div>
        <div>
          {mentionsState.loading && (
            <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Cargando menciones…</div>
          )}
          {!mentionsState.loading && mentionsState.mentions.length === 0 && (
            <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
              Sin menciones para este tópico en el periodo seleccionado.
            </div>
          )}
          {!mentionsState.loading && mentionsState.mentions.length > 0 && (
            <MentionsTable mentions={mentionsState.mentions} onMentionClick={onMentionClick} />
          )}
        </div>
        {!mentionsState.loading && mentionsState.total > pageSize && (
          <div style={{ padding: 'var(--sp-3)', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' }}>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(mentionsState.total / pageSize))}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)' }}>{label}</div>
      <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: tone ? `var(--${tone})` : 'var(--text)', marginTop: 'var(--sp-1)', fontFamily: 'var(--ff-display)' }}>{value}</div>
    </div>
  );
}

// --- Calendar of "main topic of the day" ---
function TopicCalendar({ data, onSelect, onDayClick }) {
  // Color per topic slug — consistent hues
  const palette = window.ECO_CAT;
  const slugIdx = {};
  D.TOPICS.forEach((t, i) => { slugIdx[t.slug] = i; });
  const colorFor = (slug) => palette[slugIdx[slug] % palette.length];
  // Semáforo de sentimiento: el color del día = su sentimiento dominante
  // (verde positivo / rojo negativo / gris neutral). La opacidad = volumen.
  // Antes: { positivo:'#2E8B6A', negativo:'#C2412F', neutral:'#7C8698' } — el
  // verde y el rojo del tema `costa` dentro de `mando`, lo que producía 40 de
  // los 44 fallos de contraste que quedaban (texto de --mando sobre celdas de
  // --costa, 1.82:1 en el peor caso).
  const SENT_HEX = {
    positivo: window.ecoSentimentColor('positivo'),
    negativo: window.ecoSentimentColor('negativo'),
    neutral: window.ecoSentimentColor('neutral'),
  };
  const sentColor = (s) => SENT_HEX[s] || SENT_HEX.neutral;
  // Un día sin dominancia llega del endpoint como 'neutral', que es EL MISMO
  // estado que el treemap llama 'mixed': ningún lado domina. Se muestra con la
  // misma palabra para no sostener dos vocabularios a 200px de distancia. (Un
  // sentimiento 'neutral' de MENCIÓN es otra cosa —veredicto del clasificador— y
  // conserva su palabra en las otras pantallas.)
  const sentLabel = (s) => window.ecoSentimentLabel(s === 'neutral' ? 'mixed' : s);

  if (!data || data.length === 0) {
    return (
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">04 · Calendario de tópicos</div><div className="card-hd-sub">Tópico principal y volumen del día · período seleccionado</div></div></div>
        <div className="card-bd" style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
          Sin actividad de tópicos en este periodo.
        </div>
      </div>
    );
  }

  // Build a 7-col week grid starting on the first day's weekday (Monday-first)
  const parsed = data.map(d => {
    const dt = new Date(d.fullDate);
    return { ...d, dt };
  });
  const first = parsed[0].dt;
  const last = parsed[parsed.length - 1].dt;
  const firstDow = (first.getDay() + 6) % 7; // Monday-first: 0..6
  const cells = Array(firstDow).fill(null).concat(parsed);

  // Agrupar en filas de 7 días (semanas). En cada salto de fila, si el día
  // que comienza la fila (o cualquier día en ella) pertenece a un mes distinto
  // del último mes etiquetado, insertamos un header con el nuevo mes — así el
  // calendario sigue legible cuando el periodo cubre varios meses.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  // Volume scale. UN solo sitio calcula el tinte —celdas y leyenda— para que la
  // leyenda no pueda volver a prometer una rampa que las celdas no alcanzan.
  // El piso baja de 0.3 a 0.12: con 0.3 la rampa efectiva iba de 19% a 50% de
  // mezcla (2.6x) para un rango de dato de 8x (6 a 48 menciones/día), así que
  // días de 15 y de 25 menciones eran indistinguibles y sólo destacaban los
  // picos. El tope se queda en 50% porque por encima --text deja de pasar AA.
  const maxV = Math.max(...parsed.map(d => d.volume));
  const tintPct = (v) => Math.round(Math.min(0.12 + (v / maxV) * 0.88, 1) * 50);
  // Tres muestras REALES del período (mín · mediana · máx) para la leyenda.
  const volsSorted = parsed.map(d => d.volume).sort((a, b) => a - b);
  const volRamp = [volsSorted[0], volsSorted[Math.floor(volsSorted.length / 2)], volsSorted[volsSorted.length - 1]];

  // Legend = unique topics present in calendar
  const uniqueTopics = [...new Set(parsed.map(d => d.topicSlug))].map(s => D.TOPICS.find(t => t.slug === s)).filter(Boolean);

  const sameMonth = first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth();
  const headerLabel = sameMonth
    ? first.toLocaleDateString('es', { month: 'long', year: 'numeric' })
    : `${first.toLocaleDateString('es', { month: 'short', year: 'numeric' })} – ${last.toLocaleDateString('es', { month: 'short', year: 'numeric' })}`;

  let lastMonthLabel = null;
  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">04 · Calendario de tópicos</div>
          <div className="card-hd-sub">Tópico principal y volumen del día · período seleccionado</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <Icons.CalendarDays size={14} color="var(--text-3)" />
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', textTransform: 'capitalize' }}>{headerLabel}</span>
        </div>
      </div>
      <div className="card-bd" style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 200px', '1fr'), gap: 'var(--sp-5)' }}>
        {/* Grid */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}>
            {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
              // El rótulo se alinea con el NÚMERO de día de su columna, que va a
              // la izquierda dentro de una celda con 1px de borde y padding
              // var(--sp-15). Centrado, con celdas de ~130px, "MAR" quedaba a
              // ~88px de su propio "30" y se leía sobre el hueco entre celdas.
              <div key={d} style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', textAlign: 'left', paddingLeft: 'calc(var(--sp-15) + 1px)', paddingBottom: 'var(--sp-1)' }}>{d}</div>
            ))}
          </div>
          {weeks.map((week, wIdx) => {
            // Etiqueta de mes para esta fila: si alguno de los días pertenece
            // a un mes nuevo que aún no etiquetamos, lo mostramos arriba de
            // la fila. Esto marca claramente el cambio mes-a-mes en periodos
            // largos como 1A/Max.
            const firstReal = week.find(d => d);
            const monthKey = firstReal ? `${firstReal.dt.getFullYear()}-${firstReal.dt.getMonth()}` : null;
            const showHeader = monthKey && monthKey !== lastMonthLabel;
            if (showHeader) lastMonthLabel = monthKey;
            const monthName = firstReal ? firstReal.dt.toLocaleDateString('es', { month: 'long', year: 'numeric' }) : '';

            return (
              <React.Fragment key={`w${wIdx}`}>
                {showHeader && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
                    marginTop: wIdx === 0 ? 0 : 'var(--sp-3)', marginBottom: 'var(--sp-1)',
                    fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-2)',
                    textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)',
                  }}>
                    <span style={{ flex: '0 0 auto' }}>{monthName}</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'var(--sp-1)', marginBottom: 'var(--sp-1)' }}>
                  {week.map((c, i) => {
                    if (!c) return <div key={`e${wIdx}-${i}`} />;
                    const color = sentColor(c.sentiment);
                    const dayNum = c.dt.getDate();
                    const isFirstOfMonth = dayNum === 1;
                    // El nombre se corta MÁS en móvil: la celda mide ~41px de
                    // ancho (~29 útiles), así que 14 caracteres se parten en 4
                    // líneas y empujan el volumen fuera de la celda. Con 8 el
                    // corte queda marcado con puntos suspensivos y el nombre
                    // completo sigue en el tooltip y en el modal del día.
                    // (nameLimit/nameShort eliminados: la celda ya no recorta el
                    // nombre del tópico — crece a su contenido y el texto envuelve.)
                    return (
                      // Celda rediseñada (ago 2026), 3 correcciones del usuario:
                      //  1. el nombre del tópico ya NO se corta con "…" — la
                      //     celda es más alta y el texto envuelve completo.
                      //  2. fuera el número de volumen del pie ("un numerito
                      //     abajo que no se entiende y no debería estar"). El
                      //     volumen sigue en el tooltip y en el modal.
                      //  3. el número del día pasa de 10px a 15px, para que se
                      //     entienda de qué día se habla.
                      <button key={c.date} onClick={() => onDayClick(c)}
                        title={`${c.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })} · ${c.topicName} · ${sentLabel(c.sentiment)} · ${fmt(c.volume)} menciones`}
                        style={{
                          position: 'relative',
                          // Sin aspect-ratio: la celda crece a su contenido. El
                          // nombre del tópico ya no se recorta (ver abajo), así
                          // que forzar un cuadrado volvería a cortar texto. El
                          // minHeight sube a 88 para que quepan el número de día
                          // grande y un nombre de 2-3 líneas sin recorte.
                          aspectRatio: 'auto',
                          minHeight: 88,
                          padding: 'var(--sp-15)',
                          borderRadius: 'var(--r-md)',
                          // Tinte por intensidad con color-mix, no concatenando una
                          // opacidad hex al color: con tokens (`var(--pos)e6`) eso era CSS
                          // inválido y la celda quedaba transparente.
                          // Tope 50%: por encima de eso `--text` deja de pasar AA sobre el
                          // verde (3.71:1 al 60%).
                          background: `color-mix(in oklab, ${color} ${tintPct(c.volume)}%, var(--canvas))`,
                          // Borde más marcado en el primer día del mes para
                          // reforzar el cambio cuando ocurre mid-week.
                          border: isFirstOfMonth ? '1.5px solid var(--text-2)' : '1px solid var(--hairline)',
                          display: 'grid', gridTemplateRows: 'auto 1fr', gap: 'var(--sp-05)',
                          textAlign: 'left', cursor: 'pointer',
                          overflow: 'hidden', minWidth: 0,
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          {/* Número del día en --fs-num-sm (14px) y no
                              --fs-overline (11px): era lo primero que hay que
                              poder leer en una celda de calendario y se perdía
                              contra el nombre del tópico, del mismo tamaño.
                              Petición del usuario: "el número del día debería
                              ser más grande para que se entienda mejor de qué
                              día estamos hablando". */}
                          <span className="mono" style={{ fontSize: 'var(--fs-num-sm)', fontWeight: 700, lineHeight: 1, color: 'var(--text)' }}>{dayNum}</span>
                          {/* Cierra la correspondencia con la leyenda "Tópicos
                              del período": el hue por tópico ya existía en el
                              producto (el modal del día lo usa desde ECO_CAT),
                              pero no aparecía en ninguna celda. */}
                          <span title={c.topicName} style={{ width: 6, height: 6, borderRadius: '50%', background: colorFor(c.topicSlug), flex: '0 0 auto', marginTop: 'var(--sp-05)' }} />
                        </div>
                        {/* Nombre COMPLETO, sin recorte con "…": la celda crece a
                            su contenido (aspectRatio auto) y el texto envuelve.
                            Antes se cortaba a nameLimit caracteres y "Desarrollo
                            económico" y "Desarrollo social" quedaban idénticos.
                            `overflowWrap: anywhere` evita que un término largo
                            desborde la columna. */}
                        <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text)', lineHeight: 1.15, textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', overflowWrap: 'anywhere', hyphens: 'auto', minWidth: 0 }}>
                          {c.topicName}
                        </div>
                        {/* El volumen del día ya NO se imprime en la celda: era un
                            número suelto sin rótulo que no se entendía (reporte
                            del usuario). Sigue en el tooltip, en la leyenda de
                            intensidad y en el modal del día. */}
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Legend */}
        {/* En móvil la rejilla colapsa a UNA columna y la leyenda se apila
            DEBAJO del calendario: el filete izquierdo ya no separa dos columnas
            —cuelga— y su sangría desalinea toda la leyenda respecto del borde
            de las celdas que tiene encima. Apilada, el separador que
            corresponde es el de arriba (mismo patrón que el BandScale de la
            tarjeta de crisis). */}
        <div style={window.ecoIsMobile()
          ? { borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }
          : { borderLeft: '1px solid var(--hairline)', paddingLeft: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div>
            <div className="section-eyebrow" style={{ margin: '0 0 var(--sp-2)' }}>Sentimiento del día</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>
              {['positivo', 'negativo', 'neutral'].map((k) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  {/* La muestra usa el tinte de un día de volumen MEDIANO, no
                      el 50% del día de MÁS volumen: al tope de la rampa, las
                      celdas normales parecían sin clasificar al lado de la
                      leyenda. */}
                  {/* 10×10 --r-sm es el chip que ya usan las otras rampas del
                      producto (leyenda del heatmap horario y del mapa). Las tres
                      muestras de esta columna que retratan una CELDA —tinte de
                      sentimiento, rampa de volumen, borde del día 1— medían 12,
                      8 y 8: tres tallas para el mismo tipo de muestra. */}
                  <span style={{ width: 10, height: 10, borderRadius: 'var(--r-sm)', background: `color-mix(in oklab, ${SENT_HEX[k]} ${tintPct(volRamp[1])}%, var(--canvas))`, border: `1px solid ${SENT_HEX[k]}` }} />
                  <span>{sentLabel(k)}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-3)' }}>
            <div className="section-eyebrow" style={{ margin: '0 0 var(--sp-2)' }}>Tópicos del período</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', maxHeight: 168, overflowY: 'auto' }}>
              {uniqueTopics.map(t => (
                <button key={t.slug} onClick={() => onSelect(t.slug)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-1) var(--sp-15)', borderRadius: 'var(--r-md)', textAlign: 'left', cursor: 'pointer' }} className="row-hover">
                  {/* El punto lleva el HUE del tópico (ECO_CAT, vía colorFor):
                      antes las seis entradas iban en el mismo gris justo debajo
                      de una leyenda que SÍ codifica color, así que se leía como
                      clave de color y no correspondía a nada de la rejilla. */}
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: colorFor(t.slug), flex: '0 0 auto' }} />
                  <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text)', flex: 1 }}>{t.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
              {/* La rampa se dibuja con la MISMA función que las celdas y con
                  los volúmenes reales del período. Antes eran tres cuadros al
                  30/60/100% de --text-3: una rampa que duplicaba el máximo real
                  (50%) y en un gris que no era el de ninguna celda, así que la
                  leyenda prometía intensidades inalcanzables. Los números la
                  hacen verificable. */}
              <span style={{ display: 'flex', gap: 'var(--sp-05)', alignItems: 'center' }}>
                {volRamp.map((v, i) => (
                  <span key={i} title={`${fmt(v)} menciones`} style={{ width: 10, height: 10, borderRadius: 'var(--r-sm)', background: `color-mix(in oklab, var(--neu) ${tintPct(v)}%, var(--canvas))`, border: '1px solid var(--hairline)' }} />
                ))}
              </span>
              Volumen del día · {fmt(volRamp[0])} → {fmt(volRamp[2])} menciones
            </div>
            {/* Fila de CLAVE, no de escala: misma muestra de 10 y mismo gap
                --sp-2 que "Sentimiento del día" y "Tópicos del período", así las
                tres etiquetas arrancan en la misma x (18px) dentro de la columna
                de 200. La muestra va sin relleno a propósito: lo que marca el
                día 1 en la rejilla es el BORDE, no el tinte. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <span style={{ width: 10, height: 10, border: '1.5px solid var(--text-2)', borderRadius: 'var(--r-sm)' }} />
              Primer día del mes
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Slice builder: generate a plausible mentions slice from aggregate info ---
// Local filter over the cached MENTIONS list. Used only as the initial
// optimistic slice while the async fetch from /api/eco-mentions is in flight.
// No "extras" padding — irrelevant mentions must never appear.
function buildSliceMentions(predicate, max = 8) {
  return (D.MENTIONS || []).filter(predicate).slice(0, max);
}

// Fetch a real slice of mentions from the backend using the structured filter.
// The slice object must carry a `_filter` hash of query params.
function fetchSliceMentions(filter) {
  const params = new URLSearchParams();
  const agency = localStorage.getItem('eco.agency');
  if (agency) params.set('agency', agency);
  // Ventana cerrada explícita (la misma de los agregados) en vez del `period`
  // rolling implícito del endpoint. Antes, con rango custom, esto mandaba
  // `period=custom` SIN from/to y el backend degradaba en silencio a 30 días
  // rolantes (auditoría 2026-08). El caller puede sobreescribir from/to
  // pasándolos en `filter`.
  const w = (window.ecoResolvedWindow && window.ecoResolvedWindow()) || {};
  if (w.from && w.to) {
    params.set('from', w.from);
    params.set('to', w.to);
  }
  params.set('limit', '20');
  for (const [k, v] of Object.entries(filter || {})) {
    if (v == null || v === '') continue;
    params.set(k, String(v));
  }
  return fetch('/api/eco-mentions?' + params.toString(), { cache: 'no-store' })
    .then((r) => r.ok ? r.json() : { mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } })
    .catch(() => ({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }));
}


// Leyenda de TAMAÑO del mapa. El área del marcador codifica el volumen (ver
// mapMarkerRadius en charts.js) y la leyenda sólo explicaba el COLOR, así que no
// había forma de convertir un área en un número: el mapa se leía como
// "grande/pequeño" y nada más. Los radios salen de la misma función que dibuja
// los marcadores para que no puedan divergir. Los círculos van sin relleno
// porque el color ya significa otra cosa en los dos modos.
function MapSizeLegend({ max }) {
  const radiusOf = window.ECO_CHARTS && window.ECO_CHARTS.mapMarkerRadius;
  if (!max || max <= 0 || !radiusOf) return null;
  const stops = [...new Set([Math.max(1, Math.round(max * 0.1)), Math.round(max * 0.4), max])];
  const box = radiusOf(max, max) * 2;
  return (
    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-3)' }}>
      {stops.map((v) => (
        <span key={v} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-05)' }}>
          <span style={{ height: box, display: 'flex', alignItems: 'flex-end' }}>
            <span style={{ width: radiusOf(v, max) * 2, height: radiusOf(v, max) * 2, borderRadius: '50%', border: '1px solid var(--text-3)' }} />
          </span>
          <span className="num">{v.toLocaleString('es-PR')}</span>
        </span>
      ))}
      <span style={{ paddingBottom: 'var(--sp-05)' }}>menciones</span>
    </span>
  );
}

// =============== GEOGRAPHY ===============
function GeographyScreen({ onMentionClick }) {
  const [metric, setMetric] = useState('count');
  const [slice, setSlice] = useState(null);
  // Filtros de contenido: fuente / tópico / subtópico. El mapa se re-consulta a
  // /api/eco-geo cuando cambian; D.MUNICIPALITIES (boot) es solo el estado inicial.
  const [filters, setFilters] = useState({ source: 'all', topic: '', subtopic: '' });
  const [munis, setMunis] = useState(D.MUNICIPALITIES || []);
  const [loadingGeo, setLoadingGeo] = useState(false);

  // Filtros activos (sin defaults), para fusionar en cada _filter de drill-in y
  // en la query de /api/eco-geo. Subtópico va por NOMBRE (contrato eco-mentions).
  const contentFilter = React.useMemo(() => {
    const f = {};
    if (filters.source && filters.source !== 'all') f.source = filters.source;
    if (filters.topic) f.topic = filters.topic;
    if (filters.subtopic) f.subtopic = filters.subtopic;
    return f;
  }, [filters]);
  const hasFilters = !!(contentFilter.source || contentFilter.topic || contentFilter.subtopic);
  // Un vacío CON filtros puestos es accionable (quítalos) y uno sin filtros es un
  // hecho del período. Las dos cards de abajo se quedaban huecas sin decir cuál de
  // los dos era, que es la distinción que EmptyState existe para hacer.
  const geoEmptyReason = hasFilters ? 'filtered' : 'empty';
  // El corte del listado vive en UNA constante para que el rótulo del header y el
  // `slice` no puedan decir números distintos: el bug era justamente prometer 12
  // arriba y servir 8 abajo.
  const TOP_MUNIS = 8;

  // `.input` trae width:100%, así que un minWidth no impide que el select se
  // estire: los tres filtros salían a 1114px cada uno, apilados, y desktop se
  // veía igual que móvil. En móvil el ancho completo SÍ es lo correcto (objetivo
  // de toque), así que el ancho se decide por breakpoint con el mismo helper que
  // las rejillas. En desktop la fuente repite los 160 de Menciones/Búsqueda —es
  // el MISMO control— y tópico/subtópico piden 200 porque "Subtópico (elige
  // tópico)" no cabe en 160.
  const filtersStacked = window.ecoIsMobile();
  const srcWidth = filtersStacked ? '100%' : 160;
  const topicWidth = filtersStacked ? '100%' : 200;

  // Re-consulta la agregación por municipio cuando cambian los filtros.
  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    const agency = localStorage.getItem('eco.agency');
    const period = localStorage.getItem('eco.period') || window.ECO_DEFAULT_PERIOD || '7D';
    if (agency) params.set('agency', agency);
    if (period === 'custom') {
      const from = localStorage.getItem('eco.from');
      const to = localStorage.getItem('eco.to');
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      params.set('period', period);
    }
    for (const [k, v] of Object.entries(contentFilter)) params.set(k, String(v));
    setLoadingGeo(true);
    fetch('/api/eco-geo?' + params.toString(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { municipalities: null }))
      .then((d) => { if (!cancelled && Array.isArray(d.municipalities)) setMunis(d.municipalities); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingGeo(false); });
    return () => { cancelled = true; };
  }, [contentFilter]);

  // Máximo de volumen del período, para la escala secuencial del mapa.
  const maxMuniCount = React.useMemo(() => munis.reduce((mx, m) => Math.max(mx, m.count || 0), 0), [munis]);
  // Cortes de color por cuantiles de los municipios del período: con v/max
  // lineal, 8 de 12 caían en --seq-1 (1.45:1 sobre --canvas, invisible) y tres
  // pasos de la rampa no se usaban nunca. Ver seqQuantileScale.
  const seqScale = React.useMemo(() => seqQuantileScale(munis.map((m) => m.count || 0)), [munis]);

  function openMuniSlice(m) {
    // ecoNssColor: la banda neutra del NSS iba en --warn (ámbar), el color de
    // severidad, así que un municipio en 0.0 se leía como advertencia. El umbral
    // vive en UN solo sitio (data.js) y ya está en la escala canónica ±20 de #92.
    const accent = window.ecoNssColor(m.nss);
    // Desglose REAL del payload (eco-geo y eco-data lo traen por municipio).
    // Antes se fabricaba con splitSentiment y ratios fijos 55/25/20 — el
    // header del modal mostraba números inventados mientras cargaba
    // (auditoría 2026-08). Si el dato no viene, mejor no mostrar nada.
    const senti = (m.positivo != null || m.neutral != null || m.negativo != null)
      ? { pos: m.positivo || 0, neu: m.neutral || 0, neg: m.negativo || 0 }
      : undefined;
    setSlice({
      eyebrow: `${m.region} · ${m.name}`,
      title: `NSS ${m.nss > 0 ? '+' : ''}${Math.round(m.nss)}`,
      accent,
      volume: m.count,
      ...(senti ? { sentiment: senti } : {}),
      mentions: [],
      // El mapa cuenta ventana cerrada SIN pertinencia baja (default del
      // modal ✓) y su filtro de tópico es any-touch → topicMode 'all' para
      // que el total del modal cuadre con la burbuja.
      _filter: {
        ...((window.ecoResolvedWindow && window.ecoResolvedWindow()) || {}),
        municipality: m.slug,
        ...contentFilter,
        ...(contentFilter.topic ? { topicMode: 'all' } : {}),
      },
    });
  }

  // If the user came here from a MentionDrawer "Ver en mapa" action, auto-open
  // the slice modal for the requested municipality. The focus is only honored
  // if set within the last 30 seconds, so a stale focus never re-triggers.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('eco.map.focus');
      if (!raw) return;
      const focus = JSON.parse(raw);
      localStorage.removeItem('eco.map.focus');
      if (!focus || !focus.slug || (Date.now() - (focus.ts || 0)) > 30_000) return;
      const muni = (D.MUNICIPALITIES || []).find((m) => m.slug === focus.slug
        || (m.name || '').toLowerCase() === (focus.name || '').toLowerCase());
      if (muni) openMuniSlice(muni);
      else {
        setSlice({
          eyebrow: 'Región',
          title: focus.name || focus.slug,
          accent: 'var(--accent)',
          mentions: [],
          _filter: {
            ...((window.ecoResolvedWindow && window.ecoResolvedWindow()) || {}),
            municipality: focus.slug,
          },
        });
      }
    } catch (_) {}
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div className="card">
        <div className="card-hd">
          {/* La invitación a hacer click va DENTRO de la rama con datos: estaba
              concatenada fuera del ternario, así que en el caso vacío la misma
              línea decía "Sin menciones georreferenciadas en el período · click un
              municipio para ver menciones" — negaba y ofrecía a la vez. */}
          <div><div className="card-hd-title">Distribución geográfica · Puerto Rico</div><div className="card-hd-sub">{munis.length > 0 ? `${munis.length} ${munis.length === 1 ? 'municipio' : 'municipios'} con menciones en el período · click un municipio para ver menciones` : 'Sin menciones georreferenciadas en el período'}</div></div>
          <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
            {[{ k: 'count', l: 'Volumen' }, { k: 'nss', l: 'Sentimiento' }].map((o) => (
              <button key={o.k} onClick={() => setMetric(o.k)} className={`chip ${metric === o.k ? 'active' : ''}`}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="card-bd">
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
            <SourceSelect value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} style={{ width: srcWidth }} />
            <select className="input" value={filters.topic} style={{ width: topicWidth }}
              onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value, subtopic: '' }))}>
              <option value="">Todos los tópicos</option>
              {(D.TOPICS || []).filter((t) => t && t.slug).map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
            <select className="input" value={filters.subtopic} disabled={!filters.topic}
              style={{ width: topicWidth, opacity: filters.topic ? 1 : 0.5 }}
              onChange={(e) => setFilters((f) => ({ ...f, subtopic: e.target.value }))}>
              <option value="">{filters.topic ? 'Todos los subtópicos' : 'Subtópico (elige tópico)'}</option>
              {filters.topic && (((D.SUBTOPICS || {})[filters.topic]) || []).map((st) => <option key={st.slug || st.name} value={st.name}>{st.name}</option>)}
            </select>
            {hasFilters && <button className="chip" onClick={() => setFilters({ source: 'all', topic: '', subtopic: '' })}>Limpiar</button>}
            {/* --fs-caption y no --fs-overline: tokens.css §1 reserva los 11px a
                eyebrows en MAYÚSCULAS y a ticks de eje densos, y esto es una frase
                en minúsculas dentro de una barra de controles. */}
            {loadingGeo && <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>Actualizando…</span>}
          </div>
          {/* En modo Volumen la MAGNITUD va en la escala secuencial, no en el
              acento: pintar los municipios con var(--accent) cubría Puerto Rico
              de burbujas del color de alarma. */}
          <PRMap
            municipalities={munis}
            // El TAMAÑO es siempre el volumen. Con |NSS| el círculo más grande
            // del mapa era el municipio con el sentimiento más extremo, que
            // puede tener 3 menciones: "donde está el problema" señalaba ruido.
            // Y al alternar de modo la geometría no cambiaba de aspecto pero sí
            // de significado, sin leyenda que lo dijera. Ahora el toggle cambia
            // sólo el color; el tamaño es la referencia estable.
            accessor={(m) => m.count}
            colorFn={(m) => metric === 'nss'
              ? window.ecoNssColor(m.nss)
              : seqScale.colorOf(m.count || 0)}
            onMunicipalityClick={openMuniSlice}
          />
          {/* El tamaño del marcador es el volumen en los DOS modos, así que su
              leyenda va fuera del condicional: es la referencia estable. */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--sp-5)', fontSize: 'var(--fs-overline)', color: 'var(--text-2)', marginTop: 'var(--sp-4)' }}>
            <MapSizeLegend max={maxMuniCount} />
            {metric === 'nss' ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span className="dot" style={{ background: 'var(--pos)' }} /> Positivo (&gt;+2)</span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                menos
                <span style={{ display: 'flex', gap: 'var(--sp-05)' }}>
                  {/* Los chips son los pasos que el mapa DIBUJA (no los 6 de la
                      rampa) y cada uno dice su rango de menciones. */}
                  {seqScale.tokens.map((t, i) => <span key={i} title={`${seqScale.rangeOf(i)} menciones`} style={{ width: 10, height: 10, borderRadius: 'var(--r-sm)', background: t }} />)}
                </span>
                más · volumen de menciones
              </span>
            )}
            {metric === 'nss' && <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span className="dot" style={{ background: 'var(--neu)' }} /> Neutral (−2 a +2)</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}><span className="dot" style={{ background: 'var(--neg)' }} /> Negativo (&lt;-2)</span>
            </>}
          </div>
        </div>
      </div>

      {/* `start` y no el stretch por defecto: las dos listas no tienen la misma
          cantidad de contenido (8 filas de municipio contra 6 de región), y con
          stretch la card corta se estiraba hasta la altura de la larga y dejaba
          ~170px de fondo vacío bajo la última fila. */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 1fr', '1fr'), gap: 'var(--sp-3)', alignItems: 'start' }}>
        <div className="card">
          {/* El corte se ROTULA. El header de la card de arriba dice "12 municipios
              con menciones en el período" y este listado servía 8 sin nota, sin
              "ver todos" y sin puntos suspensivos: el usuario contaba 8 donde le
              habían prometido 12. El precedente es el "Top 7 + agrupados" de
              Tópicos, salvo que aquí el resto no se agrupa —se deja fuera— y eso
              es lo que hay que decir. Con 8 municipios o menos no hay corte que
              rotular y el subtítulo se queda como estaba. */}
          <div className="card-hd"><div><div className="card-hd-title">Top municipios</div><div className="card-hd-sub">{munis.length > TOP_MUNIS ? `Top ${TOP_MUNIS} de ${munis.length} · por volumen de menciones` : 'Por volumen de menciones'}</div></div></div>
          <div className="card-bd">
            {/* Con munis=[] HBarList renderiza su contenedor flex sin hijos, así
                que la card quedaba como un rectángulo con título y nada dentro.
                Mismo primitivo y mismo `reason` que la card hermana. */}
            {munis.length === 0 && <EmptyState compact reason={geoEmptyReason} />}
            <HBarList
              items={[...munis].sort((a,b)=>b.count-a.count).slice(0, TOP_MUNIS).map(m => ({ label: m.name, value: m.count, nss: m.nss, _muni: m }))}
              // La misma escala que el mapa. Con --accent (token de marca y de
              // acción: chip activo, rail, `.link`) el volumen se codificaba de
              // dos maneras a 40px de distancia, y contra la advertencia de
              // tokens.css §6.
              colorFn={(it) => seqScale.colorOf(it.value)}
              onItemClick={(it) => openMuniSlice(it._muni)}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Sentimiento por región</div><div className="card-hd-sub">NSS agregado</div></div></div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {/* Sin municipios no hay regiones: la cadena de .map devolvía lista
                vacía y la card se quedaba con el título flotando sobre la nada.
                El mismo `reason` que la card hermana, para que dos cards que
                miran el mismo dato vacío no cuenten dos historias distintas. */}
            {munis.length === 0 && <EmptyState compact reason={geoEmptyReason} />}
            {[...new Set((munis || []).map((m) => m.region).filter(Boolean))]
              // El orden era el de inserción del API, así que la columna de
              // cifras alineada a la derecha zigzagueaba y no servía para
              // comparar (la card hermana sí ordena). Ascendente por NSS: lo más
              // negativo primero, que es lo que se va a atender.
              .map((r) => ({ r, rows: munis.filter((m) => m.region === r) }))
              .filter((g) => g.rows.length > 0)
              // Ordena por el MISMO número que se imprime: ponderado por volumen.
              // Con media simple el orden y la cifra mostrada discrepaban, así que
              // la columna alineada a la derecha volvía a zigzaguear — justo lo
              // que este orden venía a arreglar.
              .map(({ r, rows }) => {
                const tot = rows.reduce((s, m) => s + (m.count || 0), 0);
                return { r, rows, avg: tot > 0
                  ? rows.reduce((s, m) => s + m.nss * (m.count || 0), 0) / tot
                  : 0 };
              })
              .sort((a, b) => a.avg - b.avg)
              .map(({ r }, i) => {
              const regionMunis = munis.filter(m => m.region === r);
              if (regionMunis.length === 0) return null;
              const total = regionMunis.reduce((s,m) => s+m.count, 0);
              // NSS regional PONDERADO por volumen: antes era media simple de
              // los NSS municipales y un municipio con 2 menciones pesaba
              // igual que uno con 4,000 (auditoría 2026-08, P1-12).
              const avgNss = total > 0
                ? regionMunis.reduce((s,m) => s + m.nss * m.count, 0) / total
                : 0;
              // El DOMINIO es ±30, no ±100. Con el rango teórico del NSS la región
              // más negativa llenaba ~10% de la pista y las seis se leían "planas
              // en cero" mientras la cifra al lado decía −21. ±30 es el umbral de
              // decisión del mapa (±20, escala canónica de #92) más holgura, así
              // que la barra y el color hablan de la misma escala.
              const NSS_DOMAIN = 30;
              const pct = Math.max(-1, Math.min(1, avgNss / NSS_DOMAIN));
              return (
                <button key={r}
                  onClick={() => {
                    setSlice({
                      eyebrow: `Región · ${r}`,
                      title: `Sentimiento en ${r}`,
                      accent: window.ecoNssColor(avgNss),
                      mentions: [],
                      _filter: {
                        ...((window.ecoResolvedWindow && window.ecoResolvedWindow()) || {}),
                        region: r,
                        ...contentFilter,
                        ...(contentFilter.topic ? { topicMode: 'all' } : {}),
                      },
                    });
                  }}
                  className="row-hover"
                  // El padding en px crudos (10 no está en la escala base-4)
                  // metía el texto de la fila 12px a la derecha del título de su
                  // propia card y del listado hermano. Con marginInline negativo
                  // —el mismo truco de HBarList— el texto cae sobre el eje del
                  // título y el área de click sigue llegando al borde. Fondo
                  // transparente: la elevación la da `.row-hover` al pasar, como
                  // en la card hermana, no un --canvas-2 permanente.
                  style={{ padding: 'var(--sp-2) var(--sp-3)', marginInline: 'calc(-1 * var(--sp-3))', background: 'transparent', borderRadius: 'var(--r-md)', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-2)' }}>
                    <div>
                      {/* 13/12 y no 12/11: dos niveles separados por 1px se
                          leían como uno. */}
                      <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600 }}>{r}</div>
                      {/* Plural resuelto, como ya lo hace el header de la propia
                          pantalla: una región con un solo municipio imprimía
                          "1 municipios". No hay helper de plural en data.js, así
                          que se replica el ternario del header en vez de inventar
                          una API global para dos usos. */}
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{regionMunis.length} {regionMunis.length === 1 ? 'municipio' : 'municipios'} · {fmt(total)} {total === 1 ? 'mención' : 'menciones'}</div>
                    </div>
                    {/* La cifra en la escala NUMÉRICA. Con --fs-title-md salía
                        idéntica en tamaño, familia y peso al título de la card
                        ("Sentimiento por región"), así que el KPI de la fila no
                        dominaba ni a su propia etiqueta. */}
                    <div className="num" style={{ fontSize: 'var(--fs-num-md)', fontWeight: 600, color: window.ecoNssColor(avgNss) }}>
                      {avgNss > 0 ? '+' : ''}{avgNss.toFixed(1)}
                    </div>
                  </div>
                  {/* Misma pista que HBarList: `.bar-track`, 6px sobre
                      --canvas-2. La de antes era propia, de 4px sobre
                      --hairline —el token de DIVISORES— así que dos listas
                      hermanas que abren el mismo modal tenían dos barras
                      distintas. Las marcas en ±2 son el umbral con el que el
                      mapa decide el color: la barra dice dónde empieza a
                      importar. */}
                  <div className="bar-track" style={{ position: 'relative', height: 6 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--text-3)' }} />
                    {[-1, 1].map((s) => (
                      <div key={s} style={{ position: 'absolute', left: `${50 + s * Math.min(1, window.ECO_NSS_NEUTRAL_BAND / NSS_DOMAIN) * 50}%`, top: 0, bottom: 0, width: 1, background: 'var(--hairline-strong)' }} />
                    ))}
                    <div style={{ position: 'absolute', left: pct > 0 ? '50%' : `${50 + pct * 50}%`, width: `${Math.abs(pct) * 50}%`, height: '100%', background: window.ecoNssColor(avgNss), borderRadius: 'inherit' }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

// =============== CRISIS ALERTS TAB (embed de /settings/alerts) ===============
// Configurador de la regla `crisis_threshold`: umbrales, cooldown y destinatarios.
// El backend es metrics-calculator (cron c/10 min). Aquí solo se persiste la regla
// en alert_rules; la próxima evaluación la lee automáticamente.
function CrisisAlertsTab() {
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef(null);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    // Agencia activa (no hardcodear ddecpr — al cambiar a AAA estos paneles no
    // cambiaban). Pasamos slug en `agency` y `agencySlug` por compatibilidad.
    const ag = localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || 'ddecpr';
    try {
      const [cfg, hist] = await Promise.all([
        fetch(`/api/alerts/crisis-config?agency=${ag}&agencySlug=${ag}`).then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
        fetch(`/api/alerts/history?agency=${ag}&agencySlug=${ag}&limit=10`).then((r) => r.ok ? r.json() : { history: [] }).catch(() => ({ history: [] })),
      ]);
      setConfig(cfg.config ?? null);
      setHistory(hist.history ?? []);
    } catch (err) {
      console.error('crisis tab load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const isActive = config?.isActive ?? false;
  const crisisMin = config?.crisisMin ?? 0.40;
  const cooldownHours = config?.cooldownHours ?? 12;
  const recipientsCount = config?.notifyEmails?.length ?? 0;
  const lastFire = history[0] || null;
  const lastFireLabel = window.ecoFmtDate(lastFire && lastFire.triggeredAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* KPIs operativos */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(4, 1fr)', 'repeat(2, 1fr)'), gap: 'var(--sp-3)' }}>
        <KpiCard
          label="Estado del disparador"
          valueWord={loading ? '…' : (isActive ? 'Activo' : 'Inactivo')}
          valueTone={isActive ? 'pos' : 'neutral'}
          sub={isActive ? 'evalúa cada 10 min' : 'no se enviarán alertas'}
          icon="Bell"
          accent={isActive ? 'var(--pos)' : 'var(--text-3)'}
        />
        <KpiCard
          label="Umbral de activación"
          value={loading ? '…' : `${Math.round(crisisMin * 100)}%`}
          sub="Crisis Score"
          icon="Shield"
          accent="var(--neg)"
        />
        <KpiCard
          label="Cooldown"
          value={loading ? '…' : `${cooldownHours}h`}
          sub="entre alertas"
          icon="Calendar"
          accent="var(--text-2)"
        />
        <KpiCard
          label="Destinatarios"
          value={loading ? '…' : String(recipientsCount)}
          sub={lastFire ? `último: ${lastFireLabel}` : 'sin envíos aún'}
          icon="Mail"
          accent="var(--text-2)"
        />
      </div>

      {/* Form embebido */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Configuración de la alerta de crisis</div>
            <div className="card-hd-sub">Edita umbrales, cooldown y destinatarios. Los cambios aplican desde el siguiente ciclo (≤ 10 min).</div>
          </div>
          <button className="chip" onClick={() => { reloadAll(); if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}>
            Recargar
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src="/settings/alerts?embed=1"
          title="Configuración de alertas de crisis"
          style={{
            width: '100%',
            height: 1100,
            border: 'none',
            background: 'transparent',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

// =============== REPORTS TAB (embed de /settings/reports) ===============
// Esta pestaña vive dentro de Alertas y embebe la página real de configuración
// de reportes (Next.js) vía iframe. Muestra KPIs operativos arriba (próximo
// envío, destinatarios activos, último envío) y luego el form embebido.
function ReportsTab() {
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef(null);

  // Reload el iframe cuando guardamos config en otro lado, así los KPIs y el
  // form se mantienen sincronizados. La carga inicial es cuando entras al tab.
  const reloadAll = useCallback(async () => {
    setLoading(true);
    // Agencia activa (no hardcodear ddecpr). Slug en `agency` y `agencySlug`.
    const ag = localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || 'ddecpr';
    try {
      const [cfg, hist] = await Promise.all([
        fetch(`/api/reports/config?agency=${ag}&agencySlug=${ag}`).then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
        fetch(`/api/reports/history?agency=${ag}&agencySlug=${ag}&limit=14`).then((r) => r.ok ? r.json() : { history: [] }),
      ]);
      setConfig(cfg.config ?? null);
      setHistory(hist.history ?? []);
    } catch (err) {
      console.error('reports tab load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  // Próximo envío estimado: hoy o mañana a sendHourLocal en el timezone local.
  const nextSendLabel = useMemo(() => {
    if (!config || !config.isActive) return '—';
    const tz = config.timezone || 'America/Puerto_Rico';
    const hour = config.sendHourLocal ?? 6;
    const now = new Date();
    // Hora actual en el TZ destino
    const localHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).format(now), 10);
    const localMins = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, minute: '2-digit' }).format(now), 10);
    let target = new Date(now);
    target.setMinutes(0, 0, 0);
    const isToday = localHour < hour;
    target.setHours(target.getHours() + (isToday ? (hour - localHour) : (24 - localHour + hour)));
    target.setMinutes(target.getMinutes() - localMins);
    const diffMs = target - now;
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const fmtTime = `${String(hour).padStart(2, '0')}:00`;
    const dayLabel = isToday ? 'hoy' : 'mañana';
    return `${dayLabel} ${fmtTime} · en ${hrs}h ${mins}m`;
  }, [config]);

  const lastSend = history[0] || null;
  const lastSendLabel = lastSend ? window.ecoFmtDate(lastSend.sentAt) : '—';
  const lastSendStatus = lastSend ? lastSend.status : null;
  const recipientsCount = config?.recipients?.length ?? 0;
  const tzLabel = config?.timezone === 'America/Puerto_Rico' ? 'San Juan (AST)' : (config?.timezone ?? '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* KPI strip propio del tab */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(4, 1fr)', 'repeat(2, 1fr)'), gap: 'var(--sp-3)' }}>
        <KpiCard
          label="Estado del envío"
          value={loading ? '…' : (config?.isActive ? 'Activo' : 'Pausado')}
          icon={config?.isActive ? 'Check' : 'Pause'}
          accent={config?.isActive ? 'var(--pos)' : 'var(--text-3)'}
          sub={tzLabel}
        />
        <KpiCard
          label="Próximo envío"
          value={loading ? '…' : nextSendLabel.split(' · ')[0]}
          sub={loading ? '' : (nextSendLabel.split(' · ')[1] || '')}
          icon="Calendar"
          accent="var(--accent)"
        />
        <KpiCard
          label="Destinatarios"
          value={loading ? '…' : String(recipientsCount)}
          icon="Mail"
          accent="var(--text-2)"
          sub="agencia DDEC"
        />
        <KpiCard
          label="Último envío"
          value={lastSendLabel}
          sub={lastSendStatus ? `estado: ${lastSendStatus}` : 'sin envíos aún'}
          icon="Eye"
          accent={lastSendStatus === 'sent' ? 'var(--pos)' : (lastSendStatus === 'failed' ? 'var(--neg)' : 'var(--text-3)')}
        />
      </div>

      {/* Form embebido vía iframe */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Configuración de reportes por correo</div>
            <div className="card-hd-sub">Diario (cada mañana) y semanal comparativo (viernes). Edita destinatarios, hora, día del semanal y plantilla; guarda con “Guardar cambios”.</div>
          </div>
          <button className="chip" onClick={() => { reloadAll(); if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}>
            Recargar
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src="/settings/reports?embed=1"
          title="Configuración de reportes por correo"
          style={{
            width: '100%',
            height: 1200,
            border: 'none',
            background: 'transparent',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

// =============== ALERTS ===============
function AlertsScreen({ onMentionClick }) {
  // Por defecto 'history' (datos reales). El "Feed en vivo" estaba vacío porque
  // eco-data nunca pobla ALERT_FEED; ahora muestra estado vacío honesto.
  const [tab, setTab] = useState('history');
  const [slice, setSlice] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toast, setToast] = useState(null); // { kind, text }
  // Local overrides for rule active toggle (not yet persisted to backend).
  const [ruleActive, setRuleActive] = useState(() => {
    const m = {};
    (D.ALERTS || []).forEach((a) => { m[a.id] = a.active; });
    return m;
  });

  // KPIs reales (antes eran literales 6/4/7/8m). Reglas/activas salen de D.ALERTS;
  // activaciones y última-alerta de /api/alerts/history.
  //
  // VENTANA ÚNICA: la del selector global del header, la misma que consultan el
  // historial y el histograma de abajo. Antes este KPI pedía `period=1D` y se
  // rotulaba "· 24h" mientras las cards de la misma pantalla contaban 7 días, así
  // que el mismo dígito (11) aparecía dos veces a 60 px de distancia significando
  // un día y una semana. Cambiar de período recarga la página (app.js), así que
  // basta leerlo una vez por montaje.
  const [fireStats, setFireStats] = useState({ fired: null, lastFired: null });
  // Regla cuyo toggle está en vuelo, para no encadenar clics sobre la misma.
  const [savingRule, setSavingRule] = useState(null);
  const firePeriod = (typeof window.ecoGetPeriodParams === 'function') ? window.ecoGetPeriodParams().period : '7D';
  React.useEffect(() => {
    const ag = localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || '';
    const qs = new URLSearchParams(Object.assign(
      { agency: ag, agencySlug: ag, limit: '200' },
      (typeof window.ecoGetPeriodParams === 'function') ? window.ecoGetPeriodParams() : { period: '7D' },
    ));
    fetch(`/api/alerts/history?${qs.toString()}`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((j) => { const h = j.history || []; setFireStats({ fired: h.length, lastFired: h[0] ? h[0].triggeredAt : null }); })
      .catch(() => {});
  }, []);
  const rulesTotal = (D.ALERTS || []).length;
  const rulesActive = (D.ALERTS || []).filter((a) => a.active).length;
  // Sin `timeZone` esto rendía la hora del navegador: el MISMO evento salía 9:00
  // en este KPI y 10:00 en la fila del historial. Helper único (data.js).
  const lastFiredLabel = window.ecoFmtDateTime(fireStats.lastFired);
  // "Última alerta" era la única de las cuatro KPI cuyo valor no es un conteo: la
  // cadena de fecha en --fs-num-xl (30 px, lineHeight 1) envolvía a dos líneas,
  // rompía el eje inferior de la fila y dejaba 2,7 px de aire entre renglones. Y
  // una fecha no se compara con un 11: el valor pasa a ser la magnitud
  // (antigüedad) y el instante exacto baja a `sub`, que es texto y no cifra.
  const lastFiredAgeDays = fireStats.lastFired
    ? Math.max(0, Math.floor((Date.now() - new Date(fireStats.lastFired).getTime()) / 86400000))
    : null;
  const lastFiredAge = lastFiredAgeDays == null ? '—' : (lastFiredAgeDays === 0 ? 'hoy' : `hace ${lastFiredAgeDays} d`);
  const canRules = (typeof window !== 'undefined' && typeof window.ecoHasCap === 'function') ? window.ecoHasCap('manage_alert_rules') : true;
  const canTemplates = (typeof window !== 'undefined' && typeof window.ecoHasCap === 'function') ? window.ecoHasCap('manage_templates') : true;

  function fireToast(kind, text) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3600);
  }

  // El toggle Activa/Inactiva de la tabla de reglas solo movía estado local: se
  // veía como un control que guarda, se quedaba puesto hasta recargar y la regla
  // seguía disparando igual. Ahora escribe en PATCH /api/alerts/[id].
  // Optimista —el switch responde al instante— con vuelta atrás y aviso si el
  // servidor lo rechaza, que es lo que pasaba en silencio hasta ahora.
  async function toggleRule(id) {
    if (savingRule) return;
    const next = !ruleActive[id];
    setSavingRule(id);
    setRuleActive((s) => ({ ...s, [id]: next }));
    try {
      const res = await fetch('/api/alerts/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      fireToast('ok', next ? 'Regla activada.' : 'Regla desactivada.');
    } catch (e) {
      setRuleActive((s) => ({ ...s, [id]: !next }));
      fireToast('err', 'No se pudo cambiar la regla (' + (e.message || e) + ')');
    } finally {
      setSavingRule(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(4, 1fr)', 'repeat(2, 1fr)'), gap: 'var(--sp-3)' }}>
        <KpiCard label="Reglas configuradas" value={String(rulesTotal)} icon="Shield" accent="var(--text-2)" />
        <KpiCard label="Reglas activas" value={String(rulesActive)} icon="Bell" accent="var(--text-2)" />
        <KpiCard label={`Activaciones · ${firePeriod}`} value={fireStats.fired == null ? '—' : String(fireStats.fired)} icon="Zap" accent="var(--text-2)" />
        <KpiCard label="Última alerta" value={lastFiredAge} sub={lastFiredLabel} icon="Activity" accent="var(--text-2)" />
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-15)', alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setTab('history')} className={`chip ${tab === 'history' ? 'active' : ''}`}>Historial</button>
        <button onClick={() => setTab('rules')} className={`chip ${tab === 'rules' ? 'active' : ''}`}>Reglas</button>
        {(canRules || canTemplates) && (
          <>
            <span aria-hidden style={{ width: 1, height: 18, background: 'var(--hairline-strong)', margin: '0 6px' }} />
            <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginRight: 2 }}>Configuración</span>
            {canRules && <button onClick={() => setTab('crisis')} className={`chip ${tab === 'crisis' ? 'active' : ''}`}>Alertas de crisis</button>}
            {canTemplates && <button onClick={() => setTab('reports')} className={`chip ${tab === 'reports' ? 'active' : ''}`}>Reportes por correo</button>}
          </>
        )}
        <div style={{ flex: 1 }} />
        {tab !== 'reports' && tab !== 'crisis' && canRules && (
          <button className="btn btn-primary" onClick={() => setEditorOpen(true)}><Icons.Plus size={13} /> Nueva regla</button>
        )}
      </div>

      {tab === 'rules' && (
        <div className="card scroll-x">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 120px 120px 30px', minWidth: 740, gap: 'var(--sp-3)', padding: '10px 16px', fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', borderBottom: '1px solid var(--hairline)' }}>
            {/* "Activaciones 30d" prometía una ventana de 30 días para un número
                que el API devuelve SIEMPRE 0 (eco-data/route.ts: triggered: 0), y
                era la tercera ventana distinta de la pantalla. Y el campo se llama
                "Prioridad" aquí y "Severidad" en el historial: un solo término. */}
            <span>Regla</span><span>Severidad</span><span style={{ textAlign: 'right' }}>Activaciones</span><span>Estado</span><span>Canales</span><span>Último</span><span />
          </div>
          {D.ALERTS.map((a) => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 120px 120px 30px', minWidth: 740, gap: 'var(--sp-3)', alignItems: 'center', padding: '14px 16px', borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-caption)' }}>
              <span style={{ fontWeight: 500 }}>{a.name}</span>
              <span className={`pill ${a.priority === 'alta' ? 'pill-neg' : a.priority === 'media' ? 'pill-warn' : 'pill-neu'}`} style={{ justifySelf: 'start' }}>{a.priority}</span>
              {/* a.triggered viene hardcodeado a 0 del API (eco-data/route.ts), así
                  que un "0" aquí no significa "cero activaciones" sino "sin dato":
                  se rinde como raya hasta que el endpoint lo calcule. */}
              <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{a.triggered ? a.triggered : '—'}</span>
              {/* Sin manage_alert_rules el PATCH responde 403, así que el
                  switch no se ofrece: se muestra el estado y ya. */}
              {canRules ? (
                <button
                  onClick={() => toggleRule(a.id)}
                  disabled={savingRule === a.id}
                  aria-pressed={!!ruleActive[a.id]}
                  title={ruleActive[a.id] ? 'Desactivar esta regla' : 'Activar esta regla'}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', cursor: savingRule === a.id ? 'wait' : 'pointer', background: 'none', border: 0, padding: 0, opacity: savingRule === a.id ? 0.6 : 1 }}>
                  <div style={{ width: 28, height: 16, borderRadius: 'var(--r-lg)', background: ruleActive[a.id] ? 'var(--pos)' : 'var(--hairline-strong)', position: 'relative', transition: 'all 0.2s' }}>
                    <div style={{ position: 'absolute', top: 2, left: ruleActive[a.id] ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'var(--knob)', transition: 'all var(--dur) var(--ease)' }} />
                  </div>
                  <span style={{ color: ruleActive[a.id] ? 'var(--pos)' : 'var(--text-3)' }}>{ruleActive[a.id] ? 'Activa' : 'Inactiva'}</span>
                </button>
              ) : (
                <span className={`pill ${ruleActive[a.id] ? 'pill-pos' : 'pill-neu'}`} style={{ justifySelf: 'start' }}>
                  {ruleActive[a.id] ? 'Activa' : 'Inactiva'}
                </span>
              )}
              <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                {a.channels.map((c) => {
                  const IconC = { email: Icons.Mail, slack: Icons.Slack, sms: Icons.Phone }[c];
                  return <span key={c} title={c} style={{ width: 24, height: 24, borderRadius: 'var(--r-sm)', background: 'var(--canvas-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconC size={11} color="var(--text-2)" /></span>;
                })}
              </div>
              <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{a.lastFired}</span>
              <Icons.More size={14} color="var(--text-3)" />
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && <AlertsHistory onMentionClick={onMentionClick} />}

      {tab === 'crisis' && canRules && <CrisisAlertsTab />}

      {tab === 'reports' && canTemplates && <ReportsTab />}

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
      {editorOpen && (
        <AlertRuleEditor
          topics={D.TOPICS || []}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); fireToast('ok', 'Regla creada.'); setTab('rules'); }}
          onError={(m) => fireToast('err', m || 'No se pudo guardar la regla')}
        />
      )}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 2200,
          background: toast.kind === 'err' ? 'var(--neg-bg)' : 'var(--pos-bg)',
          color: toast.kind === 'err' ? 'var(--neg)' : 'var(--pos)',
          padding: '10px 16px', borderRadius: 'var(--r-lg)', border: '1px solid var(--hairline)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)', fontSize: 'var(--fs-caption)', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
        }}>
          <span className="dot" style={{ background: 'currentColor' }} />
          {toast.text}
        </div>
      )}
    </div>
  );
}

// --- AlertRuleEditor ---
function AlertRuleEditor({ topics, onClose, onSaved, onError }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Reglas de MÉTRICA sobre el snapshot diario (decisión: estandarizar en reglas
  // de métrica). Cada métrica trae dirección + umbral por defecto sensatos.
  const METRIC_DEFAULTS = {
    crisis:               { comparator: 'gte', threshold: 0.40, label: 'Crisis Score (0–1)',           hint: '≥ 0.40 = banda ALERTA' },
    bhi:                  { comparator: 'lte', threshold: 0.45, label: 'Brand Health Index (0–1)',     hint: '≤ 0.45 = salud baja' },
    polarization:         { comparator: 'gte', threshold: 50,   label: 'Polarización (0–100)',         hint: '≥ 50 = polarizada: dos bandos parejos' },
    engagement_velocity:  { comparator: 'gte', threshold: 2.5,  label: 'Velocidad de engagement (z)',  hint: '≥ 2.5σ sobre baseline' },
    volume_anomaly:       { comparator: 'gte', threshold: 2.5,  label: 'Anomalía de volumen (z)',      hint: '≥ 2.5σ sobre baseline' },
  };
  const [metric, setMetric] = useState('crisis');
  const [comparator, setComparator] = useState(METRIC_DEFAULTS.crisis.comparator);
  const [threshold, setThreshold] = useState(METRIC_DEFAULTS.crisis.threshold);
  const [cooldownHours, setCooldownHours] = useState(12);
  const [emailsText, setEmailsText] = useState('');
  const [saving, setSaving] = useState(false);
  const onMetricChange = (m) => { setMetric(m); const d = METRIC_DEFAULTS[m]; if (d) { setComparator(d.comparator); setThreshold(d.threshold); } };

  // Cerrar con Escape (mismo patrón que CommandPalette).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!name.trim()) { onError && onError('El nombre es obligatorio'); return; }
    setSaving(true);
    const emails = emailsText.split(/[\s,]+/).map(s => s.trim()).filter(s => /.+@.+\..+/.test(s));
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          config: {
            type: 'metric_threshold',
            metric,
            comparator,
            threshold: Number(threshold),
            cooldownHours: Number(cooldownHours),
          },
          notifyEmails: emails,
        }),
      });
      if (res.ok) { onSaved && onSaved(); }
      else {
        const body = await res.json().catch(() => ({}));
        onError && onError(body.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      onError && onError(e.message || 'Error de red');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(560px, 94vw)', maxHeight: '88vh', overflow: 'auto',
        background: 'var(--canvas)', border: '1px solid var(--hairline-strong)',
        borderRadius: 'var(--r-xl)', boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
        zIndex: 2001, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div style={{ flex: 1 }}>
            <div className="section-eyebrow">Nueva regla</div>
            <div style={{ fontSize: 'var(--fs-title-lg)', fontWeight: 600, fontFamily: 'var(--ff-display)', marginTop: 'var(--sp-1)' }}>Configurar condiciones y notificación</div>
          </div>
          <button aria-label="Cerrar" className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>
        <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Nombre</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Pico de negativos en infraestructura" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
            <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Descripción (opcional)</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexto o razón de la regla" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 1fr', '1fr'), gap: 'var(--sp-3)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', gridColumn: '1 / -1' }}>
              <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Métrica</span>
              <select className="input" value={metric} onChange={(e) => onMetricChange(e.target.value)}>
                {Object.entries(METRIC_DEFAULTS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
              </select>
              <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{METRIC_DEFAULTS[metric] && METRIC_DEFAULTS[metric].hint}</span>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Condición</span>
              <select className="input" value={comparator} onChange={(e) => setComparator(e.target.value)}>
                <option value="gte">Mayor o igual que (≥)</option>
                <option value="lte">Menor o igual que (≤)</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Umbral</span>
              <input className="input" type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', gridColumn: '1 / -1' }}>
              <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Cooldown entre activaciones · horas</span>
              <input className="input" type="number" min="1" max="168" value={cooldownHours} onChange={(e) => setCooldownHours(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', gridColumn: '1 / -1' }}>
              <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>Correos a notificar (separados por coma)</span>
              <input className="input" value={emailsText} onChange={(e) => setEmailsText(e.target.value)} placeholder="equipo@agencia.pr.gov" />
            </label>
          </div>
          <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
            Se evalúa sobre el snapshot diario de la agencia (cron de métricas). Al cruzar el umbral envía un correo a los destinatarios y respeta el cooldown.
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Crear regla'}
          </button>
        </div>
      </div>
    </>
  );
}

function AlertsHistory({ onMentionClick }) {
  const [rows, setRows] = React.useState(null); // null = loading
  React.useEffect(() => {
    const agency = localStorage.getItem('eco.agency') || '';
    // Misma ventana que el resto del producto, INCLUIDO el rango personalizado:
    // con `period=custom` y sin from/to el endpoint cae a 30 días por defecto
    // (api/alerts/history: `PERIOD_DAYS[periodKey] ?? 30`), así que la tabla y el
    // histograma mostraban un mes mientras el header decía otra cosa.
    const qs = new URLSearchParams(Object.assign(
      { agency },
      (typeof window.ecoGetPeriodParams === 'function') ? window.ecoGetPeriodParams() : { period: localStorage.getItem('eco.period') || '7D' },
    ));
    fetch('/api/alerts/history?' + qs.toString(), { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : { history: [] })
      .then((j) => setRows(j.history || []))
      .catch(() => setRows([]));
  }, []);
  if (rows === null) {
    return <div className="card card-bd" style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Cargando historial…</div>;
  }
  if (rows.length === 0) {
    return <div className="card card-bd" style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Sin alertas disparadas en el período.</div>;
  }
  // Aggregate by day for a mini bar chart
  const byDay = {};
  rows.forEach((r) => {
    const day = (r.triggeredAt || '').slice(0, 10);
    if (!day) return;
    byDay[day] = (byDay[day] || 0) + 1;
  });
  const days = Object.keys(byDay).sort();
  // Dominio DECLARADO, con piso. Normalizar contra el propio máximo con un rango
  // de 1-2 eventos pintaba "2 eventos" como una columna de 110 px que llenaba la
  // card: la misma tinta que tendría una crisis, y 14x la que recibe un 4 en la
  // card de severidad de al lado. Con piso 4 la proporción se conserva (1 sigue
  // siendo la mitad de 2) a una altura acorde a la magnitud, y el subtítulo
  // publica la escala para que el lector sepa qué significa "columna llena".
  const yMax = Math.max(4, ...Object.values(byDay));
  // Densidad de rótulos como en AreaLineChart: una etiqueta por columna mientras
  // caben, una de cada N cuando el período es largo (30D/3M).
  const tickEvery = Math.max(1, Math.ceil(days.length / 7));
  const showValues = days.length <= 10;
  // Analítica derivada del mismo historial (sin backend nuevo): mezcla de
  // severidad + ranking de reglas por número de activaciones.
  const sev = { alta: 0, media: 0, baja: 0 };
  rows.forEach((r) => { const s = (r.severity === 'alta' || r.severity === 'baja') ? r.severity : 'media'; sev[s]++; });
  const byRule = {};
  rows.forEach((r) => { const n = r.ruleName || r.rule || 'Regla'; byRule[n] = (byRule[n] || 0) + 1; });
  const ruleRank = Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 1fr', '1fr'), gap: 'var(--sp-4)' }}>
        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Mezcla de severidad</div><div className="card-hd-sub">Barra = % de {rows.length} activaciones</div></div></div>
          <div className="card-bd">
            {/* UN denominador para las DOS listas de esta fila (el total de
                activaciones del período) y UNA geometría (HBarList). Antes esta
                card normalizaba al total y la de al lado al máximo del ranking
                sobre una pista 4,8x más corta: el mismo valor 3 medía 117 px aquí
                y 89 px allí, y "barra llena" significaba 11 a la izquierda y 3 a
                la derecha. Ahora una barra llena significa lo mismo en las dos y
                el subtítulo declara el denominador. Sin `trackHeight`: la pista
                hereda los 6 px de HBarList, que es la altura que usan las listas
                de barras del resto del producto (Overview, Geografía). */}
            <HBarList
              items={[['Alta', 'var(--neg)'], ['Media', 'var(--warn)'], ['Baja', 'var(--text-3)']].map(([label, color]) => ({ label, color, value: sev[label.toLowerCase()] }))}
              max={Math.max(1, rows.length)}
              colorFn={(it) => it.color}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Reglas más activas</div><div className="card-hd-sub">Top {ruleRank.length} · barra = % de {rows.length} activaciones</div></div></div>
          <div className="card-bd">
            <HBarList
              items={ruleRank.map(([label, value]) => ({ label, value }))}
              max={Math.max(1, rows.length)}
            />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Activaciones por día</div><div className="card-hd-sub">{rows.length} eventos · escala 0–{yMax}</div></div></div>
        <div className="card-bd">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 'var(--sp-1)', height: 88, alignItems: 'end' }}>
            {days.map((d) => (
              <div key={d} title={`${d} · ${byDay[d]} eventos`} style={{ display: 'flex', alignItems: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', height: `${(byDay[d] / yMax) * 100}%`, background: 'var(--accent)', borderRadius: 'var(--r-sm) var(--r-sm) 0 0', minHeight: 2 }} />
              </div>
            ))}
          </div>
          {/* Eje real: valor y fecha DEBAJO de cada columna, en la misma rejilla.
              Antes sólo se rotulaban el primer y el último día — los cinco del
              medio no eran identificables — y no había ni cero ni valores, así
              que la altura era la única pista de magnitud. El `opacity: 0.85` de
              las columnas se elimina: producía un segundo naranja para la MISMA
              métrica que las barras de la card de al lado. */}
          {showValues && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>
              {days.map((d) => (
                <span key={d} className="num" style={{ textAlign: 'center', fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>{byDay[d]}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 'var(--sp-1)', marginTop: 'var(--sp-05)', fontSize: 'var(--fs-overline)', color: 'var(--chart-axis)' }}>
            {/* `d` es 'YYYY-MM-DD' tal como lo agrupa el backend: se corta como
                cadena y no con new Date(), porque esa forma se parsea como
                medianoche UTC y en AST (UTC-4) el rótulo saldría un día antes. */}
            {days.map((d, i) => (
              <span key={d} className="num" style={{ textAlign: 'center' }}>{i % tickEvery === 0 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-hd"><div>
          <div className="card-hd-title">Historial detallado</div>
          {/* Denominador explícito: la card recortaba a 40 filas en silencio y era
              la única de la pantalla sin `card-hd-sub`, mientras las otras tres
              declaran el suyo. Un recorte que no se anuncia se lee como "esto es
              todo lo que hubo". */}
          <div className="card-hd-sub">
            {rows.length > 40 ? `Mostrando 40 de ${rows.length} activaciones` : `${rows.length} activaciones`}
          </div>
        </div></div>
        <div className="scroll-x">
          {/* Fila de encabezados, con la misma pauta que la tabla de Reglas: la
              cuarta columna imprimía una fila de ceros sin nada que la nombrara. */}
          <div className="hide-mobile" style={{
            display: 'grid', gridTemplateColumns: '120px 140px 1fr 90px',
            gap: 'var(--sp-3)', padding: '0 0 var(--sp-2)',
            fontSize: 'var(--fs-overline)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)',
            letterSpacing: 'var(--tracking-overline)', color: 'var(--text-3)', fontWeight: 500,
          }}>
            <span>Cuándo</span><span>Severidad</span><span>Regla</span>
            <span style={{ textAlign: 'right' }}>Menciones</span>
          </div>
          {rows.slice(0, 40).map((r, i) => (
            /* En móvil la fila se pliega a dos líneas en vez de mantener columnas
               fijas: con '120px 140px 1fr 90px' la marca de tiempo y una píldora de
               cuatro letras se comían 260 de los ~350 px visibles (74%), al nombre
               de la regla le quedaban 77 px y el conteo caía fuera del viewport.
               Con '1fr auto' los cuatro hijos se auto-colocan en dos filas
               (tiempo | severidad / regla | conteo) sin reordenar el marcado, y sin
               minWidth no hace falta scroll horizontal para leer el dato principal.
               168 px en la primera columna es lo que mide "20 jul 26, 10:00 a. m."
               en IBM Plex Mono 12 px: hoy la cadena es más larga que su columna de
               120 px y envuelve a dos renglones dentro de la fila. */
            <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: window.ecoCols('168px 96px 1fr 72px', '1fr auto'), minWidth: window.ecoIsMobile() ? 0 : 560, gap: window.ecoCols('var(--sp-3)', 'var(--sp-1) var(--sp-3)'), padding: '10px 16px', borderTop: i > 0 ? '1px solid var(--hairline)' : 'none', fontSize: 'var(--fs-caption)', alignItems: 'center' }}>
              {/* toLocaleString sin componentes rendía "07/20/2026, 10:00:00 a. m.":
                  año de cuatro cifras y segundos que nadie audita, en una columna
                  de 120 px donde no caben. */}
              <span className="mono" style={{ color: 'var(--text-3)' }}>{window.ecoFmtDateTime(r.triggeredAt)}</span>
              {/* justifySelf: la píldora es inline-flex, pero como hija de grid se
                  blockifica y llenaba los 140 px de su columna — ~100 px de relleno
                  vacío que hacían leer "ALTA" como una barra de progreso. En la
                  tabla de Reglas el mismo componente ya llevaba justifySelf. */}
              <span className={`pill ${r.severity === 'alta' ? 'pill-neg' : r.severity === 'media' ? 'pill-warn' : 'pill-neu'}`} style={{ justifySelf: 'start' }}>{r.severity || 'media'}</span>
              <span style={{ color: 'var(--text)' }}>{r.ruleName || r.rule || 'Regla'}</span>
              {/* "—", no "0". Dos líneas más arriba la misma pantalla ya usa la raya
                  para "sin dato", y un cero aquí afirma "esta activación no tocó
                  ninguna mención", que es una medición que nadie hizo. */}
              <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                {r.mentionIds?.length ? r.mentionIds.length : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============== SETTINGS ===============
function SettingsScreen() {
  // "Preferencias de alertas" se eliminó: las alertas son solo por correo, así
  // que ese módulo (stub de canales SMS/Slack en localStorage) no hacía nada.
  // Las secciones se gatean por capacidad (editor ve Plantillas, analyst/viewer
  // no; solo admin gestiona Usuarios). La sección 'plantillas' la consume la
  // gestión de plantillas de correo (ver TemplatesAdmin).
  const has = (c) => (typeof window !== 'undefined' && typeof window.ecoHasCap === 'function' ? window.ecoHasCap(c) : true);
  const allSections = [
    { k: 'usuarios', l: 'Usuarios y roles', icon: 'Users', cap: 'manage_users', render: () => <UsersAdmin /> },
    { k: 'plantillas', l: 'Plantillas de correo', icon: 'Mail', cap: 'manage_templates', render: () => <TemplatesAdmin /> },
  ];
  const sections = allSections.filter((s) => has(s.cap));
  const [section, setSection] = useState(sections[0] ? sections[0].k : null);
  const current = sections.find((s) => s.k === section) || sections[0];

  if (sections.length === 0) {
    return (
      <div className="card"><div className="card-bd" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)', padding: 'var(--sp-5)' }}>
        No tienes permisos para gestionar la configuración.
      </div></div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('220px 1fr', '1fr'), gap: 'var(--sp-5)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-05)', minWidth: 0 }}>
        {sections.map((s) => {
          const IconC = Icons[s.icon];
          return (
            <button key={s.k} onClick={() => setSection(s.k)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                padding: '9px 12px', borderRadius: 'var(--r-lg)',
                fontSize: 'var(--fs-body-sm)', fontWeight: section === s.k ? 600 : 500,
                background: section === s.k ? 'var(--accent-fill)' : 'transparent',
                color: section === s.k ? 'var(--accent)' : 'var(--text-2)',
                textAlign: 'left',
              }}>
              <IconC size={14} /> {s.l}
            </button>
          );
        })}
      </div>
      <div style={{ minWidth: 0 }}>{current ? current.render() : null}</div>
    </div>
  );
}

// --- Gestión de plantillas de correo (Configuración → Plantillas) ---
// Previsualiza los templates tal como los recibe el destinatario. El semanal se
// renderiza vía /api/reports/preview (dryRun del lambda real). Los destinatarios
// y la programación se gestionan en Alertas → Reportes por correo.
function TemplatesAdmin() {
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const agency = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.agency'))
    || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || '';

  const loadWeekly = () => {
    setLoading(true); setErr(null);
    fetch(`/api/reports/preview?agencySlug=${agency}&template=weekly`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error || ('HTTP ' + r.status)))))
      .then((j) => setHtml(j.html || ''))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  };

  return (
    <div className="card">
      <div className="card-hd"><div>
        <div className="card-hd-title">Plantillas de correo</div>
        <div className="card-hd-sub">Previsualiza los correos como los reciben los destinatarios</div>
      </div></div>
      <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)' }}>
            <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600 }}>Reporte semanal</div>
            <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', margin: '4px 0 10px' }}>Resumen ejecutivo semanal. Destinatarios y hora en Alertas → Reportes por correo.</div>
            <button className="btn btn-primary" onClick={loadWeekly} disabled={loading || !agency}>{loading ? 'Generando…' : 'Previsualizar'}</button>
          </div>
          <div style={{ flex: '1 1 240px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', padding: 'var(--sp-4)' }}>
            <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600 }}>Alerta de crisis</div>
            <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', margin: '4px 0 10px' }}>Editorial que se envía al cruzar el umbral de crisis. Configúrala en Alertas → Alertas de crisis.</div>
            <span className="pill pill-neu" style={{ fontSize: 'var(--fs-overline)' }}>Vista previa al dispararse</span>
          </div>
        </div>
        {err && <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--neg)' }}>No se pudo generar la vista previa: {err}</div>}
        {html != null && (
          <iframe title="Vista previa del correo" srcDoc={html}
            style={{ width: '100%', height: 640, border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', background: '#fff' /* el correo ES un documento blanco: no es un token que falte */ }} />
        )}
      </div>
    </div>
  );
}

// --- Users admin module ---

// Las claves coinciden con el enum del backend (admin/editor/analyst/viewer)
// para que la etiqueta de la tabla, el filtro y los radios del drawer cuadren.
const ROLES = [
  { k: 'admin',   l: 'Administrador', desc: 'Control total · gestiona usuarios, plantillas, reglas y configuración', perms: ['Usuarios', 'Plantillas', 'Reglas', 'Editar', 'Exportar'] },
  { k: 'editor',  l: 'Editor',        desc: 'Gestiona plantillas de correo y reglas de alerta; responde menciones',  perms: ['Plantillas', 'Reglas', 'Editar', 'Exportar'] },
  { k: 'analyst', l: 'Analista',      desc: 'Ve dashboards y exporta; sin edición de plantillas/reglas/usuarios',     perms: ['Exportar'] },
  { k: 'viewer',  l: 'Solo lectura',  desc: 'Vista de dashboards sin exportar ni editar',                             perms: [] },
];

// Diccionario único de estados de cuenta: lo consumen el resumen del encabezado,
// el filtro, la pill de la tabla y el select del drawer. El mismo estado se
// llamaba «invitación pendiente» (resumen), «Invitado» (filtro y pill) e
// «Invitado (pendiente)» (drawer) — cuatro nombres para una cosa. Las claves son
// los valores que produce fromApi(). `plural` es para los contadores, que no
// pluralizaban («2 invitación pendiente»). `tone` es deliberadamente
// neutro/informativo: pos/warn/neg están tomados por sentimiento y severidad
// (pill-warn ES la banda de crisis ELEVADO, ver crisisBandPill), así que una
// invitación pendiente —tramitación normal— no puede compartir ese ámbar.
const USER_STATUS = {
  activo:     { label: 'Activo',               plural: 'Activos',                 tone: 'neu' },
  invitado:   { label: 'Invitación pendiente', plural: 'Invitaciones pendientes', tone: 'info' },
  suspendido: { label: 'Suspendido',           plural: 'Suspendidos',             tone: 'neu' },
};

// Columnas de la rejilla de «Roles disponibles». Vive fuera del render porque de
// ella se derivan los filetes de cada celda (ver el map): decidirlos por índice
// del array (`i < ROLES.length - 1`) es una regla escrita para 4 columnas, y en
// el 2×2 de móvil pintaba un borde encima del borde del card.
const roleGridCols = () => (window.ecoIsMobile() ? 2 : 4);

// Páginas del menú para el control de visibilidad por-usuario (allowed_pages).
// Las claves coinciden con NAV/SYSTEM_NAV en shell.js.
const PAGE_OPTIONS = [
  // Mismo orden que getNav() en shell.js — esta rejilla promete espejar el menú
  // ("Controla qué páginas ve este usuario en el menú"), así que si diverge el
  // admin marca casillas en un orden y el usuario ve otro.
  { k: 'overview', l: 'Overview' },
  { k: 'topics', l: 'Tópicos' },
  { k: 'narrative', l: 'Narrativas' },
  { k: 'dashboard', l: 'Scorecard' },
  { k: 'mentions', l: 'Menciones' },
  { k: 'sentiment', l: 'Sentimiento' },
  { k: 'geography', l: 'Geografía' },
  { k: 'alerts', l: 'Alertas' },
  { k: 'settings', l: 'Configuración' },
];

function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [drawer, setDrawer] = useState(null); // { mode: 'create' | 'edit', user }
  const [error, setError] = useState(null);

  const [agencyOptions, setAgencyOptions] = useState([]);
  React.useEffect(() => {
    fetch('/api/agencies', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setAgencyOptions(Array.isArray(list) ? list.map((a) => ({ slug: a.slug, name: a.name })) : []))
      .catch(() => {});
  }, []);

  // Map API row -> UI shape so existing render logic keeps working.
  const fromApi = (u) => ({
    id: u.id,
    name: u.name || u.email.split('@')[0],
    email: u.email,
    role: u.role, // 'admin' | 'editor' | 'analyst' | 'viewer'
    allAgencies: !!u.allAgencies,
    agencySlugs: Array.isArray(u.agencies) ? u.agencies : [],
    // null = ve todas las páginas que su rol permita; array = solo esas páginas.
    allowedPages: Array.isArray(u.allowedPages) ? u.allowedPages : null,
    // Display label for the Agencia column.
    agency: u.allAgencies ? 'Todas' : (Array.isArray(u.agencies) && u.agencies.length ? u.agencies.join(', ') : '—'),
    status: u.isActive ? (u.lastLogin ? 'activo' : 'invitado') : 'suspendido',
    lastSeen: window.ecoFmtDateTime(u.lastLogin),
    // Sin campo `avatar`: el color ya no depende del correo. La paleta
    // categórica se asigna EN ORDEN (data.js) y su último token es el gris de
    // «resto/otros», así que repartirla por hash del correo hacía que un
    // administrador saliera con el color de «otros». Ver <Avatar> en shell.js.
  });

  // Las claves de ROLES ya coinciden con el enum del backend; solo validamos.
  const roleToApi = (r) => (['admin', 'editor', 'analyst', 'viewer'].includes(r) ? r : 'viewer');

  const refresh = React.useCallback(() => {
    setLoading(true);
    fetch('/api/users', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then((j) => { setUsers((j.users || []).map(fromApi)); setError(null); })
      .catch((e) => setError(e.message || 'Error cargando usuarios'))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (query && !u.name.toLowerCase().includes(query.toLowerCase()) && !u.email.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: users.length,
    activos: users.filter(u => u.status === 'activo').length,
    invitados: users.filter(u => u.status === 'invitado').length,
    suspendidos: users.filter(u => u.status === 'suspendido').length,
  };

  const saveUser = async (u) => {
    try {
      if (u.id && users.find((x) => x.id === u.id)) {
        // Edit: PATCH
        await fetch('/api/users/' + encodeURIComponent(u.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            name: u.name,
            role: roleToApi(u.role),
            isActive: u.status !== 'suspendido',
            allAgencies: !!u.allAgencies,
            agencySlugs: u.agencySlugs || [],
            allowedPages: u.allowedPages ?? null,
          }),
        });
      } else {
        // Create: POST
        await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            email: u.email,
            name: u.name,
            role: roleToApi(u.role),
            allAgencies: !!u.allAgencies,
            agencySlugs: u.agencySlugs || [],
            allowedPages: u.allowedPages ?? null,
          }),
        });
      }
      setDrawer(null);
      refresh();
      (window.ecoToast || (() => {}))('ok', 'Usuario guardado');
    } catch (e) {
      (window.ecoToast || (() => {}))('err', 'No se pudo guardar: ' + (e.message || e));
    }
  };

  const deleteUser = async (id) => {
    const confirmed = window.ecoConfirm
      ? await window.ecoConfirm('¿Suspender este usuario? Podrás reactivarlo después.')
      : confirm('¿Suspender este usuario? Podrás reactivarlo después.');
    if (!confirmed) return;
    try {
      await fetch('/api/users/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      setDrawer(null);
      refresh();
      (window.ecoToast || (() => {}))('ok', 'Usuario suspendido');
    } catch (e) {
      (window.ecoToast || (() => {}))('err', 'No se pudo eliminar: ' + (e.message || e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Header */}
      <div className="card">
        <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-title-md)', fontWeight: 700, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)' }}>
              Equipo
            </div>
            {/* «Cuántas cuentas y en qué estado» son los únicos números de la
                pantalla, y estaban en el texto más chico y más apagado de la
                vista, leyéndose como pie de foto. Van como cifras (.num +
                --fs-num-md en --text) con el rótulo en el overline, igual que
                QuickMetric. Los segmentos en cero no se imprimen: «0
                suspendidos» pesaba lo mismo que un estado que sí existe. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)', marginTop: 'var(--sp-2)' }}>
              {[['Total', stats.total, true],
                [USER_STATUS.activo.plural, stats.activos, false],
                [USER_STATUS.invitado.plural, stats.invitados, false],
                [USER_STATUS.suspendido.plural, stats.suspendidos, false]]
                .filter(([, n, always]) => always || n > 0)
                .map(([l, n]) => (
                  <div key={l}>
                    <div className="num" style={{ fontSize: 'var(--fs-num-md)', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1.1 }}>{n}</div>
                    <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)' }}>{l}</div>
                  </div>
                ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setDrawer({ mode: 'create', user: { name: '', email: '', role: 'analista', allAgencies: false, agencySlugs: [], status: 'invitado', notify: true } })}>
            <Icons.Plus size={13} /> Invitar usuario
          </button>
        </div>
        <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 18px', display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Mismo patrón que el buscador de Menciones (icono absoluto + .input,
              ver más arriba en este archivo): el <input> desnudo dentro de un div
              a mano no lo alcanzaba el piso táctil de 44px, porque el media query
              apunta a la clase .input y no al elemento input. */}
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
            <Icons.Search size={14} color="var(--text-3)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o correo…" style={{ paddingLeft: 34 }} />
          </div>
          <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={{ width: 170 }}>
            <option value="all">Todos los roles</option>
            {ROLES.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 170 }}>
            <option value="all">Todos los estados</option>
            {Object.keys(USER_STATUS).map((k) => <option key={k} value={k}>{USER_STATUS[k].label}</option>)}
          </select>
        </div>
      </div>

      {/* Roles at a glance */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Roles disponibles</div><div className="card-hd-sub">Permisos configurados a nivel de plataforma</div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${roleGridCols()}, 1fr)`, gap: 0, borderTop: '1px solid var(--hairline)' }}>
          {ROLES.map((r, i) => (
            <div key={r.k} style={{
              padding: 'var(--sp-4)',
              // Los filetes se derivan de la POSICIÓN en la rejilla, no del
              // índice del array: la última celda de cada fila no lleva borde
              // derecho (antes duplicaba el borde del card en el 2×2 de móvil) y
              // las filas se separan con borderBottom (antes las cuatro celdas se
              // leían como dos columnas de texto corrido).
              borderRight: (i + 1) % roleGridCols() !== 0 ? '1px solid var(--hairline)' : 'none',
              borderBottom: i < ROLES.length - roleGridCols() ? '1px solid var(--hairline)' : 'none',
              display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)' }}>{r.l}</div>
                {/* El conteo REAL. `ROLES` no define `count`, así que el hueco existía
                    en la maqueta y salía siempre vacío: las cuatro cards eran
                    documentación estática y no decían cuántos usuarios tiene cada
                    rol — el dato que ya está calculado aquí al lado. */}
                <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
                  {users.filter((u) => u.role === r.k).length}
                </div>
              </div>
              <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', lineHeight: 1.45 }}>{r.desc}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>
                {/* Vacío EXPLÍCITO: "Solo lectura" tiene `perms: []` y dejaba la celda
                    en blanco, así que de las cuatro cards una tenía otra estructura y
                    el blanco se leía como "falta el dato" en vez de "no tiene
                    permisos de edición". */}
                {r.perms.length === 0 ? (
                  <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontStyle: 'italic' }}>
                    Sin permisos de edición
                  </span>
                ) : r.perms.map(p => (
                  <span key={p} className="pill" style={{ fontSize: 'var(--fs-overline)', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Usuarios</div><div className="card-hd-sub">{filtered.length} resultados</div></div></div>
        <div className="scroll-x">
          {/* El encabezado de la rejilla no se pinta en móvil: allí las filas se
              renderizan apiladas (UserRowCard) y esta banda de 740px sólo habría
              mostrado «USUARIO AGENCIA…» sin las columnas correspondientes. */}
          <div className="hide-mobile" style={{
            // Cada columna al LARGO de su dato, que aquí estaba invertido: la
            // agencia es un slug de seis letras («ddecpr») y se llevaba 196px de
            // los 923 del card, mientras la marca de tiempo —138px en mono 11px,
            // 151px en 12px— vivía en 110px y envolvía a dos renglones en cada
            // fila con login. La fecha pasa a su ancho medido
            // (--w-col-datetime), la agencia baja a 1fr (~149px: «Todas» o dos
            // slugs), ESTADO sube a 130px porque «Invitación pendiente» no cabe
            // en 110 (y en mayúsculas se derramaba sobre la fecha), y el chevron
            // a 32px porque el glifo mide 14. El piso de scroll sube de 740 a
            // 820: las columnas fijas crecieron 70px y con el piso viejo el
            // aumento lo pagaba entero el nombre del usuario.
            display: 'grid', gridTemplateColumns: '1.6fr 1fr 110px 130px var(--w-col-datetime) 32px', minWidth: 820, gap: 'var(--sp-3)',
            padding: '10px 18px', borderTop: '1px solid var(--hairline)',
            // Mismo eje vertical que las filas de datos (que sí llevan
            // alignItems): sin esto, el rótulo de dos líneas estiraba la banda a
            // 49px y las otras cuatro etiquetas quedaban pegadas arriba con ~24px
            // de vacío debajo — en móvil, además, la columna que provocaba el
            // salto de línea estaba fuera de pantalla y la banda alta parecía un
            // error de render.
            alignItems: 'center',
            fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)',
            background: 'var(--canvas-2)',
          }}>
            {/* Rol y Estado son pills: su texto arranca 9px dentro de la celda
                (1px de borde + los 8px de padding de .pill), así que sus
                encabezados llevan el mismo desplazamiento — si no, el eje se
                rompe en dos de cinco columnas. «Actividad» en vez de «Última
                actividad» para que la banda no salte a dos líneas en 110px. */}
            <div>Usuario</div><div>Agencia</div><div style={{ paddingLeft: 9 }}>Rol</div><div style={{ paddingLeft: 9 }}>Estado</div><div title="Última actividad registrada">Actividad</div><div></div>
          </div>
          {filtered.map((u, idx) => {
            const roleMeta = ROLES.find(r => r.k === u.role);
            // En un teléfono la rejilla de 740px sólo cabe al 44% (~329px útiles)
            // y ESTADO queda fuera del scroll-x, así que la misma información se
            // apila. Mismo corte (768px) que las media queries de index.html.
            if (window.ecoIsMobile()) return <UserRowCard key={u.id} u={u} roleMeta={roleMeta} onOpen={() => setDrawer({ mode: 'edit', user: u })} />;
            // Los estados de cuenta NO son severidad: en este producto pill-warn
            // es a la vez sentimiento neutral y la banda de crisis ELEVADO, y
            // pill-neg es prioridad alta. Una invitación pendiente es tramitación
            // normal. El nombre y el tono (neu/info) salen de USER_STATUS.
            const st = USER_STATUS[u.status] || { label: u.status, tone: 'neu' };
            return (
              <div key={u.id}
                onClick={() => setDrawer({ mode: 'edit', user: u })}
                className="row-hover"
                style={{
                  // Mismo reparto que la banda de encabezado (el por qué está
                  // allí): son dos literales gemelos y si se separan los rótulos
                  // dejan de caer sobre sus columnas.
                  display: 'grid', gridTemplateColumns: '1.6fr 1fr 110px 130px var(--w-col-datetime) 32px', minWidth: 820, gap: 'var(--sp-3)',
                  padding: '12px 18px', alignItems: 'center', cursor: 'pointer',
                  borderTop: '1px solid var(--hairline)',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
                  <Avatar name={u.name} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                    <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                  </div>
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>{u.agency}</div>
                <div>
                  <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text)', padding: '3px 8px', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-pill)' }}>
                    {roleMeta?.l || u.role}
                  </span>
                </div>
                <div><span className={`pill pill-${st.tone} pill-name`}>{u.status === 'suspendido' && <span className="dot" style={{ background: 'var(--neg)' }} />}{st.label}</span></div>
                {/* 12px, no 11: tokens.css declara --fs-caption como el PISO de «metadatos,
                    marcas de tiempo» y reserva --fs-overline para eyebrows en
                    mayúsculas y ticks de eje densos — esto es una fecha en
                    minúsculas. En móvil este mismo dato ya salía a 12px
                    (UserRowCard), o sea que había dos tamaños para la misma fecha
                    según el ancho de la pantalla. */}
                <div className="mono" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{u.lastSeen}</div>
                <Icons.ChevronRight size={14} color="var(--text-3)" />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)', borderTop: '1px solid var(--hairline)' }}>
              Sin resultados · ajusta los filtros o <button onClick={() => { setQuery(''); setRoleFilter('all'); setStatusFilter('all'); }} style={{ color: 'var(--accent)', fontWeight: 600 }}>limpiar filtros</button>
            </div>
          )}
        </div>
      </div>

      {drawer && <UserDrawer drawer={drawer} agencyOptions={agencyOptions} onSave={saveUser} onDelete={deleteUser} onClose={() => setDrawer(null)} />}
    </div>
  );
}

// Fila de usuario en móvil. La tabla de arriba declara minWidth 740 y en un
// teléfono sólo hay ~329px útiles: ESTADO y ÚLTIMA ACTIVIDAD quedaban fuera del
// scroll-x, o sea que un admin no podía ver desde el móvil quién está
// suspendido. Aquí el estado viaja junto al nombre —es el dato operativo— y
// Agencia/Rol/Actividad bajan a pares etiqueta-valor.
function UserRowCard({ u, roleMeta, onOpen }) {
  const st = USER_STATUS[u.status] || { label: u.status, tone: 'neu' };
  return (
    <div className="row-hover" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', padding: '12px 18px', borderTop: '1px solid var(--hairline)', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', minWidth: 0 }}>
        <Avatar name={u.name} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
        </div>
        <span className={`pill pill-${st.tone} pill-name`} style={{ flexShrink: 0 }}>
          {u.status === 'suspendido' && <span className="dot" style={{ background: 'var(--neg)' }} />}
          {st.label}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--sp-1) var(--sp-3)', paddingLeft: 42 }}>
        {[['Agencia', u.agency], ['Rol', roleMeta?.l || u.role], ['Actividad', u.lastSeen]].map(([l, v]) => (
          <div key={l} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)' }}>{l}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserDrawer({ drawer, agencyOptions = [], onSave, onDelete, onClose }) {
  const [form, setForm] = useState(drawer.user);

  // Cerrar con Escape (mismo patrón que CommandPalette).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isCreate = drawer.mode === 'create';
  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const valid = form.name.trim() && /@/.test(form.email);

  const submit = () => {
    if (!valid) return;
    onSave(form);
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div style={{ flex: 1 }}>
            <div className="section-eyebrow" style={{ margin: 0 }}>{isCreate ? 'Invitar usuario' : 'Editar usuario'}</div>
            <div style={{ fontSize: 'var(--fs-title-lg)', fontWeight: 700, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', marginTop: 'var(--sp-05)' }}>
              {isCreate ? 'Nuevo miembro del equipo' : form.name}
            </div>
          </div>
          <button aria-label="Cerrar" className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          {/* Identity */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Identidad</div>
            <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 1fr', '1fr'), gap: 'var(--sp-3)' }}>
              <Field label="Nombre completo" required>
                <input value={form.name} onChange={(e) => setField('name', e.target.value)}
                  placeholder="María Santos"
                  className="input" />
              </Field>
              <Field label="Correo institucional" required>
                <input value={form.email} onChange={(e) => setField('email', e.target.value)}
                  placeholder="nombre@agencia.pr.gov"
                  className="input" />
              </Field>
              <Field label="Estado">
                <select className="input" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                  {Object.keys(USER_STATUS).map((k) => <option key={k} value={k}>{USER_STATUS[k].label}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Agencies the user can switch between */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Agencias visibles</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.allAgencies}
                onChange={(e) => setField('allAgencies', e.target.checked)} />
              <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text)' }}>Todas las agencias <span style={{ color: 'var(--text-3)' }}>(staff Populicom)</span></span>
            </label>
            {!form.allAgencies && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)', paddingLeft: 2 }}>
                {agencyOptions.length === 0 && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>No hay agencias disponibles para asignar.</div>
                )}
                {agencyOptions.map((a) => {
                  const checked = (form.agencySlugs || []).includes(a.slug);
                  return (
                    <label key={a.slug} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => {
                          const cur = new Set(form.agencySlugs || []);
                          if (e.target.checked) cur.add(a.slug); else cur.delete(a.slug);
                          setField('agencySlugs', [...cur]);
                        }} />
                      <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text)' }}>{a.name} <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>({a.slug})</span></span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Role picker */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Rol y permisos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              {ROLES.map(r => {
                const selected = form.role === r.k;
                return (
                  <label key={r.k} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)',
                    padding: 'var(--sp-3)', borderRadius: 'var(--r-lg)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--hairline)'}`,
                    background: selected ? 'var(--accent-fill)' : 'var(--canvas)',
                    cursor: 'pointer',
                  }}>
                    <input type="radio" name="role" checked={selected} onChange={() => setField('role', r.k)} style={{ marginTop: 'var(--sp-05)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                        <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)' }}>{r.l}</div>
                        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                          {r.perms.map(p => <span key={p} className="pill" style={{ fontSize: 'var(--fs-overline)', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>{p}</span>)}
                        </div>
                      </div>
                      <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', marginTop: 'var(--sp-1)', lineHeight: 1.5 }}>{r.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Page visibility — qué páginas ve este usuario (override por-usuario).
              Reemplaza el mockup "Alcance de datos" (checkboxes muertos con
              agencias ficticias) por el control real de mostrar/esconder páginas. */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Páginas visibles</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.allowedPages == null}
                onChange={(e) => setField('allowedPages', e.target.checked ? null : PAGE_OPTIONS.map((p) => p.k))} />
              <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text)' }}>Todas las páginas <span style={{ color: 'var(--text-3)' }}>(según su rol)</span></span>
            </label>
            {form.allowedPages != null && (
              <div style={{ padding: 'var(--sp-3)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', display: 'grid', gridTemplateColumns: window.ecoCols('repeat(2, 1fr)', '1fr'), gap: 'var(--sp-2)' }}>
                {PAGE_OPTIONS.map((p) => {
                  const locked = p.k === 'overview'; // overview siempre visible (landing)
                  const checked = locked || (form.allowedPages || []).includes(p.k);
                  return (
                    <label key={p.k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--text)', opacity: locked ? 0.6 : 1 }}>
                      <input type="checkbox" checked={checked} disabled={locked}
                        onChange={(e) => {
                          const cur = new Set(form.allowedPages || []);
                          if (e.target.checked) cur.add(p.k); else cur.delete(p.k);
                          setField('allowedPages', [...cur]);
                        }} />
                      {p.l}
                    </label>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginTop: 'var(--sp-15)' }}>Controla qué páginas ve este usuario en el menú. "Todas" = sin restricción (su rol decide). Overview siempre visible. Las páginas de Configuración además requieren el permiso del rol.</div>
          </div>

          {/* Sin "Actividad reciente": el bloque que estaba aquí mostraba un
              registro de auditoría INVENTADO (cuatro entradas fijas con la IP
              10.24.1.18), idéntico para todos los usuarios. No existe tabla de
              auditoría; cuando exista, se reconstruye leyéndola. */}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 'var(--sp-2)', paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={submit} disabled={!valid}>
              <Icons.Check size={13} /> {isCreate ? 'Enviar invitación' : 'Guardar cambios'}
            </button>
            {!isCreate && (
              <button className="btn" style={{ color: 'var(--neg)' }} onClick={() => onDelete(form.id)}>
                <Icons.Trash size={13} /> Eliminar
              </button>
            )}
            <button className="btn" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </>
  );
}

// `inputStyle` se eliminó: era .input copiado en un objeto inline, y por no ser
// la clase se le escapaba el piso táctil de 44px (el media query apunta a
// .input), así que los campos del drawer quedaban a 34px junto a un select de 44.

function Field({ label, required, children }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginBottom: 'var(--sp-15)' }}>
        {label} {required && <span style={{ color: 'var(--neg)' }}>*</span>}
      </div>
      {children}
    </div>
  );
}

// =============== OVERVIEW ===============
// Las filas de tópico son clickeables: abren el slice modal con topicMode=primary
// (top-confidence) por defecto, con un toggle "+ Incluir secundarias" para ver
// el conteo multi-clasificación.
// ============================================================
// OverviewScreen — la Overview con la forma del correo [Diario] (sep-2026).
// ============================================================
// Petición del sponsor: que el dashboard se lea como el correo. Mismo orden y
// mismos rótulos que el Diario, con el detalle que el correo no puede dar:
//   cabecera · 01 Termómetro · 02 Riesgo de crisis · 03 Resumen del periodo ·
//   04 Tendencia (14 días, picos rotulados, crisis diaria) · 05 Insights ·
//   06 Tópicos.
// Las cifras salen de las MISMAS funciones que el correo (buildSentimentReport
// y loadMetricsForWindow vía /api/overview); el texto de 03 y 05 sale de
// overview_period_insights (/api/eco-insights), que genera eco-ai-tasks con
// el mismo esquema de lede que el correo: titular, párrafo y viñetas.

// Polling del análisis IA (cache-or-202). Rampa: 2s los primeros 20s, 4s
// después; ~27 peticiones en 90s, bajo el rate limit de 30/min del endpoint.
const OVERVIEW_LEDE_VERSION = 2;
function useOverviewInsights(periodStart, periodEnd, agency) {
  const [state, setState] = React.useState({ phase: 'loading', data: null, error: null });
  React.useEffect(() => {
    if (!periodStart || !periodEnd) return;
    setState({ phase: 'loading', data: null, error: null });
    const startedAt = Date.now();
    const MAX_POLL_MS = 90 * 1000;
    const ctrl = new AbortController();
    let timer = null;
    async function fetchOnce() {
      const params = new URLSearchParams({ from: periodStart, to: periodEnd });
      if (agency) params.set('agency', agency);
      try {
        const res = await fetch('/api/eco-insights?' + params.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal });
        if (res.status === 202) { setState((s) => ({ ...s, phase: 'computing' })); return 'computing'; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ phase: 'error', data: null, error: body.error || `HTTP ${res.status}` });
          return 'error';
        }
        const json = await res.json();
        setState({ phase: 'ready', data: json, error: null });
        // Fila sin lede o con lede de una versión anterior: el endpoint ya
        // disparó el recálculo; seguimos consultando hasta que llegue el
        // vigente (OVERVIEW_LEDE_VERSION, la misma que /api/eco-insights).
        const outdated = json && json.dailySummary && (json.lede == null || Number(json.lede.v || 1) < OVERVIEW_LEDE_VERSION);
        return outdated ? 'computing' : 'ready';
      } catch (e) {
        if (e?.name === 'AbortError') return 'aborted';
        setState({ phase: 'error', data: null, error: String(e?.message || e) });
        return 'error';
      }
    }
    async function loop() {
      const status = await fetchOnce();
      if (status !== 'computing') return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_POLL_MS) {
        setState((s) => (s.phase === 'ready' ? s : { phase: 'error', data: null, error: 'Timeout esperando insights (>90s)' }));
        return;
      }
      timer = setTimeout(loop, elapsed < 20_000 ? 2_000 : 4_000);
    }
    loop();
    return () => { ctrl.abort(); if (timer) clearTimeout(timer); };
  }, [periodStart, periodEnd, agency]);
  return state;
}

// Las publicaciones de más interacción de la ventana, del MISMO endpoint que
// el modal y el feed (/api/eco-mentions, universo pertinente) para que el
// click abra el MentionDrawer con la forma que espera.
function useTopPieces(periodStart, periodEnd, agency) {
  const [items, setItems] = React.useState(null);
  React.useEffect(() => {
    if (!periodStart || !periodEnd) return;
    setItems(null);
    const params = new URLSearchParams({ from: periodStart, to: periodEnd, sortBy: 'engagement', limit: '5' });
    if (agency) params.set('agency', agency);
    const ctrl = new AbortController();
    fetch('/api/eco-mentions?' + params.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((j) => setItems(Array.isArray(j.mentions) ? j.mentions : []))
      .catch((e) => { if (e?.name !== 'AbortError') setItems([]); });
    return () => ctrl.abort();
  }, [periodStart, periodEnd, agency]);
  return items;
}

function OverviewScreen({ period, agency, onMentionClick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [slice, setSlice] = useState(null);

  useEffect(() => {
    setData(null); setError(null);
    const params = new URLSearchParams({ period: period || '7D' });
    if (agency) params.set('agency', agency);
    // Rango personalizado: cuando period === 'custom', el FilterBar habrá
    // guardado eco.from/eco.to en localStorage; los pasamos al API para que
    // sobrescriba la ventana derivada del period.
    if (period === 'custom') {
      const from = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.from')) || '';
      const to = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.to')) || '';
      if (from && to) { params.set('from', from); params.set('to', to); }
    }
    const ctrl = new AbortController();
    fetch('/api/overview?' + params.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => { if (e?.name !== 'AbortError') setError(String(e?.message || e)); });
    return () => ctrl.abort();
  }, [period, agency]);

  const insights = useOverviewInsights(data?.periodStart, data?.periodEnd, agency);
  const pieces = useTopPieces(data?.periodStart, data?.periodEnd, agency);

  // El fallo va por EmptyState reason="error" (shell.js: «Nunca se debe
  // pintar como vacío»); la carga, con el tamaño de los otros «Cargando…» de
  // pantalla completa.
  if (error) {
    return (
      <div className="card">
        <EmptyState reason="error" title="No se pudo cargar el Overview" detail={error} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card" style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
        Cargando…
      </div>
    );
  }

  function openSentimentSlice(name, count) {
    const map = { negativo: 'Negativo', neutral: 'Neutral', positivo: 'Positivo' };
    const accent = name === 'positivo' ? 'var(--pos)' : name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    setSlice({
      eyebrow: 'Sentimiento',
      title: `Menciones ${map[name].toLowerCase()}`,
      accent,
      volume: count,
      mentions: [],
      // Ventana del termómetro (/api/overview: cerrada, universo pertinente —
      // el mismo default del modal).
      _filter: { from: data.periodStart, to: data.periodEnd, sentiment: name },
    });
  }

  // Click en un día de la tendencia: el modal con las menciones de ESE día
  // (day = YYYY-MM-DD en TZ PR, lo interpreta /api/eco-mentions).
  function openDaySlice(d) {
    if (!d || !d.fullDate) return;
    const total = (d.negative || 0) + (d.neutral || 0) + (d.positive || 0);
    const bias = (d.negative || 0) > (d.positive || 0) ? 'negativo'
      : (d.positive || 0) > (d.negative || 0) ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)';
    setSlice({
      eyebrow: d.date || d.fullDate,
      title: `Conversación del día`,
      accent,
      volume: total,
      sentiment: { pos: d.positive || 0, neu: d.neutral || 0, neg: d.negative || 0 },
      mentions: [],
      _filter: { day: d.fullDate },
    });
  }

  // Ventana de UN día (granularity 'hour'): el filtro combina day + hour.
  function openHourSlice(d) {
    if (!d || !d.fullHour) return;
    const total = (d.negative || 0) + (d.neutral || 0) + (d.positive || 0);
    const bias = (d.negative || 0) > (d.positive || 0) ? 'negativo'
      : (d.positive || 0) > (d.negative || 0) ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)';
    const hh = d.fullHour.slice(11, 13);
    setSlice({
      eyebrow: `${d.fullHour.slice(0, 10)} · ${hh}:00 – ${hh}:59`,
      title: 'Conversación de la hora',
      accent,
      volume: total,
      sentiment: { pos: d.positive || 0, neu: d.neutral || 0, neg: d.negative || 0 },
      mentions: [],
      _filter: { day: d.fullHour.slice(0, 10), hour: Number(hh) },
    });
  }

  function openMetricInsight(metric, value, accent) {
    const labels = {
      crisis: 'Riesgo de crisis',
      polarization: 'Polarización',
      nss: 'Net Sentiment Score',
      bhi: 'Brand Health',
      volume: 'Volumen',
    };
    const filter = metric === 'crisis' ? { sentiment: 'negativo', pertinence: 'alta' } : {};
    openMetricInsightShared(setSlice, {
      metric,
      value,
      accent,
      label: labels[metric] || metric,
      periodLabel: data?.periodLabel,
      periodStart: data?.periodStart,
      periodEnd: data?.periodEnd,
      agency,
      subcomponents: [],
      filter,
    });
  }

  const lede = insights.phase === 'ready' ? (insights.data?.lede || null) : null;

  return (
    // --gap-section: la separación declarada entre bloques numerados del
    // Overview (tokens.css).
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)' }}>
      <OverviewHero data={data} />
      <OverviewTermometro totals={data.totals} deltas={data.deltaVsPrev} onSliceClick={openSentimentSlice} />
      <OverviewHighlights metrics={data.currentMetrics} crisis={data.crisis} onOpenInsight={openMetricInsight} />
      <OverviewResumen insights={insights} pieces={pieces} onMentionClick={onMentionClick} />
      <OverviewTendencia
        dailySeries={data.dailySeries}
        prevDailySeries={data.prevDailySeries}
        hourlySeries={data.hourlySeries}
        granularity={data.trendGranularity}
        crisisDaily={data.crisis?.daily}
        peaks={lede?.peaks || []}
        onDayClick={openDaySlice}
        onHourClick={openHourSlice}
      />
      <OverviewInsights insights={insights} totals={data.totals} />
      <OverviewTopicos
        rows={data.topicsTable}
        totals={data.totals}
        onTopicClick={(row) => {
          // La tabla viene de buildSentimentReport (la del correo), que solo
          // expone el name; el slug se resuelve contra D.TOPICS.
          const topic = (D.TOPICS || []).find((t) => t.name === row.topic);
          if (!topic) return;
          const palette = window.ECO_CAT;
          const slugIdx = {};
          (D.TOPICS || []).forEach((tp, i) => { slugIdx[tp.slug] = i; });
          const accent = palette[(slugIdx[topic.slug] || 0) % palette.length] || 'var(--accent)';
          setSlice({
            eyebrow: 'Tópico',
            title: topic.name,
            accent,
            mentions: [],
            // Misma ventana y universo que la fila (cerrada, primario).
            _filter: { from: data.periodStart, to: data.periodEnd, topic: topic.slug },
          });
        }}
      />
      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

// Número de sección del Overview: el mismo «NN · Rótulo» del correo.
function OverviewEyebrow({ n, children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <div className="section-eyebrow" style={{ marginBottom: 0 }}>{n} · {children}</div>
      {right}
    </div>
  );
}

function OverviewHero({ data }) {
  const total = data.totals.total || 0;
  const days = (data.dailySeries || []).length;
  const ag = data.agency;
  // Cabecera del correo: siglas · nombre, «Conversación pública, <periodo>» y
  // la línea de metadatos. Sin padding propio: el H1 cae en el mismo eje
  // vertical que el borde de las cards.
  return (
    <div>
      {ag && (
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body-sm)', marginBottom: 'var(--sp-05)' }}>
          {ag.shortName} · {ag.name}
        </div>
      )}
      <h1 style={{
        fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display-lg)', fontWeight: 600,
        lineHeight: 1.2, margin: '0 0 4px', letterSpacing: 'var(--letter-display)',
        color: 'var(--text)', textWrap: 'balance',
      }}>
        Conversación pública, {data.periodLabel || (data.periodStart + ' → ' + data.periodEnd)}
      </h1>
      <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
        {total > 0
          ? <><span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{total.toLocaleString('es-PR')}</span> menciones · {days} {days === 1 ? 'día cerrado' : 'días cerrados'}</>
          : <>Sin menciones registradas en la ventana seleccionada.</>}
      </div>
    </div>
  );
}

function OverviewTermometro({ totals, deltas, onSliceClick }) {
  // Defensa contra payload incompleto: sin `totals` la tarjeta se dibuja en
  // cero en vez de tumbar la pantalla al error boundary.
  const T = totals || {};
  const D = deltas || {};
  const t = T.total || 1;
  const cards = [
    { name: 'Negativo', sentKey: 'negativo', value: T.negative, delta: D.negative, accent: 'var(--neg)', deltaMetric: 'negativeCount' },
    { name: 'Neutral',  sentKey: 'neutral',  value: T.neutral,  delta: D.neutral,  accent: 'var(--neu)', invert: false },
    { name: 'Positivo', sentKey: 'positivo', value: T.positive, delta: D.positive, accent: 'var(--pos)', deltaMetric: 'positiveCount' },
  ];
  const share = (v) => (T.total > 0 ? ((v || 0) / t) * 100 : 0);
  return (
    <div>
      <OverviewEyebrow n="01">Termómetro · vs ventana previa</OverviewEyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(3, 1fr)', '1fr'), gap: 'var(--sp-3)' }}>
        {cards.map((c) => {
          const pct = T.total > 0 ? Math.round(((c.value || 0) / t) * 100) : 0;
          // La dirección del delta la decide DeltaBadge (ECO_METRIC_DIRECTION).
          return (
            <button key={c.name}
              onClick={() => onSliceClick && onSliceClick(c.sentKey, c.value)}
              className="card row-hover"
              style={{
                padding: 'var(--sp-4)', textAlign: 'left',
                cursor: 'pointer', border: '1px solid var(--hairline)',
                background: 'var(--canvas)',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.accent }} />
                <div className="t-overline">{c.name}</div>
                <Icons.ArrowRight size={11} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                  {fmt(c.value)}
                </div>
                <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', fontWeight: 600 }}>{pct}%</div>
              </div>
              <div style={{ marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                <DeltaBadge value={c.delta} metricKey={c.deltaMetric || 'volume'} />
              </div>
            </button>
          );
        })}
      </div>
      {/* La barra de mezcla del correo («Menciones · 7 días vs 7 previos»):
          las tres cards en una sola regla, en el orden canónico del producto
          (negativo → neutral → positivo, como en el correo). */}
      {T.total > 0 && (
        <div role="img" aria-label={`Mezcla del periodo: ${Math.round(share(T.negative))}% negativo, ${Math.round(share(T.neutral))}% neutral, ${Math.round(share(T.positive))}% positivo`}
          style={{ display: 'flex', height: 8, borderRadius: 'var(--r-sm)', overflow: 'hidden', marginTop: 'var(--sp-3)', background: 'var(--canvas-2)' }}>
          <span style={{ width: `${share(T.negative)}%`, background: 'var(--neg)' }} />
          <span style={{ width: `${share(T.neutral)}%`, background: 'var(--neu)' }} />
          <span style={{ flex: 1, background: 'var(--pos)' }} />
        </div>
      )}
    </div>
  );
}

// 02 · Riesgo de crisis — la métrica de la VENTANA (la misma del correo, con
// su cambio en puntos contra la ventana previa), la escala por bandas y tres
// datos de apoyo: el pico diario, el cierre del último día y la ventana
// previa. Clickable: abre MetricInsightModal.
function OverviewHighlights({ metrics, crisis, onOpenInsight }) {
  const m = metrics || {};
  const C = crisis || {};
  const score = C.window != null ? C.window : m.crisisRiskScore;
  if (score == null) return null;
  const cb = crisisBand(score);
  const cd = (m.display && m.display.crisis) || null;
  const word = cd ? cd.word : cb.label;
  const pctOf = (v) => Math.round(v * 100);
  const valueLabel = cd && cd.value ? cd.value : (pctOf(score) + '%');
  // Cambio en puntos, invertido (subir la crisis es malo) — mismo formato que
  // el correo: «▲ +21 pts».
  const deltaPts = C.prevWindow != null ? pctOf(score) - pctOf(C.prevWindow) : null;
  const dayLabel = (ymd) => {
    const hit = ymd ? new Date(ymd + 'T12:00:00') : null;
    return hit ? hit.toLocaleDateString('es-PR', { weekday: 'short', day: 'numeric' }).replace('.', '') : '';
  };
  const rows = [
    C.peak && { k: `Pico diario · ${dayLabel(C.peak.date)}`, v: pctOf(C.peak.score) + '%', color: crisisBand(C.peak.score).color },
    C.last && (!C.peak || C.last.date !== C.peak.date) && { k: `Cierre del ${dayLabel(C.last.date)}`, v: pctOf(C.last.score) + '%' },
    C.prevWindow != null && { k: 'Ventana previa', v: pctOf(C.prevWindow) + '%' },
  ].filter(Boolean);
  const mobile = window.ecoIsMobile();
  const divider = mobile
    ? { paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--hairline)' }
    : { paddingLeft: 'var(--sp-4)', borderLeft: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', justifyContent: 'center' };
  return (
    <button
      onClick={() => onOpenInsight && onOpenInsight('crisis', valueLabel, 'var(--neg)')}
      className="card row-hover"
      style={{
        padding: 'var(--sp-4)',
        display: 'grid', gridTemplateColumns: window.ecoCols(rows.length ? '1fr 1.3fr 1fr' : '1fr 2fr', '1fr'), gap: 'var(--sp-4)', alignItems: 'stretch',
        cursor: 'pointer', border: '1px solid var(--hairline)', background: 'var(--canvas)',
        textAlign: 'left', width: '100%',
      }}
      title="Ver insight del riesgo de crisis para el periodo">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-15)' }}>
          <Icons.Shield size={14} color="var(--neg)" />
          <div className="card-hd-title">02 · Riesgo de crisis</div>
          <Icons.ArrowRight size={11} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: cb.color, fontFamily: 'var(--ff-display)', lineHeight: 1.1 }}>
            {word}
          </div>
          <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', fontWeight: 600 }}>{valueLabel}</div>
          {deltaPts != null && <DeltaBadge value={deltaPts} metricKey="crisisRiskScore" suffix=" pts" />}
        </div>
      </div>
      <div style={divider}>
        <BandScale bands={CRISIS_BANDS} value={score} max={1} valueLabel={valueLabel} ariaLabel="Riesgo de crisis" />
      </div>
      {rows.length > 0 && (
        <div style={divider}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-3)', padding: 'var(--sp-15) 0', borderTop: i ? '1px solid var(--hairline)' : 'none', fontSize: 'var(--fs-body-sm)' }}>
              <span style={{ color: 'var(--text-2)' }}>{r.k}</span>
              <span className="num" style={{ fontWeight: 600, color: r.color || 'var(--text)' }}>{r.v}</span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

const OVERVIEW_SOURCE_LABEL = { facebook: 'Facebook', instagram: 'Instagram', news: 'Noticias', twitter: 'X', youtube: 'YouTube', linkedin: 'LinkedIn', blog: 'Blog', blogs: 'Blog', tiktok: 'TikTok', reddit: 'Reddit', forum: 'Foro', bluesky: 'Bluesky' };

// 03 · Resumen del periodo — el lede del correo (titular, foto, párrafo y
// viñetas numeradas) a la izquierda; las publicaciones que más movieron la
// ventana a la derecha.
function OverviewResumen({ insights, pieces, onMentionClick }) {
  const { phase, data } = insights;
  const lede = data?.lede || null;
  const summary = data?.dailySummary || null;
  const highlights = (lede?.highlights || []).filter(Boolean);
  const showHero = !!(lede?.hero?.url && Number(lede.v || 1) >= OVERVIEW_LEDE_VERSION);
  const loading = phase === 'loading' || phase === 'computing';
  const status = phase === 'computing'
    ? <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}><span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-2)' }} />Generando…</span>
    : (phase === 'ready' && data?.stale ? <span className="pill pill-info" style={{ fontSize: 'var(--fs-overline)' }} title="Datos cacheados; se están recalculando en segundo plano">Actualizando…</span> : null);

  let left;
  if (phase === 'error') {
    left = <EmptyState reason="error" compact title="No se pudo cargar el resumen" detail={insights.error} />;
  } else if (loading && !summary) {
    left = (
      <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', paddingTop: 'var(--sp-4)' }}>
        <div className="skeleton" style={{ height: 22, width: '80%' }} />
        <div className="skeleton" style={{ height: 14 }} />
        <div className="skeleton" style={{ height: 14, width: '92%' }} />
        <div className="skeleton" style={{ height: 14, width: '70%' }} />
      </div>
    );
  } else if (!summary) {
    left = <EmptyState reason="pending" title="Todavía no hay suficiente señal"
      detail="El resumen necesita al menos 10 menciones en la ventana. Prueba una ventana más amplia." />;
  } else {
    left = (
      <div className="card-bd" style={{ paddingTop: 'var(--sp-4)' }}>
        {lede?.headline && (
          <h2 style={{ fontSize: 'var(--fs-title-md)', fontWeight: 600, lineHeight: 1.3, margin: '0 0 var(--sp-3)', letterSpacing: 'var(--tracking-tight)', textWrap: 'balance', color: 'var(--text)' }}>
            {lede.headline}
          </h2>
        )}
        {/* Foto al lado del párrafo (no encima): con la columna ancha, una foto
            a todo el ancho estiraba el bloque el doble de alto que las piezas
            de al lado. En móvil vuelve a ir encima, a todo el ancho. Solo se
            pinta la foto del lede vigente: la de una versión anterior no
            dependía de la ventana y se está recalculando. */}
        <div style={{ display: 'grid', gridTemplateColumns: showHero ? window.ecoCols('minmax(0,1fr) minmax(0,38%)', '1fr') : '1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>
          <div style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6, color: 'var(--text)', maxWidth: '72ch', order: window.ecoIsMobile() ? 2 : 1 }}
            dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(summary) }} />
          {showHero && (
            <figure style={{ margin: 0, order: window.ecoIsMobile() ? 1 : 2 }}>
              {/* La copia propia se guarda con URL absoluta (citizenecho.com/media/…);
                  como ruta relativa carga en cualquiera de los dos dominios bajo
                  la CSP img-src 'self' de /overview. */}
              <img src={String(lede.hero.url).replace(/^https?:\/\/[^/]+(?=\/media\/)/, '')} alt="" loading="lazy"
                onError={(e) => { const f = e.currentTarget.closest('figure'); if (f) f.style.display = 'none'; }}
                style={{ width: '100%', maxWidth: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--r-md)', display: 'block', background: 'var(--canvas-2)' }} />
              {lede.hero.caption && (
                <figcaption className="num" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-15)' }}>{lede.hero.caption}</figcaption>
              )}
            </figure>
          )}
        </div>
        {highlights.length > 0 && (
          <ol style={{ listStyle: 'none', margin: 'var(--sp-3) 0 0', padding: 0 }}>
            {highlights.map((h, i) => (
              <li key={i} style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr)', gap: 'var(--sp-3)', padding: 'var(--sp-2) 0', borderTop: '1px solid var(--hairline)' }}>
                <span className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)', paddingTop: 1 }}>{i + 1}</span>
                <span style={{ fontSize: 'var(--fs-body-sm)', lineHeight: 1.55, color: 'var(--text)', maxWidth: '70ch' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(h) }} />
              </li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  return (
    <div>
      <OverviewEyebrow n="03" right={status}>Resumen del periodo</OverviewEyebrow>
      {/* El resumen pesa más que las piezas: 1.85 : 1 (antes 1.5 : 1). */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('minmax(0,1.85fr) minmax(0,1fr)', '1fr'), gap: 'var(--sp-3)', alignItems: 'start' }}>
        <div className="card">{left}</div>
        <div className="card">
          <div className="card-hd">
            <div>
              <div className="card-hd-title">Las piezas que movieron la ventana</div>
              <div className="card-hd-sub">por interacciones · click para abrir la mención</div>
            </div>
          </div>
          <div className="card-bd" style={{ paddingTop: 'var(--sp-2)' }}>
            {pieces == null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}
              </div>
            ) : pieces.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)' }}>Sin publicaciones con interacción en la ventana.</div>
            ) : pieces.map((mn, i) => {
              const tone = mn.sentiment === 'negativo' ? 'var(--neg)' : mn.sentiment === 'positivo' ? 'var(--pos)' : 'var(--neu)';
              const src = OVERVIEW_SOURCE_LABEL[mn.source] || mn.domain || 'Web';
              const who = mn.author || mn.domain || src;
              return (
                <button key={mn.id} onClick={() => onMentionClick && onMentionClick(mn)} className="row-hover"
                  style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', width: '100%', display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 'var(--sp-3)', padding: 'var(--sp-3) var(--sp-1)', borderTop: i ? '1px solid var(--hairline)' : 'none', alignItems: 'start' }}>
                  <Avatar name={who} size={28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone, flexShrink: 0 }} aria-label={mn.sentiment} />
                      <span style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)' }}>{who}</span>
                      <span style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)' }}>{src}{mn.publishedAt ? ` · ${mn.publishedAt}` : ''}</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', marginTop: 'var(--sp-05)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {mn.title || mn.snippet}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)' }}>{fmt(mn.engagement)}</div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>interac.</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Barras apiladas por día con la ventana previa en gris a la izquierda, los
// días pico rotulados y, debajo del eje, la cinta del riesgo de crisis diario.
// Una sola escala vertical para las dos ventanas (así se comparan).
function OverviewTrendChart({ days, prev, crisisDaily, peaks, onDayClick }) {
  const [ref, w] = useChartWidth(720);
  const titleId = React.useId ? React.useId() : 'ov-trend-title';
  const all = [...(prev || []).map((d) => ({ ...d, isPrev: true })), ...days];
  const hasCrisis = Array.isArray(crisisDaily) && crisisDaily.length > 0 && days.length <= 31;
  const crisisBy = {};
  (crisisDaily || []).forEach((c) => { crisisBy[c.date] = c.score; });
  const peakBy = {};
  (peaks || []).forEach((p) => { peakBy[p.date] = p; });
  const tot = (d) => (d.negative || 0) + (d.neutral || 0) + (d.positive || 0);
  const maxV = Math.max(1, ...all.map(tot));
  // Escala "bonita": el máximo redondeado al múltiplo de 5/10/20/50… siguiente.
  const niceStep = (() => { const raw = maxV / 4; const pow = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / pow; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow; })();
  const yMax = Math.ceil(maxV / niceStep) * niceStep;
  const ticks = []; for (let t = 0; t <= yMax + 1e-9; t += niceStep) ticks.push(Math.round(t));
  const hasPeaks = Object.keys(peakBy).length > 0;
  // Arriba, dos franjas que no se tocan: los rótulos de los picos (y 14–33)
  // y, debajo, las etiquetas de las dos ventanas (padT - 10).
  const padL = hasCrisis ? 48 : 34, padR = 8, padT = hasPeaks ? 66 : (prev ? 30 : 12), padB = hasCrisis ? 50 : 26;
  const H = 280 + (hasPeaks ? 20 : 0);
  const iw = Math.max(10, w - padL - padR), ih = H - padT - padB;
  const bw = iw / Math.max(1, all.length);
  const y = (v) => padT + ih - (v / yMax) * ih;
  const labelEvery = Math.max(1, Math.ceil(46 / bw));
  const showValues = bw >= 22;
  const xOf = (i) => padL + i * bw;
  const prevEndX = prev && prev.length ? xOf(prev.length) : null;
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width="100%" height={H} viewBox={`0 0 ${Math.max(w, 1)} ${H}`} role="img" aria-labelledby={titleId} style={{ display: 'block', overflow: 'visible' }}>
        <title id={titleId}>Menciones por día y sentimiento{prev ? ', con la ventana previa' : ''}{hasCrisis ? ' y el riesgo de crisis diario' : ''}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={padL + iw} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="num" style={{ fontSize: 11, fill: 'var(--text-3)' }}>{t}</text>
          </g>
        ))}
        {prevEndX != null && (
          <g>
            <line x1={prevEndX} x2={prevEndX} y1={padT - 22} y2={padT + ih} stroke="var(--hairline-strong)" strokeDasharray="3 3" />
            <text x={prevEndX - 6} y={padT - 10} textAnchor="end" style={{ fontSize: 11, fill: 'var(--text-3)' }}>ventana previa · {fmt(prev.reduce((a, d) => a + tot(d), 0))}</text>
            <text x={prevEndX + 6} y={padT - 10} style={{ fontSize: 11, fill: 'var(--text-3)' }}>esta ventana · {fmt(days.reduce((a, d) => a + tot(d), 0))}</text>
          </g>
        )}
        {all.map((d, i) => {
          const x0 = xOf(i) + bw * 0.18, bwi = Math.max(1, bw * 0.64);
          const total = tot(d);
          let yy = y(0);
          const seg = (v, fill, key) => { if (!v) return null; const hh = (v / yMax) * ih; yy -= hh; return <rect key={key} x={x0} y={yy} width={bwi} height={hh} fill={fill} />; };
          const bars = d.isPrev
            ? seg(total, 'color-mix(in oklab, var(--text-3) 35%, var(--canvas))', 'p')
            : [seg(d.positive, 'var(--pos)', 'pos'), seg(d.neutral, 'var(--neu)', 'neu'), seg(d.negative, 'var(--neg)', 'neg')];
          const clickable = !d.isPrev && onDayClick;
          const cs = crisisBy[d.fullDate];
          const cb = cs != null ? crisisBand(cs) : null;
          return (
            <g key={d.fullDate || i}
              onClick={clickable ? () => onDayClick(d) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayClick(d); } } : undefined}
              tabIndex={clickable ? 0 : undefined} role={clickable ? 'button' : undefined}
              aria-label={clickable ? `${d.date}: ${total} menciones` : undefined}
              className={clickable ? 'eco-trend-day' : undefined}
              style={{ cursor: clickable ? 'pointer' : 'default' }}>
              <rect x={xOf(i)} y={padT - 4} width={bw} height={ih + 4} fill={peakBy[d.fullDate] ? 'var(--action-fill)' : 'transparent'} className="eco-trend-hit" />
              {bars}
              {!d.isPrev && showValues && total > 0 && (
                <text x={xOf(i) + bw / 2} y={y(total) - 5} textAnchor="middle" className="num" style={{ fontSize: 11, fill: 'var(--text-2)' }}>{total}</text>
              )}
              {i % labelEvery === 0 && (
                <text x={xOf(i) + bw / 2} y={padT + ih + 15} textAnchor="middle" className="num" style={{ fontSize: 11, fill: 'var(--text-3)' }}>{d.date}</text>
              )}
              {hasCrisis && !d.isPrev && cb && (
                <g>
                  <rect x={x0} y={padT + ih + 24} width={bwi} height={15} rx={2} fill={cb.color} />
                  {bwi >= 26 && <text x={xOf(i) + bw / 2} y={padT + ih + 35} textAnchor="middle" className="num" style={{ fontSize: 10, fontWeight: 600, fill: 'var(--canvas)' }}>{Math.round(cs * 100)}%</text>}
                </g>
              )}
            </g>
          );
        })}
        {hasCrisis && <text x={padL - 6} y={padT + ih + 35} textAnchor="end" style={{ fontSize: 10, fill: 'var(--text-3)' }}>crisis</text>}
        {all.map((d, i) => {
          const p = !d.isPrev && peakBy[d.fullDate];
          if (!p) return null;
          const cx = xOf(i) + bw / 2;
          const top = y(tot(d)) - (showValues ? 18 : 6);
          const yA = 14;
          // El rótulo va a la derecha del marcador, o a la izquierda si el pico
          // está en el último tercio; y nunca se sale del dibujo (en móvil el
          // gráfico mide ~300px y un rótulo de 40 caracteres no cabe centrado).
          const sub = `${p.total} menciones · ${p.negative} negativas`;
          const textW = Math.max(String(p.label).length * 6.9, sub.length * 6.7);
          const end = cx > padL + iw * 0.62;
          const tx = Math.max(2, Math.min(Math.max(w, 1) - textW - 2, end ? cx - 8 - textW : cx + 8));
          return (
            <g key={'pk' + i} pointerEvents="none">
              <line x1={cx} x2={cx} y1={Math.max(yA, top)} y2={yA} stroke="var(--text-2)" />
              <circle cx={cx} cy={yA} r={2.5} fill="var(--text)" />
              <text x={tx} y={yA + 4} style={{ fontSize: 12, fontWeight: 600, fill: 'var(--text)' }}>{p.label}</text>
              <text x={tx} y={yA + 19} className="num" style={{ fontSize: 11, fill: 'var(--text-3)' }}>{sub}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OverviewTendencia({ dailySeries, prevDailySeries, hourlySeries, granularity, crisisDaily, peaks, onDayClick, onHourClick }) {
  // Con ventana de UN día el API devuelve trendGranularity='hour' +
  // hourlySeries: ese caso conserva las franjas por hora (SeriesPanels).
  const hourly = granularity === 'hour' && Array.isArray(hourlySeries) && hourlySeries.length > 0;
  const series = [
    { key: 'negative', label: 'Negativo', color: 'var(--neg)' },
    { key: 'neutral',  label: 'Neutral',  color: 'var(--neu)' },
    { key: 'positive', label: 'Positivo', color: 'var(--pos)' },
  ];
  const days = (dailySeries || []).map((d) => ({
    date: d.dayLabel, fullDate: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive,
    totalMentions: (d.negative || 0) + (d.neutral || 0) + (d.positive || 0),
  }));
  const prev = Array.isArray(prevDailySeries) && prevDailySeries.length > 0
    ? prevDailySeries.map((d) => ({ date: d.dayLabel, fullDate: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive }))
    : null;
  if (!hourly && days.length === 0) {
    return (
      <div className="card">
        <EmptyState reason="empty" title="Sin datos de tendencia"
          detail="No hay menciones con fecha en el período seleccionado." />
      </div>
    );
  }
  const legendItem = (color, label) => (
    <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />{label}
    </span>
  );
  return (
    <div className="card">
      <div className="card-hd" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div>
          <div className="card-hd-title">04 · Tendencia · {hourly ? 'Hora a hora' : 'Día a día'}</div>
          <div className="card-hd-sub">
            {hourly
              ? 'Volumen por sentimiento, hora a hora (TZ Puerto Rico) · click una hora para ver sus menciones'
              : 'Volumen por sentimiento (TZ Puerto Rico) · click un día para ver sus menciones'}
          </div>
        </div>
        {!hourly && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
            {legendItem('var(--neg)', 'Negativo')}
            {legendItem('var(--neu)', 'Neutral')}
            {legendItem('var(--pos)', 'Positivo')}
            {prev && legendItem('color-mix(in oklab, var(--text-3) 35%, var(--canvas))', 'Ventana previa')}
          </div>
        )}
      </div>
      <div className="card-bd">
        {hourly ? (
          <SeriesPanels
            data={hourlySeries.map((d) => ({
              date: d.hourLabel, fullHour: d.hour,
              negative: d.negative, neutral: d.neutral, positive: d.positive,
              totalMentions: (d.negative || 0) + (d.neutral || 0) + (d.positive || 0),
            }))}
            series={series}
            panelHeight={72}
            onPointClick={onHourClick}
            a11yTitle="Volumen por sentimiento, hora a hora"
          />
        ) : (
          <OverviewTrendChart days={days} prev={prev} crisisDaily={crisisDaily} peaks={peaks} onDayClick={onDayClick} />
        )}
      </div>
    </div>
  );
}

// 05 · Insights — las tres columnas del correo (negativo, neutral, positivo),
// cada una con su peso en el total. El resumen general ya vive en 03.
function OverviewInsights({ insights, totals }) {
  const state = insights;
  const T = totals || {};
  const share = (v) => (T.total > 0 ? Math.round(((v || 0) / T.total) * 100) : 0);
  const eyebrow = <OverviewEyebrow n="05">Insights · análisis IA del periodo</OverviewEyebrow>;
  if (state.phase === 'error') {
    return (
      <div>
        {eyebrow}
        <div className="card">
          <EmptyState reason="error" compact title="No se pudieron cargar los insights" detail={state.error} />
        </div>
      </div>
    );
  }
  const cols = [
    { key: 'negative', title: 'Negativo', empty: 'Sin insights negativos', accent: 'var(--neg)', share: share(T.negative), items: state.data?.insights?.negative ?? [] },
    { key: 'neutral',  title: 'Neutral',  empty: 'Sin insights neutrales', accent: 'var(--neu)', share: share(T.neutral),  items: state.data?.insights?.neutral ?? [] },
    { key: 'positive', title: 'Positivo', empty: 'Sin insights positivos', accent: 'var(--pos)', share: share(T.positive), items: state.data?.insights?.positive ?? [] },
  ];
  const isLoading = state.phase !== 'ready';
  const allEmpty = !isLoading && cols.every((c) => c.items.length === 0);
  return (
    <div>
      {eyebrow}
      {allEmpty ? (
        <div className="card">
          <EmptyState reason="pending" title="Todavía no hay suficiente señal"
            detail="Los insights necesitan más menciones en el período para decir algo con fundamento. Prueba una ventana más amplia." />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(3, 1fr)', '1fr'), gap: 'var(--sp-3)' }}>
          {cols.map((col) => (
            <div key={col.key} className="card" style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', borderTop: `2px solid ${col.accent}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                <div className="t-overline">{col.title}</div>
                <div className="num" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{col.share}% del total</div>
              </div>
              {isLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <div className="skeleton" style={{ height: 14 }} />
                  <div className="skeleton" style={{ height: 14, width: '92%' }} />
                  <div className="skeleton" style={{ height: 14, width: '78%' }} />
                </div>
              ) : col.items.length === 0 ? (
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{col.empty} para este periodo.</div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  {col.items.map((it, i) => (
                    // La constitución editorial autoriza <strong>; mismo saneado
                    // que el resto del Overview (solo sobrevive <strong>).
                    <li key={i} style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text)', lineHeight: 1.55 }}
                      dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(it) }} />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewTopicos({ rows, totals, onTopicClick }) {
  if (!rows || rows.length === 0) {
    // El mismo primitivo que el vacío de Tendencia (:5461): dos cards de la
    // MISMA pantalla no pueden decir «no hay nada» de dos maneras distintas.
    // reason="empty" y no "filtered" ni "pending" porque la consulta corrió y
    // el cero es un HECHO del periodo, no un filtro ni un cómputo que falta.
    return (
      <div className="card">
        <EmptyState reason="empty" title="Sin tópicos clasificados"
          detail="Ninguna mención del período recibió un tópico con confianza suficiente." />
      </div>
    );
  }
  const universe = totals.total || 1;

  // La alineación derecha de la cifra existe para compartir borde con la columna
  // vecina; cuando `ecoCols` colapsa la rejilla a '1fr' esa columna no existe y
  // el número se va al borde de la card, en diagonal respecto de su etiqueta. Un
  // solo objeto para la fila de tópico y la de TOTAL: la decisión es la misma en
  // las dos y no puede volver a divergir.
  const numCell = { textAlign: window.ecoCols('right', 'left') };

  // `scale` = qué fracción del PERIODO representa la fila (0–1). Sin él la barra
  // era siempre el 100% de la columna, porque cada fila se normalizaba a su
  // propio total: nueve barras del mismo largo para 253 y para 80 menciones, y
  // como las mezclas se parecen (~16/34/50) el proyector mostraba ocho barras
  // idénticas. Ahora el LARGO dice el volumen y el RELLENO dice la mezcla.
  function DistributionBar({ neg, neu, pos, t, scale = 1 }) {
    const td = t || 1;
    // Orden canónico del producto: positivo → neutral → negativo. Es el de
    // SentimentBar (2146-2148) y el de las cinco leyendas y demás barras
    // apiladas; esta era la única espejada, así que al hacer click en una fila y
    // aterrizar en Tópicos el rojo saltaba de lado sin que ninguna de las dos
    // tenga leyenda. El último tramo absorbe el redondeo para que sumen 100%.
    const posPct = (pos / td) * 100;
    const neuPct = (neu / td) * 100;
    const negPct = Math.max(0, 100 - posPct - neuPct);
    return (
      <div style={{ display: 'flex', height: 8, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--canvas-2)', width: `${Math.max(2, scale * 100)}%` }}>
        <div title={`positivo · ${pos}`} style={{ width: `${posPct}%`, background: 'var(--pos)' }} />
        <div title={`neutral · ${neu}`}  style={{ width: `${neuPct}%`, background: 'var(--neu)' }} />
        <div title={`negativo · ${neg}`} style={{ width: `${negPct}%`, background: 'var(--neg)' }} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">06 · Tópicos</div>
          <div className="card-hd-sub">Top 7 + agrupados · cada mención cuenta una vez bajo su tópico de mayor confianza</div>
        </div>
      </div>
      <div>
        {rows.map((row, idx) => {
          const pctOfTotal = universe > 0 ? Math.round((row.total / universe) * 100) : 0;
          const muted = !!(row.isOther || row.isUnclassified);
          // Solo las filas clasificadas (top-7) son clickeables. "Otros" y
          // "Sin clasificar" agregan tópicos heterogéneos / sin clasificar
          // y no tienen un slug único al cual filtrar.
          const clickable = !muted && !!onTopicClick;
          return (
            <div key={idx}
              onClick={clickable ? () => onTopicClick(row) : undefined}
              className={clickable ? 'row-hover' : undefined}
              style={{
                display: 'grid', gridTemplateColumns: window.ecoCols('1.4fr 110px 1fr', '1fr'), gap: 'var(--sp-4)',
                // 14px no existe en la escala base-4; el mapa de migración de
                // tokens.css §2 («14,16→--sp-4») manda a --sp-4, que además es el
                // padding de .card-bd y el valor de --pad-card: un solo ritmo.
                padding: 'var(--sp-4)', alignItems: 'center',
                borderTop: idx > 0 ? '1px solid var(--hairline)' : 'none',
                opacity: muted ? 0.78 : 1,
                cursor: clickable ? 'pointer' : 'default',
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--fs-body-sm)', fontWeight: muted ? 500 : 600,
                  color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{row.topic}</div>
                {(row.subtopics || row.secondaryCount > 0) && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', marginTop: 'var(--sp-05)', fontStyle: row.isUnclassified ? 'italic' : 'normal' }}>
                    {row.subtopics}
                    {row.subtopics && row.secondaryCount > 0 ? ' · ' : ''}
                    {row.secondaryCount > 0 && (
                      <span>+{row.secondaryCount} también lo tocan</span>
                    )}
                  </div>
                )}
              </div>
              <div style={numCell}>
                {/* --fs-num-md (18px) es el escalón que faltaba: la MISMA unidad
                    (menciones) salía a 30px en el termómetro y a 14px aquí, un
                    salto de 2.1x sin nada en medio y a 1px del nombre del tópico,
                    que es texto y no cifra. Este número es el ranking que el
                    cliente lee en la reunión. */}
                <div className="num" style={{ fontSize: 'var(--fs-num-md)', fontWeight: muted ? 600 : 700, color: 'var(--text)' }}>
                  {fmt(row.total)}
                </div>
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', fontWeight: 500, marginTop: 'var(--sp-05)' }}>{pctOfTotal}%</div>
              </div>
              <DistributionBar neg={row.negative} neu={row.neutral} pos={row.positive} t={row.total} scale={row.total / universe} />
            </div>
          );
        })}
        {/* Footer "Total del periodo" — debe cuadrar con el termómetro */}
        <div style={{
          display: 'grid', gridTemplateColumns: window.ecoCols('1.4fr 110px 1fr', '1fr'), gap: 'var(--sp-4)',
          // Mismo ritmo que las filas de arriba (--sp-4 por el mapa de §2): la
          // fila TOTAL es una fila más, no un bloque con su propia métrica.
          padding: 'var(--sp-4)', alignItems: 'center',
          borderTop: '1px solid var(--hairline-strong)',
          // Sin relleno: --canvas-2 es MÁS OSCURO que la card en oscuro (#091018
          // vs #0E1620), así que la fila más importante de la tabla era la única
          // hundida — al revés de la regla que declara tokens.css:225 («en oscuro,
          // más elevación = más CLARO»). Y es el valor exacto de .row-hover:hover
          // (index.html:481): un color con dos significados en la misma tabla, el
          // TOTAL en hover permanente y cualquier fila bajo el cursor con aspecto
          // de total. --surface-raised no es alternativa: en claro vale #FFFFFF,
          // igual que la card (1.000:1). El énfasis lo cargan el --hairline-strong
          // de arriba, el rótulo en overline, el 700 de la cifra y la barra a
          // escala 1 — cuatro señales que no compiten con ningún estado.
        }}>
          <div className="t-overline" style={{ color: 'var(--text-3)' }}>
            Total del periodo
          </div>
          <div style={numCell}>
            {/* Sin abreviar: `fmt` sacaba "1.3K" para el MISMO número que el hero
                imprime "1,331", y en esta columna las ocho filas de arriba ya van
                sin abreviar (253, 213, …). Regla: titulares y totales completos,
                `fmt` sólo donde el ancho no da. Aquí da. */}
            <div className="num" style={{ fontSize: 'var(--fs-num-md)', fontWeight: 700, color: 'var(--text)' }}>{totals.total.toLocaleString('es-PR')}</div>
          </div>
          {/* La fila TOTAL es la regla de medir: su barra ocupa la pista completa
              y las de arriba son su fracción real del periodo. Por eso scale=1
              explícito y no un cálculo: es el 100% por definición. */}
          <DistributionBar neg={totals.negative} neu={totals.neutral} pos={totals.positive} t={totals.total} scale={1} />
        </div>
      </div>
      {/* --fs-caption y no --fs-overline: esto son cuatro líneas de PROSA corrida
          y tokens.css:63-69 restringe los 11px a eyebrows en MAYÚSCULAS y a ticks
          de eje densos («Nada más»). 12px es el piso declarado del texto corrido.
          El padding crudo pasa a tokens con el mapa de §2 (12→--sp-3, 16→--sp-4). */}
      <div style={{ padding: 'var(--sp-3) var(--sp-4)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
        <Icons.Info size={12} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
        <span>
          Cada mención cuenta una vez bajo su tópico de mayor confianza (mismo
          criterio del correo diario). El "+N también lo tocan" indica
          menciones donde el tópico aparece como tema secundario — verás
          conteos más altos en la pestaña Tópicos por esa razón.
        </span>
      </div>
    </div>
  );
}

// ============================================================
// NarrativeScreen — página Narrativas (oct-2026, propuesta integrada)
// ============================================================
// Cuatro bloques encadenados sobre UN solo universo de menciones (asignación
// principal, sin duplicados, pertinente, «solo fecha» cuando la hora llega en
// blanco, una voz por medio): 01 la serie de las historias de los últimos 30
// días, 02 el tablero por etapa de vida (7 días contra los 7 anteriores), 03 la
// propagación de la narrativa elegida y 04 el mapa de 26 semanas con la más
// reciente a la izquierda. Elegir una narrativa en cualquier bloque cambia la
// propagación.
//
// Ventanas FIJAS que terminan ayer (AST): la página no usa el selector de
// periodo (app.js lo oculta aquí), porque cada bloque tiene su escala.
// Todo lo que se cuenta sale de /api/narrative/overview y
// /api/narrative/[id]/propagation; aquí solo se dibuja.
//
// Nombres con prefijo nx/NX: los scripts del SPA comparten el ámbito global.
const NX_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const NX_DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const nxT = (ymd) => Date.parse(ymd + 'T00:00:00Z');
const nxD = (ymd) => new Date(nxT(ymd));
const nxAddDays = (ymd, k) => new Date(nxT(ymd) + k * 86400000).toISOString().slice(0, 10);
const nxDayLab = (ymd) => { const d = nxD(ymd); return `${NX_DIA[d.getUTCDay()]} ${d.getUTCDate()}`; };
const nxDateLab = (ymd, year) => { const d = nxD(ymd); return `${d.getUTCDate()} ${NX_MES[d.getUTCMonth()]}${year ? ' ' + d.getUTCFullYear() : ''}`; };
const nxMonthLab = (ymd) => { const d = nxD(ymd); return `${NX_MES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const nxTimeLab = (hhmm) => { const H = Number(hhmm.slice(0, 2)); const h12 = H % 12 === 0 ? 12 : H % 12; return `${h12}:${hhmm.slice(3, 5)} ${H < 12 ? 'a.m.' : 'p.m.'}`; };
const nxHourTxt = (H) => (H === 0 ? '12 a.m.' : H < 12 ? `${H} a.m.` : H === 12 ? '12 m.' : `${H - 12} p.m.`);
const nxFmt = (n) => Number(n || 0).toLocaleString('es-PR');
const nxPct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const nxRange = (a, b) => {
  const da = nxD(a), db = nxD(b);
  if (da.getUTCMonth() === db.getUTCMonth() && da.getUTCFullYear() === db.getUTCFullYear()) return `${da.getUTCDate()}–${db.getUTCDate()} ${NX_MES[db.getUTCMonth()]}`;
  return `${nxDateLab(a)} – ${nxDateLab(b)}`;
};
const nxCut = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
// «de» + el nombre con artículo: «del DDEC», «de la Gobernadora».
const nxDe = (art) => (art.startsWith('el ') ? 'del ' + art.slice(3) : 'de ' + art);
// Una sola regla de «negativo» para toda la página (la misma de la API).
const nxIsNeg = (neg, n) => n >= 8 && neg / n >= 0.3;

const NX_STATUS = { emerging: 'Naciendo', active: 'Activa', peaking: 'En pico', revived: 'Revivió', declining: 'Apagándose', dormant: 'Terminada' };
const nxStCls = (s) => (s === 'peaking' || s === 'revived' ? 'active' : s in NX_STATUS ? s : 'dormant');
// El estado se codifica con forma y texto, nunca con color: el color de la
// página es la identidad de la historia, y --narr-* son alias de --cat-*.
function NxStatus({ s }) {
  return <span className={'nx-st ' + nxStCls(s)}><i aria-hidden="true" />{NX_STATUS[s] || s}</span>;
}
function NxOrigin({ o, short }) {
  const L = { propia: short || 'Propia', prensa: 'Prensa', politica: 'Política', redes: 'Redes' };
  return <span className="nx-org" title="Quién inició la narrativa">{L[o] || 'Redes'}</span>;
}
function NxSecHd({ n, title, sub, right }) {
  return (
    <div className="card-hd" style={{ flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
      <div style={{ minWidth: 0 }}>
        <div className="card-hd-title" style={{ display: 'flex', alignItems: 'center' }}><span className="nx-secn">{n}</span>{title}</div>
        {sub && <div className="card-hd-sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// Colores: cada historia (2+ narrativas en la serie) tiene una familia y la
// claridad separa sus capítulos; una narrativa suelta, su propio color. En el
// mapa la misma historia lleva el mismo color. Asignados EN ORDEN y sin
// repetir: cuando se acaban los 8 de la paleta, la marca va en gris.
function nxColors(data) {
  const byId = data.byId;
  const storyCount = {}, groupSize = {};
  data.series.forEach((id) => { const s = byId[id] && byId[id].storyId; if (s) storyCount[s] = (storyCount[s] || 0) + 1; });
  const groupOf = {}, groupColor = {}, seriesColor = {}, groupOrder = [];
  data.series.forEach((id) => {
    const s = byId[id].storyId;
    const g = s && storyCount[s] >= 2 ? s : id;
    groupOf[id] = g;
    groupSize[g] = (groupSize[g] || 0) + 1;
  });
  let k = 0;
  const seen = {};
  data.series.forEach((id) => {
    const g = groupOf[id];
    if (!(g in groupColor)) { groupColor[g] = window.ecoCat(k++); groupOrder.push(g); }
    const i = (seen[g] = (seen[g] || 0) + 1) - 1;
    // La claridad se reparte en todo el grupo: cada capítulo, un tono distinto.
    const mix = i === 0 ? 100 : Math.round(100 - (i * 55) / Math.max(1, groupSize[g] - 1));
    seriesColor[id] = i === 0 ? groupColor[g] : `color-mix(in oklab, ${groupColor[g]} ${mix}%, var(--canvas))`;
  });
  return { groupOf, groupColor, seriesColor, groupOrder, nextCat: k };
}
// Color de la marca de cada historia del mapa (solo las que se marcan). La
// historia que también está en la serie conserva su color; las demás toman
// uno que ninguna otra marca del mapa use (primero los libres en la serie).
// Gris solo si se acaban los 8.
function nxStoryColors(data, colors, storyIds) {
  const out = {}, used = new Set();
  const seriesUsed = new Set(Object.values(colors.groupColor));
  const pool = [...window.ECO_CAT.filter((c) => !seriesUsed.has(c)), ...window.ECO_CAT.filter((c) => seriesUsed.has(c))];
  const pending = [];
  storyIds.forEach((sid) => {
    const st = (data.stories || []).find((x) => x.id === sid);
    const solo = st && st.memberIds.find((id) => colors.groupOf[id] === id);
    const own = colors.groupColor[sid] || (solo && colors.groupColor[solo]);
    if (own && !used.has(own)) { out[sid] = own; used.add(own); } else pending.push(sid);
  });
  pending.forEach((sid) => {
    const c = pool.find((x) => !used.has(x));
    out[sid] = c || 'var(--text-3)';
    if (c) used.add(c);
  });
  return out;
}

// --------------------------- 01 · Historias ---------------------------
function NxSeriesChart({ data, colors, selected, onSelect }) {
  const [ref, cw] = useChartWidth(720);
  const W = Math.max(560, Math.floor(cw)), H = 340, L = 44, R = 12, T = 84, B = 30;
  const days = data.windows.series.days, n = days.length;
  const byId = data.byId;
  const order = colors.groupOrder;
  const ids = [...data.series].sort((a, b) => (a === selected ? -1 : b === selected ? 1 : 0)
    || order.indexOf(colors.groupOf[a]) - order.indexOf(colors.groupOf[b]) || data.series.indexOf(a) - data.series.indexOf(b));
  const totals = days.map((_, i) => ids.reduce((s, id) => s + byId[id].d30[i], 0));
  const max = Math.max(5, Math.ceil(Math.max(...totals) / 10) * 10);
  const x = (i) => L + (i * (W - L - R)) / (n - 1);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const base = days.map(() => 0);
  const bands = {};
  const paths = ids.map((id) => {
    const a = byId[id];
    const top = a.d30.map((c, i) => base[i] + c);
    const d = top.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(t).toFixed(1)}`).join('')
      + base.map((_, i) => `L${x(n - 1 - i).toFixed(1)},${y(base[n - 1 - i]).toFixed(1)}`).join('') + 'Z';
    bands[id] = { lo: base.slice(), hi: top.slice() };
    top.forEach((t, i) => { base[i] = t; });
    return { id, d, a };
  });
  // Rótulos: el pico de cada grupo (4+ menciones), sin repetir día, como máximo 3.
  const peaks = {};
  ids.forEach((id) => byId[id].d30.forEach((c, i) => { const g = colors.groupOf[id]; if (!peaks[g] || c > peaks[g].c) peaks[g] = { c, i, id }; }));
  const used = new Set();
  const placed = [{ y: T - 12, x0: L, x1: L + 140 }]; // «menciones por día»
  const labels = Object.values(peaks).filter((p) => p.c >= 4).sort((a, b) => b.c - a.c)
    .filter((p) => (used.has(p.i) ? false : (used.add(p.i), true))).slice(0, 3).map((p) => {
      const cx = x(p.i); const band = bands[p.id]; const mid = (y(band.hi[p.i]) + y(band.lo[p.i])) / 2;
      const end = cx > W * 0.55; const label = nxCut(byId[p.id].name, 44); const wTxt = Math.min(320, label.length * 7.4);
      const x0 = end ? cx - 8 - wTxt : cx + 8, x1 = x0 + wTxt;
      // Encima de la silueta en su tramo; si choca con otro rótulo sube una
      // fila, y si ya no cabe arriba se omite (mejor sin rótulo que encimado).
      const top = Math.min(...days.map((_, i) => (x(i) >= x0 - 10 && x(i) <= x1 + 10 ? y(totals[i]) : H))) - 26;
      let ly = null;
      for (let c = Math.min(top, H - B - 40); c >= 16; c -= 38) {
        if (!placed.some((q) => Math.abs(q.y - c) < 38 && x0 < q.x1 + 12 && x1 > q.x0 - 12)) { ly = c; break; }
      }
      if (ly === null) return null;
      placed.push({ y: ly, x0, x1 });
      return { p, cx, mid, ly, end, label };
    }).filter(Boolean);
  return (
    <div ref={ref} className="scroll-x">
      <svg width={W} height={H} className="nx-svg" role="group" aria-label="Menciones por día de las narrativas principales, apiladas" style={{ display: 'block' }}>
        <defs>
          {ids.filter((id) => byId[id].status === 'dormant').map((id) => (
            <pattern key={id} id={'nx-hatch-' + id.slice(0, 8)} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" style={{ fill: 'var(--canvas)' }} />
              <rect width="2.5" height="6" style={{ fill: colors.seriesColor[id] }} />
            </pattern>
          ))}
        </defs>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--hairline)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end">{Math.round(t)}</text>
          </g>
        ))}
        <text x={L} y={T - 12} className="nx-sans" style={{ fill: 'var(--text-3)' }}>menciones por día</text>
        {days.map((d, i) => (i % 5 === 0 || i === n - 1) && (n - 1 - i >= 3 || i === n - 1) ? (
          <text key={d} x={x(i)} y={H - 8} textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{nxDayLab(d)}</text>
        ) : null)}
        {paths.map(({ id, d, a }) => {
          const ended = a.status === 'dormant', sel = id === selected;
          return (
            <path key={id} d={d} className="nx-band" onClick={() => onSelect(id)}
              style={{ fill: ended ? `url(#nx-hatch-${id.slice(0, 8)})` : colors.seriesColor[id] }}
              stroke={sel ? 'var(--text)' : ended ? 'var(--text-3)' : 'var(--canvas)'} strokeWidth={sel ? 1.8 : 0.8}
              strokeDasharray={ended ? '3 2' : undefined}>
              <title>{`${a.name} · ${a.m30} ${a.m30 === 1 ? 'mención' : 'menciones'} en 30 días`}</title>
            </path>
          );
        })}
        {labels.map(({ p, cx, mid, ly, end, label }) => (
          <g key={p.id} style={{ pointerEvents: 'none' }}>
            <line x1={cx} x2={cx} y1={ly + 24} y2={mid} stroke="var(--text-2)" />
            <circle cx={cx} cy={mid} r="2.5" fill="var(--text)" />
            <text x={end ? cx - 8 : cx + 8} y={ly} textAnchor={end ? 'end' : 'start'} className="nx-sans" style={{ fill: 'var(--text)', fontWeight: 600 }}>{label}</text>
            <text x={end ? cx - 8 : cx + 8} y={ly + 18} textAnchor={end ? 'end' : 'start'} className="nx-sans" style={{ fill: 'var(--text-3)' }}>{`${nxDayLab(days[p.i])} · ${p.c} de ${totals[p.i]} menciones del día`}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function NxHistorias({ data, colors, selected, onSelect }) {
  const byId = data.byId;
  const groups = [];
  data.series.forEach((id) => {
    const g = colors.groupOf[id];
    let e = groups.find((x) => x.g === g);
    if (!e) { e = { g, ids: [] }; groups.push(e); }
    e.ids.push(id);
  });
  const storyById = {};
  (data.stories || []).forEach((s) => { storyById[s.id] = s; });
  const ended = data.series.filter((id) => byId[id].status === 'dormant');
  const live = data.series.length - ended.length;
  const win = data.windows.series;
  const endDays = [...new Set(ended.map((id) => byId[id].lastDay))];
  const endWhen = endDays.length === 1 && ended.length > 1 ? `ambas con última mención el ${nxDateLab(endDays[0])}` : `última mención el ${endDays.map((d) => nxDateLab(d)).join(' y el ')}`;
  const endTxt = ended.length ? `${ended.length === 1 ? 'la que terminó' : `las ${ended.length} que terminaron`} más recientemente (${endWhen})` : '';
  return (
    <div className="card">
      <NxSecHd n="01" title="Historias de los últimos 30 días"
        sub={data.series.length === 0 ? `${nxRange(win.from, win.to)} · ninguna narrativa viva o recién terminada tuvo menciones en estos días`
          : `${nxRange(win.from, win.to)} · ${live === 0 ? `ninguna narrativa viva tuvo menciones; se muestran ${endTxt}` : `${live === 1 ? 'la narrativa viva (naciendo, activa o apagándose) con más menciones' : `las ${live} narrativas vivas (naciendo, activas o apagándose) con más menciones`}${endTxt ? ' y ' + endTxt : ''}`}. Apiladas por historia; elige una para ver su propagación.`} />
      {data.series.length === 0 ? (
        <div className="card-bd"><EmptyState reason="empty" compact title="Sin narrativas en estos 30 días" detail="Ninguna narrativa viva o recién terminada tuvo menciones en la ventana. El mapa de abajo muestra las de las últimas 26 semanas." /></div>
      ) : (
        <div className="card-bd nx-hist">
          <NxSeriesChart data={data} colors={colors} selected={selected} onSelect={onSelect} />
          <div>
            <div className="nx-leg-head"><span /><span>narrativa</span><span>estado</span><span style={{ textAlign: 'right' }}>30 d</span></div>
            {groups.map(({ g, ids }) => {
              const st = storyById[g];
              return (
                <div key={g} className="nx-leg-story">
                  {st && ids.length >= 2 && (
                    <h4 title={st.subtitle || st.name}>
                      <span className="nx-sw" style={{ background: colors.groupColor[g] }} />
                      <span className="nx-kind">Historia</span><span className="truncate">{st.name}</span>
                    </h4>
                  )}
                  {ids.map((id) => {
                    const a = byId[id];
                    const ended2 = a.status === 'dormant';
                    return (
                      <button key={id} className="nx-leg-row" aria-pressed={id === selected} onClick={() => onSelect(id)} title={a.summary || a.name}>
                        <span className="nx-sw" style={{ background: ended2 ? `repeating-linear-gradient(45deg, ${colors.seriesColor[id]} 0 2px, var(--canvas) 2px 4px)` : colors.seriesColor[id] }} />
                        <span className="nx-nm">{a.name}</span>
                        <NxStatus s={a.status} />
                        <span className="num" style={{ textAlign: 'right' }}>{a.m30}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <p className="nx-note" style={{ marginTop: 'var(--sp-1)' }}>Rayado = la narrativa terminó. La elegida va abajo del todo, con borde.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------- 02 · Ciclo de vida ---------------------------
function NxSpark({ vals, max, color, mark }) {
  const [ref, cw] = useChartWidth(220);
  const w = Math.max(80, Math.floor(cw)), h = 28;
  const M = Math.max(1, max);
  const x = (i) => 2 + (i * (w - 4)) / (vals.length - 1), y = (v) => h - 3 - (v / M) * (h - 6);
  const p = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <div ref={ref}>
      <svg width={w} height={h} aria-hidden="true" style={{ display: 'block' }}>
        {mark != null && <line x1={x(mark)} x2={x(mark)} y1="0" y2={h} stroke="var(--hairline-strong)" strokeDasharray="2 2" />}
        <path d={`${p}L${x(vals.length - 1)},${h - 3}L${x(0)},${h - 3}Z`} style={{ fill: color }} opacity=".12" />
        <path d={p} fill="none" style={{ stroke: color }} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function NxCard({ a, data, sMax, selected, onSelect, short }) {
  const wk = data.windows.week;
  const neg = nxIsNeg(a.neg7, a.m7);
  let change;
  if (a.column === 'declining') change = <span>última mención: {nxDateLab(a.lastDay)}</span>;
  else if (a.m7p === 0 && a.bornDay >= wk.from) change = <span className="nx-delta">nueva</span>;
  else {
    const d = a.m7 - a.m7p;
    change = <span className="nx-delta" style={{ color: d > 0 ? 'var(--text)' : 'var(--text-3)' }}>{d > 0 ? '▲ +' : d < 0 ? '▼ ' : '· '}{d} <span className="nx-muted">({a.m7p} la semana anterior)</span></span>;
  }
  const tone = neg ? <span style={{ color: 'var(--neg)' }}>{nxPct(a.neg7, a.m7)}% negativas</span>
    : a.neg7 ? <span>{a.neg7} {a.neg7 === 1 ? 'negativa' : 'negativas'}</span>
      : a.pos7 ? <span>{a.pos7} {a.pos7 === 1 ? 'positiva' : 'positivas'}</span> : null;
  const spark = a.d30.slice(16);
  return (
    <button className="nx-card" aria-pressed={a.id === selected} onClick={() => onSelect(a.id, true)} title={a.summary || a.name}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
        <h4>{a.name}</h4><NxOrigin o={a.origin} short={short} />
      </div>
      <div className="nx-meta"><span><b>{a.m7}</b> en 7 días</span>{change}</div>
      <div className="nx-meta">
        {a.voices7 > 0 && <span>{a.voices7} {a.voices7 === 1 ? 'voz' : 'voces'}</span>}
        {a.press7 > 0 && <span>{a.press7} de medios</span>}
        {tone}
      </div>
      <NxSpark vals={spark} max={sMax} color={neg ? 'var(--neg)' : 'var(--text-2)'} mark={7} />
      <div className="nx-cap">{nxRange(data.windows.series.days[16], data.windows.series.to)} · misma escala en todas</div>
      <div className="nx-meta">
        <span>la inició: {a.starter}</span>
        <span>primera mención: {nxDateLab(a.bornDay)}</span>
        {a.column === 'emerging' && a.createdDay && a.createdDay > a.bornDay && <span>detectada: {nxDateLab(a.createdDay)}</span>}
      </div>
    </button>
  );
}

// Cada columna muestra las 6 narrativas con más menciones en 7 días; el resto
// se despliega (Gobernadora llega a 17 en una columna).
const NX_COL_MAX = 6;
function NxTablero({ data, selected, onSelect, short, art }) {
  const [open, setOpen] = useState({});
  const byId = data.byId;
  const liveIds = [...data.board.emerging, ...data.board.active, ...data.board.declining];
  const sMax = Math.max(1, ...liveIds.flatMap((id) => byId[id].d30.slice(16)));
  const al = data.alertId ? byId[data.alertId] : null;
  const alStory = al && al.storyId ? (data.stories || []).find((s) => s.id === al.storyId) : null;
  const sib = alStory ? liveIds.map((id) => byId[id]).find((b) => b.id !== al.id && b.storyId === al.storyId) : null;
  const wk = data.windows.week, pw = data.windows.prevWeek;
  const COLS = [['emerging', 'Naciendo'], ['active', 'Activas'], ['declining', 'Apagándose']];
  return (
    <div className="card">
      <NxSecHd n="02" title="Ciclo de vida"
        sub={`${liveIds.length} ${liveIds.length === 1 ? 'narrativa viva' : 'narrativas vivas'} · ${nxRange(wk.from, wk.to)} contra ${nxRange(pw.from, pw.to)} · las terminadas (${nxFmt(data.counts.dormant)}${data.counts.dormantSince ? ` desde ${nxMonthLab(data.counts.dormantSince)}` : ''}) no entran aquí; el mapa (04) muestra las más grandes de las últimas 26 semanas`} />
      <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {al && (
          <div className="nx-alert" role="note">
            <div className="nx-alert-stp" />
            <div className="nx-alert-in">
              <h3>{`Nace una narrativa que no inició ${art}, con ${al.neg7} de ${al.m7} menciones negativas: «${al.name}»`}</h3>
              <p>{`La inició ${al.starter} el ${nxDayLab(al.bornDay)} de ${NX_MES[nxD(al.bornDay).getUTCMonth()]}${al.starterTime ? ` a las ${nxTimeLab(al.starterTime)}` : ''}; ${al.voices7} ${al.voices7 === 1 ? 'voz' : 'voces'}, ${al.press7} de medios en 7 días.`}
                {sib ? (alStory.name === sib.name || alStory.name === al.name
                  ? ` Es parte de la misma historia que «${sib.name}» (${sib.m7} en 7 días).`
                  : ` Es parte de la historia «${alStory.name}», con «${sib.name}» (${sib.m7} en 7 días).`) : ''}</p>
            </div>
            <div className="nx-alert-act"><button className="btn btn-primary" onClick={() => onSelect(al.id, true)}>Ver propagación</button></div>
          </div>
        )}
        <div className="nx-kan">
          {COLS.map(([c, label]) => {
            const items = data.board[c].map((id) => byId[id]);
            // La elegida siempre queda a la vista aunque esté más abajo del tope.
            const shown = open[c] ? items : items.filter((a, i) => i < NX_COL_MAX || a.id === selected);
            return (
              <div key={c} className="nx-kcol">
                <h3><span className={'nx-st ' + c}><i aria-hidden="true" />{label}</span><span className="num nx-muted">{items.length}</span></h3>
                {items.length ? shown.map((a) => <NxCard key={a.id} a={a} data={data} sMax={sMax} selected={selected} onSelect={onSelect} short={short} />)
                  : <div className="nx-muted" style={{ padding: 'var(--sp-15)', fontSize: 'var(--fs-body-sm)' }}>Nada en esta etapa.</div>}
                {items.length > shown.length && <button className="btn" onClick={() => setOpen((o) => ({ ...o, [c]: true }))}>{items.length - shown.length === 1 ? 'Ver la restante' : `Ver las ${items.length - shown.length} restantes`}</button>}
                {open[c] && items.length > NX_COL_MAX && <button className="btn" onClick={() => setOpen((o) => ({ ...o, [c]: false }))}>Ver menos</button>}
              </div>
            );
          })}
        </div>
        <div className="nx-kan-legend">
          <span><NxStatus s="emerging" /> detectada hace menos de 7 días</span>
          <span><NxStatus s="active" /> con menciones recientes</span>
          <span><NxStatus s="declining" /> días sin menciones y por debajo de su ritmo</span>
          <span><NxStatus s="dormant" /> 14 días sin menciones</span>
        </div>
        {data.cajones.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline', flexWrap: 'wrap', fontSize: 'var(--fs-body-sm)' }}>
            <span className="nx-badge">{data.cajones.length === 1 ? 'apartada' : 'apartadas'}</span>
            <span>
              {data.cajones.slice(0, 3).map((c, i) => (
                <React.Fragment key={c.id}>{i ? ', ' : ''}<b>«{c.name}»</b> <span className="nx-muted">({nxFmt(c.life)} menciones desde {nxMonthLab(c.bornDay)})</span></React.Fragment>
              ))}
              {data.cajones.length > 3 && <span className="nx-muted">{` y ${data.cajones.length - 3} más`}</span>}
              <span className="nx-muted">{` ${data.cajones.length === 1 ? 'reúne' : 'reúnen'} menciones de muchas semanas sin un tema común, así que no ${data.cajones.length === 1 ? 'entra' : 'entran'} al tablero, la serie ni el mapa.`}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// --------------------------- 03 · Propagación ---------------------------
const NX_LANES = ['Noticias', 'Facebook', 'Instagram', 'Otras redes'];
// Hora de la fila en ms «ingenuos» (la hora ya viene en hora de PR). Las
// «solo fecha» se dibujan al mediodía, huecas.
const nxRowT = (r) => nxT(r.d) + (r.t ? (Number(r.t.slice(0, 2)) * 60 + Number(r.t.slice(3, 5))) * 60000 : 12 * 3600000);
// Misma regla que la API: la primera que no es página de etiqueta; en el mismo
// día gana la que tiene hora.
const nxEarliest = (rows) => [...rows].sort((a, b) => a.d.localeCompare(b.d) || (a.t ? 0 : 1) - (b.t ? 0 : 1) || (a.t || '').localeCompare(b.t || ''))[0];

function NxPropChart({ rows, voices }) {
  const [ref, cw] = useChartWidth(720);
  const W = Math.max(560, Math.floor(cw)), H = 290, L = 104, R = 16, T = 26, B = 36, lh = (H - T - B) / NX_LANES.length;
  const rMax = Math.min(12, lh / 2 - 4);
  const t0 = nxRowT(rows[0]);
  const t1 = Math.max(nxRowT(rows[rows.length - 1]), t0 + 6 * 3600000);
  const span = t1 - t0;
  // Margen de un radio a cada lado: el círculo del primer y del último punto no se corta.
  const x = (t) => L + rMax + ((t - t0) / span) * (W - L - R - 2 * rMax);
  const spanDays = span / 86400000, pxDay = (W - L - R - 2 * rMax) / spanDays;
  const long = spanDays > 7 || rows[0].d.slice(0, 7) !== rows[rows.length - 1].d.slice(0, 7);
  const ticks = [];
  if (spanDays < 1.5) {
    // Todo cabe en un día o poco más: el eje va en horas.
    const hStep = [1, 2, 3, 6, 12].find((k) => k * (pxDay / 24) >= 64) || 24;
    for (let t = Math.ceil(t0 / 3600000) * 3600000; t <= t1; t += 3600000) {
      const H24 = Math.round((t % 86400000) / 3600000) % 24;
      if (H24 % hStep) continue;
      ticks.push({ d: String(t), xx: x(t), lab: H24 === 0 ? nxDayLab(new Date(t).toISOString().slice(0, 10)) : nxHourTxt(H24) });
    }
  } else {
    const step = [1, 2, 7, 14, 30, 61, 91, 182, 365].find((k) => k * pxDay >= 72) || 730;
    const monthly = step >= 30, everyN = Math.max(1, Math.round(step / 30));
    let mi = 0;
    for (let d = rows[0].d, k = 0; nxT(d) <= t1; d = nxAddDays(d, 1), k++) {
      if (monthly) { if (nxD(d).getUTCDate() !== 1) continue; if ((mi++) % everyN) continue; } else if (k % step) continue;
      const xx = x(nxT(d)); if (xx < L - 1) continue;
      ticks.push({ d, xx, lab: monthly ? nxMonthLab(d) : long ? nxDateLab(d) : nxDayLab(d) });
    }
  }
  // Un rótulo que se saldría por la derecha se ancla a su final.
  ticks.forEach((tk) => { tk.end = tk.xx + 3 + tk.lab.length * 7.8 > W; });
  const eMax = Math.max(1, ...rows.map((p) => p.e));
  const rOf = (p) => 3 + (rMax - 3) * Math.sqrt(p.e / eMax);
  const bucket = {};
  rows.forEach((p) => { const k = `${p.d}${p.t ? p.t.slice(0, 2) : 'z'}|${p.c}`; bucket[k] = (bucket[k] || 0) + 1; });
  const kMax = Math.max(...Object.values(bucket));
  const stepY = kMax > 1 ? Math.min(6, (lh / 2 - 3) / Math.ceil((kMax - 1) / 2)) : 0;
  const usedB = {};
  const id8 = String(rows.length) + '-' + rows[0].d;
  return (
    <div ref={ref} className="scroll-x">
      <svg width={W} height={H} className="nx-svg" role="img" aria-label={`${rows.length} menciones por canal y hora; la lista de quién la amplificó está al lado`} style={{ display: 'block' }}>
        <defs>
          {NX_LANES.map((_, i) => <clipPath key={i} id={`nx-ln-${id8}-${i}`}><rect x={L - 2} y={T + lh * i + 1} width={W - L - R + 4} height={lh - 2} /></clipPath>)}
        </defs>
        {NX_LANES.map((l, i) => (
          <g key={l}>
            <line x1={L} x2={W - R} y1={T + lh * (i + 0.5)} y2={T + lh * (i + 0.5)} stroke="var(--hairline)" />
            <text x={L - 8} y={T + lh * (i + 0.5) + 4} textAnchor="end" className="nx-sans" style={{ fill: 'var(--text-2)' }}>{l}</text>
          </g>
        ))}
        {ticks.map((tk) => (
          <g key={tk.d}>
            <line x1={tk.xx} x2={tk.xx} y1={T - 6} y2={H - B} stroke="var(--hairline-strong)" strokeDasharray="3 3" />
            <text x={tk.end ? tk.xx - 3 : tk.xx + 3} y={H - B + 18} textAnchor={tk.end ? 'end' : 'start'}>{tk.lab}</text>
          </g>
        ))}
        {rows.map((p, idx) => {
          const k = `${p.d}${p.t ? p.t.slice(0, 2) : 'z'}|${p.c}`;
          const j = (usedB[k] = (usedB[k] || 0) + 1) - 1;
          const off = (j % 2 ? 1 : -1) * Math.ceil(j / 2) * stepY;
          const c = p.s === 'n' ? 'var(--neg)' : p.s === 'p' ? 'var(--pos)' : 'var(--neu)';
          const cy = T + lh * (p.c + 0.5) + off;
          const tip = `${voices[p.v] || p.v} · ${nxDayLab(p.d)} ${NX_MES[nxD(p.d).getUTCMonth()]} · ${p.t ? nxTimeLab(p.t) : 'sin hora'} · ${nxFmt(p.e)} interacciones${p.j ? ' · página de etiqueta' : ''}${p.ti ? '\n' + p.ti : ''}`;
          const hollow = !p.t || p.j;
          const dot = hollow
            ? <circle clipPath={`url(#nx-ln-${id8}-${p.c})`} cx={x(nxRowT(p))} cy={cy} r={Math.max(4.5, rOf(p))} style={{ fill: 'var(--canvas)', stroke: c }} strokeWidth="1.6"><title>{tip}</title></circle>
            : <circle clipPath={`url(#nx-ln-${id8}-${p.c})`} cx={x(nxRowT(p))} cy={cy} r={rOf(p)} style={{ fill: c, stroke: 'var(--canvas)' }} fillOpacity=".72"><title>{tip}</title></circle>;
          // Los puntos abren la mención con el ratón; fuera del orden de tabulación
          // (una narrativa grande sumaría cientos de paradas de teclado).
          return p.u ? <a key={idx} href={p.u} target="_blank" rel="noopener noreferrer" tabIndex={-1}>{dot}</a> : <React.Fragment key={idx}>{dot}</React.Fragment>;
        })}
      </svg>
    </div>
  );
}

function NxPropagacion({ a, prop, loading, error, short, art }) {
  if (!a) return null;
  const head = (sub) => <NxSecHd n="03" title={`Propagación · ${a.name}`} sub={sub}
    right={<div style={{ display: 'flex', gap: 'var(--sp-15)', alignItems: 'center' }}><NxOrigin o={a.origin} short={short} /><NxStatus s={a.status} /></div>} />;
  if (error) return <div className="card" id="nx-prop">{head(null)}<div className="card-bd"><EmptyState reason="error" compact title="No se pudo cargar la propagación" detail="Vuelve a elegir la narrativa en unos segundos." /></div></div>;
  if (loading || !prop) return <div className="card" id="nx-prop">{head('Cargando las menciones de la narrativa…')}<div className="card-bd"><div className="nx-empty">Cargando…</div></div></div>;
  const pts = prop.rows || [];
  const V = (k) => (prop.voices && prop.voices[k]) || k;
  if (!pts.length) return <div className="card" id="nx-prop">{head(null)}<div className="card-bd"><div className="nx-empty">Sin menciones en el universo de la página.</div></div></div>;
  const real = pts.filter((p) => !p.j);
  const first = nxEarliest(real.length ? real : pts);
  const sinHora = first.t ? real.filter((p) => !p.t && p.d === first.d).length : 0;
  const firstMedia = nxEarliest(real.filter((p) => p.m));
  const perH = {};
  real.filter((p) => p.t).forEach((p) => { const k = `${p.d} ${p.t.slice(0, 2)}`; perH[k] = (perH[k] || 0) + 1; });
  const pk = Object.entries(perH).sort((x1, x2) => x2[1] - x1[1] || x1[0].localeCompare(x2[0]))[0];
  const amp = [...pts].sort((x1, x2) => x2.e - x1.e)[0];
  const last = pts[pts.length - 1];
  const long = pts[0].d.slice(0, 7) !== last.d.slice(0, 7) || (nxT(last.d) - nxT(pts[0].d)) / 86400000 > 7;
  const dl = (d) => (long ? nxDateLab(d, true) : nxDayLab(d));
  const when = (p) => `${dl(p.d)} · ${p.t ? nxTimeLab(p.t) : 'sin hora'}`;
  let gap = '—';
  if (firstMedia) {
    if (firstMedia === first) gap = 'Al inicio';
    else if (!firstMedia.t || !first.t) { const dd = Math.round((nxT(firstMedia.d) - nxT(first.d)) / 86400000); gap = dd <= 0 ? 'Mismo día' : `+${dd} d`; }
    else { const h = (nxRowT(firstMedia) - nxRowT(first)) / 3600000; gap = h < 1 ? 'Misma hora' : h < 48 ? `+${Math.round(h)} h` : `+${Math.round(h / 24)} d`; }
  }
  const ampBy = {}, cnt = {};
  pts.forEach((p) => { ampBy[p.v] = (ampBy[p.v] || 0) + p.e; cnt[p.v] = (cnt[p.v] || 0) + 1; });
  const top = Object.keys(cnt).sort((k1, k2) => ampBy[k2] - ampBy[k1] || cnt[k2] - cnt[k1]).slice(0, 6);
  const voicesN = Object.keys(cnt).length, negs = pts.filter((p) => p.s === 'n').length, press = pts.filter((p) => p.m).length, own = pts.filter((p) => p.o).length;
  const eMax = Math.max(1, ...pts.map((p) => p.e));
  return (
    <div className="card" id="nx-prop">
      {head(`${nxFmt(pts.length)} ${pts.length === 1 ? 'mención' : 'menciones'} desde el ${nxDateLab(first.d, true)} (${nxFmt(a.n180)} en las últimas 26 semanas) · ${voicesN} ${voicesN === 1 ? 'voz' : 'voces'} · ${press} de medios · ${own} de cuentas ${nxDe(art)} · ${negs} ${negs === 1 ? 'negativa' : 'negativas'}`)}
      <div className="card-bd nx-prop">
        <div style={{ minWidth: 0 }}>
          <NxPropChart rows={pts} voices={prop.voices || {}} />
          <div className="nx-legend" style={{ marginTop: 'var(--sp-15)' }}>
            <span><span className="nx-dot" style={{ background: 'var(--neg)' }} />Negativo</span>
            <span><span className="nx-dot" style={{ background: 'var(--neu)' }} />Neutral</span>
            <span><span className="nx-dot" style={{ background: 'var(--pos)' }} />Positivo</span>
            <span className="nx-muted">tamaño = interacción (máx. {nxFmt(eMax)}) · ○ hueco = sin hora o página de etiqueta · clic = abrir la mención</span>
          </div>
          <div className="nx-mile">
            <div><b>{when(first)}</b><span>Primera: {V(first.v)}{sinHora ? ` (+${sinHora} sin hora ese día)` : ''}</span></div>
            <div><b>{gap}</b><span>{firstMedia ? `Primer medio: ${V(firstMedia.v)}${firstMedia === first ? ' (fue la primera)' : ''}` : 'No llegó a medios'}</span></div>
            <div><b>{pk ? `${dl(pk[0].slice(0, 10))}, ${nxHourTxt(Number(pk[0].slice(11, 13)))}` : '—'}</b><span>{pk ? `Hora pico: ${pk[1]} ${pk[1] === 1 ? 'mención' : 'menciones'}` : 'Sin horas registradas'}</span></div>
            {amp.e > 0
              ? <div><b>{nxFmt(amp.e)} {amp.e === 1 ? 'interacción' : 'interacciones'}</b><span>Mención con más interacción: {V(amp.v)}</span></div>
              : <div><b>Sin interacciones</b><span>Ninguna mención registra interacciones</span></div>}
            <div><b>{when(last)}</b><span>Última: {V(last.v)}</span></div>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="nx-over" style={{ marginBottom: 'var(--sp-15)' }}>Quién la amplificó · {amp.e > 0 ? 'por interacción' : 'por menciones'}</div>
          {top.map((k) => (
            <div key={k} className="nx-vrow">
              <Avatar name={V(k)} size={28} />
              <div className="truncate"><b style={{ fontWeight: 600 }}>{V(k)}</b> <span className="nx-muted">· {cnt[k]} {cnt[k] === 1 ? 'mención' : 'menciones'}</span></div>
              <div className="num" style={{ textAlign: 'right' }} title="interacciones">{nxFmt(ampBy[k])}</div>
            </div>
          ))}
          <p className="nx-note">Una voz es un medio o una cuenta; un mismo medio cuenta una vez aunque publique en varios canales.</p>
        </div>
      </div>
    </div>
  );
}

// --------------------------- 04 · Mapa de 26 semanas ---------------------------
function NxMapa({ data, colors, selected, onSelect }) {
  const [all, setAll] = useState(false);
  const [ref, cw] = useChartWidth(900);
  const byId = data.byId;
  // Vista inicial: la serie, la alerta y las más grandes (inMapCore), más la elegida.
  const inView = (id) => byId[id].inMapCore || id === selected;
  const lanes = data.lanes.filter((id) => all || inView(id));
  const hidden = data.lanes.length - data.lanes.filter(inView).length;
  const weeks = [...data.windows.map.weeks].reverse(); // 0 = semana en curso (izquierda)
  const asOf = data.asOf;
  const W = Math.max(760, Math.floor(cw)), L = 270, R = 50, rowH = 28, T = 92;
  const H = T + lanes.length * rowH + 12;
  const cwk = (W - L - R) / weeks.length;
  const vals = lanes.flatMap((id) => byId[id].w).filter(Boolean).sort((a, b) => a - b);
  const cap = vals[Math.floor(vals.length * 0.95)] || 1;
  const hOf = (v) => 4 + 16 * Math.sqrt(Math.min(v, cap) / cap);
  // Meses: cada uno se rotula en su semana más reciente (la de más a la
  // izquierda), por el jueves de la semana; la semana en curso, por el último día con datos.
  const months = [];
  let prev = '';
  weeks.forEach((w, i) => {
    const th = nxAddDays(w, 3) > asOf ? asOf : nxAddDays(w, 3);
    const key = th.slice(0, 7);
    if (key !== prev) { months.push({ i, lab: NX_MES[nxD(th).getUTCMonth()] }); prev = key; }
  });
  const ctx = weeks.map((w) => data.context.find((c) => c.week === w) || { week: w, total: 0, inNarr: 0 });
  const cMax = Math.max(1, ...ctx.map((c) => c.total));
  const gapN = ctx.filter((c) => c.total && !c.inNarr).reduce((s, c) => s + c.total, 0);
  const storyById = {};
  (data.stories || []).forEach((s) => { storyById[s.id] = s; });
  const laneStories = {};
  lanes.forEach((id) => { const s = byId[id].storyId; if (s) laneStories[s] = (laneStories[s] || 0) + 1; });
  const storyMark = (id) => { const s = byId[id].storyId; return s && laneStories[s] >= 2 ? s : null; };
  const usedStories = Object.keys(laneStories).filter((s) => laneStories[s] >= 2 && storyById[s]);
  const storyColor = nxStoryColors(data, colors, usedStories);
  const nBig = data.lanes.filter((id) => byId[id].n180 >= 15).length;
  const partial = data.windows.map.partialDays;
  const nameMax = Math.floor((L - 26) / 7.2);
  const agencyArt = data.agency.article || 'la agencia';
  return (
    <div className="card">
      <NxSecHd n="04" title="Mapa de 26 semanas"
        sub={`Las ${nBig} narrativas con 15 o más menciones y todas las de la serie y el tablero (${data.lanes.length} carriles${hidden && !all ? `, ${lanes.length} a la vista` : ''}) · sin cajones · semanas de lunes a domingo · ordenadas por su semana más reciente con menciones`}
        right={
          <div className="nx-legend">
            <span><span className="nx-sw" style={{ background: 'var(--neg)' }} />semana con ≥ 30% negativas (8 o más menciones)</span>
            <span><span className="nx-sw" style={{ background: 'var(--neu)', opacity: 0.55 }} />resto</span>
            {gapN > 0 && <span><span className="nx-sw" style={{ background: 'repeating-linear-gradient(45deg,var(--hairline-strong) 0 2px,var(--canvas) 2px 5px)', border: '1px solid var(--text-3)' }} />semana sin menciones asignadas a narrativas</span>}
          </div>
        } />
      <div className="card-bd"><div ref={ref} className="scroll-x">
        <svg width={W} height={H} className="nx-svg" role="group" aria-label="Narrativas de las últimas 26 semanas; la semana en curso está a la izquierda" style={{ display: 'block' }}>
          <defs>
            <pattern id="nx-gap" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" style={{ fill: 'var(--canvas)' }} /><rect width="2" height="6" style={{ fill: 'var(--hairline-strong)' }} />
            </pattern>
          </defs>
          <text x={L} y="14" className="nx-sans" style={{ fill: 'var(--text)', fontWeight: 600 }}>← más reciente</text>
          <text x={W - R} y="14" textAnchor="end" className="nx-sans" style={{ fill: 'var(--text-3)' }}>más antiguo →</text>
          {months.map((m) => (
            <g key={m.i}>
              {m.i > 0 && <line x1={L + m.i * cwk} x2={L + m.i * cwk} y1="22" y2={H - 6} stroke="var(--hairline)" />}
              <text x={L + m.i * cwk + 3} y="34">{m.lab}</text>
            </g>
          ))}
          {partial && (
            <g>
              <title>{`Semana en curso: ${partial} de 7 días con datos (hasta el ${nxDateLab(asOf)})`}</title>
              <rect x={L} y="22" width={cwk} height={H - 22} style={{ fill: 'var(--action-fill)' }} stroke="var(--hairline-strong)" strokeDasharray="3 3" />
              <text x={L + 2} y="52">{partial === 1 ? String(nxD(asOf).getUTCDate()) : `${nxD(weeks[0]).getUTCDate()}–${nxD(asOf).getUTCDate()}`}</text>
              <text x={L + 2} y="68" className="nx-sans">parcial</text>
            </g>
          )}
          <text x="16" y={T - 10} className="nx-sans" style={{ fill: 'var(--text-2)' }}>{`Todas las menciones ${nxDe(agencyArt)}`}</text>
          {ctx.map((c, i) => {
            if (!c.total) return null;
            const h = 3 + 13 * Math.sqrt(c.total / cMax), gap = c.inNarr === 0;
            return (
              <rect key={c.week} x={L + i * cwk + 1.5} y={T - 6 - h} width={Math.max(1, cwk - 3)} height={h} rx="2"
                style={{ fill: gap ? 'url(#nx-gap)' : 'var(--neu)', opacity: gap ? 1 : 0.55 }} stroke={gap ? 'var(--text-3)' : 'none'}>
                <title>{`Semana del ${nxDateLab(c.week)}: ${nxFmt(c.total)} ${c.total === 1 ? 'mención' : 'menciones'}, ${nxFmt(c.inNarr)} en narrativas${gap ? ' (el agrupador no asignó ninguna)' : ''}`}</title>
              </rect>
            );
          })}
          {lanes.map((id, j) => {
            const a = byId[id];
            const yy = T + 4 + j * rowH;
            const vv = [...a.w].reverse(), vn = [...a.wn].reverse();
            const sel = id === selected;
            const sk = storyMark(id);
            const lim = a.dupOf ? nameMax - 10 : nameMax;
            const act = () => onSelect(id, true);
            return (
              <g key={id} className="nx-lane" tabIndex={0} role="button" aria-pressed={sel}
                aria-label={`${a.name}: ${a.n180} menciones en 26 semanas`}
                onClick={act} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } }}>
                <rect className="nx-hl" x="2" y={yy} width={W - 4} height={rowH - 2} rx="4" fill={sel ? 'var(--action-fill)' : 'transparent'} stroke={sel ? 'var(--text)' : 'none'} />
                {sk && <rect x="6" y={yy + 6} width="4" height={rowH - 14} rx="2" style={{ fill: storyColor[sk] || 'var(--text-3)' }}><title>{`Historia: ${storyById[sk].name}`}</title></rect>}
                <text x="16" y={yy + 18} className="nx-sans" style={{ fill: 'var(--text)', fontWeight: sel ? 600 : 400 }}>
                  <title>{a.name + (a.dupOf ? ` · posible duplicado de «${a.dupOf.name}»` : '')}</title>{nxCut(a.name, lim)}
                </text>
                {a.dupOf && <text x={L - 8} y={yy + 18} textAnchor="end" className="nx-dup">duplicado</text>}
                {vv.map((v, i) => {
                  if (!v) return null;
                  const h = hOf(v), neg = nxIsNeg(vn[i], v);
                  return (
                    <rect key={i} x={L + i * cwk + 1.5} y={yy + 13 - h / 2} width={Math.max(1, cwk - 3)} height={h} rx="2"
                      style={{ fill: neg ? 'var(--neg)' : 'var(--neu)', opacity: neg ? 1 : 0.55 }} stroke={v > cap ? 'var(--text)' : 'none'}>
                      <title>{`${a.name} · semana del ${nxDateLab(weeks[i])}${i === 0 && partial ? ' (en curso)' : ''}: ${v} ${v === 1 ? 'mención' : 'menciones'}, ${vn[i]} ${vn[i] === 1 ? 'negativa' : 'negativas'}`}</title>
                    </rect>
                  );
                })}
                <text x={W - 6} y={yy + 18} textAnchor="end" style={{ fill: 'var(--text-3)' }}>{a.n180}</text>
              </g>
            );
          })}
        </svg>
      </div></div>
      <div className="card-bd" style={{ paddingTop: 0 }}>
        <div className="nx-legend">
          {usedStories.map((s) => <span key={s} title={storyById[s].subtitle || ''}><span className="nx-sw" style={{ background: storyColor[s], width: 4, height: 12 }} />{storyById[s].name}</span>)}
          <span className="nx-muted">cifra de la derecha = menciones en 26 semanas</span>
          {hidden > 0 && (
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? `Ver solo las ${data.lanes.length - hidden} principales` : hidden === 1 ? 'Ver la restante' : `Ver las ${hidden} restantes`}
            </button>
          )}
        </div>
        <p className="nx-note">
          La marca de la izquierda agrupa las narrativas de una misma historia.
          {lanes.some((id) => byId[id].dupOf) ? ' «Duplicado» marca una narrativa que parece el mismo hecho partido en dos (mismas fechas y mismo tema).' : ''}
          {partial ? ` La columna sombreada es la semana en curso: ${partial} de 7 días con datos.` : ''}
          {gapN > 0 ? ` En las semanas con trama hubo ${nxFmt(gapN)} menciones que el agrupador no asignó a ninguna narrativa: esas semanas vacías no son silencio.` : ''}
        </p>
      </div>
    </div>
  );
}

// --------------------------- Montaje ---------------------------
function NarrativeScreen({ agency }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [selected, setSelected] = useState(null);
  const [props, setProps] = useState({});
  const [live, setLive] = useState('');
  const pending = React.useRef({});

  React.useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    ecoFetchAuthed('/api/narrative/overview?' + new URLSearchParams({ agency: agency || '' }).toString(), { credentials: 'same-origin', cache: 'no-store' })
      .then((raw) => {
        if (cancelled) return;
        const byId = {};
        (raw.narratives || []).forEach((n) => { byId[n.id] = n; });
        const data = { ...raw, byId };
        setState({ loading: false, error: null, data });
        const first = (raw.series || [])[0] || (raw.board ? [...raw.board.emerging, ...raw.board.active, ...raw.board.declining][0] : null) || (raw.lanes || [])[0] || null;
        setSelected(first);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e && e.code === 401) { ecoBounceToSignIn(); return; }
        setState({ loading: false, error: String(e && e.message || e), data: null });
      });
    return () => { cancelled = true; };
  }, [agency]);

  // La propagación se pide al elegir una narrativa y se guarda: volver a una
  // ya vista no repite la consulta.
  React.useEffect(() => {
    if (!selected || (props[selected] && !props[selected].error) || pending.current[selected]) return;
    pending.current[selected] = true;
    ecoFetchAuthed(`/api/narrative/${encodeURIComponent(selected)}/propagation?` + new URLSearchParams({ agency: agency || '' }).toString(), { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => setProps((p) => ({ ...p, [selected]: { data: res } })))
      .catch((e) => {
        if (e && e.code === 401) { ecoBounceToSignIn(); return; }
        setProps((p) => ({ ...p, [selected]: { error: true } }));
      })
      .finally(() => { delete pending.current[selected]; });
  }, [selected, agency, props]);

  const data = state.data;
  const colors = React.useMemo(() => (data ? nxColors(data) : null), [data]);
  const onSelect = React.useCallback((id, jump) => {
    if (!data || !data.byId[id]) return;
    setSelected(id);
    // Si la propagación de esta narrativa falló, elegirla otra vez la reintenta.
    setProps((p) => { if (!p[id] || !p[id].error) return p; const q = { ...p }; delete q[id]; return q; });
    setLive(`Propagación: ${data.byId[id].name}`);
    if (jump) {
      setTimeout(() => {
        const el = document.getElementById('nx-prop');
        if (!el) return;
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const top = el.getBoundingClientRect().top + window.scrollY - 16;
        window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
      }, 0);
    }
  }, [data]);

  if (state.loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)' }}>
        {['01', '02', '03', '04'].map((n) => <div key={n} className="card"><div className="card-bd"><div className="nx-empty">Cargando narrativas…</div></div></div>)}
      </div>
    );
  }
  if (state.error) {
    return <div className="card"><div className="card-bd"><EmptyState reason="error" title="No se pudieron cargar las narrativas" detail="Recarga la página en unos segundos. Si persiste, avisa al equipo." /></div></div>;
  }
  if (!data || !data.narratives || data.narratives.length === 0) {
    return <div className="card"><div className="card-bd"><EmptyState reason="empty" title="Sin narrativas en las últimas 26 semanas" detail="El agrupador no encontró narrativas con menciones pertinentes para esta agencia." /></div></div>;
  }
  const short = (data.agency && data.agency.short) || 'Propia';
  const art = (data.agency && data.agency.article) || 'la agencia';
  const sel = selected && data.byId[selected];
  const p = selected ? props[selected] : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)' }}>
      {sel && (
        <div className="nx-selbar">
          <span className="nx-muted">Narrativa elegida:</span><b className="truncate" style={{ minWidth: 0 }}>{sel.name}</b>
          <span className="nx-muted hide-mobile">Cambia la propagación (03). Elige otra en la serie, el tablero o el mapa.</span>
          <span className="nx-muted" style={{ marginLeft: 'auto' }}>Datos al {nxDateLab(data.asOf, true)}</span>
        </div>
      )}
      <NxHistorias data={data} colors={colors} selected={selected} onSelect={onSelect} />
      <NxTablero data={data} selected={selected} onSelect={onSelect} short={short} art={art} />
      <NxPropagacion a={sel} prop={p && p.data} loading={!p} error={p && p.error} short={short} art={art} />
      <NxMapa data={data} colors={colors} selected={selected} onSelect={onSelect} />
      <div aria-live="polite" className="sr-only">{live}</div>
    </div>
  );
}

// =====================================================================
// VISTA EJECUTIVA MULTI-AGENCIA (agencia === '__all__' → /api/exec-overview)
// =====================================================================
// Tres pantallas de gobierno: Tabla de posiciones, Sala de mando y Radar de
// crisis. Todas consumen el MISMO endpoint /api/exec-overview (cache no-store),
// que devuelve un composite reach-weighted + fila por agencia + crisisFeed +
// topicWaves. El endpoint responde 403 a no-staff; las pantallas muestran ese
// caso como un empty state ("solo disponible para staff"). Re-autoría de los
// mockups en apps/web/public/exec-mockups/{01,02,06}.* con el estilo real del
// SPA (tokens var(--…), pill-*, KpiCard) — no el CSS standalone del mockup.

// Hook compartido: fetch único de /api/exec-overview al montar. Devuelve
// { data, loading, error }. `error.code === 403` distingue "sin permiso" de un
// fallo genérico. Se re-ejecuta si cambia `period` (mismo control del Header).
function useExecOverview(period) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);
    const params = new URLSearchParams({ period: period || '7D' });
    if (period === 'custom') {
      const from = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.from')) || '';
      const to = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.to')) || '';
      if (from && to) { params.set('from', from); params.set('to', to); }
    }
    const ctrl = new AbortController();
    fetch('/api/exec-overview?' + params.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then((r) => {
        if (r.ok) return r.json();
        const e = new Error('HTTP ' + r.status); e.code = r.status; return Promise.reject(e);
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => {
        if (cancelled || e?.name === 'AbortError') return;
        setError(e); setLoading(false);
      });
    return () => { cancelled = true; ctrl.abort(); };
  }, [period]);
  return { data, loading, error };
}

// Envoltorio de estados (cargando / error / 403 / vacío) común a las 3
// pantallas ejecutivas. `render(data)` solo se llama con datos válidos.
function ExecStateWrap({ loading, error, data, empty, children }) {
  if (loading) {
    return (
      <div className="card" style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)' }}>
        Cargando vista ejecutiva…
      </div>
    );
  }
  if (error) {
    const forbidden = error.code === 403;
    return (
      <div className="card" style={{ padding: 'var(--sp-6)', textAlign: 'center' }}>
        <div className="section-eyebrow" style={{ color: forbidden ? 'var(--warn)' : 'var(--neg)', marginBottom: 'var(--sp-15)' }}>
          {forbidden ? 'Acceso restringido' : 'Error'}
        </div>
        <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>
          {forbidden
            ? 'La vista ejecutiva multi-agencia solo está disponible para usuarios con acceso a todas las agencias.'
            : `No se pudo cargar la vista ejecutiva: ${error.message || error}`}
        </div>
      </div>
    );
  }
  if (!data || empty) {
    return (
      <div className="card" style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)' }}>
        Sin datos para el período seleccionado.
      </div>
    );
  }
  return children;
}

// Color por tono (MetricDisplay.tone) → var CSS. Reusa el mapa de DeltaBadge.
const EXEC_TONE_C = { pos: 'var(--pos)', neg: 'var(--neg)', warn: 'var(--warn)', accent: 'var(--accent)', neutral: 'var(--text-3)' };
function execToneColor(tone) { return EXEC_TONE_C[tone] || 'var(--text)'; }

// Clase pill según banda de crisis (label CRISIS/ALERTA/ELEVADO/NORMAL).
function crisisBandPill(band) {
  const b = String(band || 'NORMAL').toUpperCase();
  if (b === 'CRISIS' || b === 'ALERTA') return { cls: 'pill-neg', color: 'var(--neg)', label: b };
  if (b === 'ELEVADO') return { cls: 'pill-warn', color: 'var(--warn)', label: b };
  return { cls: 'pill-pos', color: 'var(--pos)', label: 'NORMAL' };
}

// Barra apilada de sentimiento pos/neu/neg (mismo patrón que el mockup Tabla).
function SentimentSplitBar({ pos, neu, neg, height = 6 }) {
  const total = (pos || 0) + (neu || 0) + (neg || 0);
  if (total <= 0) {
    return <div style={{ height, borderRadius: height / 2, background: 'color-mix(in oklab, var(--text-3) 16%, transparent)' }} />;
  }
  return (
    <div style={{ display: 'flex', height, borderRadius: height / 2, overflow: 'hidden', background: 'color-mix(in oklab, var(--text-3) 16%, transparent)' }}>
      <div style={{ flexGrow: pos || 0, background: 'var(--pos)' }} />
      <div style={{ flexGrow: neu || 0, background: 'var(--text-3)' }} />
      <div style={{ flexGrow: neg || 0, background: 'var(--neg)' }} />
    </div>
  );
}

// Delta de posición (rankDelta: + = subió puestos). null = sin base previa.
// Delegado a DeltaBadge: antes tenía su propio ▲/▼ y su propio criterio de color.
function RankDelta({ delta }) {
  return <DeltaBadge value={delta} metricKey="volume" />;
}

// Strip superior de KPIs del composite gobierno — compartido por Tabla y Sala.
// Usa KpiCard en modo "palabra" para BHI/NSS/Crisis (word+value coloreado por
// tono) y modo número para volumen.
function ExecCompositeStrip({ composite, agencyCount }) {
  const c = composite;
  const inCrisis = null; // se calcula fuera si se necesita; aquí solo el compuesto
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-3)' }}>
      <KpiCard
        label="Índice de salud" icon="Activity" accent="var(--accent)"
        valueWord={c.display.bhi.word} valueTone={c.display.bhi.tone}
        value={c.display.bhi.value} deltaInfo={c.deltaDisplay.bhi}
        sub="Compuesto ponderado"
      />
      <KpiCard
        label="Sentimiento neto" icon="Heart" accent="var(--pos)"
        valueWord={c.display.nss.word} valueTone={c.display.nss.tone}
        value={c.display.nss.value} deltaInfo={c.deltaDisplay.nss}
      />
      <KpiCard
        label="Riesgo de crisis" icon="AlertTriangle" accent="var(--neg)"
        valueWord={c.display.crisis.word} valueTone={c.display.crisis.tone}
        value={c.display.crisis.value} deltaInfo={c.deltaDisplay.crisis}
        tone={crisisBandPill(c.crisisBand).cls === 'pill-neg' ? 'neg' : crisisBandPill(c.crisisBand).cls === 'pill-warn' ? 'warn' : 'pos'}
        toneLabel={crisisBandPill(c.crisisBand).label}
      />
      <KpiCard
        label="Menciones" icon="Mentions" accent="var(--text-2)"
        value={fmt(c.totalMentions)} deltaInfo={c.deltaDisplay.totalMentions}
        sub={`${agencyCount} agencias · alcance ${fmt(c.totalReach)}`}
      />
    </div>
  );
}

// --------------------------------------------------------------------
// TablaScreen — ranking de salud digital (BHI desc)
// --------------------------------------------------------------------
function TablaScreen({ period }) {
  const { data, loading, error } = useExecOverview(period);
  return (
    <ExecStateWrap loading={loading} error={error} data={data} empty={data && (!data.agencies || data.agencies.length === 0)}>
      {data && (() => {
        // El backend ya ordena por rank (BHI desc). Refuerzo defensivo.
        const rows = [...data.agencies].sort((a, b) => a.rank - b.rank);
        const maxReach = Math.max(1, ...rows.map((r) => r.totalReach || 0));
        // Marcador segmentado sobre la escala pública BHI 1–10.
        const bhiMarkPct = (raw10) => {
          if (raw10 == null) return null;
          return Math.min(100, Math.max(0, (raw10 / 10) * 100));
        };
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <ExecCompositeStrip composite={data.composite} agencyCount={rows.length} />

            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                <span>Ranking de salud digital · {rows.length} agencias · {data.periodLabel}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 'var(--sp-3)', textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}><span style={{ width: 14, height: 8, borderRadius: 'var(--r-sm)', background: 'var(--pos)' }} /> Positivo</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}><span style={{ width: 14, height: 8, borderRadius: 'var(--r-sm)', background: 'var(--text-3)' }} /> Neutral</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}><span style={{ width: 14, height: 8, borderRadius: 'var(--r-sm)', background: 'var(--neg)' }} /> Negativo</span>
                </span>
              </div>

              <div className="card" style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 720 }}>
                  {/* Cabecera */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '52px 1.5fr 1.5fr 1.3fr 108px 74px 88px',
                    gap: 'var(--sp-4)', alignItems: 'center',
                    padding: '11px 20px', background: 'var(--canvas-2)',
                    borderBottom: '1px solid var(--hairline-strong)',
                  }}>
                    {['Pos', 'Agencia', 'Índice de salud ▾', 'Sentimiento', 'Riesgo', 'Velocidad', 'Alcance'].map((h, i) => (
                      <span key={h} style={{
                        fontSize: 'var(--fs-overline)', fontWeight: 500, color: i === 2 ? 'var(--accent)' : 'var(--text-3)',
                        textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)',
                        textAlign: i >= 4 ? (i === 5 ? 'center' : 'right') : 'left',
                      }}>{h}</span>
                    ))}
                  </div>

                  {rows.map((a, idx) => {
                    const bb = { color: execToneColor(a.display.bhi.tone) };
                    const cb = crisisBandPill(a.crisisBand);
                    const markPct = bhiMarkPct(a.display.bhi.raw != null ? a.display.bhi.raw : (a.bhi != null ? a.bhi / 10 : null));
                    const nssColor = a.nss > 0 ? 'var(--pos)' : a.nss < 0 ? 'var(--neg)' : 'var(--text-2)';
                    const velInfo = a.deltaDisplay.totalMentions;
                    return (
                      <div key={a.slug} className="row-hover" style={{
                        display: 'grid',
                        gridTemplateColumns: '52px 1.5fr 1.5fr 1.3fr 108px 74px 88px',
                        gap: 'var(--sp-4)', alignItems: 'center',
                        padding: '10px 20px', minHeight: 54,
                        borderTop: idx === 0 ? 'none' : '1px solid var(--hairline)',
                      }}>
                        {/* Pos */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                          <span className="num" style={{ fontSize: 'var(--fs-title-md)', fontWeight: 700, minWidth: 16, textAlign: 'right' }}>{a.rank}</span>
                          <RankDelta delta={a.rankDelta} />
                        </div>
                        {/* Agencia */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: cb.color, flex: 'none' }} />
                            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</span>
                          </div>
                          <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', paddingLeft: 16 }}>{a.slug}</div>
                        </div>
                        {/* Índice de salud */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                            <span className="num" style={{ fontSize: 'var(--fs-display-md)', fontWeight: 600, color: bb.color, lineHeight: 1 }}>{a.display.bhi.value || '—'}</span>
                            <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: bb.color }}>{a.display.bhi.word}</span>
                            <DeltaBadge info={a.deltaDisplay.bhi} />
                          </div>
                          {markPct != null && (
                            <div style={{ position: 'relative', height: 5 }}>
                              <div style={{ position: 'absolute', inset: 0, borderRadius: 'var(--r-sm)', background: 'color-mix(in oklab, var(--text-3) 20%, transparent)' }} />
                              <div style={{ position: 'absolute', top: 0, left: 0, width: `${markPct}%`, height: 5, borderRadius: 'var(--r-sm)', background: bb.color, opacity: 0.85 }} />
                            </div>
                          )}
                        </div>
                        {/* Sentimiento */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                            <span className="num" style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 700, color: nssColor }}>{a.display.nss.value || '—'}</span>
                            <span className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{a.pos}/{a.neu}/{a.neg}</span>
                          </div>
                          <SentimentSplitBar pos={a.pos} neu={a.neu} neg={a.neg} />
                        </div>
                        {/* Riesgo */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--sp-15)' }}>
                          <span className="num" style={{ fontSize: 'var(--fs-title-md)', fontWeight: 600, color: cb.color }}>{a.display.crisis.value || '—'}</span>
                          <span className={`pill ${cb.cls}`} style={{ fontSize: 'var(--fs-overline)', padding: '2px 6px' }}>{cb.label}</span>
                        </div>
                        {/* Velocidad (Δ% menciones vs período previo) */}
                        <div style={{ textAlign: 'center' }}>
                          {velInfo && velInfo.hasBaseline
                            ? <span className="num" style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: execToneColor(velInfo.tone) }}>{velInfo.arrow} {velInfo.value}</span>
                            : <span className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>sin base</span>}
                        </div>
                        {/* Alcance */}
                        <div style={{ textAlign: 'right' }}>
                          <div className="num" style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, color: 'var(--text)' }}>{fmt(a.totalReach)}</div>
                          <div className="num" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{fmt(a.totalMentions)} menc.</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </ExecStateWrap>
  );
}

// --------------------------------------------------------------------
// SalaScreen — "sala de mando" (war room): strip + muro de tiles + actividad
// --------------------------------------------------------------------
function SalaScreen({ period }) {
  const { data, loading, error } = useExecOverview(period);
  return (
    <ExecStateWrap loading={loading} error={error} data={data} empty={data && (!data.agencies || data.agencies.length === 0)}>
      {data && (() => {
        // Muro ordenado por riesgo de crisis descendente.
        const tiles = [...data.agencies].sort((a, b) => (b.crisis || 0) - (a.crisis || 0));
        const feed = data.crisisFeed || [];
        const sevPill = (sev) => sev === 'alta' ? 'pill-neg' : sev === 'media' ? 'pill-warn' : 'pill-neu';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            <ExecCompositeStrip composite={data.composite} agencyCount={tiles.length} />

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 320px)', gap: 'var(--sp-4)', alignItems: 'start' }}>
              {/* Muro de tiles */}
              <div>
                <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>El muro · {tiles.length} agencias · orden por riesgo</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--sp-3)' }}>
                  {tiles.map((a) => {
                    const cb = crisisBandPill(a.crisisBand);
                    const isCrisis = cb.cls === 'pill-neg';
                    const bhiColor = execToneColor(a.display.bhi.tone);
                    const nssColor = a.nss > 0 ? 'var(--pos)' : a.nss < 0 ? 'var(--neg)' : 'var(--text-3)';
                    return (
                      <div key={a.slug} className="card" style={{
                        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
                        borderLeft: `3px solid ${cb.color}`,
                        background: isCrisis ? 'linear-gradient(180deg, var(--neg-bg), transparent 60%), var(--canvas)' : 'var(--canvas)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                          <span style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</span>
                          <span className={`pill ${cb.cls}`} style={{ marginLeft: 'auto', fontSize: 'var(--fs-overline)', padding: '2px 6px' }}>{cb.label}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-3)' }}>
                          <div>
                            <div className="num" style={{ fontSize: 'var(--fs-display-lg)', fontWeight: 600, color: bhiColor, lineHeight: 0.95 }}>{a.display.bhi.value || '—'}</div>
                            <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginTop: 'var(--sp-05)' }}>Salud · {a.display.bhi.word}</div>
                          </div>
                          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                            <div className="num" style={{ fontSize: 'var(--fs-title-md)', fontWeight: 600, color: nssColor, lineHeight: 1 }}>{a.display.nss.value || '—'}</div>
                            <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)', marginTop: 'var(--sp-05)' }}>Sent. neto</div>
                          </div>
                        </div>
                        <SentimentSplitBar pos={a.pos} neu={a.neu} neg={a.neg} height={5} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>
                          <span style={{ color: cb.color, fontWeight: 600 }}>Riesgo {a.display.crisis.value || '—'}</span>
                          <span className="num" style={{ color: 'var(--text-3)' }}>{fmt(a.totalMentions)} menc.</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actividad — crisisFeed */}
              <div>
                <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <I2.Zap size={12} color="var(--accent)" /> Actividad · escalamientos
                </div>
                <div className="card" style={{ padding: 0, maxHeight: 620, overflowY: 'auto' }}>
                  {feed.length === 0 ? (
                    <div style={{ padding: 'var(--sp-5)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textAlign: 'center' }}>Sin escalamientos en el período.</div>
                  ) : feed.map((f, i) => (
                    <div key={i} style={{
                      padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)',
                      borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                        <span className={`pill ${sevPill(f.severity)}`} style={{ fontSize: 'var(--fs-overline)', padding: '2px 6px' }}>{f.band || f.severity}</span>
                        <span className="mono" style={{ marginLeft: 'auto', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
                          {(() => { try { return new Date(f.triggeredAt).toLocaleString('es-PR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } })()}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--text)' }}>{f.agencyName || f.agencySlug}</div>
                      <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>{f.ruleName}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </ExecStateWrap>
  );
}

// --------------------------------------------------------------------
// RadarScreen — sala situacional de crisis (3 columnas)
// --------------------------------------------------------------------
function RadarScreen({ period }) {
  const { data, loading, error } = useExecOverview(period);
  return (
    <ExecStateWrap loading={loading} error={error} data={data} empty={data && (!data.agencies || data.agencies.length === 0)}>
      {data && (() => {
        const ranked = [...data.agencies].sort((a, b) => (b.crisis || 0) - (a.crisis || 0));
        const maxCrisis = Math.max(0.0001, ...ranked.map((a) => a.crisis || 0));
        const feed = [...(data.crisisFeed || [])];
        const sevOrder = { alta: 0, media: 1, baja: 2 };
        feed.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));
        const sevPill = (sev) => sev === 'alta' ? 'pill-neg' : sev === 'media' ? 'pill-warn' : 'pill-neu';
        // Olas temáticas: agrupadas por agencia (no hay taxonomía cross-agencia).
        const wavesByAgency = {};
        for (const w of (data.topicWaves || [])) {
          (wavesByAgency[w.agencyName] ??= []).push(w);
        }
        const waveGroups = Object.entries(wavesByAgency);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 1.4fr) minmax(240px, 1fr)', gap: 'var(--sp-4)', alignItems: 'start' }}>
            {/* Columna izquierda — ranking por crisis */}
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Riesgo por agencia ▾</div>
              <div className="card" style={{ padding: '6px 0' }}>
                {ranked.map((a) => {
                  const cb = crisisBandPill(a.crisisBand);
                  const w = Math.max(6, ((a.crisis || 0) / maxCrisis) * 100);
                  return (
                    <div key={a.slug} className="row-hover" style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1fr 1.2fr auto', '1fr'), gap: 'var(--sp-2)', alignItems: 'center', padding: '8px 14px' }}>
                      <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</span>
                      <div style={{ height: 6, borderRadius: 'var(--r-sm)', background: 'color-mix(in oklab, var(--text-3) 16%, transparent)', overflow: 'hidden' }}>
                        <div style={{ width: `${w.toFixed(1)}%`, height: '100%', borderRadius: 'var(--r-sm)', background: cb.color }} />
                      </div>
                      <span className="num" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: cb.color, minWidth: 34, textAlign: 'right' }}>{a.display.crisis.value || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Columna central — feed en vivo */}
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                <I2.Radio size={12} color="var(--neg)" /> Escalamientos · orden por severidad
              </div>
              <div className="card" style={{ padding: 0, maxHeight: 640, overflowY: 'auto' }}>
                {feed.length === 0 ? (
                  <div style={{ padding: 'var(--sp-5)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textAlign: 'center' }}>Sin escalamientos en el período.</div>
                ) : feed.map((f, i) => {
                  const cb = crisisBandPill(f.band || (f.severity === 'alta' ? 'ALERTA' : f.severity === 'media' ? 'ELEVADO' : 'NORMAL'));
                  return (
                    <div key={i} className="row-hover" style={{
                      display: 'grid', gridTemplateColumns: '64px auto 1fr', gap: 'var(--sp-3)', alignItems: 'start',
                      padding: '11px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                    }}>
                      <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', paddingTop: 2 }}>
                        {(() => { try { return new Date(f.triggeredAt).toLocaleString('es-PR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } })()}
                      </div>
                      <div>
                        <span className={`pill ${sevPill(f.severity)}`} style={{ fontSize: 'var(--fs-overline)', padding: '2px 6px' }}>
                          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cb.color, marginRight: 4 }} />
                          {f.band || f.severity}
                        </span>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text)' }}>{f.agencyName || f.agencySlug}</div>
                        <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>{f.ruleName}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Columna derecha — olas temáticas por agencia */}
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Olas temáticas · vol ▾</div>
              <div style={{
                fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginBottom: 'var(--sp-2)', lineHeight: 1.5,
                padding: '8px 10px', background: 'var(--canvas-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--hairline)',
              }}>
                Los tópicos están definidos por agencia — no existe (aún) una taxonomía cross-agencia unificada, así que las olas se agrupan por agencia.
              </div>
              <div className="card" style={{ padding: 0, maxHeight: 560, overflowY: 'auto' }}>
                {waveGroups.length === 0 ? (
                  <div style={{ padding: 'var(--sp-5)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textAlign: 'center' }}>Sin tópicos destacados en el período.</div>
                ) : waveGroups.map(([agencyName, waves], gi) => (
                  <div key={agencyName} style={{ borderTop: gi === 0 ? 'none' : '1px solid var(--hairline)' }}>
                    <div className="mono" style={{ padding: '9px 14px 4px', fontSize: 'var(--fs-overline)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', fontFamily: 'var(--ff-mono)', letterSpacing: 'var(--tracking-overline)' }}>{agencyName}</div>
                    {waves.map((w, wi) => {
                      const nssColor = w.nss == null ? 'var(--text-3)' : w.nss > 0 ? 'var(--pos)' : w.nss < 0 ? 'var(--neg)' : 'var(--text-2)';
                      const dArrow = w.volumeDelta > 0 ? '▲' : w.volumeDelta < 0 ? '▼' : '·';
                      const dColor = w.volumeDelta > 0 ? 'var(--pos)' : w.volumeDelta < 0 ? 'var(--neg)' : 'var(--text-3)';
                      return (
                        <div key={w.topicSlug + wi} style={{ padding: '4px 14px 9px', display: 'flex', flexDirection: 'column', gap: 'var(--sp-05)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.topicSlug}</span>
                            <span className="num" style={{ marginLeft: 'auto', fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>{fmt(w.volume)}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: 'var(--fs-overline)' }}>
                            <span style={{ color: dColor, fontWeight: 600 }}>{dArrow} {w.volumeDelta === 0 ? 'estable' : fmt(Math.abs(w.volumeDelta))}</span>
                            <span className="num" style={{ color: nssColor, fontWeight: 600 }}>NSS {w.nss == null ? '—' : (w.nss > 0 ? '+' : '') + w.nss}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </ExecStateWrap>
  );
}

window.ECO_SCREENS = { OverviewScreen, DashboardScreen, MentionsScreen, SearchScreen, SentimentScreen, TopicsScreen, GeographyScreen, AlertsScreen, SettingsScreen, NarrativeScreen, TablaScreen, SalaScreen, RadarScreen };
