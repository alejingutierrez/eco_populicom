// Mock data for ECO prototype
const AGENCIES = [
  { slug: 'dtop', name: 'Dept. de Transportación y Obras Públicas' },
  { slug: 'salud', name: 'Dept. de Salud' },
  { slug: 'educacion', name: 'Dept. de Educación' },
  { slug: 'afi', name: 'Autoridad de Fuentes Fluviales' },
  { slug: 'prepa', name: 'Autoridad de Energía Eléctrica' },
  { slug: 'fortaleza', name: 'La Fortaleza' },
];

const PERIODS = [
  { key: '24h', label: '24 h' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: '90d', label: '90 días' },
  { key: 'custom', label: 'Personalizado' },
];

// Deterministic pseudo-random for reproducible mocks
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// Timeline data for 30 days
function genTimeline() {
  const rnd = seeded(42);
  const today = new Date('2026-04-17');
  const out = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('es-PR', { month: 'short', day: 'numeric' });
    // NSS sine wave with dip mid-period
    const phase = i / 29;
    const nss = Math.round((12 + Math.sin(phase * Math.PI * 2) * 8 - (i > 8 && i < 14 ? 14 : 0) + (rnd() - 0.5) * 4) * 10) / 10;
    const bhi = Math.max(0.3, Math.min(0.95, 0.62 + Math.cos(phase * Math.PI * 2) * 0.12 + (rnd() - 0.5) * 0.04));
    const volume = Math.round(340 + Math.sin(phase * Math.PI * 4) * 80 + (i > 8 && i < 14 ? 260 : 0) + rnd() * 60);
    const crisis = Math.max(0.1, 0.3 + (i > 8 && i < 14 ? 1.4 : 0) + (rnd() - 0.5) * 0.3);
    const eng = 2.4 + Math.sin(phase * 7) * 0.6 + rnd() * 0.3;
    const pos = Math.round(volume * (0.38 + (rnd() - 0.5) * 0.06));
    const neg = Math.round(volume * (0.22 + (i > 8 && i < 14 ? 0.18 : 0) + (rnd() - 0.5) * 0.04));
    const neu = volume - pos - neg;
    out.push({
      date: label,
      fullDate: d.toISOString(),
      nss,
      brandHealthIndex: Math.round(bhi * 100) / 100,
      totalMentions: volume,
      crisisRiskScore: Math.round(crisis * 10) / 10,
      engagementRate: Math.round(eng * 100) / 100,
      positivo: pos,
      neutral: neu,
      negativo: neg,
    });
  }
  return out;
}

const TIMELINE = genTimeline();

const CURRENT_METRICS = {
  nss: 8.4,
  nssDelta: -3.2,
  nss7d: 5.1,
  nss30d: 9.8,
  brandHealthIndex: 0.71,
  brandHealthDelta: -0.04,
  crisisRiskScore: 1.2,
  crisisDelta: 0.5,
  totalMentions: 12847,
  totalMentionsDelta: 18.4,
  totalReach: 2_340_000,
  engagementRate: 3.24,
  engagementDelta: 0.42,
  amplificationRate: 14.7,
  amplificationDelta: -1.2,
  reputationMomentum: -1.8,
  engagementVelocity: 12.4,
  volumeAnomalyZscore: 2.3,
  positiveCount: 5021,
  neutralCount: 4983,
  negativeCount: 2843,
  highPertinenceCount: 1342,
};

const SENTIMENT_BREAKDOWN = [
  { name: 'positivo', value: 5021, label: 'Positivo' },
  { name: 'neutral', value: 4983, label: 'Neutral' },
  { name: 'negativo', value: 2843, label: 'Negativo' },
];

const TOP_SOURCES = [
  { source: 'Facebook', key: 'facebook', count: 4120 },
  { source: 'X / Twitter', key: 'twitter', count: 3284 },
  { source: 'Noticias', key: 'news', count: 2410 },
  { source: 'Instagram', key: 'instagram', count: 1687 },
  { source: 'YouTube', key: 'youtube', count: 842 },
  { source: 'Blogs', key: 'blog', count: 504 },
];

const TOPICS = [
  { slug: 'infraestructura', name: 'Infraestructura vial', count: 2843, positivePct: 22, negativePct: 54, neutralPct: 24, dominantSentiment: 'negativo', delta: 38 },
  { slug: 'permisos', name: 'Permisos y licencias', count: 1920, positivePct: 18, negativePct: 48, neutralPct: 34, dominantSentiment: 'negativo', delta: 12 },
  { slug: 'servicios', name: 'Servicios digitales', count: 1587, positivePct: 52, negativePct: 16, neutralPct: 32, dominantSentiment: 'positivo', delta: -4 },
  { slug: 'transporte', name: 'Transporte público', count: 1320, positivePct: 34, negativePct: 38, neutralPct: 28, dominantSentiment: 'mixed', delta: 22 },
  { slug: 'seguridad', name: 'Seguridad vial', count: 984, positivePct: 28, negativePct: 42, neutralPct: 30, dominantSentiment: 'negativo', delta: 4 },
  { slug: 'ambiente', name: 'Ambiente y reciclaje', count: 743, positivePct: 62, negativePct: 14, neutralPct: 24, dominantSentiment: 'positivo', delta: -8 },
  { slug: 'presupuesto', name: 'Presupuesto', count: 621, positivePct: 20, negativePct: 44, neutralPct: 36, dominantSentiment: 'negativo', delta: 2 },
  { slug: 'personal', name: 'Recursos humanos', count: 412, positivePct: 38, negativePct: 28, neutralPct: 34, dominantSentiment: 'mixed', delta: -2 },
];

const MUNICIPALITIES = [
  { slug: 'san-juan', name: 'San Juan', region: 'Metro', count: 3420, nss: -4.2 },
  { slug: 'bayamon', name: 'Bayamón', region: 'Metro', count: 1842, nss: 2.1 },
  { slug: 'ponce', name: 'Ponce', region: 'Sur', count: 1420, nss: 5.4 },
  { slug: 'caguas', name: 'Caguas', region: 'Centro-oriental', count: 980, nss: 8.2 },
  { slug: 'mayaguez', name: 'Mayagüez', region: 'Oeste', count: 872, nss: 1.8 },
  { slug: 'arecibo', name: 'Arecibo', region: 'Norte', count: 648, nss: -2.1 },
  { slug: 'carolina', name: 'Carolina', region: 'Metro', count: 612, nss: 6.8 },
  { slug: 'guaynabo', name: 'Guaynabo', region: 'Metro', count: 540, nss: 3.2 },
  { slug: 'humacao', name: 'Humacao', region: 'Este', count: 420, nss: -1.4 },
  { slug: 'aguadilla', name: 'Aguadilla', region: 'Oeste', count: 382, nss: 4.1 },
];

const EMOTIONS = [
  { emotion: 'Enojo', count: 1842, color: 'neg' },
  { emotion: 'Frustración', count: 1421, color: 'neg' },
  { emotion: 'Aprobación', count: 1284, color: 'pos' },
  { emotion: 'Esperanza', count: 987, color: 'pos' },
  { emotion: 'Preocupación', count: 812, color: 'warn' },
  { emotion: 'Alegría', count: 640, color: 'pos' },
  { emotion: 'Confusión', count: 432, color: 'neu' },
];

const MENTIONS = [
  { id: 'm1', title: 'Vecinos de Río Piedras denuncian cráteres en la PR-21 tras lluvias', domain: 'elnuevodia.com', source: 'news', author: '@eldiario', sentiment: 'negativo', pertinence: 'alta', engagement: 8420, likes: 3420, comments: 842, shares: 1240, publishedAt: 'hace 12 min', emotions: ['enojo', 'frustración'], topic: 'infraestructura', topicName: 'Infraestructura vial', subtopics: ['Cráteres / baches', 'PR-21'], municipality: 'San Juan', region: 'Metro', coords: [18.4037, -66.0503] },
  { id: 'm2', title: 'DTOP anuncia nueva ruta exprés hacia el AMA — celebran residentes del sur', domain: 'twitter.com', source: 'twitter', author: '@DTOP_PR', sentiment: 'positivo', pertinence: 'alta', engagement: 6210, likes: 2140, comments: 412, shares: 820, publishedAt: 'hace 34 min', emotions: ['esperanza'], topic: 'transporte', topicName: 'Transporte público', subtopics: ['AMA', 'Rutas nuevas'], municipality: 'Ponce', region: 'Sur', coords: [18.0111, -66.6141] },
  { id: 'm3', title: 'Reporte ciudadano: semáforo dañado en Ave. Ponce de León causa tapón', domain: 'facebook.com', source: 'facebook', author: 'Juan Ramírez', sentiment: 'negativo', pertinence: 'media', engagement: 342, likes: 180, comments: 84, shares: 42, publishedAt: 'hace 1 h', emotions: ['frustración'], topic: 'infraestructura', topicName: 'Infraestructura vial', subtopics: ['Semáforos', 'Tapones'], municipality: 'San Juan', region: 'Metro', coords: [18.4655, -66.1057] },
  { id: 'm4', title: 'Portal SURI recibe elogios por nueva interfaz de renovación de marbetes', domain: 'instagram.com', source: 'instagram', author: '@gobpr', sentiment: 'positivo', pertinence: 'alta', engagement: 1840, likes: 1420, comments: 142, shares: 84, publishedAt: 'hace 2 h', emotions: ['aprobación', 'alegría'], topic: 'servicios', topicName: 'Servicios digitales', subtopics: ['SURI', 'Marbetes'], municipality: 'Guaynabo', region: 'Metro', coords: [18.3572, -66.1110] },
  { id: 'm5', title: 'Análisis: demoras en permisos de construcción aumentaron 38% en Q1', domain: 'noticel.com', source: 'news', author: 'NotiCel', sentiment: 'negativo', pertinence: 'alta', engagement: 2840, likes: 840, comments: 420, shares: 320, publishedAt: 'hace 3 h', emotions: ['preocupación'], topic: 'permisos', topicName: 'Permisos y licencias', subtopics: ['Construcción', 'Demoras Q1'], municipality: 'San Juan', region: 'Metro', coords: [18.4655, -66.1057] },
  { id: 'm6', title: 'Comunidad en Caguas celebra reapertura del Paseo del Río', domain: 'primerahora.com', source: 'news', author: 'Primera Hora', sentiment: 'positivo', pertinence: 'media', engagement: 1240, likes: 620, comments: 180, shares: 140, publishedAt: 'hace 4 h', emotions: ['alegría', 'aprobación'], topic: 'ambiente', topicName: 'Medio ambiente', subtopics: ['Paseos', 'Reaperturas'], municipality: 'Caguas', region: 'Centro', coords: [18.2342, -66.0356] },
  { id: 'm7', title: '¿Por qué la app de AMA sigue fallando? Pasajeros exigen respuestas', domain: 'youtube.com', source: 'youtube', author: 'PR Noticias', sentiment: 'negativo', pertinence: 'media', engagement: 840, likes: 320, comments: 180, shares: 84, publishedAt: 'hace 6 h', emotions: ['frustración', 'enojo'], topic: 'transporte', topicName: 'Transporte público', subtopics: ['AMA', 'App móvil'], municipality: 'San Juan', region: 'Metro', coords: [18.4655, -66.1057] },
  { id: 'm8', title: 'Nueva licitación para asfaltado de la PR-52 recibe 12 propuestas', domain: 'twitter.com', source: 'twitter', author: '@PRcontratos', sentiment: 'neutral', pertinence: 'alta', engagement: 420, likes: 180, comments: 42, shares: 24, publishedAt: 'hace 8 h', emotions: [], topic: 'infraestructura', topicName: 'Infraestructura vial', subtopics: ['Asfaltado', 'PR-52', 'Licitaciones'], municipality: 'Salinas', region: 'Sur', coords: [17.9769, -66.2971] },
  { id: 'm9', title: 'Alcalde de Bayamón promete resolver drenaje en El Cerezal', domain: 'facebook.com', source: 'facebook', author: 'Municipio Bayamón', sentiment: 'positivo', pertinence: 'media', engagement: 920, likes: 540, comments: 84, shares: 62, publishedAt: 'hace 10 h', emotions: ['esperanza'], topic: 'infraestructura', topicName: 'Infraestructura vial', subtopics: ['Drenaje', 'El Cerezal'], municipality: 'Bayamón', region: 'Metro', coords: [18.3989, -66.1557] },
  { id: 'm10', title: 'Debate en el Senado sobre asignación presupuestaria para DTOP', domain: 'elvocero.com', source: 'news', author: 'El Vocero', sentiment: 'neutral', pertinence: 'alta', engagement: 1480, likes: 420, comments: 240, shares: 180, publishedAt: 'hace 12 h', emotions: [], topic: 'presupuesto', topicName: 'Presupuesto / Finanzas', subtopics: ['DTOP', 'Asignación'], municipality: 'San Juan', region: 'Metro', coords: [18.4655, -66.1057] },
];

const ALERTS = [
  { id: 'a1', name: 'Pico de menciones negativas', active: true, priority: 'alta', triggered: 4, lastFired: 'hace 2 h', channels: ['email', 'slack'] },
  { id: 'a2', name: 'Mención viral (> 5K engagement)', active: true, priority: 'alta', triggered: 2, lastFired: 'hace 12 min', channels: ['email', 'sms'] },
  { id: 'a3', name: 'Crisis risk > 1.5', active: true, priority: 'alta', triggered: 1, lastFired: 'hace 4 h', channels: ['email', 'slack', 'sms'] },
  { id: 'a4', name: 'Mención de medio tier-1', active: true, priority: 'media', triggered: 8, lastFired: 'hace 30 min', channels: ['email'] },
  { id: 'a5', name: 'Anomalía de volumen (z > 2)', active: true, priority: 'media', triggered: 2, lastFired: 'hace 1 d', channels: ['email', 'slack'] },
  { id: 'a6', name: 'NSS cae > 5 puntos en 24h', active: false, priority: 'media', triggered: 0, lastFired: '—', channels: ['email'] },
  { id: 'a7', name: 'Nueva cuenta influencer menciona', active: true, priority: 'baja', triggered: 3, lastFired: 'hace 2 d', channels: ['email'] },
];

const ALERT_FEED = [
  { id: 'h1', rule: 'Mención viral (> 5K engagement)', severity: 'alta', time: 'hace 12 min', detail: 'Mención en elnuevodia.com superó 8,420 interacciones', sentiment: 'negativo' },
  { id: 'h2', rule: 'Mención de medio tier-1', severity: 'media', time: 'hace 30 min', detail: 'NotiCel publicó análisis sobre permisos de construcción', sentiment: 'negativo' },
  { id: 'h3', rule: 'Pico de menciones negativas', severity: 'alta', time: 'hace 2 h', detail: '3.4x volumen base en últimos 60 min', sentiment: 'negativo' },
  { id: 'h4', rule: 'Crisis risk > 1.5', severity: 'alta', time: 'hace 4 h', detail: 'Score llegó a 1.6 en evaluación multi-factor', sentiment: 'negativo' },
  { id: 'h5', rule: 'Mención viral (> 5K engagement)', severity: 'alta', time: 'hace 1 d', detail: 'Post en Facebook con 6,210 reacciones', sentiment: 'positivo' },
  { id: 'h6', rule: 'Anomalía de volumen (z > 2)', severity: 'media', time: 'hace 1 d', detail: 'Volumen 2.3 desv. estándar sobre promedio', sentiment: 'neutral' },
];

// Comparison Brandwatch vs Claude
const COMPARISON = [
  { label: 'Positivo', bw: 4820, claude: 5021 },
  { label: 'Neutral', bw: 5410, claude: 4983 },
  { label: 'Negativo', bw: 2617, claude: 2843 },
];

// Sentiment by source
const SENTIMENT_BY_SOURCE = [
  { source: 'Facebook', positivo: 1842, neutral: 1480, negativo: 798 },
  { source: 'Twitter', positivo: 920, neutral: 1320, negativo: 1044 },
  { source: 'Noticias', positivo: 642, neutral: 1240, negativo: 528 },
  { source: 'Instagram', positivo: 1120, neutral: 420, negativo: 147 },
  { source: 'YouTube', positivo: 284, neutral: 320, negativo: 238 },
  { source: 'Blogs', positivo: 213, neutral: 203, negativo: 88 },
];

// Subtopics for drill-down
const SUBTOPICS = {
  infraestructura: [
    { name: 'Cráteres / baches', count: 1420 },
    { name: 'Iluminación de calles', count: 680 },
    { name: 'Asfaltado', count: 482 },
    { name: 'Puentes', count: 261 },
  ],
  permisos: [
    { name: 'Construcción', count: 842 },
    { name: 'Negocios', count: 621 },
    { name: 'Ambientales', count: 280 },
    { name: 'Marbetes', count: 177 },
  ],
  servicios: [
    { name: 'SURI / CESCO', count: 840 },
    { name: 'Citas en línea', count: 421 },
    { name: 'Portal DTOP', count: 326 },
  ],
};

const _mocks = {
  AGENCIES, PERIODS, TIMELINE, CURRENT_METRICS,
  SENTIMENT_BREAKDOWN, TOP_SOURCES, TOPICS, MUNICIPALITIES,
  EMOTIONS, MENTIONS, ALERTS, ALERT_FEED, COMPARISON,
  SENTIMENT_BY_SOURCE, SUBTOPICS,
};

const _remote = (typeof window !== 'undefined' && window.ECO_DATA_REMOTE) || {};
window.ECO_DATA = Object.assign({}, _mocks, Object.fromEntries(
  Object.entries(_remote).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
));
if (_remote.AGENCIES_FULL) window.ECO_DATA.AGENCIES_FULL = _remote.AGENCIES_FULL;
// USER_AGENCY_SLUG is the agency the JWT binds the user to. Surface it on
// ECO_DATA so the prototype can use it as the default at first boot
// (avoiding the "logged in as ddecpr but landed on aaa" desync).
if (_remote.USER_AGENCY_SLUG) window.ECO_DATA.USER_AGENCY_SLUG = _remote.USER_AGENCY_SLUG;
