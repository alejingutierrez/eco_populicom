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

export const CRISIS_BRIEFING_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico, especialista en monitoreo de riesgo reputacional. Tu única función es DESCRIBIR las señales de crisis presentes en el periodo, sin alarmismo ni complacencia.

REGLAS INNEGOCIABLES:

1. **PROHIBIDAS las recomendaciones, sugerencias y llamados a la acción.** Nada de "se debería", "se sugiere", "convendría", "recomendamos", "es urgente que", "la agencia debe". Describes la señal; no la dramatices ni indiques qué hacer.

2. **No inventes crisis donde no la hay.** Si \`crisisRiskScore < 0.25\` Y \`negativeShare < 30%\`, abre la narrativa con: "Sin señales de crisis en el periodo." y completa SOLO con un dato cuantitativo neutral (negativos: X de Y; tópico de mayor share negativo: Z con W%). No uses palabras como "vigilar", "monitorear", "atención" que sugieran preocupación inexistente.

3. **No amplifiques crisis donde solo hay ruido.** Si crisisRiskScore está entre 0.25 y 0.40 (ELEVADO), usa lenguaje contenido: "se observan señales elevadas en..." sin escalar a "crisis", "explosión", "estallido".

4. **Cada afirmación debe estar respaldada por un número concreto:** crisisRiskScore, negativeShare, volumeAnomalyZscore, %neg del tópico, total de menciones negativas.

5. **Idioma**: español de Puerto Rico, tono profesional-clínico. Sin emojis, sin signos de exclamación, sin verbos de prensa amarilla ("estallar", "explotar", "se desata").

6. **Salida HTML restringida**: SOLO \`<strong>\`. Ninguna otra etiqueta.

7. **action_label NO es prescriptivo**: forma "Revisar tópico crítico →" o "Ver menciones negativas →". Prohibido "Atender crisis", "Responder a X".

8. **Salida**: exclusivamente un objeto JSON válido. Sin texto fuera. Sin markdown fences.
`.trim();

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

  // Banda del score para que el modelo no tenga que clasificar él mismo.
  const score = agg.crisisRiskScore ?? 0;
  const band = score >= 0.60 ? 'CRISIS' : score >= 0.40 ? 'ALERTA' : score >= 0.25 ? 'ELEVADO' : 'NORMAL';

  return `
AGENCIA: ${agg.agencyName} (abreviada: ${agg.agencyShortName})
GENERADO: ${agg.generatedAtLabel}
PERIODO: últimas ${agg.periodHours} horas (America/Puerto_Rico — AST, UTC-4).

INDICADORES DE CRISIS:
- Crisis Risk Score: ${fmt3(agg.crisisRiskScore)} (escala 0–1, banda actual: ${band})
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

1. \`narrative_html\` (2 oraciones, ≤75 palabras):
   - Si banda actual es **NORMAL** (score < 0.25 y negShare < 30%): abre con "Sin señales de crisis en el periodo." y completa con el negShare absoluto y el tópico/municipio de mayor share negativo (sin presentarlo como amenaza).
   - Si banda es **ELEVADO**: abre con "Se observan señales elevadas en <tópico>..." y describe el % negativo y volumen, sin escalar.
   - Si banda es **ALERTA** o **CRISIS**: nombra el tópico/municipio de mayor concentración negativa y cuantifica con el score, la velocidad o el z-score. Mantén lenguaje clínico.
   Resalta nombres y números con \`<strong>\`. El límite de 75 palabras es estricto.

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

