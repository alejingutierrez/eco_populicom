/**
 * Prompt para el modo "Vigilancia de crisis" del Resumen ejecutivo del
 * Scorecard.
 *
 * Lo invoca eco-ai-tasks 4 veces al día por agencia (en paralelo con
 * `executive-briefing.ts` "signal" y `briefing-emerging.ts" "emerging"). Se
 * enfoca en señales de riesgo: tópicos con alta concentración negativa,
 * picos de volumen anómalos, crisisRiskScore activo.
 *
 * Si no hay señales de crisis (crisisRiskScore < 0.25 y negativeShare < 30%),
 * debe decirlo explícitamente — la regla #2 prohíbe inventar alarma.
 */

import type { BriefingOutput } from './executive-briefing';
import { crisisBand, bandWord } from '../format/metrics-display';
import { HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

export interface CrisisBriefingAggregates {
  agencyName: string;
  agencyShortName: string;
  periodHours: number;
  generatedAtLabel: string;

  /** Crisis Risk Score 0-1 (>0.25 elevado, >0.4 alerta, >0.6 crisis). */
  crisisRiskScore: number | null;
  crisisSeverity: number | null;     // 0-1
  crisisVelocity: number | null;     // 0-1
  crisisRelevance: number | null;    // 0-1
  /** Volume anomaly z-score: cuántas desviaciones está el volumen del periodo vs. 30d baseline. */
  volumeAnomalyZscore: number | null;

  totals: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  };
  /** Share negativo del periodo (negative / total). */
  negativeShare: number;

  /** Top 5 tópicos ordenados por share negativo (no por volumen). */
  topNegativeTopics: Array<{
    topic: string;
    total: number;
    negative: number;
    /** negative / total */
    negativeShare: number;
  }>;

  /** Municipios con mayor concentración negativa, top 3. */
  topNegativeMunicipalities: Array<{
    municipality: string;
    total: number;
    negative: number;
  }>;

  totalReach: number;
}

export const CRISIS_BRIEFING_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  `Eres el analista de ECO vigilando el riesgo de crisis de una agencia pública. Describes las señales que hay, sin alarmismo y sin complacencia.`,
  `
- Tope de 110 palabras, dos ideas: de qué se está quejando la gente en concreto,
  y qué tan fuerte es esa señal comparada con lo normal de la agencia.
- Abre con la LECTURA de la banda (Normal, Elevado, Alerta o Crisis — la misma
  palabra que ve el usuario) y ancla el % después.
- No inventes crisis donde no la hay: si la banda es Normal, abre con "Sin
  señales de crisis en el periodo" y completa con un dato neutral. No uses
  "vigilar", "monitorear" ni "atención", que sugieren una preocupación que el
  dato no sostiene.
- Tampoco amplifiques: reserva la palabra "crisis" para la banda Crisis.
- Los números van en escala pública (%), nunca en la interna 0–1.
- ${HTML_INLINE_RULE}
`,
);

export function buildCrisisBriefingPrompt(agg: CrisisBriefingAggregates): string {
  const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);
  const fmt3 = (n: number | null) => n == null ? 'n/d' : Math.round(n * 1000) / 1000;

  const negTopicsBlock = agg.topNegativeTopics.length > 0
    ? agg.topNegativeTopics.map((t) =>
        `- ${t.topic}: ${t.negative}/${t.total} negativas (${Math.round(t.negativeShare * 100)}% del tópico)`
      ).join('\n')
    : '- (sin tópicos con concentración negativa medible)';

  const negMuniBlock = agg.topNegativeMunicipalities.length > 0
    ? agg.topNegativeMunicipalities.map((m) =>
        `- ${m.municipality}: ${m.negative}/${m.total} negativas (${pct(m.negative, m.total)}%)`
      ).join('\n')
    : '- (sin concentración geográfica negativa)';

  // Banda del score para que el modelo no tenga que clasificar él mismo. Single
  // source: format/metrics-display (crisisBand) — mismos umbrales que la UI.
  const score = agg.crisisRiskScore ?? 0;
  const band = crisisBand(score);
  const bandLabel = bandWord('crisis', band);

  return `
AGENCIA: ${agg.agencyName} (abreviada: ${agg.agencyShortName})
GENERADO: ${agg.generatedAtLabel}
PERIODO: últimas ${agg.periodHours} horas (America/Puerto_Rico — AST, UTC-4).

INDICADORES DE CRISIS:
- Crisis Risk Score: ${fmt3(agg.crisisRiskScore)} (escala 0–1, banda actual: ${band} — palabra que ve el usuario: "${bandLabel}", ${Math.round(score * 100)}%)
- Severidad (concentración negativa): ${fmt3(agg.crisisSeverity)}
- Velocidad (anomalía de volumen vs 30d): ${fmt3(agg.crisisVelocity)}
- Relevancia (pertinencia alta del flujo): ${fmt3(agg.crisisRelevance)}
- Volume anomaly z-score: ${fmt3(agg.volumeAnomalyZscore)}

TOTALES DEL PERIODO:
- Total: ${agg.totals.total} menciones
- Negativas: ${agg.totals.negative} (${Math.round(agg.negativeShare * 100)}% del total)
- Neutrales: ${agg.totals.neutral}
- Positivas: ${agg.totals.positive}

TÓPICOS CON MAYOR CONCENTRACIÓN NEGATIVA:
${negTopicsBlock}

MUNICIPIOS CON MAYOR CONCENTRACIÓN NEGATIVA:
${negMuniBlock}

TAREA:
Devuelve un objeto JSON con cinco campos: \`narrative_html\`, \`dominant_signal\`, \`action_label\`, \`action_tone\`, \`reach_label\`.

1. \`narrative_html\` (2 a 4 oraciones, máximo 110 palabras) — di de qué se queja la gente en concreto, no solo qué tópico concentra la negatividad:
   - Si banda actual es **NORMAL** (score < 0.25 y negShare < 30%): abre con "Sin señales de crisis en el periodo." y completa con el negShare absoluto y el tópico/municipio de mayor share negativo (sin presentarlo como amenaza).
   - Si banda es **ELEVADO**: abre con "Se observan señales elevadas en <tópico>..." y describe el % negativo y volumen, sin escalar.
   - Si banda es **ALERTA** o **CRISIS**: nombra el tópico/municipio de mayor concentración negativa y cuantifica con el score, la velocidad o el z-score. Mantén lenguaje clínico.
   Resalta nombres y números con \`<strong>\`. El límite de 110 palabras es estricto.

2. \`dominant_signal\`: "<Banda> · <Tópico crítico>" (ej. "ALERTA · Servicios básicos") o "NORMAL · Sin tópico crítico".

3. \`action_label\` (≤6 palabras, termina en "→"): "Revisar tópico crítico →" o "Ver menciones negativas →". NUNCA imperativos hacia la agencia.

4. \`action_tone\`: "neg" si banda ≥ ALERTA, "warn" si ELEVADO, "neu" si NORMAL.

5. \`reach_label\`: humaniza ${agg.totalReach} impresiones (≥1M → "X.YYM"; ≥1K → "NK"; <1K → "N").

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "narrative_html": "<oraciones con <strong> opcional>",
  "dominant_signal": "<Banda> · <Tópico>",
  "action_label": "<Etiqueta corta> →",
  "action_tone": "pos|neg|warn|neu",
  "reach_label": "<volumen humanizado>"
}
`.trim();
}

