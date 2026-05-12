/**
 * Prompt para el insight AI que aparece en el modal de cada KPI del Scorecard.
 *
 * Lo invoca /api/ai/metric-insight on-demand cuando el usuario clickea un KPI.
 * Output esperado: una sola frase (2-3 oraciones, ~60 palabras) en lenguaje
 * coloquial que explique qué dice el número sin entrar en la fórmula.
 */

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

1. **PROHIBIDO mencionar fórmulas o componentes técnicos.** No digas "es 0.40 * NSS + 0.25 * engagement…", "se calcula como (pos − neg)/total", "z-score", "logaritmo", "saturado en 0-1". El lector NO quiere la fórmula — quiere saber qué significa el número.

2. **PROHIBIDO recomendar acciones.** No digas "se debería", "se sugiere", "convendría", "es importante". Describes; no instruyes.

3. **Cada afirmación debe estar respaldada por un número del input:** valor actual, delta vs. previo, P25/P75 histórico, % de share de tópicos. Sin número no hay afirmación.

4. **Empieza con la conclusión, no con la métrica.** "La conversación se inclina más hacia lo positivo…", no "El NSS de 12 indica…". El lector ya sabe qué métrica está viendo.

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

  // Guía contextual del rango de la métrica, para que el modelo no invente significados.
  const semantics: Record<MetricKey, string> = {
    nss: 'Net Sentiment Score: rango −100 (todo negativo) a +100 (todo positivo). >+20 muy positivo, +5 a +20 moderadamente positivo, −5 a +5 neutral, −20 a −5 moderadamente negativo, <−20 muy negativo.',
    crisis: 'Crisis Risk Score: rango 0 a 1. 0–0.25 NORMAL, 0.25–0.40 ELEVADO, 0.40–0.60 ALERTA, ≥0.60 CRISIS. Mide concentración negativa, anomalía de volumen y pertinencia.',
    volume: 'Volumen total de menciones en el periodo. Sin escala fija — interpreta vs. P25/P75 histórico.',
    bhi: 'Brand Health Index: rango 0 a 1. <0.4 CRÍTICO, 0.4–0.6 DÉBIL, 0.6–0.8 SANO, >0.8 FUERTE. Combina sentimiento, engagement, alcance y pertinencia.',
    polarization: 'Polarization Index: 0 a 100%. % de menciones que tienen postura clara (pos o neg). >60% APÁTICA es contradicción — alta polarización = pocos neutrales.',
  };

  return `
MÉTRICA: ${input.metricLabel} (${input.metric})
SIGNIFICADO: ${semantics[input.metric]}

VALOR ACTUAL: ${input.currentValue} (banda: ${input.band})
VENTANA: últimos ${input.windowDays} días (cerrada, terminando ayer en AST PR).
CAMBIO vs ventana anterior de la misma duración: ${deltaStr}
RANGO HISTÓRICO 90d: P25 = ${p25Str} ; P75 = ${p75Str}

TÓPICOS QUE MÁS CONTRIBUYEN AL VALOR (top 3):
${topicsBlock}
${muniLine}

TAREA:
Devuelve un objeto JSON con un único campo \`interpretation\` (2-3 oraciones, máximo 60 palabras, con \`<strong>\` opcional en números y nombres propios).

Estructura esperada:
1. Primera oración: conclusión cualitativa (qué dice el número en lenguaje natural, sin fórmula).
2. Segunda oración: comparación con el histórico O con la ventana previa (usa los números del input).
3. Tercera oración (opcional, solo si aporta): nombrar 1 tópico que está dominando o cambiando el valor.

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "interpretation": "<2-3 oraciones con <strong> opcional>"
}
`.trim();
}
