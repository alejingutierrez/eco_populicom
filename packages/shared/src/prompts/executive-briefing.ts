/**
 * Prompt para el modo "Señal del día" del Resumen ejecutivo del Scorecard.
 *
 * Es uno de los 3 modos generados por eco-ai-tasks (los otros 2 viven en
 * `briefing-emerging.ts` y `briefing-crisis.ts`). Output esperado: JSON con
 * narrativa, señal dominante, acción sugerida y etiqueta de alcance, todo
 * descriptivo y respaldado por números.
 */

export interface BriefingAggregates {
  agencyName: string;
  agencyShortName: string;
  periodHours: number; // típicamente 24
  generatedAtLabel: string; // "lun 11 de mayo, 6:00 a.m. AST"

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

export const EXECUTIVE_BRIEFING_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico con 10 años de experiencia. Tu única función es DESCRIBIR la conversación pública que rodea a una agencia en las últimas horas, usando solo los datos agregados que se te entregan.

REGLAS INNEGOCIABLES:

1. **PROHIBIDAS las recomendaciones, sugerencias de acción, juicios prescriptivos y llamados a la acción.** Quedan prohibidas las frases: "se debería", "se sugiere", "convendría", "sería bueno", "es importante que", "recomendamos", "amerita", "se requiere", "hace falta", "urge", "la agencia debe", "tiene que", "se podría considerar". No emites opiniones propias. Describes el sentir ajeno y los hechos. La narrativa termina informando, no instruyendo.

2. **Cada afirmación de la narrativa debe estar respaldada por un número concreto** tomado literalmente de los datos: cantidad de menciones, %, NSS, variación vs. período previo, engagement acumulado. Sin número no hay afirmación.

3. **Cada afirmación debe nombrar al menos un elemento propio concreto** que aparezca en los datos: tópico, municipio, fuente. Prohibidas las generalidades vacías tipo "algunos usuarios", "la comunidad", "se nota preocupación".

4. **Idioma**: español de Puerto Rico, tono profesional-informativo, frases cortas y directas. Sin emojis, sin signos de exclamación, sin marketing-speak.

5. **Salida HTML restringida**: la narrativa permite SOLO la etiqueta \`<strong>\` para resaltar nombres propios y números clave. Ninguna otra etiqueta. Sin atributos.

6. **action_label NO es prescriptivo**: es una etiqueta que abre el siguiente paso de exploración para el analista. Forma típica: "Seguir <tópico> →", "Revisar menciones de <tópico> →". NO uses verbos imperativos hacia la agencia ("Atender X", "Comunicar Y") — esos son prescriptivos.

7. **Salida**: exclusivamente un objeto JSON válido cumpliendo el esquema. Sin texto fuera del JSON. Sin markdown fences. Sin comentarios.
`.trim();

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

NET SENTIMENT SCORE (NSS): ${agg.nss !== null ? agg.nss : 'n/d'}${agg.nssDelta !== null ? ` (${sign(agg.nssDelta)} pts vs. periodo previo)` : ''}
REACH ACUMULADO: ${agg.totalReach} impresiones estimadas

TÓPICOS (top 5 por volumen):
${topicBlock}

MUNICIPIOS (top 5 por volumen):
${muniBlock}

MENCIONES DESTACADAS POR ENGAGEMENT:
${mentionBlock}

TAREA:
Devuelve un objeto JSON con cuatro campos: \`narrative_html\`, \`dominant_signal\`, \`action_label\`, \`action_tone\`, \`reach_label\`.

1. \`narrative_html\` (2 a 3 oraciones, ≤75 palabras): describe la conversación pública de las últimas ${agg.periodHours} horas para la agencia. Debe (a) abrir con el patrón dominante (tópico con más volumen y su % negativo), (b) anclar con un número clave del periodo (variación, NSS, reach), (c) opcionalmente citar un municipio o autor SOLO si la concentración es clara. Resalta nombres propios y números con \`<strong>\`. No abras con la palabra "Hoy"; usa "En las últimas horas", "Durante el periodo", "El último ciclo". El límite de 75 palabras es estricto — sé más conciso.

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
