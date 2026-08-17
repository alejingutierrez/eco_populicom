/**
 * Prompt para el modo "Narrativas emergentes" del Resumen ejecutivo del
 * Scorecard.
 *
 * Lo invoca eco-ai-tasks 4 veces al día por agencia (en paralelo con
 * `executive-briefing.ts` y `briefing-crisis.ts`). Se enfoca en tópicos que
 * han **crecido** en la segunda mitad del periodo respecto a la primera,
 * usando el `deltaPct` ya calculado por el backend.
 *
 * Si no hay tópicos con crecimiento (>15%), debe decirlo explícitamente —
 * la regla #2 del system prompt prohíbe inventar dinamismo.
 */

import type { BriefingOutput, BriefingBaseline } from './executive-briefing';

/** Tópico con su crecimiento ya calculado (segunda mitad vs primera mitad del periodo). */
export interface EmergingTopic {
  topic: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  /** % de cambio: ((recent - previous) / previous) * 100. Puede ser negativo. */
  deltaPct: number;
}

import { HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

export interface EmergingBriefingAggregates {
  agencyName: string;
  agencyShortName: string;
  periodHours: number;
  generatedAtLabel: string;
  /** Tópicos ya ordenados por deltaPct descendiente. Top 5. */
  emergingTopics: EmergingTopic[];
  /** Totales del periodo, para anchor numérico. */
  totals: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  };
  totalReach: number;
  /** Nivel típico de 7 días (avg diario + NSS) para contexto coyuntural. Opcional. */
  baseline7d?: BriefingBaseline | null;
}

export const EMERGING_BRIEFING_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO. Este texto identifica qué está CRECIENDO en la conversación de una agencia pública: qué se habla ahora en la segunda mitad del periodo que no se hablaba en la primera.`,
  `
- Tope de 110 palabras, dos ideas: qué creció, y de qué se trata ese crecimiento.
  Un tópico que sube no dice nada por sí solo — lo que importa es QUÉ conversación
  concreta lo hizo subir.
- Si nada crece de forma clara, dilo con todas sus letras. Un periodo sin nada
  emergente es información, no un hueco que rellenar.
- ${HTML_INLINE_RULE}
`,
);

export function buildEmergingBriefingPrompt(agg: EmergingBriefingAggregates): string {
  const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);

  // Contexto coyuntural: volumen del periodo vs. el nivel típico de 7 días.
  const b7 = agg.baseline7d;
  const baselineLine = b7 && b7.avgDailyVolume != null && b7.avgDailyVolume > 0
    ? `NIVEL TÍPICO (7 días): ~${Math.round(b7.avgDailyVolume)} menciones/día — el periodo (${agg.totals.total}) está ${Math.round(((agg.totals.total - b7.avgDailyVolume) / b7.avgDailyVolume) * 100)}% vs. ese nivel.`
    : '';

  const emergingBlock = agg.emergingTopics.length > 0
    ? agg.emergingTopics.map((t) => {
        const sign = t.deltaPct > 0 ? '+' : '';
        return `- ${t.topic}: ${sign}${t.deltaPct}% (${t.total} menciones, neg ${t.negative}/${pct(t.negative, t.total)}%, neu ${t.neutral}, pos ${t.positive})`;
      }).join('\n')
    : '- (sin tópicos clasificados con crecimiento medible en el periodo)';

  return `
AGENCIA: ${agg.agencyName} (abreviada: ${agg.agencyShortName})
GENERADO: ${agg.generatedAtLabel}
PERIODO: últimas ${agg.periodHours} horas (America/Puerto_Rico — AST, UTC-4).

TOTALES DEL PERIODO:
- Total: ${agg.totals.total} menciones
- Negativo: ${agg.totals.negative} (${pct(agg.totals.negative, agg.totals.total)}%)
- Neutral:  ${agg.totals.neutral}  (${pct(agg.totals.neutral, agg.totals.total)}%)
- Positivo: ${agg.totals.positive} (${pct(agg.totals.positive, agg.totals.total)}%)
REACH ACUMULADO: ${agg.totalReach} impresiones
${baselineLine ? `${baselineLine}\n` : ''}
TÓPICOS ORDENADOS POR CRECIMIENTO (segunda mitad vs primera mitad):
${emergingBlock}

TAREA:
Devuelve un objeto JSON con cinco campos: \`narrative_html\`, \`dominant_signal\`, \`action_label\`, \`action_tone\`, \`reach_label\`.

1. \`narrative_html\` (2 a 4 oraciones, máximo 110 palabras): di QUÉ conversación está creciendo y DE QUÉ SE TRATA — el reclamo, el anuncio o la cobertura concreta que la empuja, no solo el nombre del tópico con su porcentaje. Ancla con el crecimiento en % y con la composición de tono si aporta. Si ningún tópico crece más de 15%, abre con "Sin narrativas emergentes claras en el periodo" y describe brevemente de qué sigue hablando la gente, sin presentarlo como emergente.

2. \`dominant_signal\` (texto plano): "<Tópico emergente> · +<delta>%" si hay crecimiento real. Si no, "Sin narrativas emergentes · Estable".

3. \`action_label\` (texto plano, ≤6 palabras, termina en "→"): etiqueta exploratoria. Ejemplos: "Seguir tópico en alza →", "Revisar emergentes →". PROHIBIDO el imperativo hacia la agencia.

4. \`action_tone\`: "pos" si los tópicos emergentes son mayormente positivos, "neg" si son mayormente negativos, "warn" si son mixtos con negatividad creciente, "neu" si no hay emergentes claros.

5. \`reach_label\` (texto plano): humaniza ${agg.totalReach} impresiones. ≥1,000,000 → "X.YYM impresiones"; ≥1,000 → "NK impresiones"; <1,000 → "N impresiones".

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "narrative_html": "<oraciones con <strong> opcional>",
  "dominant_signal": "<Tópico> · <Delta o Estable>",
  "action_label": "<Etiqueta corta> →",
  "action_tone": "pos|neg|warn|neu",
  "reach_label": "<volumen humanizado>"
}
`.trim();
}

