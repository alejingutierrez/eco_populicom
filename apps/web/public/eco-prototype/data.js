// Empty fallbacks for the dashboard prototype.
//
// Históricamente este archivo contenía datasets sintéticos de
// agencias y menciones inventadas ("DTOP", "PR-21 en Río Piedras", etc.)
// que se mezclaban con los datos reales del API en `_remote` cada vez que
// algún campo venía null. Eso confundía a los usuarios — un panel que
// debería estar vacío mostraba menciones falsas como si fueran reales.
//
// Ahora todo arranca con arrays/objetos vacíos. La UI muestra "empty
// states" honestos cuando el backend no devuelve datos para un campo.
// Si necesitas datos para diseño visual offline, usa
// `scripts/preview-weekly-report.ts` o `?fixtures=1` (no implementado).

const PERIODS = [
  { key: '24h', label: '24 h' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: '90d', label: '90 días' },
  { key: 'custom', label: 'Personalizado' },
];

const _mocks = {
  AGENCIES: [],
  PERIODS,
  TIMELINE: [],
  CURRENT_METRICS: {
    nss: null,
    nssDelta: 0,
    nss7d: null,
    nss30d: null,
    brandHealthIndex: null,
    brandHealthDelta: 0,
    crisisRiskScore: null,
    crisisDelta: 0,
    totalMentions: 0,
    totalMentionsDelta: 0,
    totalReach: 0,
    engagementRate: null,
    engagementDelta: 0,
    amplificationRate: null,
    amplificationDelta: 0,
    reputationMomentum: null,
    engagementVelocity: null,
    volumeAnomalyZscore: null,
    polarizationIndex: null,
    positiveCount: 0,
    neutralCount: 0,
    negativeCount: 0,
    highPertinenceCount: 0,
    // Formato legible (lo llena /api/eco-data vía @eco/shared/format). Estos
    // placeholders evitan que el scorecard rompa antes de que resuelva el fetch.
    display: {
      nss: { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
      brandHealth: { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
      crisis: { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
      polarization: { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
      engagementRate: { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
      amplificationRate: { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
      velocity: { word: 'Sin base', value: null, short: 'Sin base de comparación', raw: null, band: null, tone: 'neutral', color: 'var(--text-3)' },
    },
    deltaDisplay: {
      nss: { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' },
      brandHealth: { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' },
      crisis: { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' },
      engagementRate: { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' },
      totalMentions: { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' },
      polarization: { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' },
    },
  },
  SENTIMENT_BREAKDOWN: [
    { name: 'positivo', value: 0, label: 'Positivo' },
    { name: 'neutral', value: 0, label: 'Neutral' },
    { name: 'negativo', value: 0, label: 'Negativo' },
  ],
  TOP_SOURCES: [],
  TOPICS: [],
  MUNICIPALITIES: [],
  EMOTIONS: [],
  MENTIONS: [],
  ALERTS: [],
  ALERT_FEED: [],
  COMPARISON: [],
  SENTIMENT_BY_SOURCE: [],
  SUBTOPICS: {},
  TOPIC_CALENDAR: [],
};

const _remote = (typeof window !== 'undefined' && window.ECO_DATA_REMOTE) || {};
window.ECO_DATA = Object.assign({}, _mocks, Object.fromEntries(
  Object.entries(_remote).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
));
if (_remote.AGENCIES_FULL) window.ECO_DATA.AGENCIES_FULL = _remote.AGENCIES_FULL;
if (_remote.USER_AGENCY_SLUG) window.ECO_DATA.USER_AGENCY_SLUG = _remote.USER_AGENCY_SLUG;

// ---------------------------------------------------------------------------
// Total de menciones del período — FUENTE ÚNICA (WS-P0.5).
//
// Antes cada widget resolvía su propio total y no cuadraban: el KPI "Volumen ·
// período" y el badge del rail sumaban `TIMELINE[].totalMentions` (agregado de
// daily_metric_snapshots) mientras el enlace "Ver todas" y el modal que abre la
// propia tarjeta usaban `CURRENT_METRICS.totalMentions` (recuento vivo sobre la
// tabla `mentions`). Medido en producción: 47 vs 54, ~13% de diferencia — el
// usuario hacía click en una tarjeta y el drill-down la contradecía.
//
// Canónico = el recuento vivo, porque es el único que el drill-down puede
// reproducir: /api/eco-mentions cuenta sobre `mentions` con los mismos filtros.
// La suma de snapshots queda como respaldo para cuando CURRENT_METRICS no trae
// el campo (payload viejo o período sin snapshots).
window.ecoPeriodMentionTotal = function ecoPeriodMentionTotal() {
  const D = window.ECO_DATA || {};
  const live = D.CURRENT_METRICS && D.CURRENT_METRICS.totalMentions;
  if (typeof live === 'number' && live > 0) return live;
  const fromSnapshots = (D.TIMELINE || []).reduce((s, t) => s + (t.totalMentions || 0), 0);
  if (fromSnapshots > 0) return fromSnapshots;
  return (D.MENTIONS && D.MENTIONS.length) || 0;
};

// ---------------------------------------------------------------------------
// Puente de tokens para JavaScript (WS-F1).
//
// tokens.css es la fuente única de los valores, pero hay dos cosas que el CSS
// no puede resolver solo:
//
//   1. Las PALETAS ORDENADAS. Una serie de gráfica o una lista de fuentes
//      necesita "el token i-ésimo de la paleta categórica". Aquí vive el orden;
//      los valores siguen en tokens.css.
//   2. Los CONSUMIDORES QUE EXIGEN UN STRING LITERAL. Leaflet recibe los
//      colores como opciones JS (`fillColor`, `color`), no como CSS, así que no
//      puede resolver `var(--pos)`. Por eso `ecoTokenValue()` lo resuelve con
//      getComputedStyle. Es también la razón por la que el modo claro estaba
//      roto en el mapa: los marcadores llevaban hex de modo oscuro.
// ---------------------------------------------------------------------------

// Paleta categórica. Se asigna EN ORDEN, nunca por hash del nombre ni al azar,
// y no reutiliza los hues de --pos/--neg/--warn: en un dashboard de sentimiento
// el verde ya significa "positivo", así que una categoría verde se lee como un
// juicio. (Antes este array de 8 hex estaba COPIADO LITERALMENTE 4 veces en
// screens.js: líneas 312, 1996, 2441 y 4102.)
window.ECO_CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)',
                  'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)'];

// Color categórico estable por índice.
window.ecoCat = function ecoCat(i) {
  return window.ECO_CAT[((i % window.ECO_CAT.length) + window.ECO_CAT.length) % window.ECO_CAT.length];
};

// Plataformas / fuentes. Claves = las mismas que usa `sourceKey()` en el API.
window.ECO_SOURCE_COLOR = {
  news: 'var(--cat-1)',
  facebook: 'var(--cat-5)',
  instagram: 'var(--cat-2)',
  twitter: 'var(--cat-3)',
  x: 'var(--cat-3)',
  youtube: 'var(--cat-4)',
  blog: 'var(--cat-6)',
  forum: 'var(--cat-7)',
  linkedin: 'var(--cat-5)',
  tumblr: 'var(--cat-2)',
  reddit: 'var(--cat-7)',
  desconocido: 'var(--cat-8)',
};
window.ecoSourceColor = function ecoSourceColor(key) {
  return window.ECO_SOURCE_COLOR[String(key || '').toLowerCase()] || 'var(--cat-8)';
};

// Emociones — el set canónico que produce el processor.
window.ECO_EMOTION_COLOR = {
  ira: 'var(--emo-ira)',
  enojo: 'var(--emo-ira)',
  frustración: 'var(--emo-frustracion)',
  frustracion: 'var(--emo-frustracion)',
  miedo: 'var(--emo-miedo)',
  preocupación: 'var(--emo-miedo)',
  preocupacion: 'var(--emo-miedo)',
  tristeza: 'var(--emo-tristeza)',
  alegría: 'var(--emo-alegria)',
  alegria: 'var(--emo-alegria)',
  satisfacción: 'var(--emo-alegria)',
  satisfaccion: 'var(--emo-alegria)',
  esperanza: 'var(--emo-esperanza)',
  alivio: 'var(--emo-esperanza)',
  sorpresa: 'var(--emo-sorpresa)',
  sarcasmo: 'var(--emo-miedo)',
};
window.ecoEmotionColor = function ecoEmotionColor(e) {
  const k = String(e || '').toLowerCase().trim();
  return window.ECO_EMOTION_COLOR[k] || 'var(--text-3)';
};

// Sentimiento — un solo mapa para todo el producto. Antes `SENT_HEX`
// (screens.js:2447) usaba #2E8B6A/#C2412F, que son el verde y el rojo del tema
// `costa`, dentro de `mando`.
window.ecoSentimentColor = function ecoSentimentColor(s) {
  const k = String(s || '').toLowerCase();
  if (k === 'positivo' || k === 'positive' || k === 'pos') return 'var(--pos)';
  if (k === 'negativo' || k === 'negative' || k === 'neg') return 'var(--neg)';
  return 'var(--text-3)';
};

// Métricas compuestas que necesitan color propio en las series de gráfica.
window.ECO_METRIC_COLOR = {
  nss: 'var(--accent)',
  brandHealthIndex: 'var(--pos)',
  totalMentions: 'var(--text-2)',
  crisisRiskScore: 'var(--neg)',
  polarizationIndex: 'var(--metric-polarization)',
  engagementRate: 'var(--warn)',
};

// Resuelve un token a su valor computado. SÓLO para consumidores que no
// aceptan CSS (Leaflet). Se re-resuelve en cada llamada para que el cambio de
// modo claro/oscuro se refleje.
window.ecoTokenValue = function ecoTokenValue(cssValue, fallback) {
  const v = String(cssValue || '');
  const m = v.match(/^var\((--[\w-]+)\)$/);
  if (!m) return v || fallback || '#000';
  const out = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  return out || fallback || '#000';
};

// ---------------------------------------------------------------------------
// Dirección del delta (WS-F4) — un solo contrato para todo el producto.
//
// Antes cada pantalla decidía por su cuenta y se contradecían: el delta de
// VOLUMEN era verde-si-sube en el Scorecard y rojo-si-sube en Tópicos, el mismo
// dato con colores opuestos. Y `SentimentBar` pintaba TODA subida de volumen
// como mala, también la de Turismo.
//
// El volumen es NEUTRO: que suba no es bueno ni malo por sí mismo — depende del
// tópico, y el producto no sabe cuál es "bueno". Lo que sí tiene dirección es
// la métrica compuesta.
// ---------------------------------------------------------------------------
window.ECO_METRIC_DIRECTION = {
  nss: 'up-good',
  brandHealthIndex: 'up-good',
  engagementRate: 'up-good',
  crisisRiskScore: 'up-bad',
  polarizationIndex: 'up-bad',
  negativeCount: 'up-bad',
  positiveCount: 'up-good',
  totalMentions: 'neutral',
  volume: 'neutral',
  reach: 'neutral',
};

// Color del delta según la dirección declarada de la métrica.
// `neutral` NO se colorea: se muestra en --text-2 con su flecha, que ya dice el
// sentido sin emitir un juicio que el producto no puede sostener.
window.ecoDeltaColor = function ecoDeltaColor(metricKey, delta) {
  if (delta == null || !Number.isFinite(Number(delta)) || Number(delta) === 0) return 'var(--text-3)';
  const dir = window.ECO_METRIC_DIRECTION[metricKey] || 'neutral';
  if (dir === 'neutral') return 'var(--text-2)';
  const up = Number(delta) > 0;
  const good = dir === 'up-good' ? up : !up;
  return good ? 'var(--pos)' : 'var(--neg)';
};

window.ecoDeltaArrow = function ecoDeltaArrow(delta) {
  if (delta == null || !Number.isFinite(Number(delta))) return '—';
  const d = Number(delta);
  return d > 0 ? '↑' : d < 0 ? '↓' : '↔';
};
