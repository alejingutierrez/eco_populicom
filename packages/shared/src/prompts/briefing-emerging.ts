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

import type { BriefingOutput } from './executive-briefing';

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
}

export const EMERGING_BRIEFING_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico. Tu única función es identificar y DESCRIBIR los tópicos que están creciendo en la conversación pública durante el periodo, comparando la segunda mitad del periodo con la primera.

REGLAS INNEGOCIABLES:

1. **PROHIBIDAS las recomendaciones, sugerencias de acción y llamados a la acción.** Quedan prohibidas las frases: "se debería", "se sugiere", "convendría", "recomendamos", "es importante", "amerita", "urge", "la agencia debe". Describes el crecimiento; no instruyes qué hacer.

2. **No inventes crecimiento.** Si ningún tópico crece más de 15% o si los datos son insuficientes, dilo literalmente: "Sin narrativas emergentes claras en el periodo". No fuerces narrativa.

3. **Cada afirmación de la narrativa debe estar respaldada por un número concreto** del input: deltaPct, total de menciones, composición de sentimiento. Sin número no hay afirmación.

4. **Idioma**: español de Puerto Rico, tono profesional-informativo, frases cortas y directas. Sin emojis, sin signos de exclamación, sin marketing-speak.

5. **Salida HTML restringida**: la narrativa permite SOLO la etiqueta \`<strong>\`. Ninguna otra etiqueta. Sin atributos.

6. **action_label NO es prescriptivo**: forma típica "Seguir <tópico emergente> →" o "Explorar tópicos en alza →". Prohibido el imperativo hacia la agencia.

7. **Salida**: exclusivamente un objeto JSON válido con el esquema. Sin texto fuera del JSON. Sin markdown fences. Sin comentarios.
`.trim();

export function buildEmergingBriefingPrompt(agg: EmergingBriefingAggregates): string {
  const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);

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

TÓPICOS ORDENADOS POR CRECIMIENTO (segunda mitad vs primera mitad):
${emergingBlock}

TAREA:
Devuelve un objeto JSON con cinco campos: \`narrative_html\`, \`dominant_signal\`, \`action_label\`, \`action_tone\`, \`reach_label\`.

1. \`narrative_html\` (2 oraciones, ≤75 palabras): identifica el 1 o 2 tópicos con mayor crecimiento positivo (deltaPct > 15%) y describe (a) cuál crece y cuánto en %, (b) cómo es su composición de sentimiento (qué % es negativo). Si ningún tópico crece >15%, abre con "Sin narrativas emergentes claras en el periodo" y completa con el tópico de mayor volumen sin presentarlo como emergente. Resalta nombres propios y % con \`<strong>\`. El límite de 75 palabras es estricto.

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

