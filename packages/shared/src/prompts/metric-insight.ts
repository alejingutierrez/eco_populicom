/**
 * Prompt para el insight AI que aparece en el modal de cada KPI del Scorecard.
 *
 * Lo invoca /api/ai/metric-insight on-demand cuando el usuario clickea un KPI.
 * Output esperado: una sola frase (2-3 oraciones, ~60 palabras) en lenguaje
 * coloquial que explique qué dice el número sin entrar en la fórmula.
 */

import { formatMetric, bandWord, metricBand, type BandedMetricKey } from '../format/metrics-display';
import { buildSystemPrompt } from './constitution';

export type MetricKey = 'nss' | 'crisis' | 'volume' | 'bhi' | 'polarization';

/** Bandas semánticas posibles de cada métrica (la API se las pasa ya calculadas). */
export type MetricBand =
  | 'CRISIS' | 'ALERTA' | 'ELEVADO' | 'NORMAL'
  | 'POSITIVO' | 'NEUTRAL' | 'NEGATIVO'
  | 'CRÍTICO' | 'DÉBIL' | 'SANO' | 'FUERTE'
  | 'APÁTICA' | 'MODERADA' | 'ALTA' | 'EXTREMA'
  | 'BAJO' | 'PROMEDIO' | 'ALTO';

export interface MetricInsightInput {
  metric: MetricKey;
  /** Etiqueta human-readable: "Net Sentiment Score", "Riesgo de crisis", etc. */
  metricLabel: string;
  /** Valor actual de la métrica para la ventana del usuario. */
  currentValue: number;
  /** Banda semántica del valor actual. */
  band: MetricBand;
  /** Tamaño de la ventana en días (1, 7, 30, 90, 180, 365). */
  windowDays: number;
  /** Cambio vs la ventana previa de la misma duración. % o puntos según métrica. */
  deltaVsPrev: number | null;
  /** P25 y P75 de la métrica en los últimos 90 días de snapshots — contexto histórico. */
  historicalP25: number | null;
  historicalP75: number | null;
  /** Top 3 tópicos que más contribuyen a este valor (mayor volumen o mayor share negativo si métrica=crisis). */
  topContributingTopics: Array<{ name: string; share: number }>;
  /** Nombre del municipio con mayor concentración (opcional, solo cuando aplica). */
  topMunicipality?: { name: string; share: number } | null;
}

export interface MetricInsightOutput {
  /** 2-3 oraciones, ~60 palabras, con <strong> permitido en números y nombres propios. */
  interpretation: string;
}

export const METRIC_INSIGHT_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO explicando UNA métrica del dashboard. El usuario abrió este panel porque vio un número que le llamó la atención; lo que necesita saber es QUÉ ESTÁ PASANDO que lo produce, no qué mide el indicador.`,
  `
- Abre por el HECHO, no por la métrica. La métrica es la consecuencia, y va en
  la segunda mitad de la primera oración o en la segunda oración.
  BIEN: "Un paro de la unión de empleados se montó sobre la crisis de agua y la
        conversación no ha vuelto a bajar. Eso es lo que tiene el riesgo de
        crisis en 73%."
  MAL:  "El riesgo de crisis está en 73% porque casi la mitad de las menciones
        son negativas."
- Nunca expliques la fórmula ni sus componentes. Nada de "se calcula como",
  "0.40 * NSS", "ponderado", "saturado en 0-1". El lector quiere el porqué del
  mundo real, no el del cálculo.
- Usa EXACTAMENTE la palabra de banda y el número que se muestran en pantalla,
  sin reformular ni convertir de escala.
- Di si el valor es alto o bajo PARA ESTA AGENCIA, comparándolo con su propio
  rango histórico cuando lo tengas. "73%" no le dice nada a nadie si no sabe
  que la agencia suele andar por 65%.
- 2 a 3 oraciones, máximo 70 palabras.
`,
);

export function buildMetricInsightPrompt(input: MetricInsightInput): string {
  const deltaStr = input.deltaVsPrev == null
    ? 'n/d'
    : (input.deltaVsPrev > 0 ? '+' : '') + Math.round(input.deltaVsPrev * 10) / 10;

  const p25Str = input.historicalP25 == null ? 'n/d' : Math.round(input.historicalP25 * 100) / 100;
  const p75Str = input.historicalP75 == null ? 'n/d' : Math.round(input.historicalP75 * 100) / 100;

  const topicsBlock = input.topContributingTopics.length > 0
    ? input.topContributingTopics.map((t) => `- ${t.name}: ${Math.round(t.share * 100)}%`).join('\n')
    : '- (sin tópicos contribuyentes destacados)';

  const muniLine = input.topMunicipality
    ? `Municipio con mayor concentración: ${input.topMunicipality.name} (${Math.round(input.topMunicipality.share * 100)}% del total).`
    : '';

  // Palabra + número canónicos (los MISMOS que ve el usuario en pantalla). Para
  // las métricas con banda derivamos la palabra desde el token de banda vía
  // bandWord (single source: format/metrics-display) para que el vocabulario del
  // prompt nunca diverja de la UI. Volume no lleva banda cualitativa.
  const isBanded = (m: MetricKey): m is Exclude<MetricKey, 'volume'> => m !== 'volume';
  const word = isBanded(input.metric)
    ? bandWord(input.metric as BandedMetricKey, input.band)
    : null;
  // Número legible tal cual aparece en la tarjeta.
  const displayNumber = input.metric === 'volume'
    ? `${input.currentValue.toLocaleString('es-PR')} menciones`
    : input.metric === 'crisis'
      ? `${Math.round(input.currentValue * 100)}%`
      : input.metric === 'bhi'
        ? `${input.currentValue} / 10`
        : input.metric === 'polarization'
          ? `${Math.round(input.currentValue)}%`
          : (input.currentValue > 0 ? `+${input.currentValue}` : `${input.currentValue}`); // nss
  const displayLine = word ? `${word} · ${displayNumber}` : displayNumber;

  // Qué es "bueno" o "malo" para cada métrica — sin fórmula, solo dirección.
  const direction: Record<MetricKey, string> = {
    nss: 'Más positivo (hacia +100) es mejor; más negativo (hacia −100) es peor.',
    crisis: 'Más bajo (Normal) es mejor; más alto (Alerta/Crisis) es peor.',
    volume: 'Sin escala fija de bueno/malo — interpreta vs. su rango histórico P25/P75.',
    bhi: 'Más alto (hacia 10, Fuerte) es mejor; más bajo (hacia 1, Crítico) es peor.',
    polarization: 'Más alto significa una conversación más dividida (menos neutrales), no necesariamente peor.',
  };

  return `
MÉTRICA: ${input.metricLabel} (${input.metric})

COMO SE MUESTRA AL USUARIO: ${displayLine}
INTERPRETACIÓN DE DIRECCIÓN: ${direction[input.metric]}
VENTANA: últimos ${input.windowDays} días (cerrada, terminando ayer en AST PR).
CAMBIO vs ventana anterior de la misma duración: ${deltaStr}
RANGO HISTÓRICO 90d: P25 = ${p25Str} ; P75 = ${p75Str}

TÓPICOS QUE MÁS CONTRIBUYEN AL VALOR (top 3):
${topicsBlock}
${muniLine}

TAREA:
Explica en 2 o 3 oraciones (máximo 70 palabras) POR QUÉ ${input.metricLabel} está donde está.

1. Primera oración: QUÉ ESTÁ PASANDO en la conversación — el hecho, el reclamo, la cobertura o el evento que produce este valor. Sale de los tópicos que más contribuyen. Cierra la oración (o abre la siguiente) anclando con "${displayLine}", usando esa palabra y ese número tal cual.
2. Segunda oración: si es alto o bajo para esta agencia, comparado con su rango habitual (P25 ${p25Str} / P75 ${p75Str}) o con la ventana previa (cambio: ${deltaStr}).
3. Tercera oración, solo si aporta algo que las dos anteriores no dijeron.

Recuerda la dirección de esta métrica: ${direction[input.metric]}

SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "interpretation": "<2-3 oraciones con <strong> opcional>"
}
`.trim();
}
