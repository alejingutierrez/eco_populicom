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
