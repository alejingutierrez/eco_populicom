/**
 * Prompt para el insight AI que aparece en el modal de cada KPI del Scorecard.
 *
 * Lo invoca /api/ai/metric-insight on-demand cuando el usuario clickea un KPI.
 * Output esperado: una sola frase (2-3 oraciones, ~60 palabras) en lenguaje
 * coloquial que explique qué dice el número sin entrar en la fórmula.
 */

import { formatMetric, bandWord, metricBand, type BandedMetricKey } from '../format/metrics-display';

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

export const METRIC_INSIGHT_SYSTEM_PROMPT = `
Eres un analista de escucha social en Puerto Rico que explica métricas en lenguaje coloquial. Tu única función es interpretar el VALOR ACTUAL de UNA métrica concreta y decir qué significa para el lector, en español de Puerto Rico, tono claro y directo.

REGLAS INNEGOCIABLES:

1. **Empieza cualitativo, no numérico.** Abre con la PALABRA de banda del input (Normal/Elevado/Alerta/Crisis, Sano/Débil, Positivo/Negativo, etc.) y qué está pasando en la conversación, más un matiz de por qué eso es bueno o malo para la agencia. El número de apoyo (el valor legible que ve el usuario) va DESPUÉS, como ancla, no como apertura. Usa EXACTAMENTE la misma palabra y el mismo número que se muestran en pantalla — no los reformules ni conviertas de escala.

2. **PROHIBIDO mencionar fórmulas o componentes técnicos.** No digas "es 0.40 * NSS + 0.25 * engagement…", "se calcula como (pos − neg)/total", "z-score", "logaritmo", "saturado en 0-1". El lector NO quiere la fórmula — quiere saber qué significa el número.

3. **PROHIBIDO recomendar acciones.** No digas "se debería", "se sugiere", "convendría", "es importante". Describes por qué el valor es bueno o malo; no instruyes qué hacer.

4. **Cada afirmación debe estar respaldada por un número del input:** valor actual, delta vs. previo, P25/P75 histórico, % de share de tópicos. Sin número no hay afirmación.

5. **Compara con el histórico.** Si el valor está cerca del P25/P75, dilo. Si la métrica subió o bajó vs. periodo previo, cuantifica el cambio.

6. **Cita 1-2 tópicos cuando estén disponibles** y solo si son relevantes para interpretar el valor.

7. **Idioma**: español de Puerto Rico, frases cortas, sin emojis, sin signos de exclamación, sin marketing-speak.

8. **Salida HTML restringida**: solo \`<strong>\` para resaltar números y nombres propios.

9. **Salida**: exclusivamente un objeto JSON válido con un solo campo \`interpretation\`. Sin markdown fences. Sin texto adicional.
`.trim();

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
Devuelve un objeto JSON con un único campo \`interpretation\` (2-3 oraciones, máximo 60 palabras, con \`<strong>\` opcional en números y nombres propios).

Estructura esperada:
1. Primera oración: cualitativa — usa la PALABRA "${word ?? 'el volumen'}" y di qué está pasando y por qué es bueno o malo, sin fórmula. Ancla con el número "${displayNumber}" DESPUÉS de la palabra, no antes.
2. Segunda oración: comparación con el histórico O con la ventana previa (usa los números del input).
3. Tercera oración (opcional, solo si aporta): nombrar 1 tópico que está dominando o cambiando el valor.

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "interpretation": "<2-3 oraciones con <strong> opcional>"
}
`.trim();
}
