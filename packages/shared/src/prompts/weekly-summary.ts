/**
 * Prompt del RESUMEN SEMANAL comparativo (correo de los viernes, jul 2026).
 *
 * A diferencia de los prompts del reporte diario (weekly-report-insights.ts),
 * aquí TODO gira alrededor de la comparación semana vs semana anterior: el
 * párrafo ejecutivo y los highlights deben explicar QUÉ CAMBIÓ y POR QUÉ,
 * no describir la semana en el vacío. Comparte los guardrails del
 * INSIGHTS_SYSTEM_PROMPT (sin recomendaciones, sin handles personales, sin
 * inferencia geográfica, números literales de los datos).
 */

import type { MentionSample, WeeklyAggregates } from './weekly-report-insights';

export interface WeeklyComparisonInputs {
  /** Agregados de la semana actual (misma forma que el reporte diario). */
  current: WeeklyAggregates;
  /** Totales de la semana anterior. */
  prevTotals: { negative: number; neutral: number; positive: number; total: number };
  /** Tópicos de la semana anterior (para detectar subidas/bajadas/nuevos). */
  prevByTopic: Array<{ topic: string; total: number; negative: number }>;
  /**
   * Indicadores compuestos ya formateados en escala pública, actual y previo,
   * p.ej. { label: "Riesgo de crisis", cur: "36%", prev: "42%" }.
   */
  indicatorLines: Array<{ label: string; cur: string; prev: string }>;
  /** Muestras de menciones de la semana actual (pertinencia alta/media). */
  samples: {
    negative: MentionSample[];
    neutral: MentionSample[];
    positive: MentionSample[];
  };
  /** Etiquetas humanas de ambas semanas ("30 jun – 6 jul 2026"). */
  weekLabel: string;
  prevWeekLabel: string;
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function signedPct(cur: number, prev: number): string {
  if (prev <= 0) return cur > 0 ? 'nuevo' : '0%';
  const v = Math.round(((cur - prev) / prev) * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

function formatSample(i: number, m: MentionSample): string {
  const clean = m.text.replace(/\s+/g, ' ').trim().slice(0, 500);
  const dateShort = m.createdAt.slice(0, 10);
  const meta = [
    m.topic ? `topic=${m.topic}` : null,
    m.source ? `src=${m.source}` : null,
    m.pageType ? `tipo=${m.pageType}` : null,
    typeof m.engagement === 'number' ? `eng=${m.engagement}` : null,
  ].filter(Boolean).join(' ');
  return `${i}. (${dateShort} | ${meta}) "${clean}"`;
}

export function buildWeeklySummaryPrompt(inputs: WeeklyComparisonInputs): string {
  const { current, prevTotals, prevByTopic, indicatorLines, samples } = inputs;
  const { totals } = current;

  const prevTopicMap = new Map(prevByTopic.map((t) => [t.topic, t]));
  const topicCompareBlock = current.byTopic.slice(0, 10).map((t) => {
    const prev = prevTopicMap.get(t.topic);
    const prevTotal = prev?.total ?? 0;
    return `- ${t.topic}: esta semana=${t.total} (neg ${t.negative}) · semana anterior=${prevTotal} · cambio=${signedPct(t.total, prevTotal)}`;
  }).join('\n');

  // Tópicos que existían la semana pasada y desaparecieron esta semana.
  const curTopicNames = new Set(current.byTopic.map((t) => t.topic));
  const goneTopics = prevByTopic
    .filter((t) => t.total > 0 && !curTopicNames.has(t.topic))
    .slice(0, 5)
    .map((t) => `- ${t.topic}: tenía ${t.total} menciones la semana anterior; esta semana no registra`)
    .join('\n');

  const indicatorBlock = indicatorLines
    .map((l) => `- ${l.label}: esta semana=${l.cur} · semana anterior=${l.prev}`)
    .join('\n');

  const sourceBlock = (current.topSources ?? []).slice(0, 8)
    .map((s) => `- ${s.source}: ${s.mentions} menciones`).join('\n') || '- (sin datos)';

  const emotionBlock = (current.topEmotions ?? []).slice(0, 6)
    .map((e) => `- ${e.emotion}: ${e.count} menciones`).join('\n') || '- (sin datos)';

  return `
AGENCIA: ${current.agencyName} (abreviada: ${current.agencyShortName})
CORREO: resumen SEMANAL comparativo. Se envía el viernes a la mañana y cubre la semana cerrada del ${current.periodStart} al ${current.periodEnd} (${inputs.weekLabel}), comparada contra la semana anterior (${inputs.prevWeekLabel}). TZ America/Puerto_Rico.

TOTALES — SEMANA ACTUAL vs SEMANA ANTERIOR:
- Total:    ${totals.total} vs ${prevTotals.total} (${signedPct(totals.total, prevTotals.total)})
- Negativo: ${totals.negative} (${pct(totals.negative, totals.total)}%) vs ${prevTotals.negative} (${signedPct(totals.negative, prevTotals.negative)})
- Neutral:  ${totals.neutral} (${pct(totals.neutral, totals.total)}%) vs ${prevTotals.neutral} (${signedPct(totals.neutral, prevTotals.neutral)})
- Positivo: ${totals.positive} (${pct(totals.positive, totals.total)}%) vs ${prevTotals.positive} (${signedPct(totals.positive, prevTotals.positive)})

INDICADORES COMPUESTOS (escala pública del dashboard):
${indicatorBlock || '- (sin indicadores)'}

VOLUMEN DIARIO DE LA SEMANA ACTUAL:
${current.dailySeries.map((d) => `- ${d.date}: neg=${d.negative}, neu=${d.neutral}, pos=${d.positive} (total ${d.negative + d.neutral + d.positive})`).join('\n')}

TÓPICOS — COMPARACIÓN SEMANA VS SEMANA (ordenados por volumen actual):
${topicCompareBlock || '- (sin menciones clasificadas por tópico)'}
${goneTopics ? `\nTÓPICOS QUE SALIERON (tenían volumen la semana anterior, esta semana no):\n${goneTopics}` : ''}

FUENTES / MEDIOS DE LA SEMANA ACTUAL (top por volumen):
${sourceBlock}

EMOCIONES AGREGADAS DE LA SEMANA ACTUAL:
${emotionBlock}

MUESTRAS DE MENCIONES DE LA SEMANA ACTUAL (pre-filtradas a pertinencia alta/media):
--- NEGATIVAS (${samples.negative.length}) ---
${samples.negative.slice(0, 12).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}
--- NEUTRALES (${samples.neutral.length}) ---
${samples.neutral.slice(0, 8).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}
--- POSITIVAS (${samples.positive.length}) ---
${samples.positive.slice(0, 8).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA — DOS SALIDAS, AMBAS CENTRADAS EN LA COMPARACIÓN:

1) "summary" — UN párrafo de 3 a 5 oraciones: la semana en un vistazo PARA UN LECTOR EJECUTIVO. Debe abrir con la TENSIÓN o el CAMBIO central de la semana vs la anterior (no con enumeración de conteos), citar el volumen total y su variación (${signedPct(totals.total, prevTotals.total)}), identificar el MECANISMO dominante (evento/cobertura/actor que explica el cambio) y cerrar con la posición de la agencia en su conversación. Usa <strong> para cifras y nombres propios clave.

2) "highlights" — 2 a 4 oraciones independientes tipo "qué cambió esta semana", cada una sobre un CAMBIO distinto vs la semana anterior:
   - un movimiento de volumen o sentimiento con su mecanismo (qué evento lo explica),
   - un tópico que subió, bajó, apareció o salió — con números de ambas semanas,
   - un indicador compuesto que se movió (usa los valores de escala pública tal cual: "36%", "6.8 / 10") y qué lo explica,
   - opcionalmente una asimetría (canal, fuente o actor que se comporta distinto que la semana pasada).
   Cada highlight: una sola oración, 25–50 palabras, al menos un número de CADA semana cuando compares, y al menos un nombre propio del dato. Usa <strong> para lo clave.

REGLAS (además de las del sistema):
- TODO se afirma en clave comparativa: "X pasó de N a M", "sube/baja/entra/sale". Nada de describir la semana actual en el vacío.
- Si una variación es "nuevo" (la semana anterior no registraba), dilo explícitamente en lugar de inventar un porcentaje.
- Si no hay señal suficiente para 4 highlights, entrega menos (mínimo 1). Mejor pocos y verdaderos.
- NUNCA "hoy"/"ayer": habla de "esta semana" (${inputs.weekLabel}) y "la semana anterior" (${inputs.prevWeekLabel}).
`.trim();
}
