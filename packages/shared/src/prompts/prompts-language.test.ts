/**
 * Reglas de lenguaje de los prompts (spec de interpretación v1, secciones 9 y
 * 10.3; WP-5). Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/prompts/prompts-language.test.ts
 *
 * Tres garantías:
 *  1. Con la bandera apagada (reglas `v1`, el default) cada prompt es IDÉNTICO
 *     byte a byte al de origin/main 6e499dc: las huellas sha256 de abajo se
 *     tomaron de ese código antes de tocarlo.
 *  2. Con las reglas `v2` ningún prompt trae los ejemplos figurados que el
 *     modelo copiaba («se apaga la cobertura», «un frente que sigue vivo»…)
 *     ni un verbo vetado fuera de la propia lista de vetados, y todos traen la
 *     ley de verbos literales, reacción tardía y ausencias.
 *  3. Las muestras anotadas (tipo, autor, publicación original con fecha y
 *     días transcurridos) se imprimen; las no anotadas salen como hoy.
 *
 * Si esta prueba falla porque reapareció un ejemplo figurado: no lo agregues
 * a una lista de excepciones; reescribe el ejemplo con un verbo literal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import * as constitution from './constitution';
import * as insights from './weekly-report-insights';
import * as weekly from './weekly-summary';
import * as execSummary from './executive-summary';
import * as execBriefing from './executive-briefing';
import * as emerging from './briefing-emerging';
import * as crisisBriefing from './briefing-crisis';
import * as metricInsight from './metric-insight';
import * as cachedMetric from './metric-insight-cached';
import * as topicDesc from './topic-description';
import * as crisisEditorial from './crisis-editorial';
import * as fullReport from './full-report';

import type { MentionSample, WeeklyAggregates } from './weekly-report-insights';
import type { EditorialRulesVersion } from './constitution';

// ============================================================
// Fixtures (deterministas; cubren todas las ramas de los builders)
// ============================================================

const AGG: WeeklyAggregates = {
  periodStart: '2026-10-26',
  periodEnd: '2026-11-01',
  agencyName: 'Departamento de Prueba',
  agencyShortName: 'DP',
  totals: { negative: 40, neutral: 120, positive: 60, total: 220 },
  deltaVsPrevWeek: { negative: 12.4, neutral: -8, positive: 30 },
  dailySeries: [
    { date: '2026-10-26', negative: 5, neutral: 20, positive: 9 },
    { date: '2026-10-27', negative: 7, neutral: 18, positive: 10 },
    { date: '2026-10-28', negative: 4, neutral: 15, positive: 8 },
    { date: '2026-10-29', negative: 9, neutral: 22, positive: 11 },
    { date: '2026-10-30', negative: 6, neutral: 17, positive: 7 },
    { date: '2026-10-31', negative: 5, neutral: 14, positive: 8 },
    { date: '2026-11-01', negative: 4, neutral: 14, positive: 7 },
  ],
  byTopic: [
    { topic: 'Incentivos', subtopics: ['Decretos', 'Ley 60'], total: 80, negative: 10, neutral: 50, positive: 20 },
    { topic: 'Gestión del Secretario', subtopics: [], total: 60, negative: 20, neutral: 30, positive: 10 },
    { topic: 'Comercio Exterior', subtopics: ['Ferias'], total: 30, negative: 2, neutral: 20, positive: 8 },
  ],
  byMunicipality: [
    { municipality: 'San Juan', total: 40, negative: 10 },
    { municipality: 'Ponce', total: 12, negative: 3 },
  ],
  topAuthors: [
    { author: 'El Nuevo Día', mentions: 14, sentiment: 'neutral' },
    { author: 'Página de la agencia', mentions: 9, sentiment: 'positive' },
  ],
  topSources: [
    { source: 'Facebook', mentions: 90 },
    { source: 'El Nuevo Día', mentions: 14 },
  ],
  topEmotions: [
    { emotion: 'confianza', count: 30 },
    { emotion: 'frustración', count: 12 },
  ],
};

/** Muestra NO anotada: la forma que mandan los lambdas hoy. */
const PLAIN: MentionSample = {
  id: 'm1',
  createdAt: '2026-11-01T14:52:24.000Z',
  text: 'Feria de empleo en Ponce — La agencia anunció 300 plazas para el sábado',
  sentiment: 'neutral',
  topic: 'Incentivos',
  subtopic: 'Decretos',
  municipality: 'Ponce',
  author: 'El Nuevo Día',
  source: 'El Nuevo Día',
  url: 'https://example.com/nota',
  engagement: 12,
  pageType: 'news',
  pertinence: 'alta',
  emotions: ['confianza'],
};

const PLAIN_NEG: MentionSample = {
  id: 'm2',
  createdAt: '2026-10-31T21:10:00.000Z',
  text: 'Vecinos dicen que el programa no ha llegado a su barrio',
  sentiment: 'negative',
  topic: 'Gestión del Secretario',
  source: 'Facebook',
  pageType: 'facebook',
  engagement: 0,
};

const PLAIN_POS: MentionSample = {
  id: 'm3',
  createdAt: '2026-10-30T12:00:00.000Z',
  text: 'Felicitaciones a la agencia por la feria',
  sentiment: 'positive',
  source: 'Instagram',
};

const SAMPLES = { negative: [PLAIN_NEG], neutral: [PLAIN], positive: [PLAIN_POS] };

function legacyInputs() {
  const weeklyInputs: Parameters<typeof weekly.buildWeeklySummaryPrompt>[0] = {
    current: AGG,
    prevTotals: { negative: 30, neutral: 130, positive: 40, total: 200 },
    prevByTopic: [
      { topic: 'Incentivos', total: 60, negative: 8 },
      { topic: 'Permisos', total: 25, negative: 9 },
    ],
    indicatorLines: [{ label: 'Riesgo de crisis', cur: '36%', prev: '42%' }],
    samples: SAMPLES,
    weekLabel: '26 oct – 1 nov 2026',
    prevWeekLabel: '19 – 25 oct 2026',
  };
  const execAgg: Parameters<typeof execSummary.buildExecutiveSummaryPrompt>[0] = {
    agencyName: 'Departamento de Prueba',
    agencyShortName: 'DP',
    periodLabel: '26 oct – 1 nov 2026',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-01',
    periodDays: 7,
    totals: { total: 220, negative: 40, neutral: 120, positive: 60 },
    prevTotals: { total: 200, negative: 30, neutral: 130, positive: 40 },
    nss: 9.1,
    crisisRiskScore: 0.21,
    totalReach: 125000,
    topics: [{ name: 'Incentivos', total: 80, negative: 10, neutral: 50, positive: 20, deltaPct: 33, subtopics: 'Decretos · Ley 60' }],
    topMunicipalities: [{ name: 'San Juan', count: 40 }],
    topAuthors: [{ name: 'El Nuevo Día', mentions: 14, reach: 50000 }],
    samples: [{ text: 'La agencia anunció 300 plazas', sentiment: 'neutral', topic: 'Incentivos', author: 'El Nuevo Día', source: 'El Nuevo Día', engagement: 12 }],
  };
  const briefingAgg: Parameters<typeof execBriefing.buildExecutiveBriefingPrompt>[0] = {
    agencyName: 'Departamento de Prueba',
    agencyShortName: 'DP',
    periodHours: 24,
    generatedAtLabel: 'lun 2 de noviembre, 6:00 a.m. AST',
    baseline7d: { windowDays: 7, avgDailyVolume: 30, avgNss: 5 },
    baseline30d: { windowDays: 30, avgDailyVolume: 28, avgNss: 4 },
    totals: { total: 25, positive: 7, neutral: 14, negative: 4 },
    prevTotals: { total: 30, positive: 8, neutral: 14, negative: 8 },
    nss: 12,
    nssDelta: 4,
    totalReach: 40000,
    byTopic: [{ topic: 'Incentivos', total: 10, positive: 3, neutral: 6, negative: 1 }],
    byMunicipality: [{ municipality: 'Ponce', total: 4, negative: 1 }],
    topMentions: [{ text: 'La agencia anunció 300 plazas', sentiment: 'neutral', topic: 'Incentivos', municipality: 'Ponce', source: 'El Nuevo Día', engagement: 12 }],
  };
  const emergingAgg: Parameters<typeof emerging.buildEmergingBriefingPrompt>[0] = {
    agencyName: 'Departamento de Prueba',
    agencyShortName: 'DP',
    periodHours: 24,
    generatedAtLabel: 'lun 2 de noviembre, 6:00 a.m. AST',
    emergingTopics: [{ topic: 'Comercio Exterior', total: 12, positive: 4, neutral: 7, negative: 1, deltaPct: 50 }],
    totals: { total: 25, positive: 7, neutral: 14, negative: 4 },
    totalReach: 40000,
    baseline7d: { windowDays: 7, avgDailyVolume: 30, avgNss: 5 },
  };
  const crisisAgg: Parameters<typeof crisisBriefing.buildCrisisBriefingPrompt>[0] = {
    agencyName: 'Departamento de Prueba',
    agencyShortName: 'DP',
    periodHours: 24,
    generatedAtLabel: 'lun 2 de noviembre, 6:00 a.m. AST',
    crisisRiskScore: 0.31,
    crisisSeverity: 0.4,
    crisisVelocity: 0.2,
    volumeAnomalyZscore: 1.3,
    totals: { total: 25, positive: 7, neutral: 14, negative: 4 },
    negativeShare: 0.16,
    topNegativeTopics: [{ topic: 'Gestión del Secretario', total: 8, negative: 3, negativeShare: 0.375 }],
    topNegativeMunicipalities: [{ municipality: 'San Juan', total: 6, negative: 2 }],
    totalReach: 40000,
  };
  const metricInput: Parameters<typeof metricInsight.buildMetricInsightPrompt>[0] = {
    metric: 'crisis',
    metricLabel: 'Riesgo de crisis',
    currentValue: 36,
    band: 'ELEVADO',
    windowDays: 7,
    deltaVsPrev: -6,
    historicalP25: 20,
    historicalP75: 40,
    topContributingTopics: [{ name: 'Gestión del Secretario', share: 0.4 }],
    topMunicipality: { name: 'San Juan', share: 0.3 },
  };
  const cachedInput: Parameters<typeof cachedMetric.buildCachedMetricInsightPrompt>[0] = {
    metric: 'crisis',
    agencyName: 'Departamento de Prueba',
    agencyShortName: 'DP',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-01',
    value: 0.36,
    subcomponents: { severity: 0.4, velocity: 0.1, confidence: 0.9 },
    topTopics: [{ topic: 'Gestión del Secretario', total: 60, negative: 20, positive: 10 }],
    topAuthors: [{ author: 'El Nuevo Día', mentions: 14 }],
    topMunicipalities: [{ municipality: 'San Juan', total: 40, negative: 10 }],
    totalMentions: 220,
    totalMentionsDelta: 10,
  };
  const topicAgg: Parameters<typeof topicDesc.buildTopicDescriptionPrompt>[0] = {
    agencyName: 'Departamento de Prueba',
    topicName: 'Incentivos',
    topicSlug: 'incentivos',
    periodDays: 7,
    totalMentions: 80,
    positive: 20,
    neutral: 50,
    negative: 10,
    topSubtopics: [{ name: 'Decretos', count: 30 }],
    topMunicipalities: [{ name: 'San Juan', count: 30 }],
  };
  const topicSamples: Parameters<typeof topicDesc.buildTopicDescriptionPrompt>[1] = [
    { text: 'La agencia anunció 300 plazas', sentiment: 'neutral', subtopic: 'Decretos', source: 'El Nuevo Día', author: 'El Nuevo Día' },
  ];
  const editorialInput: Parameters<typeof crisisEditorial.buildCrisisEditorialPrompt>[0] = {
    agencyName: 'Departamento de Prueba',
    agencyShortName: 'DP',
    generatedAtLabel: 'lun 2 de noviembre, 6:00 a.m. AST',
    triggerDay: '2026-11-02',
    band: 'ALERTA',
    crisisRiskScore: 0.45,
    crisisRiskScore24hAgo: 0.3,
    crisisSeverity: 0.5,
    volumeVsAvg7Pct: 80,
    volumeAnomalyZscore: 2.1,
    totalMentions: 60,
    negativeCount: 25,
    negativeShare: 0.42,
    prevDayTotal: 30,
    prevDayNegative: 8,
    topNegativeTopics: [{ topic: 'Gestión del Secretario', total: 30, negative: 15, negativeShare: 0.5 }],
    topNegativeMunicipalities: [{ municipality: 'San Juan', total: 20, negative: 9 }],
    sampleMentions: [PLAIN_NEG, PLAIN],
  };
  const peaks = [{ date: '2026-10-29', total: 42, negative: 9, samples: [PLAIN, PLAIN_NEG] }];
  const hero = [{ day: '2026-10-29', source: 'El Nuevo Día', title: 'Feria de empleo en Ponce' }];
  return { weeklyInputs, execAgg, briefingAgg, emergingAgg, crisisAgg, metricInput, cachedInput, topicAgg, topicSamples, editorialInput, peaks, hero };
}

/**
 * Todo lo que el modelo recibe. Sin `rules` usa la API que existía en 6e499dc
 * (constantes y builders sin opciones): de ahí salieron las huellas de
 * LEGACY_HASHES, corrido sobre el código sin tocar. Con `rules` usa los
 * getters y la opción nueva.
 */
function promptOutputs(rules?: EditorialRulesVersion, samplesOverride?: MentionSample[]): Record<string, string> {
  const f = legacyInputs();
  const o = rules ? { rules } : undefined;
  const today = samplesOverride ?? [PLAIN, PLAIN_NEG, PLAIN_POS];
  const samples = samplesOverride
    ? { negative: samplesOverride.filter((m) => m.sentiment === 'negative'), neutral: samplesOverride.filter((m) => m.sentiment === 'neutral'), positive: samplesOverride.filter((m) => m.sentiment === 'positive') }
    : SAMPLES;
  const peaks = samplesOverride ? [{ ...f.peaks[0], samples: samplesOverride }] : f.peaks;
  const weeklyInputs = { ...f.weeklyInputs, samples };
  const sys = (constant: string, getter: (r?: EditorialRulesVersion | null) => string) => (rules ? getter(rules) : constant);
  return {
    'constitution.ECO_EDITORIAL_CONSTITUTION': rules ? constitution.getEditorialConstitution(rules) : constitution.ECO_EDITORIAL_CONSTITUTION,
    'constitution.buildSystemPrompt': constitution.buildSystemPrompt('ROL', 'ADENDA', rules),
    'insights.INSIGHTS_SYSTEM_PROMPT': sys(insights.INSIGHTS_SYSTEM_PROMPT, insights.buildInsightsSystemPrompt),
    'insights.buildSentimentInsightsPrompt': insights.buildSentimentInsightsPrompt(AGG, samples, o),
    'insights.buildDailySummaryPrompt': insights.buildDailySummaryPrompt(AGG, today, '2026-11-01', o),
    'insights.buildDailySummaryPrompt.empty': insights.buildDailySummaryPrompt(AGG, [], '2026-10-26', o),
    'insights.buildPeriodSummaryPrompt': insights.buildPeriodSummaryPrompt(AGG, samples, peaks, f.hero, o),
    'insights.buildPeriodSummaryPrompt.bare': insights.buildPeriodSummaryPrompt(AGG, samples, undefined, undefined, o),
    'weekly.buildWeeklySummaryPrompt': weekly.buildWeeklySummaryPrompt(weeklyInputs, o),
    'execSummary.EXECUTIVE_SUMMARY_SYSTEM_PROMPT': sys(execSummary.EXECUTIVE_SUMMARY_SYSTEM_PROMPT, execSummary.buildExecutiveSummarySystemPrompt),
    'execSummary.EXECUTIVE_SUMMARY_TOOL_SCHEMA': JSON.stringify(rules ? execSummary.buildExecutiveSummaryToolSchema(rules) : execSummary.EXECUTIVE_SUMMARY_TOOL_SCHEMA),
    'execSummary.buildExecutiveSummaryPrompt': execSummary.buildExecutiveSummaryPrompt(f.execAgg, o),
    'execBriefing.EXECUTIVE_BRIEFING_SYSTEM_PROMPT': sys(execBriefing.EXECUTIVE_BRIEFING_SYSTEM_PROMPT, execBriefing.buildExecutiveBriefingSystemPrompt),
    'execBriefing.buildExecutiveBriefingPrompt': execBriefing.buildExecutiveBriefingPrompt(f.briefingAgg),
    'emerging.EMERGING_BRIEFING_SYSTEM_PROMPT': sys(emerging.EMERGING_BRIEFING_SYSTEM_PROMPT, emerging.buildEmergingBriefingSystemPrompt),
    'emerging.buildEmergingBriefingPrompt': emerging.buildEmergingBriefingPrompt(f.emergingAgg),
    'crisisBriefing.CRISIS_BRIEFING_SYSTEM_PROMPT': sys(crisisBriefing.CRISIS_BRIEFING_SYSTEM_PROMPT, crisisBriefing.buildCrisisBriefingSystemPrompt),
    'crisisBriefing.buildCrisisBriefingPrompt': crisisBriefing.buildCrisisBriefingPrompt(f.crisisAgg),
    'metricInsight.METRIC_INSIGHT_SYSTEM_PROMPT': sys(metricInsight.METRIC_INSIGHT_SYSTEM_PROMPT, metricInsight.buildMetricInsightSystemPrompt),
    'metricInsight.buildMetricInsightPrompt': metricInsight.buildMetricInsightPrompt(f.metricInput, o),
    'cachedMetric.CACHED_METRIC_INSIGHT_SYSTEM_PROMPT': sys(cachedMetric.CACHED_METRIC_INSIGHT_SYSTEM_PROMPT, cachedMetric.buildCachedMetricInsightSystemPrompt),
    'cachedMetric.buildCachedMetricInsightPrompt': cachedMetric.buildCachedMetricInsightPrompt(f.cachedInput, o),
    'topicDesc.TOPIC_DESCRIPTION_SYSTEM_PROMPT': sys(topicDesc.TOPIC_DESCRIPTION_SYSTEM_PROMPT, topicDesc.buildTopicDescriptionSystemPrompt),
    'topicDesc.buildTopicDescriptionPrompt': topicDesc.buildTopicDescriptionPrompt(f.topicAgg, f.topicSamples, o),
    'crisisEditorial.CRISIS_EDITORIAL_SYSTEM_PROMPT': sys(crisisEditorial.CRISIS_EDITORIAL_SYSTEM_PROMPT, crisisEditorial.buildCrisisEditorialSystemPrompt),
    'crisisEditorial.buildCrisisEditorialPrompt': crisisEditorial.buildCrisisEditorialPrompt(f.editorialInput, o),
    'fullReport.REPORT_SYSTEM_PROMPT': rules ? '' : fullReport.REPORT_SYSTEM_PROMPT,
  };
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

if (process.env.PRINT_PROMPT_HASHES) {
  const out = promptOutputs();
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sha(v)])), null, 2));
}

/** Huellas de origin/main 6e499dc (antes de WP-5) con los fixtures de arriba. */
const LEGACY_HASHES: Record<string, string> = {
  'constitution.ECO_EDITORIAL_CONSTITUTION': 'c2f904e4e6aab5d9',
  'constitution.buildSystemPrompt': '7dcd3b2b6fe8568f',
  'insights.INSIGHTS_SYSTEM_PROMPT': 'ca869f5503fc0b56',
  'insights.buildSentimentInsightsPrompt': 'a67065da06d2e8df',
  'insights.buildDailySummaryPrompt': '5e4de03d0488b7bf',
  'insights.buildDailySummaryPrompt.empty': 'a2da2b932cf54a94',
  'insights.buildPeriodSummaryPrompt': 'dd2d12a19339d50a',
  'insights.buildPeriodSummaryPrompt.bare': 'e5912f8c2f8bcc5b',
  'weekly.buildWeeklySummaryPrompt': '04bcf80e9e9b6a82',
  'execSummary.EXECUTIVE_SUMMARY_SYSTEM_PROMPT': '6a93160401b84253',
  'execSummary.EXECUTIVE_SUMMARY_TOOL_SCHEMA': 'ac0fd53123aa3c8f',
  'execSummary.buildExecutiveSummaryPrompt': '60bc08df93a3af30',
  'execBriefing.EXECUTIVE_BRIEFING_SYSTEM_PROMPT': '4f4ec30c578cc56e',
  'execBriefing.buildExecutiveBriefingPrompt': '53a8b67618172f04',
  'emerging.EMERGING_BRIEFING_SYSTEM_PROMPT': '85255d2ec7b41d0e',
  'emerging.buildEmergingBriefingPrompt': 'e5c307d460dd9c46',
  'crisisBriefing.CRISIS_BRIEFING_SYSTEM_PROMPT': '027c127ced7cfdea',
  'crisisBriefing.buildCrisisBriefingPrompt': 'df1a573c56ddaedc',
  'metricInsight.METRIC_INSIGHT_SYSTEM_PROMPT': 'ad285129af6e456c',
  'metricInsight.buildMetricInsightPrompt': 'a4faee79c7b4ec75',
  'cachedMetric.CACHED_METRIC_INSIGHT_SYSTEM_PROMPT': '29a33ff63f9b46d8',
  'cachedMetric.buildCachedMetricInsightPrompt': 'b120a72825fe590b',
  'topicDesc.TOPIC_DESCRIPTION_SYSTEM_PROMPT': 'd765e73293d719c5',
  'topicDesc.buildTopicDescriptionPrompt': 'f1a35d9516a6d704',
  'crisisEditorial.CRISIS_EDITORIAL_SYSTEM_PROMPT': '6d0c9695807e07b3',
  'crisisEditorial.buildCrisisEditorialPrompt': '09cd5908efd6c71e',
  'fullReport.REPORT_SYSTEM_PROMPT': 'f5a2c07d40e86184',
};

// ============================================================
// Copias LOCALES de las listas (no se importan a propósito: si alguien borra
// un término de la constitución, esta prueba lo nota). WP-3 tiene la suya en
// composer/; el orquestador las unifica al integrar.
// ============================================================

/** Spec de interpretación v1, Anexo C (lista de vetados v1). */
const VETOED_ANEXO_C = [
  'aprieta', 'aprietan', 'apretó', 'acorrala', 'acorralan', 'se deslinda', 'se deslindan',
  'traslada la carga', 'se apaga', 'se apagó', 'sobrevive', 'sobreviven', 'flanco', 'dispara',
  'disparan', 'arremete', 'arremetió', 'copó', 'tira y jala', 'bajo fuego', 'bajo la lupa',
  'contra el reloj', 'arrastra', 'se agudiza', 'estalla', 'sacude', 'sacudió', 'zozobra',
  'otro frente', 'nuevo frente', 'segundo frente',
];

/** Spec 9.1: verbos literales. */
const LITERAL_VERBS_SPEC = [
  'dijo', 'afirmó', 'pidió', 'exigió', 'solicitó', 'reclamó', 'informó', 'anunció', 'publicó',
  'respondió', 'entregó', 'advirtió', 'aprobó', 'citó', 'presentó', 'explicó', 'preguntó',
  'felicitó', 'criticó',
];

/**
 * Los ejemplos y giros figurados que traían los prompts (constitución, diario,
 * periodo/Overview, semanal, Scorecard/KPI, editorial de crisis). El modelo los
 * copiaba: «Se apaga la cobertura…» salió como titular real. No deben volver.
 */
const FIGURATIVE_EXAMPLES = [
  'se apaga la cobertura',
  'cuando se apaga la cobertura',
  'lo que sobrevive es la crítica',
  'un frente que sigue vivo',
  'frente que sigue vivo',
  'viene de antes y no se apaga',
  'se prendió un día y se apagó',
  'se monta sobre la crisis',
  'se montó sobre la crisis',
  'domina la conversación del ddec',
  'se enfría la crisis',
  'se disparó o se apagó',
  'qué discusión se apagó',
  'lo que la agencia arrastra',
  'el frente negativo',
  'se está apagando',
  'se está inflando o desinflando',
  'es cola de uno anterior',
  'evento(s)-disparador',
  'empujando la conversación',
  'empuja la conversación',
  'empujó la conversación',
  'empujando el valor',
  'se dispararon',
  'disparó el volumen',
  'presión de la legislatura',
  'es un titular de prensa',
  'el día más flojo',
];

/** Busca un término como palabra completa, sin distinguir mayúsculas. */
function findTerm(text: string, term: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Quita la propia lista de vetados (la ley 08 los nombra para prohibirlos). */
function withoutVetoedList(text: string): string {
  return text.split(constitution.CONSTITUTION_VETOED_TERMS.join(', ')).join(' ');
}

// ============================================================
// Anotaciones de muestras
// ============================================================

/** Comentario del domingo 1-nov a una publicación de la agencia del lunes 26-oct (6 días). */
const LATE_COMMENT: MentionSample = {
  id: 'c1',
  createdAt: '2026-11-01T14:52:24.000Z',
  text: 'Aprendí algo nuevo',
  sentiment: 'positive',
  topic: 'Incentivos',
  source: 'Facebook',
  kind: 'comment',
  parent: {
    text: 'En el Mes de la Manufactura destacamos a los negocios que producen desde Puerto Rico',
    publishedAt: '2026-10-26T16:00:00.000Z',
    author: 'Departamento de Prueba',
    isAgency: true,
  },
  moreInThread: 15,
};
const AGENCY_POST: MentionSample = {
  id: 'p1', createdAt: '2026-11-01T13:00:00.000Z', text: 'Finalizamos octubre con una semana de talleres',
  sentiment: 'neutral', source: 'Instagram', kind: 'agency_post', author: 'desarrollopr',
};
const THIRD_PARTY: MentionSample = {
  id: 't1', createdAt: '2026-11-01T15:00:00.000Z', text: 'El informe anual de negocios exentos vence el 15 de noviembre',
  sentiment: 'neutral', source: 'Instagram', kind: 'third_party_post', author: 'Contables PR',
};
const ARTICLE: MentionSample = {
  id: 'a1', createdAt: '2026-11-01T11:00:00.000Z', text: 'La UPR celebrará el simposio de comercio internacional',
  sentiment: 'neutral', source: 'Online News', kind: 'article',
};
const SAME_DAY_COMMENT: MentionSample = {
  id: 'c2', createdAt: '2026-11-01T23:30:00.000Z', text: 'Excelente iniciativa',
  sentiment: 'positive', source: 'Facebook', kind: 'comment',
  parent: { text: 'Hoy abrimos la convocatoria', publishedAt: '2026-11-01T12:00:00.000Z', author: 'Departamento de Prueba', isAgency: true },
};
const ANNOTATED = [LATE_COMMENT, AGENCY_POST, THIRD_PARTY, ARTICLE, SAME_DAY_COMMENT, PLAIN_NEG];

// ============================================================
// Pruebas
// ============================================================

test('bandera apagada: con reglas v1 cada prompt es idéntico al de antes de WP-5', () => {
  const out = promptOutputs('v1');
  for (const [k, v] of Object.entries(out)) {
    if (k === 'fullReport.REPORT_SYSTEM_PROMPT') continue;
    assert.equal(sha(v), LEGACY_HASHES[k], `cambió el prompt v1 de ${k}`);
  }
});

test('bandera apagada: sin ECO_EDITORIAL_RULES las constantes y los builders sin opciones son los de antes', (t) => {
  if (process.env.ECO_EDITORIAL_RULES) {
    t.skip('ECO_EDITORIAL_RULES está definida en este proceso');
    return;
  }
  assert.equal(constitution.resolveEditorialRules(), 'v1');
  const out = promptOutputs();
  for (const [k, v] of Object.entries(out)) assert.equal(sha(v), LEGACY_HASHES[k], `cambió el default de ${k}`);
});

test('resolveEditorialRules: la opción explícita manda; si no, la variable de entorno; si no, v1', () => {
  const prev = process.env.ECO_EDITORIAL_RULES;
  try {
    delete process.env.ECO_EDITORIAL_RULES;
    assert.equal(constitution.resolveEditorialRules(), 'v1');
    assert.equal(constitution.resolveEditorialRules('v2'), 'v2');
    process.env.ECO_EDITORIAL_RULES = 'v2';
    assert.equal(constitution.resolveEditorialRules(), 'v2');
    assert.equal(constitution.resolveEditorialRules('v1'), 'v1');
    process.env.ECO_EDITORIAL_RULES = 'otra';
    assert.equal(constitution.resolveEditorialRules(), 'v1');
  } finally {
    if (prev === undefined) delete process.env.ECO_EDITORIAL_RULES;
    else process.env.ECO_EDITORIAL_RULES = prev;
  }
});

test('v2: la constitución trae la ley de verbos literales, vetados, reacción tardía y ausencias', () => {
  const c = constitution.ECO_EDITORIAL_CONSTITUTION_V2;
  assert.match(c, /08\. VERBOS LITERALES/);
  for (const v of LITERAL_VERBS_SPEC) assert.ok(findTerm(c, v), `falta el verbo literal «${v}»`);
  for (const v of VETOED_ANEXO_C) assert.ok(c.toLowerCase().includes(v), `la ley 08 no veta «${v}»`);
  assert.match(c, /queda en manos de/);
  assert.match(c, /REACCIÓN TARDÍA/);
  assert.match(c, /más de 2 días/);
  assert.match(c, /10\. AUSENCIAS/);
  assert.match(c, /"no hubo cobertura"/i);
  assert.match(c, /"algunos"\s*\(2 o más\)/);
  assert.match(c, /"varios"\s*\(3 o más\)/);
  assert.match(c, /"muchos"\s*\(8 o más\)/);
});

test('la lista exportada de vetados contiene toda la del Anexo C y los verbos literales son los del spec', () => {
  const exported = constitution.CONSTITUTION_VETOED_TERMS.map((t) => t.toLowerCase());
  for (const v of VETOED_ANEXO_C) assert.ok(exported.includes(v), `CONSTITUTION_VETOED_TERMS perdió «${v}»`);
  assert.deepEqual([...constitution.CONSTITUTION_LITERAL_VERBS], LITERAL_VERBS_SPEC);
});

for (const [label, samples] of [['muestras sin anotar', undefined], ['muestras anotadas', ANNOTATED]] as const) {
  test(`v2 (${label}): ningún prompt trae ejemplos figurados ni verbos vetados fuera de la lista`, () => {
    const out = promptOutputs('v2', samples as MentionSample[] | undefined);
    for (const [k, raw] of Object.entries(out)) {
      if (!raw) continue;
      const text = withoutVetoedList(raw);
      for (const ex of FIGURATIVE_EXAMPLES) {
        assert.ok(!text.toLowerCase().includes(ex), `${k} (v2) trae el ejemplo figurado «${ex}»`);
      }
      for (const v of VETOED_ANEXO_C) {
        assert.ok(!findTerm(text, v), `${k} (v2) usa el vetado «${v}» fuera de la lista de vetados`);
      }
    }
  });
}

test('v2: todos los system prompts llevan la constitución nueva y difieren de v1', () => {
  const v1 = promptOutputs('v1');
  const v2 = promptOutputs('v2');
  const systemKeys = Object.keys(v2).filter((k) => k.endsWith('_SYSTEM_PROMPT') && k !== 'fullReport.REPORT_SYSTEM_PROMPT');
  assert.ok(systemKeys.length >= 9);
  for (const k of systemKeys) {
    assert.ok(v2[k].includes(constitution.ECO_EDITORIAL_CONSTITUTION_V2), `${k} no trae la constitución v2`);
    assert.notEqual(v2[k], v1[k]);
  }
});

test('v2: los titulares del diario, del periodo y del semanal piden verbo literal y prohíben intención', () => {
  const out = promptOutputs('v2');
  for (const k of ['insights.buildDailySummaryPrompt', 'insights.buildPeriodSummaryPrompt', 'weekly.buildWeeklySummaryPrompt']) {
    assert.match(out[k], /verbo literal/, k);
    assert.match(out[k], /figuras ni intenciones/, k);
    assert.ok(!/titular de prensa/i.test(out[k]), `${k} todavía pide «titular de prensa»`);
  }
  assert.match(out['insights.buildDailySummaryPrompt'], /reacción tardía/);
  assert.match(out['insights.buildDailySummaryPrompt'], /100 caracteres/);
});

test('las muestras sin anotar se imprimen como antes (sin etiqueta ni leyenda)', () => {
  const v1 = promptOutputs('v1');
  assert.ok(!v1['insights.buildDailySummaryPrompt'].includes('CÓMO LEER CADA MENCIÓN'));
  assert.equal(insights.formatMentionSampleTag(PLAIN), '');
  assert.equal(insights.mentionSamplesLegend([PLAIN, PLAIN_NEG]), '');
});

test('comentario a una publicación de más de 2 días: publicación original, fecha, días y REACCIÓN TARDÍA', () => {
  const tag = insights.formatMentionSampleTag(LATE_COMMENT);
  assert.match(tag, /^\[COMENTARIO de un usuario en Facebook a una publicación de la propia agencia \(Departamento de Prueba\)/);
  assert.match(tag, /publicación original del lunes 26 oct 2026/);
  assert.match(tag, /pasaron 6 días: REACCIÓN TARDÍA/);
  assert.match(tag, /\[\+15 comentarios más a esta misma publicación ese día\]/);
  assert.equal(
    insights.formatMentionSampleBody(LATE_COMMENT),
    'PUBLICACIÓN ORIGINAL: "En el Mes de la Manufactura destacamos a los negocios que producen desde Puerto Rico" || COMENTARIO: "Aprendí algo nuevo"',
  );
  const daily = insights.buildDailySummaryPrompt(AGG, ANNOTATED, '2026-11-01', { rules: 'v2' });
  assert.match(daily, /CÓMO LEER CADA MENCIÓN/);
  assert.match(daily, /1\. \[COMENTARIO de un usuario en Facebook/);
  // La leyenda también sale con v1 si el caller anota las muestras (la anotación es dato, no regla).
  assert.match(insights.buildDailySummaryPrompt(AGG, ANNOTATED, '2026-11-01', { rules: 'v1' }), /CÓMO LEER CADA MENCIÓN/);
});

test('comentario del mismo día no es reacción tardía; los demás tipos llevan su etiqueta', () => {
  const same = insights.formatMentionSampleTag(SAME_DAY_COMMENT);
  assert.match(same, /del mismo día/);
  assert.ok(!same.includes('REACCIÓN TARDÍA'));
  assert.equal(insights.formatMentionSampleTag(AGENCY_POST), '[PUBLICACIÓN DE LA AGENCIA en Instagram]');
  assert.equal(insights.formatMentionSampleTag(THIRD_PARTY), '[PUBLICACIÓN DE UN TERCERO: Contables PR en Instagram]');
  assert.equal(insights.formatMentionSampleTag(ARTICLE), '[NOTA DE PRENSA O BLOG: Online News]');
  // 2 días exactos todavía no es tardía; 3 sí (spec: «más de 2 días»).
  const two = { ...LATE_COMMENT, moreInThread: null, parent: { ...LATE_COMMENT.parent, publishedAt: '2026-10-30T16:00:00.000Z' } };
  const three = { ...two, parent: { ...two.parent, publishedAt: '2026-10-29T16:00:00.000Z' } };
  assert.match(insights.formatMentionSampleTag(two), /pasaron 2 días\]$/);
  assert.match(insights.formatMentionSampleTag(three), /pasaron 3 días: REACCIÓN TARDÍA/);
});

test('días entre publicación y comentario se cuentan en calendario de Puerto Rico', () => {
  // 11:30 p.m. AST del sábado 31 = 03:30Z del domingo 1: sigue siendo sábado en PR.
  assert.equal(insights.daysBetweenInstantsPr('2026-10-26T16:00:00Z', '2026-11-01T03:30:00Z'), 5);
  assert.equal(insights.daysBetweenInstantsPr('2026-10-26T16:00:00Z', '2026-11-01T14:00:00Z'), 6);
  assert.equal(insights.daysBetweenInstantsPr('no-es-fecha', '2026-11-01T14:00:00Z'), null);
});

test('el semanal y el editorial de crisis también imprimen las anotaciones', () => {
  const f = legacyInputs();
  const w = weekly.buildWeeklySummaryPrompt({ ...f.weeklyInputs, samples: { negative: [], neutral: [AGENCY_POST], positive: [LATE_COMMENT] } }, { rules: 'v2' });
  assert.match(w, /CÓMO LEER CADA MENCIÓN/);
  assert.match(w, /REACCIÓN TARDÍA/);
  const e = crisisEditorial.buildCrisisEditorialPrompt({ ...f.editorialInput, sampleMentions: [LATE_COMMENT, PLAIN_NEG] }, { rules: 'v2' });
  assert.match(e, /CÓMO LEER CADA MENCIÓN/);
  assert.match(e, /1\. \[COMENTARIO de un usuario/);
  assert.match(e, /2\. \(sábado 31 oct 2026\) \[medio=Facebook\]/);
});
