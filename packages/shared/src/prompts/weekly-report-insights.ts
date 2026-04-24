/**
 * Prompts para generación del reporte semanal (últimos 7 días)
 *
 * Se ejecutan con Claude (AWS Bedrock). Todos los prompts son descriptivos:
 * describen, cuantifican y contextualizan la conversación. Nunca ofrecen
 * recomendaciones, sugerencias de acción ni juicios prescriptivos.
 */

export interface MentionSample {
  id: string;
  createdAt: string;                 // ISO
  text: string;                      // título + snippet
  sentiment: 'negative' | 'neutral' | 'positive';
  topic?: string | null;             // nombre humano del tópico
  subtopic?: string | null;
  municipality?: string | null;
  author?: string | null;
  source?: string | null;            // nombre de la fuente/medio
  url?: string | null;
  engagement?: number | null;        // likes+comments+shares
  pageType?: string | null;          // e.g. "twitter", "news", "facebook"
  pertinence?: 'alta' | 'media' | 'baja' | null;
  emotions?: string[];               // e.g. ["frustración","enojo"]
}

export interface WeeklyAggregates {
  periodStart: string;               // YYYY-MM-DD (inclusive)
  periodEnd: string;                 // YYYY-MM-DD (inclusive)
  agencyName: string;
  agencyShortName: string;           // e.g. "DDEC"
  totals: {
    negative: number;
    neutral: number;
    positive: number;
    total: number;
  };
  deltaVsPrevWeek: {
    negative: number;                // porcentaje
    neutral: number;
    positive: number;
  };
  dailySeries: Array<{
    date: string;                    // YYYY-MM-DD
    negative: number;
    neutral: number;
    positive: number;
  }>;
  byTopic: Array<{
    topic: string;
    subtopics: string[];
    total: number;
    negative: number;
    neutral: number;
    positive: number;
  }>;
  byMunicipality: Array<{
    municipality: string;
    total: number;
    negative: number;
  }>;
  /** Top 5 autores por volumen en el periodo — útil para dar nombres propios en insights. */
  topAuthors?: Array<{ author: string; mentions: number; sentiment: 'negative' | 'neutral' | 'positive' }>;
  /** Top 5 fuentes/medios por volumen. */
  topSources?: Array<{ source: string; mentions: number }>;
  /** Emociones agregadas de la semana (top 5). */
  topEmotions?: Array<{ emotion: string; count: number }>;
}

// ============================================================
// SYSTEM PROMPT — guardrails compartidos
// ============================================================

export const INSIGHTS_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico con 10 años de experiencia cubriendo agencias públicas. Tu única función es DESCRIBIR, CUANTIFICAR y CONTEXTUALIZAR lo que la audiencia está diciendo, usando SOLO los datos agregados y las menciones de muestra que te entregan.

REGLAS INNEGOCIABLES (violaciones anulan la respuesta):

1. **PROHIBIDAS las recomendaciones, sugerencias de acción, consejos, juicios prescriptivos y llamados a la acción.** Quedan prohibidas las frases: "se debería", "se sugiere", "convendría", "sería bueno", "es importante que", "recomendamos", "amerita", "se requiere", "hace falta", "urge", "la agencia debe/tiene que", "se podría considerar". No ofrezcas opiniones propias sobre la agencia ni sobre el gobierno; reporta el sentir ajeno, no el tuyo.

2. **Cada afirmación debe estar respaldada por un número concreto** tomado literalmente de los datos entregados: cantidad de menciones, porcentaje, variación vs. la semana previa, engagement acumulado, o rango de fechas. Sin número no hay afirmación.

3. **Cada afirmación debe nombrar al menos un elemento propio concreto** que aparezca en los datos: municipio ("Bayamón"), tópico/subtópico ("facturación · cobros indebidos"), autor destacado, medio/fuente, o fecha específica. Prohibidas las generalidades vacías tipo "algunos usuarios", "la comunidad", "se nota preocupación".

4. **Idioma**: español de Puerto Rico, tono profesional-informativo, frases cortas y directas. Sin emojis, sin signos de exclamación, sin marketing-speak.

5. **Consistencia entre ejecuciones**: si los datos de esta semana son similares a otra ejecución con los mismos datos, los insights deben referirse a los mismos patrones dominantes. No reordenes para parecer novedoso. Siempre prioriza (a) el tópico o subtópico con mayor volumen absoluto, (b) la variación más marcada vs. la semana previa, (c) los autores o fuentes destacadas, (d) la concentración geográfica **solo si es un patrón claro** — no fuerces menciones geográficas cuando los datos no lo ameriten.

6. **Si los datos no alcanzan** para un insight contextualizado con número + nombre propio, entrega menos insights. Nunca inventes municipios, tópicos, autores ni fuentes que no aparezcan en los datos. Nunca extrapoles a "sectores rurales", "clase media", "clase política", etc., si no está explícito.

7. **Salida**: exclusivamente un objeto JSON válido que cumpla el esquema pedido. Sin texto fuera del JSON. Sin markdown fences. Sin comentarios.

EJEMPLOS DE INSIGHTS ACEPTABLES (referenciales):
- "Reclamos por cortes prolongados de agua se concentran en Bayamón (142 menciones), Toa Baja (89) y Carolina (67), con crecimiento de +34% vs. la semana previa; el pico ocurre del 19 al 21 de abril."
- "Cuestionamientos sobre facturación (184 menciones, 80% con sentimiento negativo) citan específicamente cobros sin suministro efectivo y ajustes pendientes; el autor @usuariopr lidera con 12 menciones."

EJEMPLOS DE INSIGHTS INACEPTABLES (rechazar):
- "Se debería mejorar la comunicación con la ciudadanía." ← prescriptivo.
- "La comunidad está preocupada por el servicio." ← sin número, sin nombre propio.
- "Hay una tendencia al alza de menciones negativas." ← sin número, sin tópico.
- "Es importante atender los reclamos del área metropolitana." ← prescriptivo + sin dato.
`.trim();

// ============================================================
// PROMPT 1 — Insights por sentimiento (3 bloques de 3 insights)
// ============================================================

export function buildSentimentInsightsPrompt(
  aggregates: WeeklyAggregates,
  samples: {
    negative: MentionSample[];
    neutral: MentionSample[];
    positive: MentionSample[];
  },
): string {
  const { periodStart, periodEnd, totals, deltaVsPrevWeek, agencyName, agencyShortName } = aggregates;

  const topicBlock = aggregates.byTopic.slice(0, 10).map((t) => {
    const subs = t.subtopics.length ? ` [${t.subtopics.join(', ')}]` : '';
    const pctNeg = t.total > 0 ? Math.round((t.negative / t.total) * 100) : 0;
    return `- ${t.topic}${subs}: total=${t.total}, neg=${t.negative} (${pctNeg}%), neu=${t.neutral}, pos=${t.positive}`;
  }).join('\n');

  const muniBlock = aggregates.byMunicipality.slice(0, 15)
    .map((m) => `- ${m.municipality}: ${m.total} menciones / ${m.negative} negativas`).join('\n');

  const authorBlock = (aggregates.topAuthors ?? []).slice(0, 8)
    .map((a) => `- ${a.author}: ${a.mentions} menciones (sentimiento dominante: ${translateSentiment(a.sentiment)})`)
    .join('\n') || '- (sin datos)';

  const sourceBlock = (aggregates.topSources ?? []).slice(0, 8)
    .map((s) => `- ${s.source}: ${s.mentions} menciones`)
    .join('\n') || '- (sin datos)';

  const emotionBlock = (aggregates.topEmotions ?? []).slice(0, 6)
    .map((e) => `- ${e.emotion}: ${e.count} menciones`).join('\n') || '- (sin datos)';

  return `
AGENCIA: ${agencyName} (abreviada: ${agencyShortName})
PERIODO ANALIZADO: ${periodStart} al ${periodEnd} (7 días naturales, zona horaria America/Bogota).

TOTALES DEL PERIODO:
- Negativo: ${totals.negative} menciones (${pct(totals.negative, totals.total)}% del total, ${signed(deltaVsPrevWeek.negative)}% vs. los 7 días previos)
- Neutral:  ${totals.neutral}  menciones (${pct(totals.neutral, totals.total)}%, ${signed(deltaVsPrevWeek.neutral)}% vs. previo)
- Positivo: ${totals.positive} menciones (${pct(totals.positive, totals.total)}%, ${signed(deltaVsPrevWeek.positive)}% vs. previo)
- Total:    ${totals.total}

VOLUMEN DIARIO (todas las menciones por fecha y sentimiento):
${aggregates.dailySeries.map((d) => `- ${d.date}: neg=${d.negative}, neu=${d.neutral}, pos=${d.positive} (total ${d.negative + d.neutral + d.positive})`).join('\n')}

DESGLOSE POR TÓPICO (ordenado por volumen descendente):
${topicBlock || '- (sin menciones clasificadas por tópico)'}

CONCENTRACIÓN GEOGRÁFICA (top municipios):
${muniBlock || '- (sin datos geográficos)'}

AUTORES DESTACADOS (top por volumen):
${authorBlock}

FUENTES / MEDIOS (top por volumen):
${sourceBlock}

EMOCIONES AGREGADAS DEL PERIODO (detectadas por análisis NLP):
${emotionBlock}

MUESTRAS DE MENCIONES (seleccionadas por relevancia y engagement; hay más menciones en los agregados de arriba):

--- MUESTRAS NEGATIVAS (${samples.negative.length}) ---
${samples.negative.map((m, i) => formatSample(i + 1, m)).join('\n')}

--- MUESTRAS NEUTRALES (${samples.neutral.length}) ---
${samples.neutral.map((m, i) => formatSample(i + 1, m)).join('\n')}

--- MUESTRAS POSITIVAS (${samples.positive.length}) ---
${samples.positive.map((m, i) => formatSample(i + 1, m)).join('\n')}

TAREA:
Genera exactamente 3 insights por cada sentimiento (negative, neutral, positive). Cada insight cumple TODOS estos criterios:
a. Una sola oración, 20–45 palabras, terminada en punto.
b. Al menos un número concreto (conteo, %, o variación) tomado LITERALMENTE de los datos.
c. Al menos un nombre propio presente en los datos — priorizando en este orden: **tópico/subtópico**, **autor destacado**, **medio/fuente**, y solo si aplica claramente, municipio. Los nombres deben coincidir exactamente con los datos (respeta acentos y capitalización).
d. Describe un patrón, no una opinión. Prohibida cualquier recomendación o sugerencia (ver reglas del sistema).

ORDEN DE PRIORIZACIÓN DE INSIGHTS (aplica dentro de cada bloque de sentimiento):
1. **Tópicos y subtópicos de conversación** — el insight más importante siempre describe el tópico/subtópico con más volumen, qué está diciendo la audiencia en él, y su variación vs. semana previa.
2. **Tendencia temporal** — variación fuerte vs. los 7 días previos, aceleración o caída en el volumen, concentración en días específicos del periodo.
3. **Autores o fuentes destacadas** — si un autor individual o un medio concentra una porción notable de menciones, menciónalo con nombre y número.
4. **Geografía (opcional)** — incluye municipios SOLO cuando hay una concentración verdaderamente clara en 1–2 municipios (p.ej. >20% de las menciones del bloque) y agrega valor al tópico. Si los datos geográficos están dispersos o no son claros, NO fuerces un insight geográfico; usa ese espacio para otro tópico o subtópico.

Si para un sentimiento NO hay suficiente señal para 3 insights sustentados con datos, entrega menos (mínimo 0). Devuelve cadena vacía en los faltantes — no inventes.

FORMATO DE SALIDA (un único objeto JSON, sin texto adicional, sin markdown fences):
{
  "negative": ["insight 1", "insight 2", "insight 3"],
  "neutral":  ["insight 1", "insight 2", "insight 3"],
  "positive": ["insight 1", "insight 2", "insight 3"]
}
`.trim();
}

// ============================================================
// PROMPT 2 — Resumen del día (descriptivo, sin recomendaciones)
// ============================================================

export function buildDailySummaryPrompt(
  aggregates: WeeklyAggregates,
  todaySamples: MentionSample[],
  todayDate: string,
): string {
  const today = aggregates.dailySeries.find((d) => d.date === todayDate);
  const totalToday = today ? today.negative + today.neutral + today.positive : 0;
  const idxToday = aggregates.dailySeries.findIndex((d) => d.date === todayDate);
  const prevDay = idxToday > 0 ? aggregates.dailySeries[idxToday - 1] : null;
  const prevTotal = prevDay ? prevDay.negative + prevDay.neutral + prevDay.positive : 0;
  const diffPct = prevTotal > 0 ? Math.round(((totalToday - prevTotal) / prevTotal) * 100) : 0;

  return `
AGENCIA: ${aggregates.agencyName}
FECHA DEL RESUMEN: ${todayDate}
ZONA HORARIA: America/Bogota

VOLUMEN DE HOY (${todayDate}):
- Total: ${totalToday} menciones
- Negativo: ${today?.negative ?? 0}
- Neutral:  ${today?.neutral ?? 0}
- Positivo: ${today?.positive ?? 0}

COMPARACIÓN CON AYER:
- Ayer (${prevDay?.date ?? 'n/d'}): ${prevTotal} menciones
- Variación absoluta: ${totalToday - prevTotal}
- Variación porcentual: ${signed(diffPct)}%
- Posición del día dentro de los últimos 7 días: ${rankInWeek(aggregates, todayDate)}

CONTEXTO SEMANAL (serie diaria completa):
${aggregates.dailySeries.map((d) => `- ${d.date}: total=${d.negative + d.neutral + d.positive}, neg=${d.negative}`).join('\n')}

TOP TÓPICOS DE LA SEMANA (para identificar lo estructural vs. lo coyuntural):
${aggregates.byTopic.slice(0, 5).map((t) => `- ${t.topic}: ${t.total} (neg ${t.negative})`).join('\n') || '- (sin datos)'}

MUESTRAS DEL DÍA ${todayDate} (seleccionadas por engagement):
${todaySamples.map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA:
Redacta un párrafo ÚNICO de 3 a 5 oraciones resumiendo la jornada de hoy (${todayDate}) para ${aggregates.agencyName}. Debe:
1. Indicar el volumen total de menciones del día y qué sentimiento dominó (con % explícito).
2. Señalar en qué **1–3 tópicos de conversación concretos** se concentró el día, citando el número de menciones por tópico. Menciona municipios SOLO si un tópico específico se concentra claramente en 1–2 municipios; no fuerces geografía.
3. Ubicar el día en la tendencia semanal: si el volumen aceleró, se mantuvo o bajó, con la variación porcentual exacta vs. ayer.
4. Mencionar un hecho específico de las muestras del día (un tópico con alza inusual, una mención destacada identificable, una fuente/medio prominente) — con número asociado.
5. Puedes incorporar etiquetas HTML inline muy limitadas: solo <strong> para resaltar nombres propios y números clave. Sin otras etiquetas.

PROHIBIDO: recomendaciones, sugerencias, consejos, "se debería", "conviene", "es importante que", llamados a la acción, juicios morales, opiniones propias.

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "summary": "<párrafo de 3 a 5 oraciones>"
}
`.trim();
}

// ============================================================
// Utilidades locales de formato
// ============================================================

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function signed(n: number): string {
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

function translateSentiment(s: 'negative' | 'neutral' | 'positive'): string {
  if (s === 'negative') return 'negativo';
  if (s === 'positive') return 'positivo';
  return 'neutral';
}

function formatSample(i: number, m: MentionSample): string {
  const clean = m.text.replace(/\s+/g, ' ').trim().slice(0, 320);
  const dateShort = m.createdAt.slice(0, 10);
  const meta = [
    m.municipality ? `muni=${m.municipality}` : null,
    m.topic ? `topic=${m.topic}` : null,
    m.subtopic ? `sub=${m.subtopic}` : null,
    m.source ? `src=${m.source}` : null,
    m.author ? `autor=${m.author}` : null,
    m.pageType ? `tipo=${m.pageType}` : null,
    typeof m.engagement === 'number' ? `eng=${m.engagement}` : null,
    m.pertinence ? `pert=${m.pertinence}` : null,
    m.emotions && m.emotions.length ? `emo=${m.emotions.join('|')}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return `${i}. (${dateShort} | ${meta}) "${clean}"`;
}

function rankInWeek(agg: WeeklyAggregates, date: string): string {
  const sorted = [...agg.dailySeries]
    .map((d) => ({ date: d.date, total: d.negative + d.neutral + d.positive }))
    .sort((a, b) => b.total - a.total);
  const idx = sorted.findIndex((d) => d.date === date);
  if (idx === 0) return 'el volumen MÁS ALTO de los últimos 7 días';
  if (idx === sorted.length - 1) return 'el volumen MÁS BAJO de los últimos 7 días';
  return `posición ${idx + 1} de ${sorted.length} por volumen en los últimos 7 días`;
}
