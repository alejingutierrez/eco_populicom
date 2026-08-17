/**
 * Prompts para insight explicativo CACHEADO de una métrica sintética (Crisis,
 * Polarización, NSS, BHI, Volume). Usado por el lambda `eco-ai-tasks` acción
 * `metric-insight` para generar y persistir en `metric_insights_cache`. La UI
 * (Overview Crisis card click) consume el cache vía /api/eco-metric-insight.
 *
 * Diferencia vs el insight on-demand de Scorecard (metric-insight.ts): este es
 * un párrafo MÁS LARGO (3-5 oraciones) con énfasis en nombres propios + cifras
 * (preferido para drill-down detallado). El on-demand de Scorecard es más corto
 * (2-3 oraciones, ~60 palabras) para mostrar en el modal KPI.
 *
 * Mismos guardrails descriptivos: prohibido fórmula, recomendaciones, juicios.
 */

import type { MetricKey } from './metric-insight';
import { formatMetric, type DisplayMetricKey } from '../format/metrics-display';
import { HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

export interface MetricSnapshotSubcomponents {
  // Para crisis: severity, velocity, relevance, confidence
  // Para BHI: nssNormalized, engagementRate, reach, pertinenceRatio
  // Para NSS: positiveCount, neutralCount, negativeCount
  // Para Polarization: opinionShare, neutralShare (apatía vs polarización)
  // Para Volume: total, deltaVsPrev%
  [label: string]: number | null;
}

export interface CachedMetricInsightInput {
  metric: MetricKey;
  agencyName: string;
  agencyShortName: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  /** Valor principal de la métrica (NSS:+12.4 / Crisis:0.42 / BHI:0.62 / etc.). */
  value: number | null;
  /** Subcomponentes desglosados del snapshot. Solo numéricos para el prompt. */
  subcomponents: MetricSnapshotSubcomponents;
  /** Top 5 tópicos del periodo con neg/total para identificar drivers. */
  topTopics: Array<{ topic: string; total: number; negative: number; positive: number }>;
  /** Top 3 autores destacados (volumen). */
  topAuthors: Array<{ author: string; mentions: number }>;
  /** Top 5 municipios con mayor concentración negativa. */
  topMunicipalities: Array<{ municipality: string; total: number; negative: number }>;
  /** Total de menciones del periodo + variación vs ventana previa. */
  totalMentions: number;
  totalMentionsDelta: number; // porcentaje
}

export const CACHED_METRIC_INSIGHT_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO explicando POR QUÉ una métrica sintética (riesgo de crisis, polarización, sentimiento neto, salud de marca o volumen) está donde está para una agencia pública en un periodo dado.`,
  `
- Abre por el HECHO que produce el valor, no por la métrica. La métrica es la
  consecuencia.
- Nunca expliques la fórmula ni sus componentes. El lector quiere el porqué del
  mundo real, no el del cálculo.
- Di si el valor es alto o bajo PARA ESTA AGENCIA, comparándolo con su propio
  rango histórico. Un porcentaje suelto no informa a nadie.
- Usa el valor EXACTAMENTE como viene en el contexto (la palabra y el número de
  la tarjeta). NUNCA la escala interna 0–1: escribir "0.40" en vez de "40%"
  mezcla escalas con lo que el usuario tiene en pantalla.
- Llama a la métrica por su nombre en español, el mismo de la tarjeta. Nunca
  "Crisis Risk Score", "Brand Health Index" ni "Net Sentiment Score".
- NO especules sobre causas que el dato no muestra. Prohibidas todas las formas
  de conjetura: "probablemente", "probables", "posiblemente", "posibles",
  "seguramente", "al parecer", "todo indica que". Si el tópico se llama Medio
  Ambiente y no sabes qué pasó dentro, di "quejas por manejo ambiental" y para —
  no inventes "probables vertidos o descargas".
- NO proyectes al futuro: nada de "puede subir", "si esto escala", "subiría con
  rapidez". Describes el presente; lo que venga después no está en el dato.
- Un párrafo de 3 a 4 oraciones, máximo 110 palabras. ${HTML_INLINE_RULE}
`,
);

/**
 * Los subcomponentes llegan en la escala interna 0–1. Se muestran en % porque
 * el modelo copiaba el estilo de lo que veía: con `severity: 0.540` delante,
 * escribía "el riesgo en 0.40" y mezclaba escalas con la tarjeta del usuario.
 */
function fmtSubcomponents(subs: MetricSnapshotSubcomponents): string {
  const entries = Object.entries(subs).filter(([, v]) => v != null);
  if (entries.length === 0) return '- (sin componentes desglosados)';
  return entries
    .map(([k, v]) => `- ${k}: ${typeof v === 'number' ? `${Math.round(v * 100)}%` : v}`)
    .join('\n');
}

function fmtTopics(topics: CachedMetricInsightInput['topTopics']): string {
  if (topics.length === 0) return '- (sin tópicos clasificados en el periodo)';
  return topics.map((t) => {
    const pctNeg = t.total > 0 ? Math.round((t.negative / t.total) * 100) : 0;
    const pctPos = t.total > 0 ? Math.round((t.positive / t.total) * 100) : 0;
    return `- ${t.topic}: ${t.total} menciones (neg ${t.negative} = ${pctNeg}%, pos ${t.positive} = ${pctPos}%)`;
  }).join('\n');
}

function fmtAuthors(authors: CachedMetricInsightInput['topAuthors']): string {
  if (authors.length === 0) return '- (sin autores destacados)';
  return authors.map((a) => `- ${a.author}: ${a.mentions} menciones`).join('\n');
}

function fmtMunicipalities(munis: CachedMetricInsightInput['topMunicipalities']): string {
  if (munis.length === 0) return '- (sin datos geográficos claros)';
  return munis.map((m) => `- ${m.municipality}: ${m.total} menciones / ${m.negative} negativas`).join('\n');
}

function metricLabel(m: MetricKey): string {
  return ({
    // Los nombres que ve el usuario en la tarjeta. Antes eran los internos en
    // inglés y el modelo los copiaba literal al texto ("el Brand Health Index
    // en 4.7"), que no es como se llama nada en la interfaz.
    crisis: 'el riesgo de crisis',
    polarization: 'la polarización',
    nss: 'el sentimiento neto',
    bhi: 'la salud de marca',
    volume: 'el volumen del periodo',
  } as const)[m];
}

function metricInterpretation(m: MetricKey, value: number | null): string {
  if (value == null) return 'sin valor disponible';
  if (m === 'crisis') {
    if (value >= 0.60) return 'rango CRISIS (≥0.60)';
    if (value >= 0.40) return 'rango ALERTA (0.40-0.60)';
    if (value >= 0.25) return 'rango ELEVADO (0.25-0.40)';
    return 'rango NORMAL (<0.25)';
  }
  if (m === 'nss') {
    if (value >= 20) return 'positivo robusto';
    if (value >= 5) return 'positivo leve';
    if (value > -5) return 'neutro / mixto';
    if (value > -20) return 'negativo leve';
    return 'negativo robusto';
  }
  if (m === 'bhi') {
    if (value >= 8.2) return 'fuerte (8.2-10)';
    if (value >= 6.4) return 'sano (6.4-8.2)';
    if (value >= 4.6) return 'débil (4.6-6.4)';
    return 'crítico (1.0-4.6)';
  }
  if (m === 'polarization') {
    if (value >= 60) return 'polarización extrema (>60%)';
    if (value >= 40) return 'polarización moderada (40–60%)';
    return 'apatía / bajo nivel de opinión';
  }
  return '';
}

export function buildCachedMetricInsightPrompt(input: CachedMetricInsightInput): string {
  const interp = metricInterpretation(input.metric, input.value);
  // Escala PÚBLICA — la misma que el usuario tiene en la tarjeta (formatMetric es
  // la única fuente). Antes se pasaba el crudo 0–1 y el modelo lo citaba literal
  // ("el Crisis Risk Score en 0.40"), mezclando escalas con lo que muestra la UI.
  const valueLabel = input.value == null
    ? '—'
    : input.metric === 'volume'
      ? `${Math.round(input.value).toLocaleString('es-PR')} menciones`
      : (() => {
          const d = formatMetric(input.metric as DisplayMetricKey, input.value);
          return d.value ? `${d.word} · ${d.value}` : d.word;
        })();
  const signedDelta = input.totalMentionsDelta > 0 ? `+${input.totalMentionsDelta.toFixed(0)}` : `${input.totalMentionsDelta.toFixed(0)}`;

  return `
AGENCIA: ${input.agencyName} (abreviada: ${input.agencyShortName})
PERIODO: ${input.periodStart} al ${input.periodEnd} (AST, UTC-4)
MÉTRICA: ${metricLabel(input.metric)}
VALOR: ${valueLabel} (${interp})

SUBCOMPONENTES NUMÉRICOS DEL VALOR (puedes usarlos como contexto, pero NO los listes como fórmula):
${fmtSubcomponents(input.subcomponents)}

VOLUMEN TOTAL DEL PERIODO: ${input.totalMentions} menciones (${signedDelta}% vs ventana previa de igual duración)

TOP 5 TÓPICOS DEL PERIODO (ordenados por volumen descendente):
${fmtTopics(input.topTopics)}

TOP AUTORES DESTACADOS:
${fmtAuthors(input.topAuthors)}

CONCENTRACIÓN GEOGRÁFICA (top municipios por negativo):
${fmtMunicipalities(input.topMunicipalities)}

TAREA:
Explica en UN párrafo de 3 a 4 oraciones POR QUÉ ${metricLabel(input.metric)} está en ${valueLabel} para ${input.agencyShortName} en este periodo.

1. ABRE POR EL HECHO, no por la métrica. Qué está pasando en la conversación: el reclamo, el evento, la cobertura o el conflicto concreto que produce este valor. Sale de los tópicos, autores y municipios de arriba.
2. La métrica es la CONSECUENCIA, y aparece después: "eso es lo que tiene el ${metricLabel(input.metric)} en ${valueLabel}".
3. Di si ese valor es alto o bajo PARA ESTA AGENCIA, comparándolo con la ventana previa (${signedDelta}%) o con su rango habitual. Un número suelto no le dice nada a nadie.
4. Si hay dos cosas distintas empujando el valor, dilo: eso es más útil que enumerar cinco tópicos.

MAL: "El riesgo de crisis está en alerta porque el tópico Gestión concentra 128 menciones con 63% negativas."
BIEN: "Un paro de la unión de empleados se montó sobre la crisis de agua que ya venía, y la conversación no ha vuelto a bajar desde entonces. Eso es lo que tiene el riesgo de crisis en alerta, por encima de lo habitual de la agencia."

Nunca expliques la fórmula ni sus componentes.

`.trim();
}
