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
import { HTML_INLINE_RULE } from './constitution';

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

  // Municipios y autores ya venían calculados en WeeklyAggregates pero no se
  // le mostraban al modelo — habilitan highlights de asimetría de actor/canal
  // (lo que el system prompt pide) sin cómputo adicional.
  const muniBlock = (current.byMunicipality ?? []).slice(0, 8)
    .map((m) => `- ${m.municipality}: ${m.total} menciones (${m.negative} neg)`).join('\n') || '- (sin datos)';

  const authorBlock = (current.topAuthors ?? []).slice(0, 8)
    .map((a) => `- ${a.author}: ${a.mentions} menciones (sentimiento dominante: ${a.sentiment})`).join('\n') || '- (sin datos)';

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

AUTORES / CUENTAS MÁS ACTIVAS DE LA SEMANA ACTUAL (recuerda: sin @handles personales ni nombres de ciudadanos privados en la salida — usa medios, cargos públicos o tipo de canal):
${authorBlock}

MUNICIPIOS CON MENCIONES ESTA SEMANA (etiquetado automático del NLP — NO es ground truth del lugar del evento; aplica la regla geográfica del sistema):
${muniBlock}

EMOCIONES AGREGADAS DE LA SEMANA ACTUAL:
${emotionBlock}

MUESTRAS DE MENCIONES DE LA SEMANA ACTUAL (pre-filtradas a pertinencia alta/media, ORDENADAS POR ENGAGEMENT — las primeras son las de mayor resonancia; úsalas para anclar los hechos concretos):
--- NEGATIVAS (${samples.negative.length}) ---
${samples.negative.slice(0, 12).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}
--- NEUTRALES (${samples.neutral.length}) ---
${samples.neutral.slice(0, 8).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}
--- POSITIVAS (${samples.positive.length}) ---
${samples.positive.slice(0, 8).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA — TRES PIEZAS. Todo se afirma en clave de CAMBIO: qué es distinto respecto a la semana anterior.

1) "headline" — el titular de la semana. UNA oración de 8 a 18 palabras que nombre el cambio central. Sujeto y verbo, sin cifras, sin punto final.
   BIEN: "La semana en que la Secretaría cambió de titular y de conversación"
   BIEN: "Se enfría la crisis de agua y vuelve a pesar la gestión"
   MAL:  "Resumen semanal" · "+531% en volumen" · "Nombramientos / Designaciones"

2) "summary" — el párrafo. De 3 a 5 oraciones (80 a 130 palabras) que expliquen el cambio: qué lo produjo, en qué orden pasaron las cosas si hubo una secuencia, y quién empujó la conversación. Arranca por el cambio o por el hecho que lo causó, nunca por un conteo ni por "La conversación estuvo marcada por". Máximo dos cifras.

3) "highlights" — de 2 a 4 viñetas: qué cambió. Cada una cuenta UN CAMBIO CONCRETO, con los números de las dos semanas como apoyo, no como sujeto. Ángulos que suelen dar señal:
   - una conversación que apareció y antes no existía, o una que desapareció;
   - un tema que se disparó o se apagó, y el hecho que lo explica;
   - algo que NO cambió pese a todo lo demás — lo que la agencia arrastra semana tras semana;
   - un indicador que se movió y qué lo movió (usa el valor tal cual viene: "50%", "3.8 / 10").
   Cada viñeta: una sola oración de 25 a 45 palabras, con al menos un medio, cargo público u organización nombrado.
   BIEN: "Apareció una conversación que no existía: la relación con la Legislatura pasó de cero a 51 menciones tras la reunión en el Capitolio."
   MAL:  "Relación con la Legislatura: 51 menciones esta semana vs 0 la anterior (+nuevo)."

REGLAS PROPIAS DE ESTE CORREO:
- Di QUÉ conversación concreta subió o bajó, no solo el nombre del tema con un conteo. "Permisos bajó de 152 a 84" solo vale si a continuación dices qué discusión se apagó.
- Si una variación es "nuevo" (la semana anterior no registraba), dilo así en lugar de inventar un porcentaje.
- Cuando el volumen se dispare pero el tono casi no se mueva, dilo: es la señal más fácil de perder y la más útil.
- Habla de "esta semana" (${inputs.weekLabel}) y "la semana anterior" (${inputs.prevWeekLabel}). Nunca "hoy" ni "ayer".
- Si no hay señal para 4 viñetas, entrega menos (mínimo 1). Mejor pocas y verdaderas.

${HTML_INLINE_RULE}

SALIDA: llama la herramienta con los tres campos — headline, summary, highlights.
`.trim();
}
