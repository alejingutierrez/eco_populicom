/**
 * Prompt para el modo "Señal del día" del Resumen ejecutivo del Scorecard.
 *
 * Es uno de los 3 modos generados por eco-ai-tasks (los otros 2 viven en
 * `briefing-emerging.ts` y `briefing-crisis.ts`). Output esperado: JSON con
 * narrativa, señal dominante, acción sugerida y etiqueta de alcance, todo
 * descriptivo y respaldado por números.
 */

import { bandWord, nssBand } from '../format/metrics-display';
import { ECO_ANALYST_ROLE, HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

/**
 * Nivel de base ("típico") para contextualizar el periodo corto (24h) contra el
 * comportamiento habitual de la agencia. Permite que el briefing sea coyuntural
 * ("subió vs. su nivel típico de 7 días") sin perder el ancla de base.
 */
export interface BriefingBaseline {
  /** Días de la ventana base (7 o 30). */
  windowDays: number;
  /** Volumen diario promedio en la ventana base. */
  avgDailyVolume: number | null;
  /** NSS promedio de la ventana base (−100..100). */
  avgNss: number | null;
}

export interface BriefingAggregates {
  agencyName: string;
  agencyShortName: string;
  periodHours: number; // típicamente 24
  generatedAtLabel: string; // "lun 11 de mayo, 6:00 a.m. AST"

  /** Nivel típico de 7 días (avg diario + NSS) para contexto coyuntural. Opcional. */
  baseline7d?: BriefingBaseline | null;
  /** Nivel típico de 30 días (opcional, contexto de más largo plazo). */
  baseline30d?: BriefingBaseline | null;

  totals: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  };

  /** Mismo período pero el "anterior" — para variación. */
  prevTotals: {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  };

  nss: number | null;
  nssDelta: number | null;

  /** Suma de reach_estimate del período. */
  totalReach: number;

  /** Top 5 tópicos ordenados por volumen. */
  byTopic: Array<{
    topic: string;
    total: number;
    positive: number;
    neutral: number;
    negative: number;
  }>;

  /** Top 5 municipios ordenados por volumen. */
  byMunicipality: Array<{
    municipality: string;
    total: number;
    negative: number;
  }>;

  /** Top 3 menciones por engagement para anclar la narrativa. */
  topMentions: Array<{
    text: string;
    sentiment: 'positivo' | 'neutral' | 'negativo';
    topic?: string | null;
    municipality?: string | null;
    source?: string | null;
    engagement: number;
  }>;
}

export interface BriefingOutput {
  /** Narrativa en HTML con <strong> permitido para resaltar nombres/números. 2-4 oraciones. */
  narrative_html: string;
  /** "Tópico · Tono" — ej. "Infraestructura vial · Negativa". */
  dominant_signal: string;
  /** Frase corta tipo CTA. Sin imperativo prescriptivo. Ej: "Seguir infraestructura vial →". */
  action_label: string;
  /** pos | neg | warn | neu — controla color del CTA en UI. */
  action_tone: 'pos' | 'neg' | 'warn' | 'neu';
  /** Etiqueta legible del alcance: "2.34M impresiones", "412K impresiones". */
  reach_label: string;
}

export const EXECUTIVE_BRIEFING_SYSTEM_PROMPT = /* @__PURE__ */ buildSystemPrompt(
  ECO_ANALYST_ROLE,
  `
- Este texto vive en una tarjeta del Scorecard, con los números ya impresos al
  lado. No los repitas: cuenta la historia que los números no cuentan.
- El tope es de 110 palabras y caben DOS ideas: qué pasó, y la reacción o el
  contexto que lo completa. Antes el tope era de 75 palabras y eso obligaba a
  comprimir en categorías de analista — de ahí salía la jerga. Con 110 no hay
  excusa para escribir "patrón estructural" en vez de explicarlo.
- Mejor una idea bien contada que tres comprimidas. Si solo hay una, entrega una.
- ${HTML_INLINE_RULE}
`,
);

export function buildExecutiveBriefingPrompt(agg: BriefingAggregates): string {
  const pct = (n: number, t: number) => (t > 0 ? Math.round((n / t) * 100) : 0);
  const sign = (n: number | null) => {
    if (n === null) return 'n/d';
    const r = Math.round(n * 10) / 10;
    return r > 0 ? `+${r}` : `${r}`;
  };

  const deltaPct = agg.prevTotals.total > 0
    ? Math.round(((agg.totals.total - agg.prevTotals.total) / agg.prevTotals.total) * 100)
    : null;

  // Palabra cualitativa del NSS (single source: format/metrics-display) para que
  // el briefing use el mismo vocabulario que el KpiCard.
  const nssWord = agg.nss != null ? bandWord('nss', nssBand(agg.nss)) : null;

  // Contexto coyuntural: el periodo de 24h vs. el nivel TÍPICO de 7d (y 30d si
  // está). Comparar el volumen del día contra el promedio diario base y el NSS
  // del día contra el NSS promedio base.
  const dayVolume = agg.totals.total;
  const baselineLine = (b: BriefingBaseline | null | undefined, label: string): string | null => {
    if (!b || b.avgDailyVolume == null) return null;
    const avg = b.avgDailyVolume;
    const volDelta = avg > 0 ? Math.round(((dayVolume - avg) / avg) * 100) : null;
    const volPart = volDelta != null
      ? `volumen del periodo ${dayVolume} vs. ~${Math.round(avg)}/día típico (${volDelta > 0 ? '+' : ''}${volDelta}%)`
      : `volumen del periodo ${dayVolume} (sin base ${label} comparable)`;
    const nssPart = b.avgNss != null && agg.nss != null
      ? `; NSS ${sign(agg.nss)} vs. ~${sign(b.avgNss)} típico`
      : '';
    return `- Nivel típico de ${label}: ${volPart}${nssPart}`;
  };
  const baselineBlock = [baselineLine(agg.baseline7d, '7 días'), baselineLine(agg.baseline30d, '30 días')]
    .filter(Boolean)
    .join('\n');

  const topicBlock = agg.byTopic.length > 0
    ? agg.byTopic.map((t) => `- ${t.topic}: ${t.total} menciones (neg ${t.negative} / ${pct(t.negative, t.total)}%, neu ${t.neutral}, pos ${t.positive})`).join('\n')
    : '- (sin menciones clasificadas por tópico en el periodo)';

  const muniBlock = agg.byMunicipality.length > 0
    ? agg.byMunicipality.map((m) => `- ${m.municipality}: ${m.total} menciones / ${m.negative} negativas`).join('\n')
    : '- (sin concentración geográfica detectada)';

  const mentionBlock = agg.topMentions.length > 0
    ? agg.topMentions.map((m, i) => {
        const clean = m.text.replace(/\s+/g, ' ').trim().slice(0, 240);
        const meta = [
          m.topic ? `topic=${m.topic}` : null,
          m.municipality ? `muni=${m.municipality}` : null,
          m.source ? `src=${m.source}` : null,
          `sent=${m.sentiment}`,
          `eng=${m.engagement}`,
        ].filter(Boolean).join(' ');
        return `${i + 1}. (${meta}) "${clean}"`;
      }).join('\n')
    : '- (sin muestras destacadas)';

  return `
AGENCIA: ${agg.agencyName} (abreviada: ${agg.agencyShortName})
GENERADO: ${agg.generatedAtLabel}
PERIODO: últimas ${agg.periodHours} horas (America/Puerto_Rico — AST, UTC-4 sin DST).

TOTALES DEL PERIODO:
- Total: ${agg.totals.total} menciones${deltaPct !== null ? ` (${deltaPct > 0 ? '+' : ''}${deltaPct}% vs. ${agg.periodHours}h previas — ${agg.prevTotals.total} menciones)` : ''}
- Negativo: ${agg.totals.negative} (${pct(agg.totals.negative, agg.totals.total)}%)
- Neutral:  ${agg.totals.neutral}  (${pct(agg.totals.neutral, agg.totals.total)}%)
- Positivo: ${agg.totals.positive} (${pct(agg.totals.positive, agg.totals.total)}%)

NET SENTIMENT SCORE (NSS): ${agg.nss !== null ? agg.nss : 'n/d'}${nssWord ? ` (${nssWord})` : ''}${agg.nssDelta !== null ? ` (${sign(agg.nssDelta)} pts vs. periodo previo)` : ''}
REACH ACUMULADO: ${agg.totalReach} impresiones estimadas
${baselineBlock ? `\nNIVEL TÍPICO (base de comparación):\n${baselineBlock}\n` : ''}
TÓPICOS (top 5 por volumen):
${topicBlock}

MUNICIPIOS (top 5 por volumen):
${muniBlock}

MENCIONES DESTACADAS POR ENGAGEMENT:
${mentionBlock}

TAREA:
Devuelve un objeto JSON con cuatro campos: \`narrative_html\`, \`dominant_signal\`, \`action_label\`, \`action_tone\`, \`reach_label\`.

1. \`narrative_html\` (2 a 4 oraciones, máximo 110 palabras): cuenta qué está pasando en la conversación de la agencia. Dos ideas como mucho:
   - La PRIMERA es el hecho: qué se dijo, quién lo dijo o qué evento lo produjo. Sale de las menciones destacadas, no de la tabla de tópicos.
   - La SEGUNDA completa el cuadro: la reacción que provocó, quién más se sumó, o cómo se compara con lo habitual de esta agencia si tienes su nivel típico.
   Ancla con un número, no más de dos en todo el texto. No abras con "Hoy" ni con una cifra: usa "En las últimas horas", "Durante el periodo".

2. \`dominant_signal\` (texto plano): "<Tópico dominante> · <Tono>" — donde Tono es "Positiva", "Negativa", "Mixta" o "Neutral" según el balance del tópico dominante. Si no hay tópico claro, "Sin señal dominante · Neutral".

3. \`action_label\` (texto plano, ≤6 palabras, termina en "→"): etiqueta para abrir la siguiente vista del dashboard. Ejemplos válidos: "Seguir infraestructura vial →", "Revisar menciones de servicios →", "Explorar tópicos activos →". PROHIBIDO el imperativo hacia la agencia ("Atender X", "Comunicar Y", "Responder Z").

4. \`action_tone\`: uno de "pos" | "neg" | "warn" | "neu". Asigna "neg" si la narrativa describe un patrón mayormente negativo (>50% del tópico dominante), "warn" si es mixto pero con negatividad creciente, "pos" si dominan menciones positivas, "neu" si el periodo es estable e informativo.

5. \`reach_label\` (texto plano corto): humaniza ${agg.totalReach} impresiones. Reglas: ≥1,000,000 → "X.YYM impresiones" (dos decimales); ≥1,000 → "NK impresiones" (entero); <1,000 → "N impresiones".

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "narrative_html": "<oraciones con <strong> opcional>",
  "dominant_signal": "<Tópico> · <Tono>",
  "action_label": "<Etiqueta corta> →",
  "action_tone": "pos|neg|warn|neu",
  "reach_label": "<volumen humanizado>"
}
`.trim();
}
