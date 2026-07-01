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
import { bandWord, metricBand, toBhi10, type BandedMetricKey } from '../format/metrics-display';

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

export const CACHED_METRIC_INSIGHT_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico con 10 años de experiencia. Tu función es DESCRIBIR el porqué de una métrica sintética (Crisis Risk, Polarización, NSS, Brand Health o Volumen) para una agencia pública en un periodo dado, basándote ESTRICTAMENTE en los datos agregados que se te entregan.

Abre con la LECTURA cualitativa (la palabra de banda que se te entrega y qué implica para la agencia) y ancla con el número tal cual se muestra al usuario; luego explica qué pasó en la conversación que llevó ahí. La palabra y el número deben coincidir EXACTAMENTE con lo que ve el usuario — no los reformules ni cambies de escala.

REGLAS INNEGOCIABLES (violaciones anulan la respuesta):

1. **PROHIBIDAS las recomendaciones, sugerencias de acción, juicios prescriptivos y llamados a la acción.** Quedan prohibidas las frases: "se debería", "se sugiere", "convendría", "sería bueno", "es importante que", "recomendamos", "amerita", "se requiere", "hace falta", "urge", "la agencia debe/tiene que", "se podría considerar". Reporta el sentir ajeno, no el tuyo.

2. **PROHIBIDO explicar la fórmula de la métrica.** El usuario quiere saber QUÉ pasó en esta agencia que llevó al número actual — los tópicos dominantes, autores destacados, municipios concentrados, eventos específicos. NO digas "el Crisis Risk Score se calcula como severity * velocity * relevance * confidence".

3. **Cada afirmación debe estar respaldada por un número concreto** tomado literalmente de los datos: cantidad de menciones, porcentaje, variación, share de subcomponente. Sin número no hay afirmación.

4. **Cada afirmación debe nombrar al menos un elemento propio concreto**: tópico/subtópico, autor destacado, medio/fuente, municipio, o fecha específica. Los nombres deben coincidir exactamente con los datos (acentos y capitalización).

5. **Idioma**: español de Puerto Rico, tono profesional-informativo, frases cortas y directas. Sin emojis, sin signos de exclamación, sin marketing-speak.

6. **Salida**: exclusivamente un objeto JSON válido con el shape pedido. Sin texto fuera del JSON. Puedes usar inline <strong> y </strong> para resaltar nombres propios y cifras clave; ningún otro HTML.

EJEMPLO DE INSIGHT ACEPTABLE (referencial, para Crisis Risk de DTOP):
"El <strong>Crisis Risk de 0.74</strong> se explica por la concentración en <strong>Infraestructura Vial</strong> (<strong>184 menciones</strong>, <strong>78%</strong> negativas) y por el <strong>+142%</strong> de volumen vs. la semana previa. <strong>Bayamón</strong> y <strong>Carolina</strong> concentran <strong>54%</strong> de las menciones negativas, lideradas por <strong>@residentespr</strong> con <strong>23</strong> menciones."

EJEMPLOS INACEPTABLES:
- "El Crisis Risk se calcula como severity por velocity..." ← explica la fórmula.
- "DTOP debería emitir un comunicado." ← prescriptivo.
- "Hay preocupación entre la ciudadanía." ← sin número, sin nombre propio.
`.trim();

function fmtSubcomponents(subs: MetricSnapshotSubcomponents): string {
  const entries = Object.entries(subs).filter(([, v]) => v != null);
  if (entries.length === 0) return '- (sin componentes desglosados)';
  return entries.map(([k, v]) => `- ${k}: ${typeof v === 'number' ? v.toFixed(3) : v}`).join('\n');
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
    crisis: 'Crisis Risk Score',
    polarization: 'Polarization Index',
    nss: 'Net Sentiment Score (NSS)',
    bhi: 'Brand Health Index (BHI)',
    volume: 'Volumen del periodo',
  } as const)[m];
}

/**
 * Etiqueta cualitativa canónica de la métrica, derivada del módulo único de
 * formato (`metricBand` + `bandWord`) para que NUNCA diverja del vocabulario ni
 * de los umbrales que ve el usuario en la UI. `value` es el valor CRUDO del
 * snapshot (crisis 0–1, bhi 0–1, polarization 0–100, nss −100..100). Volume no
 * tiene banda cualitativa.
 */
function metricInterpretation(m: MetricKey, value: number | null): string {
  if (value == null) return 'sin valor disponible';
  if (m === 'volume') return 'volumen del periodo (sin escala fija — interpreta vs. su nivel típico)';
  const key = m as BandedMetricKey;
  return bandWord(key, metricBand(key, value));
}

export function buildCachedMetricInsightPrompt(input: CachedMetricInsightInput): string {
  const interp = metricInterpretation(input.metric, input.value);
  // Número legible tal cual aparece en pantalla. bhi se muestra en escala 1–10
  // aunque el snapshot lo guarde 0–1; crisis con 2 decimales; el resto 1.
  const valueLabel = input.value == null
    ? '—'
    : input.metric === 'bhi'
      ? toBhi10(input.value).toFixed(1)
      : input.value.toFixed(input.metric === 'crisis' ? 2 : 1);
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
Redacta UN párrafo único de 3 a 5 oraciones explicando POR QUÉ el ${metricLabel(input.metric)} está en ${valueLabel} para ${input.agencyShortName} en este periodo. Cumple TODOS estos criterios:

a. Cada afirmación tiene 1+ número concreto tomado de los datos.
b. Cada afirmación nombra 1+ elemento propio concreto (tópico/autor/municipio/medio/fecha).
c. Describe el "qué pasó en la conversación" que llevó al número, no la fórmula.
d. Puedes usar <strong> y </strong> inline para resaltar nombres propios y cifras clave.
e. Tono profesional, sin recomendaciones ni juicios prescriptivos.

SALIDA: usa la tool emit_cached_metric_insight con el campo "insight" (1 párrafo, 3-5 oraciones).
`.trim();
}
