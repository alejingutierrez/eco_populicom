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
// Polarización llega 0-100. Colores de la rampa de VEREDICTO (tokens.css §6):
//  · 'Apática' iba en --text-3, un escalón de TEXTO usado como relleno de datos
//    (para eso existe --neu);
//  · 'Moderada' iba en --warn, el MISMO ámbar que 'Débil' de Brand Health en la
//    card de al lado: un estado aceptable y un estado malo con el mismo color a
//    200px de distancia. Pasa a --verdict-1, el paso "aceptable";
//  · 'Alta' iba en --metric-polarization, que es el color de ESTA métrica en las
//    series y en su icono, así que el violeta significaba a la vez "polarización"
//    y "una de sus bandas".
const POLARIZATION_BANDS = [
  { from: 0,  to: 30,  label: 'Apática',  color: 'var(--neu)' },
  { from: 30, to: 60,  label: 'Moderada', color: 'var(--verdict-1)' },
  { from: 60, to: 85,  label: 'Alta',     color: 'var(--verdict-3)' },
  { from: 85, to: 100, label: 'Extrema',  color: 'var(--verdict-4)' },
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
        padding: 'var(--sp-5)', position: 'relative', overflow: 'hidden',
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
        {IconC && <div style={{ width: 26, height: 26, borderRadius: 'var(--r-md)', background: `color-mix(in oklab, ${accent} 14%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}><IconC size={14} color={accent} /></div>}
        {/* El label envuelve por PALABRA, nunca por letra. `overflowWrap:'anywhere'`
            resolvía el desborde partiendo el rótulo: en 390px se leía "RIESG/O DE/
            CRISI/S" y en desktop "POLARIZ/ACIÓN". La causa real no era el label sino
            la acción "Detalles", que competía por el mismo renglón y nunca cedía
            (flexShrink:0); ahora vive en el pie de la card, así que aquí sobra ancho. */}
        <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', minWidth: 0, overflowWrap: 'break-word', hyphens: 'none' }}>{label}</div>
        {tone && <span className={`pill pill-${tone}`} style={{ marginLeft: 'auto', flexShrink: 0 }}>{toneLabel || (tone === 'neg' ? 'Alerta' : tone === 'warn' ? 'Elevado' : 'Normal')}</span>}
      </div>
      {wordMode ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: valueColor || (valueTone ? (TONE_C[valueTone] || 'var(--text)') : 'var(--text)'), lineHeight: 1.1, fontFamily: 'var(--ff-display)' }}>{valueWord}</div>
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
          <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: 'var(--text)', lineHeight: 1, fontFamily: 'var(--ff-display)' }}>{value}</div>
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
        <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-3)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--sp-05)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
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
function DashboardScreen({ onMentionClick, period, setPeriod, setActive, agency }) {
  const m = D.CURRENT_METRICS;
  const cb = crisisBand(m && m.crisisRiskScore);
  // Default: solo "Menciones" (issue #6). El usuario puede sumar series con
  // los chips, máx 3 a la vez.
  const [activeMetrics, setActiveMetrics] = useState(['totalMentions']);
  // Modo del Resumen ejecutivo: signal | emerging | crisis. El backend
  // devuelve D.BRIEFING como objeto con esas 3 claves.
  const [focus, setFocus] = useState('signal');
  const [slice, setSlice] = useState(null);
  const [metricModal, setMetricModal] = useState(null);

  // Resumen ejecutivo activo según `focus`. Si el backend solo devolvió el
  // shape antiguo (un solo briefing), fallback a él para no romper la UI.
  const briefingByMode = (D.BRIEFING && typeof D.BRIEFING === 'object' && D.BRIEFING.signal !== undefined)
    ? D.BRIEFING
    : null;
  const activeBriefing = briefingByMode
    ? (briefingByMode[focus] || briefingByMode.signal || null)
    : D.BRIEFING;

  // Helper para clicks en KPIs del Scorecard. Usa el period preset (no
  // periodStart/periodEnd) porque DashboardScreen consume /api/eco-data que
  // no expone esos campos; el endpoint /api/eco-metric-insight resolverá la
  // ventana con closedWindowYmdInTZ del period preset.
  function openKpiInsight(metric, value, accent) {
    const labels = {
      crisis: 'Riesgo de crisis',
      polarization: 'Polarización',
      nss: 'Net Sentiment Score',
      bhi: 'Brand Health',
      volume: 'Volumen',
    };
    const filter = metric === 'crisis' ? { sentiment: 'negativo', pertinence: 'alta' }
      : metric === 'nss' ? { sentiment: 'negativo' }
      : metric === 'polarization' ? {}
      : {};
    openMetricInsightShared(setSlice, {
      metric, value, accent,
      label: labels[metric] || metric,
      periodPreset: period || '7D',
      agency,
      subcomponents: [],
      filter,
    });
  }

  const seriesConfig = [
    { key: 'nss', label: 'NSS', color: 'var(--accent)' },
    { key: 'brandHealthIndex', label: 'Brand Health', color: 'var(--pos)' },
    { key: 'totalMentions', label: 'Menciones', color: 'var(--text-2)' },
    { key: 'crisisRiskScore', label: 'Crisis', color: 'var(--neg)' },
    { key: 'polarizationIndex', label: 'Polarización', color: window.ECO_METRIC_COLOR.polarizationIndex },
    { key: 'engagementRate', label: 'Engagement', color: 'var(--warn)' },
  ];

  function openTimelineDaySlice(d, idx) {
    const total = Math.round((d.totalMentions || d.positivo + d.neutral + d.negativo) || 0);
    const bias = d.negativo > d.positivo ? 'negativo' : d.positivo > d.negativo ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)';
    const dayIso = d.fullDate ? d.fullDate.slice(0, 10) : undefined;
    // Sin histogram: el "Volumen por hora" que se mostraba aquí era una
    // senoide sintética, no datos (auditoría 2026-08). Y no se puede rellenar
    // con HOUR_HEATMAP: eso agrega por día-de-semana sobre TODO el período, no
    // por fecha. Derivarlo de las 20 menciones del modal sería otro invento.
    // Requiere una serie real por hora en el backend. El datapoint del
    // TIMELINE cuenta el universo pertinente — igual que el default del modal.
    setSlice({
      eyebrow: d.date,
      title: `NSS ${d.nss > 0 ? '+' : ''}${(d.nss ?? 0).toFixed(1)}`,
      accent, volume: total,
      sentiment: { pos: d.positivo || 0, neu: d.neutral || 0, neg: d.negativo || 0 },
      mentions: [],
      _filter: { day: dayIso },
    });
  }

  function openSourceSlice(src) {
    const key = src.key;
    // Paleta categórica, no semántica: antes "Noticias" era var(--pos) —verde—
    // a 300px de barras donde el verde significa "positivo", así que la
    // categoría se leía como un juicio.
    const colors = window.ECO_SOURCE_COLOR;
    setSlice({
      eyebrow: 'Fuente',
      title: src.label,
      accent: colors[key] || 'var(--accent)',
      mentions: [],
      // TOP_SOURCES cuenta la ventana cerrada de eco-data en el universo
      // pertinente — el mismo default del modal; solo viaja la ventana.
      _filter: { ...ecoDataWindow(), source: key },
    });
  }

  function openHeatmapSlice(cell) {
    setSlice({
      eyebrow: `${cell.dayLabel} · ${String(cell.hour).padStart(2,'0')}:00 – ${String(cell.hour).padStart(2,'0')}:59`,
      title: 'Franja horaria',
      accent: 'var(--accent)',
      mentions: [],
      _filter: { ...ecoDataWindow(), dow: cell.day, hour: cell.hour },
    });
  }

  function openTopicSlice(t) {
    const palette = window.ECO_CAT;
    const slugIdx = {};
    D.TOPICS.forEach((tp, i) => { slugIdx[tp.slug] = i; });
    const accent = palette[slugIdx[t.slug] % palette.length] || 'var(--accent)';
    setSlice({
      eyebrow: 'Tópico',
      title: t.name,
      accent,
      mentions: [],
      // TOPICS.count es primario (default del modal) sobre la ventana de
      // eco-data en el universo pertinente (default del endpoint).
      _filter: { ...ecoDataWindow(), topic: t.slug },
    });
  }

  function openBriefingSlice() {
    // Hero CTA opens the mention slice for the actual dominant topic reported
    // by the active briefing mode (falls back to the first topic by volume).
    const briefingTopicName = (activeBriefing && activeBriefing.dominantSignal || '').split(' · ')[0];
    const topic = (briefingTopicName && D.TOPICS.find(t => t.name === briefingTopicName)) || D.TOPICS[0];
    if (topic) openTopicSlice(topic);
  }

  function openMetric(key, label, accent) {
    let value = null;
    if (m) {
      if (key === 'crisis') value = m.crisisRiskScore;
      else if (key === 'volume') value = m.totalMentions;
      // BHI: el cálculo interno es 0-1 pero la UI presenta 1-10 (1=crítico,
      // 10=fuerte). Pre-convertimos el placeholder para que el modal hable
      // SIEMPRE en la misma escala — antes el headline saltaba de "0.6"
      // (mientras cargaba el fetch) a "59.5" (después, por una segunda
      // multiplicación errónea contra el valor ya escalado del API).
      else if (key === 'bhi') value = m.brandHealthIndex != null
        ? Number((1 + m.brandHealthIndex * 9).toFixed(1))
        : null;
      else if (key === 'polarization') value = m.polarizationIndex;
      else value = m.nss;
    }
    // Display legible inicial (palabra + número) mientras carga el insight AI;
    // evita el parpadeo del valor crudo "0.59" en el headline del drawer.
    const dsp = (m && m.display) || {};
    const valueDisplay = key === 'crisis' ? dsp.crisis
      : key === 'bhi' ? dsp.brandHealth
      : key === 'polarization' ? dsp.polarization
      : key === 'nss' ? dsp.nss
      : null;
    setMetricModal({ metricKey: key, value, label, accent, valueDisplay });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* ── Executive Briefing (3 modos: signal | emerging | crisis) ── */}
      <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gridTemplateColumns: window.ecoCols('1.2fr 1fr', '1fr'), gap: 'var(--sp-6)', alignItems: 'stretch' }}>
        <div>
          <div className="section-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <span>Resumen ejecutivo · {(activeBriefing && activeBriefing.eyebrow) || new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            {activeBriefing && activeBriefing.source === 'ai' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-fill)', padding: '2px 6px', borderRadius: 'var(--r-sm)', letterSpacing: '0.05em' }}>
                <Icons.Sparkles size={9} /> IA · {activeBriefing.generatedAtLabel || 'reciente'}
              </span>
            )}
            {activeBriefing && activeBriefing.source === 'rule' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', background: 'var(--canvas-2)', padding: '2px 6px', borderRadius: 'var(--r-sm)', letterSpacing: '0.05em' }}>
                Resumen automatizado
              </span>
            )}
          </div>
          {/* Fuente reducida a 18px y line-height 1.45 (issue #1). Narrativas
              cap a 75 palabras desde el prompt. */}
          <div style={{ fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-title-lg)', fontWeight: 500, lineHeight: 1.45, letterSpacing: 'var(--letter-display)', marginTop: 'var(--sp-3)', color: 'var(--text)' }}>
            {activeBriefing ? (
              <span dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(activeBriefing.narrativeHtml || '') }} />
            ) : (
              <>Sin suficientes menciones en este período para generar un resumen.</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-4)', fontSize: 'var(--fs-caption)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Señal dominante</div>
              <div style={{ color: 'var(--text)', fontWeight: 600, marginTop: 'var(--sp-05)' }}>{(activeBriefing && activeBriefing.dominantSignal) || '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Alcance del período</div>
              <div className="num" style={{ color: 'var(--text)', fontWeight: 600, marginTop: 'var(--sp-05)' }}>{(activeBriefing && activeBriefing.reachLabel) || (m?.totalReach ? fmt(m.totalReach) + ' impresiones' : '—')}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Siguiente paso</div>
              <div style={{ color: `var(--${activeBriefing && activeBriefing.actionTone === 'neg' ? 'neg' : activeBriefing && activeBriefing.actionTone === 'pos' ? 'pos' : activeBriefing && activeBriefing.actionTone === 'warn' ? 'warn' : 'text'})`, fontWeight: 600, marginTop: 'var(--sp-05)' }}>{(activeBriefing && activeBriefing.action) || 'Explorar tópicos activos →'}</div>
            </div>
          </div>
          <div style={{ marginTop: 'var(--sp-5)', display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={openBriefingSlice} style={{ fontSize: 'var(--fs-caption)' }}>
              <Icons.Eye size={13} /> Ver menciones
            </button>
            <span aria-hidden="true" style={{ width: 1, height: 16, background: 'var(--hairline)', margin: '0 var(--sp-1)' }} />
            <button className={`chip ${focus === 'signal' ? 'active' : ''}`} onClick={() => setFocus('signal')}>Señal del día</button>
            <button className={`chip ${focus === 'emerging' ? 'active' : ''}`} onClick={() => setFocus('emerging')}>Narrativas emergentes</button>
            <button className={`chip ${focus === 'crisis' ? 'active' : ''}`} onClick={() => setFocus('crisis')}>Vigilancia de crisis</button>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--hairline)', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pulso en vivo · últimas menciones</div>
          {(D.PULSE || []).map((e, i) => (
            <button key={i} onClick={() => e.mention && onMentionClick(e.mention)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)', fontSize: 'var(--fs-caption)', background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
              className="row-hover">
              {/* Sin `.mono`: tokens.css §1 reserva IBM Plex Mono para lo que es
                  literalmente código/URL/ID, y "hace 3 h" es prosa. La misma marca
                  temporal se compone en sans en la tabla de "Menciones destacadas"
                  de más abajo: el mismo dato con dos familias tipográficas. */}
              <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)', marginTop: 'var(--sp-05)', width: 54, flexShrink: 0 }}>{e.time}</span>
              <span className="dot" style={{ background: `var(--${e.dot})`, marginTop: 'var(--sp-15)', flexShrink: 0 }} />
              <span style={{ flex: 1, color: 'var(--text)' }}>{e.text}</span>
              {/* Mismo formateador que la tabla de abajo (fmt). El payload trae `eng`
                  pre-formateado con su propia regla (K a partir de 1000, sin escalón
                  M y sin separador de miles), así que la MISMA mención podía leerse
                  "1500.0K" aquí y "1.5M" doce filas más abajo. Se reformatea desde el
                  crudo, que viaja en `e.mention`; `e.eng` queda de respaldo. */}
              <span className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>
                {e.mention && Number.isFinite(Number(e.mention.engagement))
                  ? (Number(e.mention.engagement) > 0 ? fmt(Number(e.mention.engagement)) : '—')
                  : e.eng}
              </span>
            </button>
          ))}
          {!(D.PULSE && D.PULSE.length > 0) && (
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>Sin actividad reciente en el período.</div>
          )}
        </div>
      </div>

      {/* ── Hero KPIs: NSS + Crisis prominent. Click → modal con serie temporal e insight AI. ── */}
      {/* Móvil en UNA columna, no dos. A 390px cada card de dos columnas deja ~133px
          de content box: ahí no cabe el rótulo (se leía "VOLU/MEN ·/PERÍO/DO") ni la
          serie (el sparkline de 200px se cortaba dentro del overflow:hidden). A una
          columna el rótulo entra en un renglón y la gráfica mide lo que mide la card.
          Cuesta scroll; es el intercambio correcto para cinco cifras que se leen. */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1.3fr 1.3fr 1fr 1fr 1fr', '1fr', 'repeat(3, 1fr)'), gap: 'var(--sp-3)' }}>
        <KpiCard label="Net Sentiment Score" valueWord={m.display.nss.word} valueTone={m.display.nss.tone} value={m.display.nss.value} deltaInfo={m.deltaDisplay.nss} icon="Activity" accent="var(--accent)" highlight trendData={D.TIMELINE.map(t => t.nss)}
          onClick={() => openMetric('nss', 'Net Sentiment Score', 'var(--accent)')}>
          <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginTop: -4 }}>
            <span>7d <strong className="num" style={{ color: 'var(--text-2)' }}>{m.nss7d != null ? (m.nss7d > 0 ? '+' : '') + m.nss7d : '—'}</strong></span>
            <span>30d <strong className="num" style={{ color: 'var(--text-2)' }}>{m.nss30d != null ? (m.nss30d > 0 ? '+' : '') + m.nss30d : '—'}</strong></span>
          </div>
        </KpiCard>
        <KpiCard label="Riesgo de crisis" valueWord={m.display.crisis.word} valueTone={m.display.crisis.tone} valueColor={bandColorAt(CRISIS_BANDS, m.crisisRiskScore, 1)} value={m.display.crisis.value} deltaInfo={m.deltaDisplay.crisis} icon="Shield" accent="var(--neg)" highlight
          onClick={() => openMetric('crisis', 'Riesgo de crisis', 'var(--neg)')}>
          {/* Crisis V4 (0–1): combinación ponderada (0.5 severidad + 0.3 velocidad
              + 0.2 relevancia)·confianza, SIN gate. Bandas NORMAL<0.25 /
              ELEVADO<0.40 / ALERTA<0.60 / CRISIS≥0.60 (mismos cortes que el
              termómetro de Overview y el bandFor del backend). */}
          <div style={{ marginTop: -2 }}>
            <BandScale bands={CRISIS_BANDS} value={m.crisisRiskScore} max={1}
              valueLabel={m.display.crisis.short} ariaLabel="Riesgo de crisis" />
          </div>
        </KpiCard>
        <KpiCard label="Volumen · período" value={fmt(window.ecoPeriodMentionTotal())} deltaInfo={m.deltaDisplay.totalMentions} metricKey="totalMentions" sub="vs período ant." icon="MessageSquare" accent="var(--text-2)" trendData={D.TIMELINE.map(t => t.totalMentions)}
          onClick={() => openMetric('volume', 'Volumen de menciones', 'var(--text-2)')} />
        {/* Brand Health en escala 1–10 (display): cálculo interno sigue siendo
            0–1 (backtest 482d). UI maps display = 1 + valor*9 para que 1 = crítico
            y 10 = fuerte. Bandas semánticas: 1–4 crítico, 4–6 débil, 6–8 sano, 8–10 fuerte. */}
        <KpiCard label="Brand Health" valueWord={m.display.brandHealth.word} valueTone={m.display.brandHealth.tone} valueColor={bandColorAt(BHI_BANDS, m.brandHealthIndex, 1)} value={m.display.brandHealth.value} deltaInfo={m.deltaDisplay.brandHealth} icon="Heart" accent="var(--pos)"
          onClick={() => openMetric('bhi', 'Brand Health Index', 'var(--pos)')}>
          <BrandHealthMini value={m.brandHealthIndex ?? 0} />
        </KpiCard>
        {/* Polarization Index: distingue polarización (50/50 pos vs neg) de apatía (todo neutral) cuando NSS≈0.
            Solo es útil leído junto con NSS — alta polarización + NSS bajo = crisis emergente. */}
        <KpiCard label="Polarización" valueWord={m.display.polarization.word} valueTone={m.display.polarization.tone} valueColor={bandColorAt(POLARIZATION_BANDS, m.polarizationIndex, 100)} value={m.display.polarization.value} sub="opinión vs neutral" deltaInfo={m.deltaDisplay.polarization} icon="Polarization" accent="var(--metric-polarization)"
          onClick={() => openMetric('polarization', 'Polarización', 'var(--metric-polarization)')}>
          {/* UNA sola gráfica por KPI. Esta era la única card con sparkline Y banda:
              dos escalas distintas para la misma cifra, y como la fila se alinea al
              alto de la card más alta, esos ~42px extra son los que dejaban 88/85/84px
              de vacío en las otras cuatro. Se queda la banda, que es la que dice dónde
              cae el valor contra sus umbrales; la tendencia vive en "Evolución
              multi-métrica" y en el modal de la métrica. */}

          <div style={{ marginTop: -2 }}>
            <BandScale bands={POLARIZATION_BANDS} value={m.polarizationIndex} max={100}
              valueLabel={m.display.polarization.short} ariaLabel="Índice de polarización" />
          </div>
        </KpiCard>
      </div>

      {/* ── Row 2: Timeline ocupa todo el ancho (issue #5 eliminó pie de sentimiento) ── */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Evolución multi-métrica</div>
            <div className="card-hd-sub">Selecciona hasta 3 series · pasa el cursor para ver valores</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-15)', flexWrap: 'wrap' }}>
            {seriesConfig.map((s) => {
              const on = activeMetrics.includes(s.key);
              return (
                <button key={s.key} onClick={() => {
                  if (on) setActiveMetrics(activeMetrics.filter(k => k !== s.key));
                  else if (activeMetrics.length < 3) setActiveMetrics([...activeMetrics, s.key]);
                }} className="touch-target" style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--sp-15)',
                  padding: '5px 10px', borderRadius: 'var(--r-pill)',
                  fontSize: 'var(--fs-overline)', fontWeight: 600,
                  border: `1px solid ${on ? s.color : 'var(--hairline)'}`,
                  background: on ? s.color : 'transparent',
                  color: on ? 'var(--on-accent)' : 'var(--text-2)',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'currentColor' : s.color }} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="card-bd">
          {/* Issue #6: sin selector de timeframe local — el header global lo cubre. */}
          <MultiLineChart data={D.TIMELINE} series={seriesConfig.filter(s => activeMetrics.includes(s.key))} height={240} onPointClick={openTimelineDaySlice} />
        </div>
      </div>

      {/* ── Row 3: Topics (emerging) + Sources + Heatmap ── */}
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('1.2fr 1fr 1fr', '1fr'), gap: 'var(--sp-3)' }}>
        <div className="card">
          <div className="card-hd">
            <div><div className="card-hd-title">Tópicos emergentes</div><div className="card-hd-sub">Ordenados por crecimiento</div></div>
            {/* Una sola primitiva para "ir a la pantalla completa". En esta misma
                vista convivían un chip ("Ver todo"), un link ("Ver todas (1.3K) →")
                y un texto en --accent con flecha. El chip es para SELECCIONAR, no
                para navegar: aquí va la misma primitiva que el header de
                "Menciones destacadas". La base de `button` en index.html ya quita
                borde, relleno y padding. */}
            <button className="link" onClick={() => setActive && setActive('topics')} style={{ fontSize: 'var(--fs-caption)', flexShrink: 0 }}>Ver todo →</button>
          </div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            {/* `top5` (3er argumento de map) da el máximo de la lista sin hoistear
                una const: lo necesita la barra para escalar su ancho al conteo. */}
            {D.TOPICS.slice(0, 5).map((t, _i, top5) => (
              <div key={t.slug} onClick={() => openTopicSlice(t)} className="row-hover" style={{ padding: '8px 10px', marginInline: -10, borderRadius: 'var(--r-md)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', marginBottom: 'var(--sp-15)' }}>
                  <div style={{ flex: 1, fontSize: 'var(--fs-body-sm)', fontWeight: 500, color: 'var(--text)' }}>{t.name}</div>
                  <span className="num" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600 }}>{fmt(t.count)}</span>
                  {/* El crecimiento de un tópico es VOLUMEN. Aquí se pintaba toda
                      SUBIDA en --neg mientras el KPI de Volumen pinta la BAJADA en
                      --neg: el mismo dato con colores opuestos en la misma pantalla.
                      DeltaBadge lo enruta por ECO_METRIC_DIRECTION, donde el volumen
                      es neutro, y usa el mismo glifo que el resto del producto. */}
                  <span style={{ minWidth: 40, textAlign: 'right', display: 'inline-block' }}>
                    <DeltaBadge value={t.delta} metricKey="volume" suffix="%" />
                  </span>
                </div>
                {/* El ANCHO total mide el conteo; los segmentos, la composición.
                    Antes la barra se normalizaba al 100% en las cinco filas, así que
                    "Desarrollo económico" (253) y "Turismo y promoción" (133) tenían
                    barras idénticas — y a 20px de distancia la barra de "Fuentes top"
                    (misma familia visual, mismo alto, misma clase de track) sí mide
                    volumen. El lector no tenía forma de saber cuál leía. Ahora la
                    longitud significa lo mismo en las dos cards. El neutral pasa a
                    --neu, el token de relleno neutro; --text-3 es un escalón de TEXTO. */}
                <div className="bar-track" style={{ height: 4 }}>
                  <div style={{ display: 'flex', height: '100%', width: `${Math.round(((t.count || 0) / Math.max(1, ...top5.map((x) => x.count || 0))) * 100)}%`, borderRadius: 'inherit', overflow: 'hidden' }}>
                    <div style={{ width: `${t.positivePct}%`, background: 'var(--pos)' }} />
                    <div style={{ width: `${t.neutralPct}%`, background: 'var(--neu)' }} />
                    <div style={{ width: `${t.negativePct}%`, background: 'var(--neg)' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Fuentes top</div><div className="card-hd-sub">Por volumen · 30d</div></div></div>
          <div className="card-bd">
            <HBarList
              items={D.TOP_SOURCES.map(s => ({ label: s.source, value: s.count, key: s.key }))}
              colorFn={(it) => window.ecoSourceColor(it.key)}
              onItemClick={openSourceSlice}
            />
          </div>
        </div>

        <HourActivityCard onCellClick={openHeatmapSlice} />
      </div>

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
      {metricModal && MetricInsightModal && (
        <MetricInsightModal
          metricKey={metricModal.metricKey}
          value={metricModal.value}
          valueDisplay={metricModal.valueDisplay}
          label={metricModal.label}
          accent={metricModal.accent}
          period={period}
          agency={localStorage.getItem('eco.agency') || (window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || ''}
          onClose={() => setMetricModal(null)}
        />
      )}

      {/* ── Recent mentions table (dense) — issue #9: sin columna pertinencia,
          engagement=0 muestra "—". El backend ya excluye twitter y baja
          pertinencia del feed. ── */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Menciones destacadas</div><div className="card-hd-sub">Más recientes · sin twitter ni baja pertinencia</div></div>
          <a href="#mentions" className="link" style={{ fontSize: 'var(--fs-caption)' }}>Ver todas ({fmt(window.ecoPeriodMentionTotal())}) →</a>
        </div>
        <div className="scroll-x">
          {D.MENTIONS.slice(0, 7).map((mn, idx) => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
            return (
              <div key={mn.id} onClick={() => onMentionClick(mn)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '20px 2fr 130px 100px 100px', minWidth: 560, gap: 'var(--sp-3)',
                  alignItems: 'center', padding: '10px 16px',
                  borderTop: idx > 0 ? '1px solid var(--hairline)' : 'none',
                  fontSize: 'var(--fs-caption)', cursor: 'pointer',
                }}>
                <SIcon size={14} color="var(--text-3)" />
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.title}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.author} · {mn.domain}</div>
                </div>
                <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
                <span className="num" style={{ color: 'var(--text-2)', fontWeight: 600, textAlign: 'right' }}>{mn.engagement > 0 ? fmt(mn.engagement) : '—'}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.publishedAt}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- BrandHealthMini: gauge segmentado. Internamente trabaja con value 0..1
//     (output del backtest), pero el label de la banda y los hitos se muestran
//     en escala 1–10 para alinearse con la presentación del KpiCard.
//     Segmentos (valor interno): Crítico (0-.4), Débil (.4-.6), Sano (.6-.8), Fuerte (.8-1).
//     Equivalente en escala 1-10: 1-4.6, 4.6-6.4, 6.4-8.2, 8.2-10.
function BrandHealthMini({ value }) {
  // Antes: 4 segmentos con flex proporcional + 5 números repartidos con
  // space-between. Los números marcaban los BORDES pero no decían qué significa
  // cada tramo, y al subir la escala tipográfica se apretaban.
  return (
    <div style={{ marginTop: -2 }}>
      <BandScale bands={BHI_BANDS} value={value} max={1} height={8}
        valueLabel={`${(1 + (value || 0) * 9).toFixed(1)} / 10`} ariaLabel="Brand Health" />
    </div>
  );
}

// Escala secuencial del heatmap y del mapa. Los 6 pasos viven en tokens.css
// (--seq-0..5); aquí sólo está el orden, para que la LEYENDA y las CELDAS no
// puedan divergir (era el hallazgo F6).
const SEQ_STEPS = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
function seqColor(intensity) {
  const i = Math.round(Math.min(1, Math.max(0, intensity || 0)) * (SEQ_STEPS.length - 1));
  return SEQ_STEPS[i];
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

// --- HourActivityCard: heatmap fed from window.ECO_DATA.HOUR_HEATMAP ---
function HourActivityCard({ onCellClick }) {
  const data = React.useMemo(() => {
    const remote = window.ECO_DATA && window.ECO_DATA.HOUR_HEATMAP;
    if (Array.isArray(remote) && remote.length === 7 * 24) return remote;
    // Fallback stub if backend hasn't populated it yet — flat, near-zero.
    return Array.from({ length: 7 * 24 }, () => 0);
  }, []);
  const max = Math.max(1, ...data);
  const peakIdx = data.indexOf(Math.max(...data));
  const peakDay = Math.floor(peakIdx / 24);
  const peakHour = peakIdx % 24;
  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const total = data.reduce((s, v) => s + v, 0);

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Actividad por hora</div>
          <div className="card-hd-sub">Distribución por día y hora (TZ Puerto Rico) · click una franja</div>
        </div>
        {/* F6: la leyenda pintaba sus swatches con rgba(11,95,128,…) — el AZUL del
            tema `costa` — mientras las celdas iban en el naranja de `mando`.
            Leyenda y mapa no coincidían. Ahora ambos leen la MISMA escala
            secuencial --seq-*. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
          <span>menos</span>
          <div style={{ display: 'flex', gap: 'var(--sp-05)' }}>
            {SEQ_STEPS.map((t, i) => (
              <div key={i} style={{ width: 10, height: 10, background: t, borderRadius: 'var(--r-sm)' }} />
            ))}
          </div>
          <span>más</span>
        </div>
      </div>
      <div className="card-bd">
        <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', marginBottom: 'var(--sp-3)', padding: '6px 10px', background: 'color-mix(in oklab, var(--accent) 6%, var(--canvas))', borderRadius: 'var(--r-sm)', borderLeft: '2px solid var(--accent)' }}>
          Pico de actividad: <strong>{dayLabels[peakDay]} a las {peakHour}:00</strong>
        </div>
        <Heatmap
          data={data}
          colorFn={(v) => seqColor(max > 0 ? Math.min(1, v / max) : 0)}
          onCellClick={onCellClick}
        />
      </div>
    </div>
  );
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
      accent: 'var(--neg)',
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
          {[{ k: 'all', l: 'Todas' }, { k: 'positivo', l: 'Positivo', tone: 'pos' }, { k: 'neutral', l: 'Neutral' }, { k: 'negativo', l: 'Negativo', tone: 'neg' }].map((x) => (
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
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--sp-15)' }}>Tópico</div>
              <select className="input" value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} style={{ width: '100%', marginBottom: 'var(--sp-3)' }}>
                <option value="">Todos los tópicos</option>
                {topicsList.map((t) => <option key={t.slug} value={t.slug}>{t.name || t.slug}</option>)}
              </select>
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--sp-15)' }}>Región</div>
              <select className="input" value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))} style={{ width: '100%', marginBottom: 'var(--sp-3)' }}>
                <option value="">Todas las regiones</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--sp-15)' }}>Ordenar por</div>
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
        <QuickMetric
          label={`Virales (${VIRAL_THRESHOLD_LABEL})`}
          value={viralCount == null ? '…' : fmt(viralCount)}
          tone="neg"
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
function MentionsList({ mentions, onMentionClick, highlight }) {
  return (
    <div className="scroll-x">
      <div style={{ padding: '10px 16px 6px', display: 'grid', gridTemplateColumns: '20px 2fr 110px 110px 80px 30px', minWidth: 620, gap: 'var(--sp-3)', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--hairline)' }}>
        <span /><span>Mención</span><span>Sentimiento</span><span>Tópico</span><span>Hora</span><span />
      </div>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
        return (
          <div key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover"
            style={{ display: 'grid', gridTemplateColumns: '20px 2fr 110px 110px 80px 30px', minWidth: 620, gap: 'var(--sp-3)', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-caption)', cursor: 'pointer' }}>
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
            <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-overline)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.topicName || mn.topic || '—'}</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
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
              <th key={c} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{c}</th>
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
    { k: 'neutral', l: 'Neutral', tone: null, count: data.sentiment.neu },
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

  function openGroupSlice(row, sentimentType) {
    const accent = sentimentType === 'positivo' ? 'var(--pos)' : sentimentType === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    const label = row.label;
    // Las tablas "Sentimiento por X" cuentan la ventana de eco-data en el
    // universo pertinente — la modal hereda la ventana.
    const filter = { ...ecoDataWindow(), sentiment: sentimentType };
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
      title: `Sentimiento ${sentimentType}`,
      accent,
      mentions: [],
      _filter: filter,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Narrative hero */}
      <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gridTemplateColumns: window.ecoCols('1fr auto', '1fr'), gap: 'var(--sp-6)', alignItems: 'center' }}>
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
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-2)', marginTop: 'var(--sp-3)', maxWidth: 640, lineHeight: 1.55 }}>
            Sentimiento neto dentro de rango positivo, pero deterioro acelerado por discurso sobre infraestructura vial. Emociones dominantes de las últimas 24 horas: <strong>frustración</strong> y <strong>enojo</strong>.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)' }}>
          <div>
            <Donut data={D.SENTIMENT_BREAKDOWN} size={110} thickness={14} colors={['var(--pos)', 'var(--text-3)', 'var(--neg)']} />
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
              colors={['var(--pos)', 'var(--text-3)', 'var(--neg)']} height={260} onPointClick={openTimelineDaySlice} />
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
            <div className="card-hd-sub">Distribución normalizada · click un segmento para ver menciones</div>
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
              <div key={`${groupBy}-${s.label}-${idx}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-caption)', marginBottom: 'var(--sp-1)' }}>
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 60px)' }}>{s.label}</span>
                  <span className="num" style={{ color: 'var(--text-3)' }}>{fmt(total)}</span>
                </div>
                {/* 24px de alto: mínimo de objetivo de WCAG 2.2 AA. Antes eran 12px. */}
                <div style={{ display: 'flex', height: 24, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--canvas-2)' }}>
                  <button onClick={() => openGroupSlice(s, 'positivo')} aria-label={`${s.label}: ${pos}% positivo, ver menciones`} title={`${pos}% positivo — click para ver menciones`}
                    style={{ width: `${pos}%`, background: 'var(--pos)', border: 'none', cursor: 'pointer', padding: 0 }} />
                  <button onClick={() => openGroupSlice(s, 'neutral')} aria-label={`${s.label}: ${neu}% neutral, ver menciones`} title={`${neu}% neutral — click para ver menciones`}
                    style={{ width: `${neu}%`, background: 'var(--text-3)', border: 'none', cursor: 'pointer', padding: 0 }} />
                  <button onClick={() => openGroupSlice(s, 'negativo')} aria-label={`${s.label}: ${neg}% negativo, ver menciones`} title={`${neg}% negativo — click para ver menciones`}
                    style={{ width: `${neg}%`, background: 'var(--neg)', border: 'none', cursor: 'pointer', padding: 0 }} />
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
              </div>
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
                  gap: window.ecoCols('var(--sp-3)', 'var(--sp-2)'), alignItems: 'center',
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
                <span style={{ textAlign: 'right' }}>
                  <span className="num" style={{ display: 'block', color: 'var(--text-2)', fontWeight: 600, fontSize: 'var(--fs-caption)', lineHeight: 1.1 }}>{fmt(e.count)}</span>
                  <span className="num" style={{ display: 'block', color: 'var(--text-3)', fontSize: 'var(--fs-overline)', marginTop: 'var(--sp-05)' }}>{pct.toFixed(1)}%</span>
                </span>
                <Icons.ArrowRight size={11} color="var(--text-3)" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =============== TOPICS ===============
function TopicsScreen({ onMentionClick }) {
  // The open topic lives in the URL (/topics/<slug>) so the browser Back button
  // returns to the topic list (not the previous screen) and a topic is
  // deep-linkable / shareable. `selected` mirrors the URL slug.
  const topicSlugFromUrl = () => {
    const m = location.pathname.match(/^\/topics\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const [selected, setSelectedRaw] = useState(topicSlugFromUrl); // null = overview, else slug for drill-in
  const [view, setView] = useState('treemap'); // treemap | bubbles | list
  const [dayModal, setDayModal] = useState(null); // { date, fullDate, topicSlug, topicName, volume, sentiment }

  const openTopic = React.useCallback((slug) => {
    if (!slug) return;
    history.pushState({ eco: 'topics', topic: slug, fromList: true }, '', '/topics/' + encodeURIComponent(slug));
    setSelectedRaw(slug);
  }, []);
  const closeTopic = React.useCallback(() => {
    // Drilled in from the list this session → go Back so the pushed entry is
    // consumed and Back/forward stay consistent. On a cold deep-link there is no
    // list entry to return to, so rewrite the URL in place instead.
    if (history.state && history.state.fromList) history.back();
    else { history.replaceState({ eco: 'topics' }, '', '/topics'); setSelectedRaw(null); }
  }, []);
  // Sync on browser Back/forward (popstate) and on sidebar re-clicks that reset
  // the section (eco:locationchange, fired by App.setActive).
  React.useEffect(() => {
    const sync = () => setSelectedRaw(topicSlugFromUrl());
    window.addEventListener('popstate', sync);
    window.addEventListener('eco:locationchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('eco:locationchange', sync);
    };
  }, []);

  const sel = selected ? D.TOPICS.find(t => t.slug === selected) : null;
  const subs = sel ? (D.SUBTOPICS[sel.slug] || []) : [];

  // URL points at a topic absent from the current dataset (stale link, or
  // filtered out by the active period) → drop the drill-in and clean the URL.
  React.useEffect(() => {
    if (selected && !sel) {
      history.replaceState({ eco: 'topics' }, '', '/topics');
      setSelectedRaw(null);
    }
  }, [selected, sel]);

  // Real "topic of the day" data viene del endpoint (TOPIC_CALENDAR), que
  // agrupa mention_topics por (published_at AT TZ AST)::date y se queda con
  // el top-1 tópico por día. El backend ya respeta el periodo seleccionado
  // (35d para periodos cortos, hasta 365d para "1A"/"Max"), así que aquí
  // pasamos toda la lista — el render por semanas se encarga.
  const calendarData = React.useMemo(() => {
    return (D.TOPIC_CALENDAR || []).map((d) => {
      return {
        date: d.date,
        fullDate: d.fullDate,
        volume: d.volume,
        topicSlug: d.topicSlug,
        topicName: d.topicName,
        sentiment: d.sentiment,
      };
    });
  }, []);

  // Drill-in view
  if (sel) return <TopicDetail topic={sel} subs={subs} onBack={closeTopic} onMentionClick={onMentionClick} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      {/* Panorámica con view toggle */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Tópicos · vista panorámica</div><div className="card-hd-sub">Haz clic en un tópico para ver sus subtópicos</div></div>
          <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
            {[
              { k: 'treemap', l: 'Treemap', icon: 'Grid' },
              { k: 'bubbles', l: 'Burbujas', icon: 'Circle' },
              { k: 'list',    l: 'Lista',    icon: 'List' },
            ].map(o => {
              const IC = Icons[o.icon];
              return (
                <button key={o.k} onClick={() => setView(o.k)} className={`chip ${view === o.k ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <IC size={11} /> {o.l}
                </button>
              );
            })}
          </div>
        </div>
        <div className="card-bd">
          {view === 'treemap' && <TopicTreemap topics={D.TOPICS} onSelect={openTopic} />}
          {view === 'bubbles' && <TopicBubbles topics={D.TOPICS} onSelect={openTopic} />}
          {view === 'list' &&    <TopicList topics={D.TOPICS} onSelect={openTopic} />}
          {/* La leyenda vive en la card, no dentro de una vista: los tres modos
              codifican el estado con la misma familia de color y el treemap
              (vista por defecto) no explicaba la suya. */}
          <TopicSentimentLegend />
        </div>
      </div>

      {/* Calendario de tópico principal por día */}
      <TopicCalendar data={calendarData} onSelect={openTopic} onDayClick={setDayModal} />

      {dayModal && (() => {
        const palette = window.ECO_CAT;
        const slugIdx = {};
        D.TOPICS.forEach((t, i) => { slugIdx[t.slug] = i; });
        const accent = palette[slugIdx[dayModal.topicSlug] % palette.length] || 'var(--accent)';
        const dateStr = dayModal.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const dayIso = dayModal.dt.toISOString().slice(0, 10);
        // topicMode 'all': la celda del calendario cuenta multi-clasificación
        // (universo pertinente) — el modal abre en la MISMA base para que el
        // total cuadre con la celda. (El histograma
        // "Volumen por hora" que se mostraba aquí era una senoide sintética
        // con jitter — eliminado, auditoría 2026-08.)
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

      {/* Nota explicativa: la pestaña Tópicos usa el MISMO conteo que el correo
          y el Overview (top-confidence). Si una mención toca varios tópicos,
          cuenta una vez en su tópico principal — el "+N también lo tocan"
          señala las menciones donde ese tópico es secundario. */}
      <div style={{ padding: '12px 16px', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
        <Icons.Info size={12} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
        <span>
          Cada mención cuenta una vez bajo su tópico de mayor confianza (mismo
          criterio del correo y del Overview). El "+N también lo tocan"
          indica menciones donde el tópico aparece como tema secundario. Al
          hacer clic en un tópico verás las primarias por defecto, con un
          toggle para incluir las secundarias.
        </span>
      </div>
    </div>
  );
}

// --- Treemap variant (existing style, with click drill-in) ---
function TopicTreemap({ topics, onSelect }) {
  // La fila crece con su contenido. Con `gridAutoRows: '76px'` fijo el tile
  // sumaba ~109px de contenido (32 de padding + nombre + cifra + "+N también lo
  // tocan" + barra) y, sin recorte, el sobrante se pintaba ENCIMA del tile de la
  // fila siguiente: la barra de distribución y el delta de un tópico quedaban
  // rotulados dentro de OTRO tópico. Eso es misatribución de dato, no sólo
  // desborde. En móvil el nombre envuelve a 2-3 líneas, así que el mínimo sube.
  return (
    <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(4, 1fr)', 'repeat(2, 1fr)'), gridAutoRows: window.ecoCols('minmax(76px, auto)', 'minmax(96px, auto)'), gap: 'var(--sp-1)' }}>
      {topics.map((t, i) => {
        // Rótulo y tinte del tile, de la MISMA familia. El tinte de 'mixed'
        // caía en --canvas-2, un token de SUPERFICIE inset (más oscuro que la
        // card), así que los tópicos sin dominancia se leían como agujeros en la
        // rejilla mientras su rótulo iba en ámbar. Ahora los tres estados son
        // overlays al 10% sobre la card. 'mixed' va a la familia NEUTRA y no a
        // --warn: el ámbar es el color de RIESGO del producto (escala de crisis,
        // alertas) y "ninguna polaridad domina" no es un riesgo; además el
        // calendario ya pinta en gris ese mismo estado, así que un solo hue para
        // un solo concepto.
        const color = window.ecoSentimentColor(t.dominantSentiment);
        const bg = t.dominantSentiment === 'positivo' ? 'var(--pos-bg)' : t.dominantSentiment === 'negativo' ? 'var(--neg-bg)' : 'var(--neu-bg)';
        // Tiles UNIFORMES. `span = i < 2 ? 2 : 1` daba 4 celdas a los dos
        // primeros tópicos por su POSICIÓN en el array, no por su valor: con los
        // datos de julio, Empleo (173) ocupaba la CUARTA PARTE del área de
        // Permisos (213) — 19% menos dato, 75% menos área — y la MISMA área que
        // Agricultura (53), que vale 3.3x menos. En una rejilla de celdas fijas
        // el área no puede ser fiel al dato, así que se retira como canal: el
        // volumen lo dicen la cifra impresa y el orden de lectura (el endpoint
        // devuelve los tópicos por primary_count DESC).
        return (
          <button key={t.slug} onClick={() => onSelect(t.slug)}
            style={{
              padding: 'var(--sp-4)', textAlign: 'left',
              background: bg, borderRadius: 'var(--r-lg)',
              border: '1.5px solid transparent',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              // Guarda: si el contenido volviera a exceder la fila, se recorta
              // DENTRO de su tile en vez de atribuirse al tópico vecino.
              overflow: 'hidden',
              cursor: 'pointer', transition: 'all 0.2s var(--ease)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
          >
            <div>
              <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.name}</div>
              {/* Una sola talla, y desde la escala: 30 vs 18 por índice era
                  1.67x de talla tipográfica para 1.46x de dato (253 vs 173), y
                  premiaba la posición en el array, no el valor. */}
              <div className="num" style={{ fontSize: 'var(--fs-num-md)', fontWeight: 600, color: 'var(--text)', marginTop: 'var(--sp-1)', fontFamily: 'var(--ff-display)' }}>{fmt(t.count)}</div>
              {t.secondaryCount > 0 && (
                <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 500, marginTop: 'var(--sp-05)' }}>+{t.secondaryCount} también lo tocan</div>
              )}
            </div>
            {/* Barra de distribución de sentimiento: ahora ocupa todo el ancho
                disponible (flex: 1) y usa flex-grow proporcional al porcentaje
                — esto elimina el bug donde la barra quedaba diminuta (60px
                fijos) en tiles grandes. La altura aumentó a 6px para que
                las tres bandas sean visibles. */}
            <SentimentBar t={t} />
          </button>
        );
      })}
    </div>
  );
}

// Componente común para la fila inferior de un tile/list-row: barra de
// distribución pos/neu/neg + delta. Manejo de delta=null ("—") para distinguir
// "sin base de comparación" de "delta=0".
function SentimentBar({ t }) {
  const deltaStr = t.delta == null
    ? '—'
    : `${window.ecoDeltaArrow(t.delta)} ${Math.abs(t.delta)}%`;
  // El volumen de un tópico es NEUTRO: que "Turismo y promoción" suba no es
  // malo. Antes esto pintaba toda subida en --neg y toda bajada en --pos, y el
  // Scorecard hacía justo lo contrario con el mismo dato.
  const deltaColor = window.ecoDeltaColor('volume', t.delta);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginTop: 'var(--sp-15)' }}>
      {/* La pista es relleno de dato neutro (--neu-bg), no una superficie
          inset: con --canvas-2 tenía contraste CERO contra el fondo de un tile
          'mixed', que era ese mismo token. */}
      <div style={{ display: 'flex', flex: 1, height: 6, borderRadius: 'var(--r-sm)', overflow: 'hidden', background: 'var(--neu-bg)', minWidth: 40 }}>
        <div style={{ flexGrow: Math.max(0, t.positivePct || 0), background: 'var(--pos)' }} />
        <div style={{ flexGrow: Math.max(0, t.neutralPct || 0),  background: 'var(--neu)' }} />
        <div style={{ flexGrow: Math.max(0, t.negativePct || 0), background: 'var(--neg)' }} />
      </div>
      <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: deltaColor, whiteSpace: 'nowrap', minWidth: 40, textAlign: 'right' }}>
        {deltaStr}
      </span>
    </div>
  );
}

// --- Bubbles variant ---
function TopicBubbles({ topics, onSelect }) {
  const max = Math.max(...topics.map(t => t.count));
  // Lay out bubbles with deterministic pseudo-random positions within an SVG viewport
  const W = 960, H = 360;
  const positioned = React.useMemo(() => {
    const out = [];
    const rng = (i) => {
      // cheap deterministic jitter
      const s = Math.sin(i * 9973) * 10000;
      return s - Math.floor(s);
    };
    topics.forEach((t, i) => {
      const r = 30 + (t.count / max) * 70;
      let x = 60 + rng(i) * (W - 120);
      let y = 60 + rng(i + 7) * (H - 120);
      // Push away from prior bubbles
      for (let k = 0; k < out.length; k++) {
        const dx = x - out[k].x, dy = y - out[k].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const minD = r + out[k].r + 6;
        if (dist < minD && dist > 0) {
          x += (dx / dist) * (minD - dist);
          y += (dy / dist) * (minD - dist);
        }
      }
      x = Math.max(r + 8, Math.min(W - r - 8, x));
      y = Math.max(r + 8, Math.min(H - r - 8, y));
      out.push({ ...t, x, y, r });
    });
    return out;
  }, [topics]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 360, display: 'block' }}>
        {positioned.map((t) => {
          // Mismo mapa que el treemap y que la leyenda (un solo hue por estado).
          const color = window.ecoSentimentColor(t.dominantSentiment);
          return (
            <g key={t.slug} style={{ cursor: 'pointer' }} onClick={() => onSelect(t.slug)}>
              <circle cx={t.x} cy={t.y} r={t.r} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5" />
              <text x={t.x} y={t.y - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)" style={{ pointerEvents: 'none' }}>
                {t.name.length > 18 ? t.name.slice(0, 17) + '…' : t.name}
              </text>
              <text x={t.x} y={t.y + 12} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text)" style={{ fontFamily: 'var(--ff-display)', pointerEvents: 'none' }}>
                {fmt(t.count)}
              </text>
              <text x={t.x} y={t.y + 26} textAnchor="middle" fontSize="var(--fs-overline)"
                fill={window.ecoDeltaColor('volume', t.delta)}
                fontWeight="700" style={{ pointerEvents: 'none' }}>
                {t.delta == null ? '—' : `${window.ecoDeltaArrow(t.delta)} ${Math.abs(t.delta)}%`}
              </text>
            </g>
          );
        })}
      </svg>
      {/* La leyenda ya la pone la card (TopicSentimentLegend), común a las tres
          vistas y sin la entrada "Neutral" que el endpoint no emite. */}
    </div>
  );
}

// Leyenda ÚNICA del estado de sentimiento de un tópico, compartida por las tres
// vistas de la panorámica. El treemap —la vista por DEFECTO— no tenía ninguna:
// sus tintes quedaban sin explicar. La de burbujas, además, listaba una cuarta
// entrada ("Neutral") que el endpoint no puede emitir para un tópico (sólo
// positivo | negativo | mixed), o sea prometía un estado inalcanzable. Aquí se
// escribe también la DEFINICIÓN de mixto, que no estaba en ninguna parte.
function TopicSentimentLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'var(--sp-4)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginTop: 'var(--sp-3)' }}>
      {[['positivo', 'Positivo dominante'], ['negativo', 'Negativo dominante'], ['mixed', 'Mixto · ningún lado domina (≤ 8 pp)']].map(([k, l]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          <span className="dot" style={{ background: window.ecoSentimentColor(k) }} /> {l}
        </span>
      ))}
    </div>
  );
}

// --- List variant ---
function TopicList({ topics, onSelect }) {
  const sorted = [...topics].sort((a, b) => b.count - a.count);
  return (
    <div className="scroll-x">
      <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 80px 110px 1.2fr 70px 24px', minWidth: 700, gap: 'var(--sp-3)', padding: '8px 12px', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        <span>#</span><span>Tópico</span><span style={{ textAlign: 'right' }}>Menciones</span><span>Sentimiento</span><span>Distribución</span><span style={{ textAlign: 'right' }}>Δ</span><span />
      </div>
      {sorted.map((t, i) => (
        <button key={t.slug} onClick={() => onSelect(t.slug)} className="row-hover"
          style={{
            display: 'grid', gridTemplateColumns: '24px 2fr 80px 110px 1.2fr 70px 24px', minWidth: 700, gap: 'var(--sp-3)', alignItems: 'center',
            padding: '10px 12px', fontSize: 'var(--fs-caption)', textAlign: 'left', cursor: 'pointer',
            borderTop: i > 0 ? '1px solid var(--hairline)' : '1px solid var(--hairline)',
            width: '100%',
          }}>
          <span className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{String(i+1).padStart(2,'0')}</span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {t.secondaryCount > 0 && (
              <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 500 }}>+{t.secondaryCount} también lo tocan</span>
            )}
          </span>
          <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(t.count)}</span>
          {/* Nunca el enum: con .pill en mayúsculas esto imprimía "MIXED".
              Y la clase pasa a pill-neu, que index.html define justo para
              "clasificado, no vacío" — pill-warn es el ámbar de riesgo. */}
          <span className={`pill ${t.dominantSentiment === 'positivo' ? 'pill-pos' : t.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-neu'}`} style={{ justifySelf: 'start' }}>{window.ecoSentimentLabel(t.dominantSentiment)}</span>
          {/* "Distribución" es COMPOSICIÓN: la pista mide lo mismo en todas las
              filas y las bandas son porcentaje de ese largo — la misma
              codificación que el treemap. Antes el largo total codificaba
              VOLUMEN (count/max) con las bandas dentro, así que un tópico 60%
              negativo y poco volumen mostraba una banda roja diminuta aquí y una
              banda roja larga en el treemap, bajo el mismo rótulo. El volumen ya
              está impreso, exacto, en la columna "Menciones". */}
          <div style={{ position: 'relative', height: 14 }}>
            <div style={{ position: 'absolute', inset: '3px 0', borderRadius: 'var(--r-sm)', display: 'flex', overflow: 'hidden', background: 'var(--neu-bg)' }}>
              <div style={{ width: `${t.positivePct}%`, background: 'var(--pos)' }} />
              <div style={{ width: `${t.neutralPct}%`, background: 'var(--neu)' }} />
              <div style={{ width: `${t.negativePct}%`, background: 'var(--neg)' }} />
            </div>
          </div>
          {/* El delta de VOLUMEN es neutro (ECO_METRIC_DIRECTION, data.js):
              aquí salía rojo al subir y verde al bajar, el contrato OPUESTO al
              del treemap, que ya pasa por ecoDeltaColor. El mismo −8% de
              "Permisos y trámites" se leía gris en una vista y verde en la otra,
              a un clic de distancia. La flecha también sale del helper para que
              las tres vistas escriban el delta igual. */}
          <span style={{ textAlign: 'right', fontSize: 'var(--fs-overline)', fontWeight: 600,
            color: window.ecoDeltaColor('volume', t.delta) }}>
            {t.delta == null ? '—' : `${window.ecoDeltaArrow(t.delta)} ${Math.abs(t.delta)}%`}
          </span>
          <Icons.ChevronRight size={14} color="var(--text-3)" />
        </button>
      ))}
    </div>
  );
}

// --- Drill-in: topic detail with subtopics + back ---
function TopicDetail({ topic, subs, onBack, onMentionClick }) {
  // pill-neu (no pill-warn): el ámbar del producto significa riesgo.
  const sentPill = topic.dominantSentiment === 'positivo' ? 'pill-pos' : topic.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
  const subMax = Math.max(1, ...subs.map(s => s.count));

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
      <div className="card" style={{ padding: 'var(--sp-5)', display: 'grid', gridTemplateColumns: window.ecoCols('2fr 1fr 1fr 1fr', 'repeat(2, 1fr)'), gap: 'var(--sp-5)', alignItems: 'center' }}>
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
      <div className="card" style={{ padding: 'var(--sp-5)' }}>
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
          va cada subtopic sin tener que abrir las menciones. */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Subtópicos detectados</div><div className="card-hd-sub">{subs.length} subtópicos · cluster del periodo seleccionado</div></div>
        </div>
        <div className="scroll-x">
          {subs.length === 0 && <div style={{ padding: 'var(--sp-10)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Sin subtópicos detectados en este periodo</div>}
          {subs.map((s, i) => {
            const subSentPill = s.dominantSentiment === 'positivo' ? 'pill-pos' : s.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
            return (
              <div key={s.slug || s.name} className="row-hover" style={{
                display: 'grid', gridTemplateColumns: '28px 2fr 110px 110px 1.4fr', minWidth: 640, gap: 'var(--sp-3)', alignItems: 'center',
                padding: '14px 18px', borderTop: '1px solid var(--hairline)', fontSize: 'var(--fs-body-sm)',
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
                  <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{s.positivePct || 0}% pos</span>
                    <span>{s.negativePct || 0}% neg</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
      <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
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
        <div className="card-hd"><div><div className="card-hd-title">Calendario de tópicos</div><div className="card-hd-sub">Tópico principal y volumen del día · período seleccionado</div></div></div>
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
          <div className="card-hd-title">Calendario de tópicos</div>
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
              <div key={d} style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'left', paddingLeft: 'calc(var(--sp-15) + 1px)', paddingBottom: 4 }}>{d}</div>
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
                    marginTop: wIdx === 0 ? 0 : 10, marginBottom: 'var(--sp-1)',
                    fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-2)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
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
                    const nameLimit = window.ecoIsMobile() ? 8 : 14;
                    const nameShort = c.topicName.length > nameLimit ? c.topicName.slice(0, nameLimit - 1) + '…' : c.topicName;
                    return (
                      <button key={c.date} onClick={() => onDayClick(c)}
                        title={`${c.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })} · ${c.topicName} · ${sentLabel(c.sentiment)} · ${fmt(c.volume)} menciones`}
                        style={{
                          position: 'relative',
                          // En móvil la celda mide ~41px de ancho: con
                          // aspectRatio 1/1 el alto se quedaba en los 62px del
                          // minHeight mientras el contenido (día + nombre
                          // envuelto + volumen) suma ~88px, y `overflow:hidden`
                          // recortaba justo la última línea — el VOLUMEN, que es
                          // la segunda variable que promete el subtítulo. Sin
                          // aspect-ratio la celda crece a su contenido.
                          aspectRatio: window.ecoIsMobile() ? 'auto' : '1 / 1',
                          minHeight: window.ecoIsMobile() ? 78 : 62,
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
                          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                          textAlign: 'left', cursor: 'pointer',
                          overflow: 'hidden',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <span className="mono" style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text)' }}>{dayNum}</span>
                          {/* Cierra la correspondencia con la leyenda "Tópicos
                              del período": el hue por tópico ya existía en el
                              producto (el modal del día lo usa desde ECO_CAT),
                              pero no aparecía en ninguna celda. */}
                          <span title={c.topicName} style={{ width: 6, height: 6, borderRadius: '50%', background: colorFor(c.topicSlug), flex: '0 0 auto', marginTop: 'var(--sp-05)' }} />
                        </div>
                        <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '0.02em', wordBreak: 'break-word' }}>
                          {nameShort}
                        </div>
                        <div className="num" style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: 'var(--text-2)' }}>{fmt(c.volume)}</div>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ borderLeft: '1px solid var(--hairline)', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div>
            <div className="section-eyebrow" style={{ margin: '0 0 8px' }}>Sentimiento del día</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>
              {['positivo', 'negativo', 'neutral'].map((k) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  {/* La muestra usa el tinte de un día de volumen MEDIANO, no
                      el 50% del día de MÁS volumen: al tope de la rampa, las
                      celdas normales parecían sin clasificar al lado de la
                      leyenda. */}
                  <span style={{ width: 12, height: 12, borderRadius: 'var(--r-sm)', background: `color-mix(in oklab, ${SENT_HEX[k]} ${tintPct(volRamp[1])}%, var(--canvas))`, border: `1px solid ${SENT_HEX[k]}` }} />
                  <span>{sentLabel(k)}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 10 }}>
            <div className="section-eyebrow" style={{ margin: '0 0 8px' }}>Tópicos del período</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', maxHeight: 168, overflowY: 'auto' }}>
              {uniqueTopics.map(t => (
                <button key={t.slug} onClick={() => onSelect(t.slug)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', padding: '4px 6px', borderRadius: 'var(--r-md)', textAlign: 'left', cursor: 'pointer' }} className="row-hover">
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
          <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
              {/* La rampa se dibuja con la MISMA función que las celdas y con
                  los volúmenes reales del período. Antes eran tres cuadros al
                  30/60/100% de --text-3: una rampa que duplicaba el máximo real
                  (50%) y en un gris que no era el de ninguna celda, así que la
                  leyenda prometía intensidades inalcanzables. Los números la
                  hacen verificable. */}
              <span style={{ display: 'flex', gap: 'var(--sp-05)', alignItems: 'center' }}>
                {volRamp.map((v, i) => (
                  <span key={i} title={`${fmt(v)} menciones`} style={{ width: 8, height: 8, borderRadius: 'var(--r-sm)', background: `color-mix(in oklab, var(--neu) ${tintPct(v)}%, var(--canvas))`, border: '1px solid var(--hairline)' }} />
                ))}
              </span>
              Volumen del día · {fmt(volRamp[0])} → {fmt(volRamp[2])} menciones
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
              <span style={{ width: 8, height: 8, border: '1.5px solid var(--text-2)', borderRadius: 'var(--r-sm)' }} />
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
          <div><div className="card-hd-title">Distribución geográfica · Puerto Rico</div><div className="card-hd-sub">{munis.length > 0 ? `${munis.length} ${munis.length === 1 ? 'municipio' : 'municipios'} con menciones en el período` : 'Sin menciones georreferenciadas en el período'} · click un municipio para ver menciones</div></div>
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
            {loadingGeo && <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>Actualizando…</span>}
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
          <div className="card-hd"><div><div className="card-hd-title">Top municipios</div><div className="card-hd-sub">Por volumen de menciones</div></div></div>
          <div className="card-bd">
            <HBarList
              items={[...munis].sort((a,b)=>b.count-a.count).slice(0,8).map(m => ({ label: m.name, value: m.count, nss: m.nss, _muni: m }))}
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
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{regionMunis.length} municipios · {fmt(total)} menciones</div>
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
            <span style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>Configuración</span>
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
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 120px 120px 30px', minWidth: 740, gap: 'var(--sp-3)', padding: '10px 16px', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--hairline)' }}>
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
              <label
                onClick={() => setRuleActive((s) => ({ ...s, [a.id]: !s[a.id] }))}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-overline)', cursor: 'pointer' }}>
                <div style={{ width: 28, height: 16, borderRadius: 'var(--r-lg)', background: ruleActive[a.id] ? 'var(--pos)' : 'var(--hairline-strong)', position: 'relative', transition: 'all 0.2s' }}>
                  <div style={{ position: 'absolute', top: 2, left: ruleActive[a.id] ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: 'var(--knob)', transition: 'all var(--dur) var(--ease)' }} />
                </div>
                <span style={{ color: ruleActive[a.id] ? 'var(--pos)' : 'var(--text-3)' }}>{ruleActive[a.id] ? 'Activa' : 'Inactiva'}</span>
              </label>
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
    polarization:         { comparator: 'gte', threshold: 60,   label: 'Polarización (0–100)',         hint: '≥ 60 = alta polarización' },
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
        <div className="card-hd"><div><div className="card-hd-title">Historial detallado</div></div></div>
        <div className="scroll-x">
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
              <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.mentionIds?.length || 0}</span>
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
  { k: 'overview', l: 'Overview' },
  { k: 'dashboard', l: 'Scorecard' },
  { k: 'mentions', l: 'Menciones' },
  { k: 'sentiment', l: 'Sentimiento' },
  { k: 'topics', l: 'Tópicos' },
  { k: 'narrative', l: 'Narrativas' },
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
    lastSeen: u.lastLogin ? new Date(u.lastLogin).toLocaleString('es-PR') : '—',
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
                    <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{l}</div>
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
                <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{r.count}</div>
              </div>
              <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', lineHeight: 1.45 }}>{r.desc}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)', marginTop: 'var(--sp-1)' }}>
                {r.perms.map(p => (
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
            display: 'grid', gridTemplateColumns: '1.6fr 1.2fr 110px 110px 110px 40px', minWidth: 740, gap: 'var(--sp-3)',
            padding: '10px 18px', borderTop: '1px solid var(--hairline)',
            // Mismo eje vertical que las filas de datos (que sí llevan
            // alignItems): sin esto, el rótulo de dos líneas estiraba la banda a
            // 49px y las otras cuatro etiquetas quedaban pegadas arriba con ~24px
            // de vacío debajo — en móvil, además, la columna que provocaba el
            // salto de línea estaba fuera de pantalla y la banda alta parecía un
            // error de render.
            alignItems: 'center',
            fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em',
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
                  display: 'grid', gridTemplateColumns: '1.6fr 1.2fr 110px 110px 110px 40px', minWidth: 740, gap: 'var(--sp-3)',
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
                <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{u.lastSeen}</div>
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
            <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{l}</div>
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
      <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 'var(--sp-15)' }}>
        {label} {required && <span style={{ color: 'var(--neg)' }}>*</span>}
      </div>
      {children}
    </div>
  );
}

// =============== OVERVIEW ===============
// Espejo del correo diario (eco-weekly-report) sin LLM. Consume /api/overview
// que internamente usa el mismo @eco/shared/buildSentimentReport que el
// lambda — totales, deltas, daily series y la tabla de tópicos coinciden
// byte-por-byte con el correo de las 6 AM cuando period=7D.
//
// Layout (top a bottom):
//   1. Hero — período + total
//   2. Termómetro — 3 KPIs neg/neu/pos con Δ vs ventana previa
//   3. Highlights — NSS+Riesgo · Volúmenes · Brand Health
//   4. Tendencia — multi-line chart con neg/neu/pos
//   5. Tópico principal — top-7 + Otros + Sin clasificar
//
// Las filas de tópico son clickeables: abren el slice modal con topicMode=primary
// (top-confidence) por defecto, con un toggle "+ Incluir secundarias" para ver
// el conteo multi-clasificación.
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

  if (error) {
    return (
      <div className="card" style={{ padding: 'var(--sp-6)', textAlign: 'center' }}>
        <div className="section-eyebrow" style={{ color: 'var(--neg)', marginBottom: 'var(--sp-15)' }}>Error</div>
        <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>No se pudo cargar el Overview: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card" style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)' }}>
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
      // el mismo default del modal). Sin el desglose one-hot sintético que
      // afirmaba "0" en los otros sentimientos mientras cargaba — el real
      // llega del fetch del modal.
      _filter: { from: data.periodStart, to: data.periodEnd, sentiment: name },
    });
  }

  // openDaySlice — click en un día del gráfico de tendencias. Abre el modal
  // con las menciones de ESE día específico, leyendo los conteos del propio
  // datapoint. El _filter.day se interpreta como YYYY-MM-DD en TZ Puerto Rico
  // por el endpoint /api/eco-mentions.
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
      // La serie diaria del Overview cuenta el universo pertinente (default
      // del modal); `day` acota al día exacto server-side.
      _filter: { day: d.fullDate },
    });
  }

  // openMetricInsight — abre MetricInsightModal vía helper compartido.
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <OverviewHero data={data} />
      <OverviewTermometro totals={data.totals} deltas={data.deltaVsPrev} onSliceClick={openSentimentSlice} />
      <OverviewHighlights metrics={data.currentMetrics} onOpenInsight={openMetricInsight} />
      <OverviewTendencia dailySeries={data.dailySeries} onDayClick={openDaySlice} />
      <OverviewTopicos
        rows={data.topicsTable}
        totals={data.totals}
        onTopicClick={(row) => {
          // Buscar el slug del tópico en D.TOPICS (eco-data) para que el modal
          // pueda filtrar. La tabla del Overview viene de buildSentimentReport
          // (matchea correo) que solo expone el name; resolvemos el slug aquí.
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
            // Misma ventana y universo que la fila de la tabla
            // (buildSentimentReport: cerrada, primario, todas las
            // pertinencias). El default primary del modal cuadra con el
            // conteo de la fila; el toggle muestra las secundarias.
            _filter: { from: data.periodStart, to: data.periodEnd, topic: topic.slug },
          });
        }}
      />
      {/* Insights va al FINAL, después de Topicos (orden explícito del
          usuario: "necesito que salga de último después de los topicos"). */}
      <OverviewInsights periodStart={data.periodStart} periodEnd={data.periodEnd} agency={agency} />
      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

function OverviewHero({ data }) {
  const total = data.totals.total || 0;
  return (
    <div style={{ padding: '4px 4px 0' }}>
      {/* Sin section-eyebrow: el periodo / fechas viven en el Header (chips +
          calendar icon) y la palabra "Overview" ya está en el header / sidebar.
          Repetirlas aquí era ruido (instrucción explícita del usuario). */}
      <h1 style={{
        fontFamily: 'var(--ff-display)', fontSize: 'var(--fs-display-lg)', fontWeight: 600,
        lineHeight: 1.2, margin: '0 0 4px', letterSpacing: 'var(--letter-display)',
        color: 'var(--text)',
      }}>
        Conversación pública de los últimos {data.dailySeries.length} días
      </h1>
      <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body-sm)' }}>
        {/* `periodLabel` es el rótulo canónico del periodo (formatPeriodLabel en
            @eco/shared, el mismo que imprime el correo): "21 – 27 jul 2026". La
            API ya lo enviaba y aquí se imprimían las dos fechas ISO crudas, así
            que la pantalla tenía tres vocabularios de fecha (ISO en el hero,
            "mié 21" en el eje, el rótulo en el modal). */}
        {total > 0
          ? <><span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{total.toLocaleString('es-PR')}</span> menciones · {data.periodLabel || (data.periodStart + ' → ' + data.periodEnd)}</>
          : <>Sin menciones registradas en la ventana seleccionada.</>}
      </div>
    </div>
  );
}

function OverviewTermometro({ totals, deltas, onSliceClick }) {
  // Defensa contra payload incompleto: `totals` ausente tumbaba TODA la pantalla
  // principal al error boundary. Un hipo del endpoint no debe dejar al usuario
  // sin Overview; sin datos la tarjeta se dibuja en cero y lo dice.
  const T = totals || {};
  const D = deltas || {};
  const t = T.total || 1;
  const cards = [
    { name: 'Negativo', sentKey: 'negativo', value: T.negative, delta: D.negative, accent: 'var(--neg)', deltaMetric: 'negativeCount' },
    { name: 'Neutral',  sentKey: 'neutral',  value: T.neutral,  delta: D.neutral,  accent: 'var(--neu)', invert: false },
    { name: 'Positivo', sentKey: 'positivo', value: T.positive, delta: D.positive, accent: 'var(--pos)', deltaMetric: 'positiveCount' },
  ];
  return (
    <div>
      <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>01 · Termómetro · vs ventana previa</div>
      <div style={{ display: 'grid', gridTemplateColumns: window.ecoCols('repeat(3, 1fr)', '1fr'), gap: 'var(--sp-3)' }}>
        {cards.map((c) => {
          const pct = T.total > 0 ? Math.round(((c.value || 0) / t) * 100) : 0;
          // La dirección del delta la decide ECO_METRIC_DIRECTION vía DeltaBadge
          // (negativeCount = up-bad, positiveCount = up-good, volumen = neutro).
          // Esta card recalculaba el color con su propio criterio y el resultado
          // se pisaba con el del badge: dos reglas para el mismo átomo.
          // Las cards del termómetro abren MentionsSliceModal con el sentimiento
          // correspondiente. Usar <button> para teclado/aria; padding/estilos
          // imitan el card. Sin underline o cursor pointer por defecto del btn.
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
                {/* .t-overline es la clase declarada para esto (tokens.css §7):
                    11px, mayúsculas, --tracking-overline. Antes cada eyebrow
                    repetía los cinco estilos inline con su propio tracking. */}
                <div className="t-overline">
                  {c.name}
                </div>
                <Icons.ArrowRight size={11} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                  {fmt(c.value)}
                </div>
                {/* Cifra de apoyo del titular: --fs-body-sm/--text-2, igual que
                    KpiCard (156) y que la card 02 (4333). Antes iba 12px/--text-3
                    aquí y 13px/--text-2 allá, mismo rol en cards contiguas. */}
                <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', fontWeight: 600 }}>{pct}%</div>
              </div>
              {/* El color y el tamaño del delta los decide DeltaBadge (WS-F8);
                  este contenedor sólo coloca. Fijar aquí `color: dColor` era una
                  segunda política de color sobre el mismo átomo. */}
              <div style={{ marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                <DeltaBadge value={c.delta} metricKey={c.deltaMetric || 'volume'} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// OverviewHighlights — reducido a un único termómetro de Crisis. Antes había
// 3 tarjetas (NSS · Riesgo, Volúmenes, Brand Health). Por petición explícita
// del usuario quitamos NSS / Volúmenes / Brand Health del Overview (esas
// métricas viven en el tab Scorecard); Crisis se queda como termómetro pero
// ya no está fusionada con NSS — vive aquí en su propia card slim.
//
// Clickable: abre MetricInsightModal con insight LLM + subcomponentes
// (severity/velocity/relevance/confidence del snapshot diario).
function OverviewHighlights({ metrics, onOpenInsight }) {
  const m = metrics || {};
  if (m.crisisRiskScore == null) return null;
  // Crisis Risk en escala 0–1 (backtest 482d, PR #37). Thresholds:
  // NORMAL <0.25, ELEVADO <0.40, ALERTA <0.60, CRISIS ≥0.60.
  const score = m.crisisRiskScore;
  const cb = crisisBand(score);
  // Formato legible (palabra + % de riesgo) desde el API (@eco/shared/format),
  // con fallback al crisisBand local por si el payload no trae display.
  const cd = (m.display && m.display.crisis) || null;
  const band = cb.label;
  const word = cd ? cd.word : cb.label;
  const valueLabel = cd && cd.value ? cd.value : (Math.round(score * 100) + '%');
  // El titular y su banda leen el MISMO color, y sale de CRISIS_BANDS. Antes el
  // titular tomaba `cd.color` —el tone que calcula BAND_TONE en el backend— y la
  // banda tomaba `cb.color` de la tabla local: para el veredicto ALERTA el
  // backend daba --neg y la tabla otro color, así que la palabra y la barra que
  // está 30px más abajo discrepaban sobre el mismo dato. Manda la tabla, porque
  // es la que dibuja la barra que el usuario compara.
  const wordColor = cb.color;
  const bandColor = cb.color;
  return (
    <button
      onClick={() => onOpenInsight && onOpenInsight('crisis', valueLabel, 'var(--neg)')}
      className="card row-hover"
      style={{
        padding: 'var(--sp-4)',
        display: 'grid', gridTemplateColumns: window.ecoCols('repeat(3, 1fr)', '1fr'), gap: 'var(--sp-4)', alignItems: 'stretch',
        cursor: 'pointer', border: '1px solid var(--hairline)', background: 'var(--canvas)',
        textAlign: 'left', width: '100%',
      }}
      title="Ver insight del riesgo de crisis para el periodo">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-15)' }}>
          <Icons.Shield size={14} color="var(--neg)" />
          {/* 02, 03 y 04 son UNA card cada una y llevan el mismo rótulo de card
              (.card-hd-title, serif 15px). 01 y 05 rotulan GRUPOS de tres cards
              y por eso viven fuera, en .section-eyebrow. Antes 02 usaba un
              eyebrow de 11px en mayúsculas y parecía de otra familia que sus dos
              pares, con el mismo patrón de información (número · nombre). */}
          <div className="card-hd-title">
            02 · Riesgo de crisis
          </div>
          <Icons.ArrowRight size={11} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
          <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: wordColor, fontFamily: 'var(--ff-display)', lineHeight: 1.1 }}>
            {word}
          </div>
          <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', fontWeight: 600 }}>{valueLabel}</div>
        </div>
      </div>
      {/* El divisor es vertical en 2 columnas y horizontal cuando la rejilla
          colapsa en móvil: un borde izquierdo en una sola columna no separa nada. */}
      {/* La escala ocupa las dos últimas columnas de las tres, así el divisor cae
          en el tercio de la rejilla y no a media card. En móvil la rejilla es de
          una columna y el divisor pasa a horizontal (un borde izquierdo en una
          sola columna no separa nada). El flex + justifyContent centra la escala
          verticalmente mientras el borde recorre la card COMPLETA: con
          alignItems:'center' en la rejilla el borde medía 25px dentro de una card
          de 101px y separaba aire de aire. */}
      <div style={window.ecoIsMobile()
        ? { paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--hairline)' }
        : { gridColumn: '2 / span 2', paddingLeft: 'var(--sp-4)', borderLeft: '1px solid var(--hairline)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <BandScale bands={CRISIS_BANDS} value={score} max={1}
          valueLabel={valueLabel} ariaLabel="Riesgo de crisis" />
      </div>
    </button>
  );
}

function OverviewTendencia({ dailySeries, onDayClick }) {
  // Adapta dailySeries del API al shape que MultiLineChart espera (`date` + keys de las series).
  // Guardamos fullDate (YYYY-MM-DD) para que el onPointClick pueda filtrar
  // las menciones del día seleccionado en MentionsSliceModal (_filter.day).
  const chartData = (dailySeries || []).map((d) => ({
    date: d.dayLabel,
    fullDate: d.date,
    negative: d.negative,
    neutral: d.neutral,
    positive: d.positive,
    totalMentions: (d.negative || 0) + (d.neutral || 0) + (d.positive || 0),
  }));
  const series = [
    { key: 'negative', label: 'Negativo', color: 'var(--neg)' },
    { key: 'neutral',  label: 'Neutral',  color: 'var(--neu)' },
    { key: 'positive', label: 'Positivo', color: 'var(--pos)' },
  ];
  if (chartData.length === 0) {
    return (
      <div className="card">
        <EmptyState reason="empty" title="Sin datos de tendencia"
          detail="No hay menciones con fecha en el período seleccionado." />
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">03 · Tendencia · Día a día</div>
          <div className="card-hd-sub">Volumen por sentimiento, día a día (TZ Puerto Rico) · click un día para ver sus menciones</div>
        </div>
      </div>
      <div className="card-bd">
        {/* WS-C2 (arreglo de F2). Antes: MultiLineChart con normalización POR
            SERIE, que dibujaba positivo=33 un ~40% más arriba que negativo=35
            — el lector concluía lo contrario de lo que dicen los números.
            Activar `sharedScale` en el gráfico superpuesto tampoco servía:
            con un pico grande (neg=203 en un día de crisis) la variación diaria
            normal se comprime en una banda plana al fondo, que es justo la
            queja que originó la normalización por serie.
            SeriesPanels separa las series en franjas que COMPARTEN el eje: cada
            una conserva su forma y su curva suave (petición explícita del
            usuario) y las alturas sí son comparables. */}
        <SeriesPanels data={chartData} series={series} panelHeight={72} onPointClick={onDayClick} />
      </div>
    </div>
  );
}

function OverviewTopicos({ rows, totals, onTopicClick }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>
        Sin tópicos clasificados en el periodo.
      </div>
    );
  }
  const universe = totals.total || 1;

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
          <div className="card-hd-title">04 · Tópico principal</div>
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
                padding: '14px 16px', alignItems: 'center',
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
              <div style={{ textAlign: 'right' }}>
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
          padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--hairline-strong)',
          background: 'var(--canvas-2)',
        }}>
          <div className="t-overline" style={{ color: 'var(--text-3)' }}>
            Total del periodo
          </div>
          <div style={{ textAlign: 'right' }}>
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
      <div style={{ padding: '12px 16px', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)' }}>
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

// OverviewInsights — 3 columnas (negativos / positivos / resumen general)
// generadas por LLM y cacheadas por (agency, periodStart, periodEnd).
// Patrón cache-or-202: si el endpoint devuelve 'ready' renderiza inmediato.
// Si devuelve 'computing' arranca polling cada 3s hasta cap 90s.
function OverviewInsights({ periodStart, periodEnd, agency }) {
  const [state, setState] = React.useState({ phase: 'loading', data: null, error: null });
  const pollRef = React.useRef(null);
  const startedAt = React.useRef(0);
  const MAX_POLL_MS = 90 * 1000;
  const POLL_INTERVAL_MS = 3 * 1000;

  React.useEffect(() => {
    if (!periodStart || !periodEnd) return;
    setState({ phase: 'loading', data: null, error: null });
    startedAt.current = Date.now();
    const ctrl = new AbortController();

    async function fetchOnce() {
      const params = new URLSearchParams({ from: periodStart, to: periodEnd });
      if (agency) params.set('agency', agency);
      try {
        const res = await fetch('/api/eco-insights?' + params.toString(), {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (res.status === 202) {
          setState((s) => ({ ...s, phase: 'computing' }));
          return 'computing';
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ phase: 'error', data: null, error: body.error || `HTTP ${res.status}` });
          return 'error';
        }
        const json = await res.json();
        setState({ phase: 'ready', data: json, error: null });
        return 'ready';
      } catch (e) {
        if (e?.name === 'AbortError') return 'aborted';
        setState({ phase: 'error', data: null, error: String(e?.message || e) });
        return 'error';
      }
    }

    async function loop() {
      const status = await fetchOnce();
      if (status === 'computing') {
        if (Date.now() - startedAt.current > MAX_POLL_MS) {
          setState({ phase: 'error', data: null, error: 'Timeout esperando insights (>90s)' });
          return;
        }
        pollRef.current = setTimeout(loop, POLL_INTERVAL_MS);
      }
    }
    loop();

    return () => {
      ctrl.abort();
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [periodStart, periodEnd, agency]);

  const eyebrow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
      <div className="section-eyebrow" style={{ marginBottom: 0 }}>05 · Insights · análisis IA del periodo</div>
      {state.phase === 'computing' && (
        <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
          GENERANDO…
        </span>
      )}
      {state.phase === 'ready' && state.data?.stale && (
        <span className="pill pill-info" style={{ fontSize: 'var(--fs-overline)' }} title="Datos cacheados; el lambda está recomputando en background">
          Actualizando…
        </span>
      )}
    </div>
  );

  if (state.phase === 'error') {
    return (
      <div>
        {eyebrow}
        <div className="card" style={{ padding: 'var(--sp-4)', textAlign: 'center', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
          No fue posible cargar los insights del periodo: {state.error}
        </div>
      </div>
    );
  }

  const cols = [
    { key: 'negative', title: 'Negativos', accent: 'var(--neg)', items: state.data?.insights?.negative ?? [] },
    { key: 'positive', title: 'Positivos', accent: 'var(--pos)', items: state.data?.insights?.positive ?? [] },
    { key: 'general',  title: 'Resumen del periodo', accent: 'var(--accent)', items: state.data?.dailySummary ? [state.data.dailySummary] : [] },
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
              <div className="t-overline">{col.title}</div>
              {isLoading ? (
                <>
                  <div className="skeleton" style={{ height: 14, marginBottom: 'var(--sp-15)' }} />
                  <div className="skeleton" style={{ height: 14, marginBottom: 'var(--sp-15)', width: '92%' }} />
                  <div className="skeleton" style={{ height: 14, width: '78%' }} />
                </>
              ) : col.items.length === 0 ? (
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>
                  Sin {col.key === 'general' ? 'resumen' : 'insights'} para este periodo.
                </div>
              ) : col.key === 'general' ? (
                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text)', lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(col.items[0]) }} />
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  {col.items.map((it, i) => (
                    <li key={i} style={{ fontSize: 'var(--fs-caption)', color: 'var(--text)', lineHeight: 1.45, display: 'flex', gap: 'var(--sp-2)' }}>
                      <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: col.accent, marginTop: 'var(--sp-15)' }} />
                      <span>{it}</span>
                    </li>
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

// ============================================================
// NarrativeScreen — análisis de UNA narrativa en timeline (streamgraph)
// ============================================================
const NARRATIVE_STATUS_ORDER = ['peaking', 'active', 'emerging', 'revived', 'declining', 'dormant'];
// Colores desde tokens.css (--narr-*). Antes eran hex de Ant Design incrustados
// aquí; `peaking` (#FA8C16) con texto blanco daba 2.38:1 y fallaba AA.
const NARRATIVE_STATUS_COLORS = {
  peaking: 'var(--narr-peaking)',
  active: 'var(--narr-active)',
  emerging: 'var(--narr-emerging)',
  revived: 'var(--narr-revived)',
  declining: 'var(--narr-declining)',
  dormant: 'var(--narr-dormant)',
};
const NARRATIVE_STATUS_LABELS = {
  peaking: 'Pico',
  active: 'Activa',
  emerging: 'Emergente',
  revived: 'Revivida',
  declining: 'Decae',
  dormant: 'Dormida',
};
// La columna `status` de la DB puede traer valores fuera de este enum (el
// lambda evoluciona más rápido que la SPA). Antes eso se renderizaba en INGLÉS
// CRUDO, sin punto de color, y ningún chip lo contaba: se veía "Todas (8)" con
// chips que sumaban 5 y tres narrativas invisibles al filtrado.
// La fuerza de la arista puede llegar nula desde /api/narrative/edges. Antes
// `(r.strength * 100).toFixed(0)` producía la cadena "NaN" y la UI mostraba
// literalmente "· nan%" al usuario.
function strengthPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${(Number(v) * 100).toFixed(0)}%`;
}
const NARRATIVE_STATUS_UNKNOWN = 'unknown';
function narrativeStatusKey(status) {
  return NARRATIVE_STATUS_ORDER.includes(status) ? status : NARRATIVE_STATUS_UNKNOWN;
}
function narrativeStatusLabel(status) {
  return NARRATIVE_STATUS_LABELS[status] || 'Sin clasificar';
}
function narrativeStatusColor(status) {
  return NARRATIVE_STATUS_COLORS[status] || 'var(--narr-unknown)';
}
// Un solo punto de estado para las tres listas (chips de filtro, narrativas y
// relacionadas). Antes cada sitio repetía el mismo `style={{ background: … }}`,
// así que la distinción de `unknown` habría habido que recordarla tres veces.
function NarrativeStatusDot({ status }) {
  const key = narrativeStatusKey(status);
  return (
    <span
      className={`narrative-dot ${key === NARRATIVE_STATUS_UNKNOWN ? 'is-unknown' : ''}`}
      style={{ '--narr-tone': narrativeStatusColor(status) }}
    />
  );
}

// Etiquetas amigables para claves crudas de plataforma / tipo de arista
// (antes se mostraban "facebook_public", "co_occurrence", etc. al usuario).
const PLATFORM_LABELS = {
  facebook_public: 'Facebook', facebook: 'Facebook',
  instagram_public: 'Instagram', instagram: 'Instagram',
  news: 'Noticias', bluesky: 'Bluesky',
  twitter: 'X', x: 'X', tumblr: 'Tumblr', youtube: 'YouTube',
  reddit: 'Reddit', forum: 'Foros', blog: 'Blogs', desconocido: 'Otros',
};
function platformLabel(key) {
  if (!key) return 'Otros';
  const k = String(key).toLowerCase();
  if (PLATFORM_LABELS[k]) return PLATFORM_LABELS[k];
  const base = k.replace(/_(public|private)$/, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}
const EDGE_TYPE_LABELS = {
  co_occurrence: 'Co-ocurrencia',
  author_overlap: 'Autores en común',
  semantic: 'Similitud semántica',
};
function edgeTypeLabel(key) {
  return EDGE_TYPE_LABELS[key] || (key ? String(key).replace(/_/g, ' ') : '');
}

// Catmull-Rom → cubic bezier. Devuelve un string SVG path.
function smoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = i === 0 ? points[0] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < points.length ? points[i + 2] : p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function NarrativeSparkline({ data, color, max }) {
  if (!data || data.length === 0) return null;
  // 56×18 = el tamaño REAL en CSS (.narrative-sparkline). El viewBox de 64 con
  // preserveAspectRatio="none" comprimía la forma un 12.5% SÓLO en X y
  // adelgazaba el trazo en un único eje.
  const w = 56;
  const h = 18;
  // Escala COMPARTIDA por la lista visible. Normalizar por fila hacía que la
  // altura de tinta fuera (1 - min/max)·16px, o sea INVERSA al volumen: Cierres
  // (38 menciones) dibujaba una onda 2.4× más alta que Apagones (214),
  // contradiciendo el número que está 20px a su izquierda. Con el máximo de la
  // lista la altura vuelve a ser proporcional al volumen, y la base pintada en
  // cero permite leer el NIVEL además de la forma.
  const top = Math.max(Number(max) || 0, ...data, 1);
  const stepX = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => ({ x: i * stepX, y: h - 1 - (v / top) * (h - 2) }));
  return (
    <svg className="narrative-sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="var(--hairline-strong)" strokeWidth="0.75" />
      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Grafo de narrativas — force-directed nativo en SVG (sin react-force-graph2d).
// Porta la idea del NarrativeGraph local del usuario a la arquitectura del SPA,
// reusando narratives + edges (/api/narrative + /api/narrative/edges) y la
// paleta de estado. La simulación corre una sola vez por dataset (useMemo).
function NarrativeGraph({ narratives, edges, focusedId, onSelect }) {
  const W = 900, H = 560;
  // El grafo SÍ se queda en un viewBox: la simulación de fuerzas se resuelve una
  // vez en un espacio fijo (O(n²)·220 iteraciones) y recalcularla en cada resize
  // costaría frames. Lo que se compensa es el TEXTO, que dentro de un viewBox
  // escalado se multiplica por la escala de render: --fs-overline (11px) rendía
  // 9.6px en desktop y 3.7px a 390px de viewport.
  const [svgRef, svgW] = useChartWidth(W);
  const layout = React.useMemo(() => {
    const inEdge = new Set();
    (edges || []).forEach((e) => { inEdge.add(e.source); inEdge.add(e.target); });
    let nodes = (narratives || []).filter((n) => inEdge.has(n.id));
    if (nodes.length < 40) {
      const extra = [...(narratives || [])]
        .sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0))
        .filter((n) => !inEdge.has(n.id))
        .slice(0, 40 - nodes.length);
      nodes = nodes.concat(extra);
    }
    nodes = nodes.slice(0, 80);
    const idIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const links = (edges || []).filter((e) => idIdx.has(e.source) && idIdx.has(e.target));
    const N = nodes.length;
    const pos = nodes.map((_, i) => {
      const a = (i / Math.max(1, N)) * Math.PI * 2;
      return { x: W / 2 + Math.cos(a) * 220, y: H / 2 + Math.sin(a) * 180 };
    });
    const vel = pos.map(() => ({ x: 0, y: 0 }));
    for (let it = 0; it < 220; it++) {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
          const d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const f = 1400 / d2;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          vel[i].x += fx; vel[i].y += fy; vel[j].x -= fx; vel[j].y -= fy;
        }
      }
      for (const e of links) {
        const a = idIdx.get(e.source), b = idIdx.get(e.target);
        const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - 90) * 0.02 * (0.4 + (e.strength || 0.5));
        const fx = (dx / d) * f, fy = (dy / d) * f;
        vel[a].x += fx; vel[a].y += fy; vel[b].x -= fx; vel[b].y -= fy;
      }
      for (let i = 0; i < N; i++) {
        vel[i].x += (W / 2 - pos[i].x) * 0.002;
        vel[i].y += (H / 2 - pos[i].y) * 0.002;
        vel[i].x *= 0.85; vel[i].y *= 0.85;
        pos[i].x += vel[i].x; pos[i].y += vel[i].y;
      }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pos.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    return { nodes, pos, links, idIdx, bounds: { minX, minY, maxX, maxY } };
  }, [narratives, edges]);

  const { nodes, pos, links, idIdx, bounds } = layout;
  const [hovered, setHovered] = React.useState(null);
  if (!nodes.length) return <EmptyState reason="empty" title="Sin narrativas suficientes para el mapa" detail="Hacen falta al menos dos narrativas con relación entre ellas." />;
  const pad = 44;
  const vbW = (bounds.maxX - bounds.minX) + pad * 2;
  const vbH = (bounds.maxY - bounds.minY) + pad * 2;
  const vb = `${bounds.minX - pad} ${bounds.minY - pad} ${vbW} ${vbH}`;
  // Con preserveAspectRatio="meet" (el default) la escala real es la MENOR de
  // las dos relaciones, así que el factor que devuelve el texto a sus píxeles
  // nominales es la MAYOR de las inversas.
  const labelScale = Math.max(vbW / Math.max(1, svgW), vbH / H);
  const maxMent = Math.max(1, ...nodes.map((n) => n.mentionCount || 0));
  // Nodo activo (hover o foco): resalta sus conexiones y atenúa el resto para
  // que las relaciones se lean claramente en vez de ser una maraña uniforme.
  const active = hovered || focusedId;
  const connected = new Set();
  if (active) {
    connected.add(active);
    links.forEach((e) => {
      if (e.source === active) connected.add(e.target);
      if (e.target === active) connected.add(e.source);
    });
  }
  // Etiquetar siempre las narrativas más grandes (top 12 por menciones) para
  // que el mapa se entienda de un vistazo, no solo al hacer hover.
  const topLabelIds = new Set(
    [...nodes].sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0)).slice(0, 12).map((n) => n.id)
  );

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-hd"><div>
        <div className="card-hd-title">Mapa de conexiones</div>
        <div className="card-hd-sub">{nodes.length} narrativas · {links.length} conexiones · pasa el cursor para ver relaciones, click para abrir</div>
      </div></div>
      <svg ref={svgRef} viewBox={vb} style={{ width: '100%', height: 560, display: 'block' }}>
        {links.map((e, i) => {
          const a = pos[idIdx.get(e.source)], b = pos[idIdx.get(e.target)];
          const on = active && (e.source === active || e.target === active);
          const dim = active && !on;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={on ? 'var(--accent)' : 'var(--hairline-strong)'}
            strokeOpacity={dim ? 0.06 : on ? 0.9 : 0.2 + (e.strength || 0.3) * 0.5}
            strokeWidth={(on ? 1.4 : 0.6) + (e.strength || 0.3) * 1.6} />;
        })}
        {nodes.map((n, i) => {
          const p = pos[i];
          const r = 7 + Math.sqrt((n.mentionCount || 0) / maxMent) * 15;
          const isFocus = n.id === focusedId;
          const isActive = n.id === active;
          const dim = active && !connected.has(n.id);
          const showLabel = !dim && (isActive || isFocus || topLabelIds.has(n.id) || connected.has(n.id));
          return (
            <g key={n.id} style={{ cursor: 'pointer' }}
              onClick={() => onSelect && onSelect(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered((h) => (h === n.id ? null : h))}>
              <title>{`${n.name} · ${(n.mentionCount || 0).toLocaleString('es-PR')} menc · ${n.status}`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill={narrativeStatusColor(n.status)}
                fillOpacity={dim ? 0.18 : 0.9}
                stroke={isActive || isFocus ? 'var(--text)' : 'var(--canvas)'} strokeWidth={isActive || isFocus ? 2.5 : 1} />
              {showLabel && (
                <text x={p.x} y={p.y - r - 4} textAnchor="middle"
                  fill="var(--text)" stroke="var(--canvas)" strokeWidth={3} paintOrder="stroke"
                  style={{ pointerEvents: 'none', fontWeight: isActive || isFocus ? 700 : 500,
                    fontSize: `calc(var(--fs-overline) * ${labelScale.toFixed(3)})` }}>
                  {(n.name || '').slice(0, 28)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NarrativeScreen({ agency }) {
  const [narratives, setNarratives] = React.useState([]);
  const [edges, setEdges] = React.useState([]);
  const [focusedId, setFocusedId] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selectedDay, setSelectedDay] = React.useState(null);
  const [view, setView] = React.useState('detail'); // 'detail' | 'graph'

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFocusedId(null);
    setSelectedDay(null);
    Promise.all([
      // Honra el selector de período del header (antes esta pantalla lo
      // ignoraba y consultaba 730 días — auditoría 2026-08). El app recarga
      // al cambiar período/agencia, así que leer localStorage aquí basta.
      fetch(`/api/narrative?` + new URLSearchParams({ agency: agency || '', limit: '500', ...window.ecoGetPeriodParams() }).toString(), { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : Promise.reject(`narrative ${r.status}`))),
      fetch(`/api/narrative/edges?agency=${agency || ''}&minStrength=0.15`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { edges: [] })),
    ])
      .then(([nRes, eRes]) => {
        if (cancelled) return;
        const list = nRes.narratives || [];
        setNarratives(list);
        setEdges(eRes.edges || []);
        if (list.length > 0) {
          const RANK = { peaking: 0, active: 1, emerging: 2, revived: 3, declining: 4, dormant: 5 };
          const top = [...list].sort((a, b) => {
            const ra = RANK[a.status] ?? 9;
            const rb = RANK[b.status] ?? 9;
            if (ra !== rb) return ra - rb;
            return b.mentionCount - a.mentionCount;
          })[0];
          setFocusedId(top.id);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agency]);

  const statusCounts = React.useMemo(() => {
    // Se cuenta por la clave NORMALIZADA, así que todo status fuera del enum cae
    // en 'unknown' y la suma de los chips cuadra con "Todas".
    const c = { all: narratives.length };
    for (const n of narratives) {
      const k = narrativeStatusKey(n.status);
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [narratives]);

  const filteredNarratives = React.useMemo(() => {
    const RANK = { peaking: 0, active: 1, emerging: 2, revived: 3, declining: 4, dormant: 5 };
    let list = narratives.filter((n) => statusFilter === 'all' || narrativeStatusKey(n.status) === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          (n.summary || '').toLowerCase().includes(q) ||
          (n.keywords || []).some((k) => String(k).toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => {
      const ra = RANK[a.status] ?? 9;
      const rb = RANK[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.mentionCount - a.mentionCount;
    });
  }, [narratives, search, statusFilter]);

  const focused = focusedId ? narratives.find((n) => n.id === focusedId) : null;

  // Máximo diario de la lista VISIBLE: los sparklines de la lista se comparan
  // entre sí, así que tienen que compartir escala. Se recalcula con el filtro
  // para que la comparación sea siempre entre las filas que se están viendo.
  const sparkMax = React.useMemo(
    () => filteredNarratives.reduce((m, n) => (n.sparkline && n.sparkline.length ? Math.max(m, ...n.sparkline) : m), 1),
    [filteredNarratives]
  );

  return (
    <div className="narrative-screen">
      <aside className="narrative-menu">
        <input
          className="narrative-search"
          placeholder="Buscar narrativa, keyword…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="narrative-status-filters">
          <button
            className={`chip ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Todas ({statusCounts.all || 0})
          </button>
          {/* Se incluye el bucket 'unknown' cuando tiene elementos, para que la
              suma de los chips SIEMPRE cuadre con "Todas". */}
          {NARRATIVE_STATUS_ORDER.concat(
            (statusCounts[NARRATIVE_STATUS_UNKNOWN] || 0) > 0 ? [NARRATIVE_STATUS_UNKNOWN] : []
          ).map((s) => {
            const count = statusCounts[s] || 0;
            return (
              <button
                key={s}
                className={`chip ${statusFilter === s ? 'active' : ''} ${count === 0 ? 'disabled' : ''}`}
                onClick={() => count > 0 && setStatusFilter(s)}
                disabled={count === 0}
                title={`${narrativeStatusLabel(s)} (${count})`}
              >
                <NarrativeStatusDot status={s} />
                {narrativeStatusLabel(s)} ({count})
              </button>
            );
          })}
        </div>
        <div className="narrative-menu-count">
          {filteredNarratives.length} de {narratives.length} narrativas · con actividad en el período
        </div>
        <ul className="narrative-list">
          {filteredNarratives.map((n) => (
            <li
              key={n.id}
              className={`narrative-item ${n.id === focusedId ? 'active' : ''}`}
              onClick={() => { setFocusedId(n.id); setSelectedDay(null); }}
            >
              <NarrativeStatusDot status={n.status} />
              <div className="narrative-item-body">
                <div className="narrative-item-name">{n.name}</div>
                <div className="narrative-item-meta">
                  <span>{(n.mentionCount || 0).toLocaleString('es-PR')} menc</span>
                  <span>·</span>
                  <span>{narrativeStatusLabel(n.status)}</span>
                </div>
              </div>
              {n.sparkline && (
                <NarrativeSparkline data={n.sparkline} color={narrativeStatusColor(n.status)} max={sparkMax} />
              )}
            </li>
          ))}
          {filteredNarratives.length === 0 && !loading && (
            <li><EmptyState reason="filtered" title="Sin resultados" detail="Ninguna narrativa coincide con la búsqueda." compact /></li>
          )}
        </ul>
      </aside>

      <main className="narrative-canvas">
        {loading ? (
          <div className="narrative-empty">Cargando…</div>
        ) : error ? (
          <EmptyState reason="error" title="No se pudieron cargar las narrativas" detail={String(error)} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 'var(--sp-15)', marginBottom: 'var(--sp-3)' }}>
              <button className={`chip ${view === 'detail' ? 'active' : ''}`} onClick={() => setView('detail')}>Detalle</button>
              <button className={`chip ${view === 'graph' ? 'active' : ''}`} onClick={() => setView('graph')}>Mapa de conexiones</button>
            </div>
            {view === 'graph' ? (
              <NarrativeGraph
                narratives={narratives}
                edges={edges}
                focusedId={focusedId}
                onSelect={(id) => { setFocusedId(id); setView('detail'); setSelectedDay(null); }}
              />
            ) : !focused ? (
              <EmptyState reason="empty" title="Elige una narrativa" detail="Selecciónala en la lista de la izquierda para ver su análisis." />
            ) : (
              <NarrativeAnalysis
                narrative={focused}
                edges={edges}
                allNarratives={narratives}
                agency={agency}
                selectedDay={selectedDay}
                onSelectDay={setSelectedDay}
                onSelectNarrative={(id) => { setFocusedId(id); setSelectedDay(null); }}
              />
            )}
          </>
        )}
      </main>

      {selectedDay && focused && (
        <NarrativeDayDrawer
          narrative={focused}
          day={selectedDay}
          agency={agency}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function NarrativeAnalysis({ narrative, edges, allNarratives, agency, selectedDay, onSelectDay, onSelectNarrative }) {
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/narrative/${narrative.id}?agency=${agency || ''}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setDetail(d); setDetailLoading(false); } })
      .catch(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [narrative.id, agency]);

  const timeline = detail?.timeline || [];
  const topAuthors = detail?.topAuthors || [];
  const platforms = detail?.platforms || [];
  const recent = detail?.recentMentions || [];

  const related = React.useMemo(() => {
    return edges
      .filter((e) => e.source === narrative.id || e.target === narrative.id)
      .map((e) => {
        const otherId = e.source === narrative.id ? e.target : e.source;
        const other = allNarratives.find((n) => n.id === otherId);
        if (!other) return null;
        return { ...other, edgeType: e.type, strength: e.strength };
      })
      .filter(Boolean)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 6);
  }, [edges, allNarratives, narrative.id]);

  const sentimentTotals = React.useMemo(() => {
    let p = 0, neu = 0, neg = 0;
    for (const d of timeline) {
      p += d.positive || 0;
      neu += d.neutral || 0;
      neg += d.negative || 0;
    }
    return { positive: p, neutral: neu, negative: neg, total: p + neu + neg };
  }, [timeline]);

  const peak = React.useMemo(() => {
    if (timeline.length === 0) return null;
    return timeline.reduce((acc, d) => (d.mentions > acc.mentions ? d : acc), timeline[0]);
  }, [timeline]);

  const init = narrative.initiatorFirst;
  const inf = narrative.initiatorInfluencer;

  // Cuando el detalle viene vacío, las cinco secciones de desglose se
  // convertían en cinco cajas idénticas diciendo "Sin datos" — el peor caso del
  // panel, y el que más se ve, porque una narrativa recién detectada todavía no
  // tiene desglose. Cinco huecos no informan más que uno: informan menos,
  // porque hay que leerlos todos para descubrir que ninguno dice nada.
  const hasBreakdown = sentimentTotals.total > 0 || topAuthors.length > 0
    || platforms.length > 0 || !!init || !!inf;

  return (
    <div className="narrative-analysis">
      <div className="narrative-header">
        <div className="narrative-header-main">
          <div className="narrative-header-row">
            <span className="pill narrative-status-pill" style={{ '--narr-tone': narrativeStatusColor(narrative.status) }}>
              {/* Misma función que la lista y los chips: leer el mapa a mano
                  dejaba escapar el status crudo de la DB —en inglés— cuando el
                  lambda manda un estado que la SPA todavía no conoce. */}
              {narrativeStatusLabel(narrative.status)}
            </span>
            <h2 className="narrative-title">{narrative.name}</h2>
          </div>
          {narrative.summary && <div className="narrative-summary">{narrative.summary}</div>}
          {(narrative.keywords || []).length > 0 && (
            <div className="narrative-keywords">
              {narrative.keywords.map((k) => (
                <span key={k} className="narrative-tag">{k}</span>
              ))}
            </div>
          )}
        </div>
        {/* <StatBox>, no un KPI a mano: el mismo concepto (etiqueta overline +
            cifra) medía 30px en Overview/Scorecard y 18px aquí, con otro peso y
            otro tracking en la etiqueta. Una cifra de KPI mide lo mismo en las
            cinco pantallas o no hay sistema. StatBox además trae la clase .num
            (tabular + lining), que es lo que este bloque replicaba a mano. */}
        <div className="narrative-header-metrics">
          <StatBox label="Menciones" value={narrative.mentionCount.toLocaleString('es-PR')} />
          <StatBox label="Vel. 24h" value={Number(narrative.velocity24h || 0).toFixed(1)} />
          <StatBox label="Engagement" value={Number(narrative.totalEngagement || 0).toLocaleString('es-PR')} />
        </div>
      </div>

      <NarrativeStreamgraph
        timeline={timeline}
        loading={detailLoading}
        selectedDay={selectedDay}
        onSelectDay={onSelectDay}
      />

      {!hasBreakdown && !detailLoading ? (
        <EmptyState
          reason="empty"
          title="Esta narrativa todavía no tiene desglose"
          detail={`El cluster agrupa ${narrative.mentionCount.toLocaleString('es-PR')} menciones, pero ninguna trae aún los campos de autor, plataforma y sentimiento que este panel necesita. Aparecen cuando el procesador las enriquece.`}
        />
      ) : (
      <>
      <div className="narrative-grid-3">
        <div className="narrative-panel">
          <div className="narrative-panel-label">Sentimiento</div>
          {sentimentTotals.total > 0 ? (
            <>
              <div className="narrative-sentiment-bar">
                <span style={{ flex: sentimentTotals.positive, background: 'var(--pos)' }} />
                <span style={{ flex: sentimentTotals.neutral, background: 'var(--text-3)' }} />
                <span style={{ flex: sentimentTotals.negative, background: 'var(--neg)' }} />
              </div>
              <div className="narrative-sentiment-row">
                <span><i style={{ background: 'var(--pos)' }} /> {Math.round((sentimentTotals.positive / sentimentTotals.total) * 100)}% positivo</span>
                <span><i style={{ background: 'var(--text-3)' }} /> {Math.round((sentimentTotals.neutral / sentimentTotals.total) * 100)}% neutral</span>
                <span><i style={{ background: 'var(--neg)' }} /> {Math.round((sentimentTotals.negative / sentimentTotals.total) * 100)}% negativo</span>
              </div>
              {peak && <div className="narrative-peak">✕ Pico: {peak.day} ({peak.mentions} menciones)</div>}
            </>
          ) : detailLoading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : (
            <EmptyState reason="empty" title="Sin datos" compact />
          )}
        </div>

        <div className="narrative-panel">
          <div className="narrative-panel-label">Top voces</div>
          {topAuthors.length > 0 ? (
            <ul className="narrative-bar-list">
              {topAuthors.slice(0, 6).map((a) => (
                <li key={a.author}>
                  <span className="narrative-bar-name" title={a.author}>{a.author}</span>
                  <span className="narrative-bar-count">{a.mentions}</span>
                </li>
              ))}
            </ul>
          ) : detailLoading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : (
            <EmptyState reason="empty" title="Sin datos" compact />
          )}
        </div>

        <div className="narrative-panel">
          <div className="narrative-panel-label">Plataformas</div>
          {platforms.length > 0 ? (
            <ul className="narrative-bar-list">
              {platforms.slice(0, 6).map((p) => {
                const max = platforms[0].mentions || 1;
                return (
                  <li key={p.platform}>
                    <span className="narrative-bar-name">{platformLabel(p.platform)}</span>
                    <span className="narrative-bar-track">
                      <span className="narrative-bar-fill" style={{ width: `${(p.mentions / max) * 100}%` }} />
                    </span>
                    <span className="narrative-bar-count">{p.mentions}</span>
                  </li>
                );
              })}
            </ul>
          ) : detailLoading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : (
            <EmptyState reason="empty" title="Sin datos" compact />
          )}
        </div>
      </div>

      <div className="narrative-grid-2">
        <div className="narrative-panel">
          <div className="narrative-panel-label">Primera mención (cronológica)</div>
          {init ? (
            <div>
              <div className="narrative-init-author">
                <strong>{init.author || '—'}</strong>
                {init.platform && <span className="narrative-tag-mini">{platformLabel(init.platform)}</span>}
              </div>
              <div className="narrative-init-date">
                {new Date(init.publishedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
              {init.snippet && <div className="narrative-init-snippet">{init.snippet}</div>}
              {init.url && (
                <a href={init.url} target="_blank" rel="noopener noreferrer" className="narrative-link">
                  Ver fuente →
                </a>
              )}
            </div>
          ) : (
            <EmptyState reason="empty" title="Sin datos" compact />
          )}
        </div>

        <div className="narrative-panel">
          <div className="narrative-panel-label">Voz más influyente (24h)</div>
          {inf ? (
            <div>
              <div className="narrative-init-author">
                <strong>{inf.author || '—'}</strong>
              </div>
              <div className="narrative-init-meta">
                Reach {(inf.reach || 0).toLocaleString('es-PR')} · Eng {(inf.engagement || 0).toLocaleString('es-PR')}
              </div>
              {inf.url && (
                <a href={inf.url} target="_blank" rel="noopener noreferrer" className="narrative-link">
                  Ver fuente →
                </a>
              )}
            </div>
          ) : (
            <EmptyState reason="pending" title="Aún no se puede calcular" detail="Requiere al menos 24 h de historia." compact />
          )}
        </div>
      </div>
      </>
      )}

      {/* El módulo se RENDERIZA vacío en vez de desaparecer: un panel ausente se
          lee como "esta narrativa no tiene esa sección", no como "todavía no hay
          datos". Se omite sólo cuando la narrativa entera no tiene desglose,
          porque ahí ya lo explica un único EmptyState arriba y volveríamos a
          apilar cajas vacías idénticas. */}
      {(recent.length > 0 || hasBreakdown) && (
        <div className="narrative-panel">
          <div className="narrative-panel-label">Menciones recientes</div>
          {recent.length === 0 ? <EmptyState reason="empty" title="Sin datos" compact /> : (
          <div className="narrative-mentions-list">
            {recent.slice(0, 5).map((m) => (
              <div key={m.id} className="narrative-mention-row">
                <div className="narrative-mention-title">{m.title || '(sin título)'}</div>
                <div className="narrative-mention-meta">
                  {m.author && <span>{m.author}</span>}
                  {m.pageType && <span className="narrative-tag-mini">{m.pageType}</span>}
                  {m.sentiment && <span className={`narrative-sentiment-mini sent-${m.sentiment}`}>{m.sentiment}</span>}
                  <span>{new Date(m.publishedAt).toLocaleDateString('es')}</span>
                  {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer">→</a>}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {(related.length > 0 || hasBreakdown) && (
        <div className="narrative-panel">
          <div className="narrative-panel-label">Narrativas relacionadas</div>
          {related.length === 0 ? <EmptyState reason="empty" title="Sin datos" compact /> : (
          <ul className="narrative-related-list">
            {related.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="narrative-related-btn"
                  onClick={() => onSelectNarrative(r.id)}
                  title={`${edgeTypeLabel(r.edgeType)}${strengthPct(r.strength) ? ` (${strengthPct(r.strength)})` : ''}`}
                >
                  <NarrativeStatusDot status={r.status} />
                  <span className="narrative-related-name">{r.name}</span>
                  <span className="narrative-related-meta">{edgeTypeLabel(r.edgeType)}{strengthPct(r.strength) ? ` · ${strengthPct(r.strength)}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NarrativeStreamgraph({ timeline, loading, selectedDay, onSelectDay }) {
  // Coordenadas en PÍXELES reales, no en un viewBox de 1080 escalado: dentro de
  // un viewBox el font-size de los rótulos se multiplica por la escala de
  // render, así que --fs-overline (11px) salía a 7.8px en desktop y a 3.1px a
  // 390px de viewport — el piso tipográfico de tokens.css:61-63 no llega ahí.
  // Es el patrón del resto de las gráficas (charts.js:174-177): 1 unidad = 1
  // píxel, y de paso desaparece el letterboxing de `meet` en pantallas anchas.
  const [wrapRef, w] = useChartWidth(760);
  const h = 240;
  const margin = { top: 20, right: 24, bottom: 32, left: 24 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  // El div de medición existe en las TRES ramas y en la misma posición: React
  // reusa el nodo al pasar de "cargando" a "con datos", así que la medición del
  // ancho sobrevive el cambio de rama (useChartWidth mide al montar).
  if (loading) {
    return (
      <div className="narrative-stream-wrap">
        <div ref={wrapRef} className="narrative-empty-small">Cargando timeline…</div>
      </div>
    );
  }
  if (!timeline || timeline.length === 0) {
    // `pending`, no `empty`: no es que la serie valga cero, es que una narrativa
    // con menciones de un solo día no tiene evolución que dibujar todavía.
    return (
      <div className="narrative-stream-wrap">
        <div ref={wrapRef}>
        <EmptyState
          reason="pending"
          title="Sin evolución que dibujar todavía"
          detail="Hacen falta menciones en más de un día para trazar la serie."
          compact
        />
        </div>
      </div>
    );
  }

  const times = timeline.map((d) => new Date(d.day).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const span = Math.max(1, maxT - minT);
  const xScale = (t) => margin.left + ((new Date(t).getTime() - minT) / span) * innerW;

  const maxTotal = Math.max(...timeline.map((d) => (d.positive || 0) + (d.neutral || 0) + (d.negative || 0)), 1);
  const yCenter = margin.top + innerH / 2;
  // El apilado va de -total/2 a +total/2: el valor absoluto máximo es
  // maxTotal/2, NO maxTotal. Dividiendo por maxTotal el día pico ocupaba
  // 0.46·innerH y la mitad del lienzo quedaba vacía siempre, así que un día
  // récord se dibujaba como un día mediano. La escala sigue siendo lineal y
  // pasando por cero —las proporciones entre días no cambian—: lo único que
  // deja de hacer es tirar la mitad de la resolución disponible.
  const yScale = (v) => yCenter - (v / (maxTotal / 2)) * (innerH / 2) * 0.92;

  const stackedPoints = timeline.map((d) => {
    const x = xScale(d.day);
    const total = (d.positive || 0) + (d.neutral || 0) + (d.negative || 0);
    const baseline = -total / 2;
    const negTop = baseline + (d.negative || 0);
    const neuTop = negTop + (d.neutral || 0);
    const posTop = neuTop + (d.positive || 0);
    return {
      x,
      day: d.day,
      mentions: d.mentions || 0,
      baseline_y: yScale(baseline),
      neg_y: yScale(negTop),
      neu_y: yScale(neuTop),
      pos_y: yScale(posTop),
    };
  });

  const buildLayerPath = (upperKey, lowerKey) => {
    const upper = stackedPoints.map((p) => ({ x: p.x, y: p[upperKey] }));
    const lower = stackedPoints.map((p) => ({ x: p.x, y: p[lowerKey] })).reverse();
    const upperD = smoothPath(upper);
    const lowerD = smoothPath(lower).replace(/^M/, 'L');
    return `${upperD} ${lowerD} Z`;
  };

  const layers = [
    { key: 'negative', d: buildLayerPath('neg_y', 'baseline_y'), color: 'var(--neg)' },
    { key: 'neutral', d: buildLayerPath('neu_y', 'neg_y'), color: 'var(--text-3)' },
    { key: 'positive', d: buildLayerPath('pos_y', 'neu_y'), color: 'var(--pos)' },
  ];

  // Granularidad del eje según el span. Con marcas SÓLO mensuales, una
  // narrativa de días o semanas producía 0-1 ticks y `setDate(1)` caía ANTES de
  // minT, con lo que el único tick se dibujaba en x < margin.left —fuera del
  // área de trazado— y la serie quedaba sin escala temporal legible. Ahora los
  // ticks se construyen dentro de [minT, maxT] por definición.
  const DAY_MS = 86400000;
  const spanDays = span / DAY_MS;
  const stepDays = spanDays <= 10 ? 1 : spanDays <= 24 ? 2 : spanDays <= 70 ? 7 : 0;
  const ticks = [];
  if (stepDays === 0) {
    const cursor = new Date(minT);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= maxT) {
      if (cursor.getTime() >= minT) ticks.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    // Se arranca un paso DESPUÉS de minT porque el borde izquierdo ya lo rotula
    // el marcador "▸ inicio" con su fecha.
    for (let t = minT + stepDays * DAY_MS; t <= maxT; t += stepDays * DAY_MS) ticks.push(new Date(t));
  }
  const tickEvery = ticks.length > 12 ? Math.ceil(ticks.length / 10) : 1;
  const tickFormat = stepDays === 0
    ? { month: 'short', year: '2-digit' }
    : { day: 'numeric', month: 'short' };

  const peak = timeline.reduce((acc, d) => (d.mentions > acc.mentions ? d : acc), timeline[0]);
  const peakX = xScale(peak.day);

  return (
    <div className="narrative-stream-wrap">
      {/* Div sin estilos cuyo ancho ES el área de trazado (el wrap tiene padding
          y borde, que getBoundingClientRect incluiría). Mismo idioma que las
          gráficas de charts.js. */}
      <div ref={wrapRef}>
      <div className="narrative-stream-legend">
        <span className="narrative-stream-key"><i style={{ background: 'var(--pos)' }} /> Positivo</span>
        <span className="narrative-stream-key"><i style={{ background: 'var(--text-3)' }} /> Neutral</span>
        <span className="narrative-stream-key"><i style={{ background: 'var(--neg)' }} /> Negativo</span>
        <span className="narrative-stream-hint">Click un día para ver sus menciones</span>
      </div>
      <svg className="narrative-stream-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {layers.map((L) => (
          <path key={L.key} d={L.d} fill={L.color} opacity={0.78} />
        ))}
        <line x1={margin.left} y1={yCenter} x2={margin.left + innerW} y2={yCenter} stroke="var(--hairline)" strokeWidth="0.5" opacity={0.5} />

        {stackedPoints.map((p, i) => {
          const prev = stackedPoints[i - 1];
          const next = stackedPoints[i + 1];
          const x0 = prev ? (prev.x + p.x) / 2 : p.x - 2;
          const x1 = next ? (p.x + next.x) / 2 : p.x + 2;
          const isSelected = selectedDay === p.day;
          return (
            <g key={p.day} className={`narrative-stream-day ${isSelected ? 'is-selected' : ''}`} style={{ cursor: 'pointer' }}>
              <rect
                x={x0}
                y={margin.top}
                width={Math.max(1, x1 - x0)}
                height={innerH}
                fill="transparent"
                onClick={() => onSelectDay(p.day)}
              />
              {isSelected && (
                <>
                  <line
                    x1={p.x}
                    y1={margin.top}
                    x2={p.x}
                    y2={margin.top + innerH}
                    stroke="var(--accent)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    style={{ pointerEvents: 'none' }}
                  />
                  <circle cx={p.x} cy={yCenter} r="4" fill="var(--accent)" style={{ pointerEvents: 'none' }} />
                </>
              )}
              <title>{`${p.day} · ${p.mentions} menciones`}</title>
            </g>
          );
        })}

        {peak && (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={peakX} y1={margin.top} x2={peakX} y2={margin.top + innerH} stroke="var(--accent)" strokeWidth="0.5" opacity={0.4} />
            <text x={peakX} y={margin.top + 12} textAnchor="middle" fill="var(--accent)" fontSize="var(--fs-overline)" fontWeight="600">
              ✕ pico
            </text>
          </g>
        )}

        {/* Marcador de inicio de la narrativa: el timeline arranca en su primer
            día de actividad (born_at), así que el borde izquierdo es el nacimiento.
            Lo etiquetamos explícitamente porque antes la fecha de inicio no se
            entendía. */}
        <g style={{ pointerEvents: 'none' }}>
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="var(--pos)" strokeWidth="1.5" opacity={0.85} />
          <text x={margin.left + 5} y={margin.top + innerH - 6} textAnchor="start" fill="var(--pos)" fontSize="var(--fs-overline)" fontWeight="700">
            ▸ inicio {new Date(timeline[0].day).toLocaleDateString('es', { day: 'numeric', month: 'short' })}
          </text>
        </g>

        {ticks.map((d, i) => {
          if (i % tickEvery !== 0) return null;
          const x = xScale(d);
          return (
            <g key={i} style={{ pointerEvents: 'none' }}>
              <line x1={x} y1={margin.top + innerH} x2={x} y2={margin.top + innerH + 4} stroke="var(--hairline-strong)" />
              <text x={x} y={margin.top + innerH + 18} textAnchor="middle" fill="var(--text-2)" fontSize="var(--fs-overline)">
                {d.toLocaleDateString('es', tickFormat)}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    </div>
  );
}

function NarrativeDayDrawer({ narrative, day, agency, onClose }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/narrative/${narrative.id}/day?date=${day}&agency=${agency || ''}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [narrative.id, day, agency]);

  const dateLabel = new Date(day).toLocaleDateString('es', { dateStyle: 'long' });

  return (
    <div className="narrative-day-drawer">
      <div className="narrative-day-overlay" onClick={onClose} />
      <div className="narrative-day-panel">
        <div className="narrative-day-header">
          <div>
            <div className="narrative-day-eyebrow">{narrative.name}</div>
            <div className="narrative-day-title">{dateLabel}</div>
            {data && <div className="narrative-day-count">{data.totalMentions} menciones</div>}
          </div>
          <button className="narrative-day-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="narrative-day-body">
          {loading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : !data || data.totalMentions === 0 ? (
            <EmptyState reason="empty" title="Sin menciones este día" detail="La narrativa no registró actividad en la fecha seleccionada." compact />
          ) : (
            ['positivo', 'neutral', 'negativo', 'sin_clasificar'].map((kind) => {
              const items = (data.clusters && data.clusters[kind]) || [];
              if (items.length === 0) return null;
              const label = kind === 'sin_clasificar' ? 'Sin clasificar' : kind.charAt(0).toUpperCase() + kind.slice(1);
              const color = kind === 'positivo' ? 'var(--pos)' : kind === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
              return (
                <div key={kind} className="narrative-day-cluster">
                  <div className="narrative-day-cluster-label">
                    <span className="narrative-dot" style={{ background: color }} />
                    {label} <em>({items.length})</em>
                  </div>
                  {items.map((m) => (
                    <div key={m.id} className="narrative-day-mention">
                      <div className="narrative-day-mention-title">{m.title || '(sin título)'}</div>
                      <div className="narrative-day-mention-meta">
                        {m.author && <strong>{m.author}</strong>}
                        {m.pageType && <span className="narrative-tag-mini">{m.pageType}</span>}
                        <span>· {new Date(m.publishedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                        {(m.engagement || 0) > 0 && <span>· {m.engagement} eng</span>}
                      </div>
                      {m.snippet && <div className="narrative-day-mention-snippet">{m.snippet}</div>}
                      {m.url && (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="narrative-link">
                          Ver fuente →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
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
                        fontSize: 'var(--fs-overline)', fontWeight: 700, color: i === 2 ? 'var(--accent)' : 'var(--text-3)',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
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
                            <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 'var(--sp-05)' }}>Salud · {a.display.bhi.word}</div>
                          </div>
                          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                            <div className="num" style={{ fontSize: 'var(--fs-title-md)', fontWeight: 600, color: nssColor, lineHeight: 1 }}>{a.display.nss.value || '—'}</div>
                            <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 'var(--sp-05)' }}>Sent. neto</div>
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
                    <div className="mono" style={{ padding: '9px 14px 4px', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{agencyName}</div>
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
