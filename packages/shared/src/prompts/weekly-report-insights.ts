/**
 * Prompts para generación del reporte diario (ventana de 7 días).
 *
 * Se ejecutan con Claude (AWS Bedrock). El estilo lo fija la constitución
 * editorial compartida (`./constitution`); aquí solo vive lo propio de cada
 * texto: qué tiene que contar y en qué forma sale.
 *
 * Reescritos en ago 2026 tras la ronda de moldes con el cliente. El resumen del
 * día pasó de un párrafo único de 120–160 palabras a titular + párrafo corto +
 * viñetas que explican (la «opción B»); los insights conservan los tres bloques
 * por sentimiento (la «opción A») porque la plantilla del correo ya los tiene
 * pintados de color.
 */
import { formatLongDay, formatPromptDay, formatPromptDayOfInstant } from '../format-period';
import { ymdInTimeZone } from '../dates';
import {
  ECO_ANALYST_ROLE,
  HTML_INLINE_RULE,
  buildSystemPrompt,
  resolveEditorialRules,
  type EditorialRulesVersion,
  type PromptLanguageOptions,
} from './constitution';

/**
 * Tipo de mención (spec de interpretación v1, sección 5.1; columna
 * `mentions.mention_kind`). Lo calcula el processor (WP-2); aquí solo se
 * imprime para que el modelo sepa qué está leyendo.
 */
export type SampleMentionKind = 'article' | 'agency_post' | 'comment' | 'third_party_post';

/** Publicación original a la que responde un comentario. */
export interface MentionSampleParent {
  /** Texto (o inicio del texto) de la publicación original. */
  text?: string | null;
  /** ISO de la publicación original (`mentions.parent_published_at`). */
  publishedAt?: string | null;
  /** Autor o página de la publicación original. */
  author?: string | null;
  /** true si la publicación original es de una página de la propia agencia. */
  isAgency?: boolean | null;
}

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
  // ---- Anotaciones (nov 2026, WP-5). Todas opcionales: una muestra sin ellas
  // ---- se imprime EXACTAMENTE como antes.
  /** Tipo de mención. Con `comment`, `text` debe ser el comentario solo (sin el post padre). */
  kind?: SampleMentionKind | null;
  /** Para comentarios: la publicación original, con su fecha. */
  parent?: MentionSampleParent | null;
  /** Comentarios adicionales a la misma publicación ese día que no se muestran (tope por hilo). */
  moreInThread?: number | null;
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

/**
 * System prompt del correo diario, del semanal y del resumen del periodo, en la
 * versión de reglas pedida. `INSIGHTS_SYSTEM_PROMPT` es esta función con la
 * versión del proceso (`ECO_EDITORIAL_RULES`; `v1` si no está).
 */
export function buildInsightsSystemPrompt(rules?: EditorialRulesVersion | null): string {
  return buildSystemPrompt(
    ECO_ANALYST_ROLE,
    `
- Estos textos van dentro de un correo que el lector abre en el teléfono a las
  6 de la mañana. Cada oración tiene que ganarse el espacio.
- ${HTML_INLINE_RULE}
- No repitas entre bloques el mismo hecho con otras palabras. Si dos bloques
  cuentan lo mismo, uno de los dos sobra: entrega menos.
`,
    rules,
  );
}

export const INSIGHTS_SYSTEM_PROMPT = /* @__PURE__ */ buildInsightsSystemPrompt();

// ============================================================
// PROMPT 1 — Insights por sentimiento (3 bloques de hasta 2 insights)
// ============================================================

export function buildSentimentInsightsPrompt(
  aggregates: WeeklyAggregates,
  samples: {
    negative: MentionSample[];
    neutral: MentionSample[];
    positive: MentionSample[];
  },
  opts: PromptLanguageOptions = {},
): string {
  const v2 = resolveEditorialRules(opts.rules) === 'v2';
  const { periodStart, periodEnd, totals, deltaVsPrevWeek, agencyName, agencyShortName } = aggregates;
  const legend = mentionSamplesLegend([...samples.negative, ...samples.neutral, ...samples.positive]);

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
PERIODO ANALIZADO: ${periodStart} al ${periodEnd} (7 días naturales cerrados, zona horaria America/Puerto_Rico — AST, UTC-4 sin DST). El reporte se envía a las 6:00 a.m. AST y NO incluye el día actual; el día más reciente del periodo es el de ayer cerrado completo.

NOTA SOBRE PERTINENCIA: las muestras de menciones que recibes a continuación están pre-filtradas a pertinencia 'alta' o 'media' por el NLP — son las relevantes para la agencia. Las menciones de pertinencia 'baja' SÍ están contadas en los totales del termómetro y la tendencia diaria (para mantener paridad con el dashboard), pero NO debes inventar insights sobre ellas porque no son señal — son ruido. Si describes el volumen total, descríbelo tal cual; no especules sobre lo que dicen las de baja pertinencia.

TOTALES DEL PERIODO:
- Negativo: ${totals.negative} menciones (${pct(totals.negative, totals.total)}% del total, ${signed(deltaVsPrevWeek.negative)}% vs. los 7 días previos)
- Neutral:  ${totals.neutral}  menciones (${pct(totals.neutral, totals.total)}%, ${signed(deltaVsPrevWeek.neutral)}% vs. previo)
- Positivo: ${totals.positive} menciones (${pct(totals.positive, totals.total)}%, ${signed(deltaVsPrevWeek.positive)}% vs. previo)
- Total:    ${totals.total}

VOLUMEN DIARIO (todas las menciones por fecha y sentimiento):
${aggregates.dailySeries.map((d) => `- ${formatPromptDay(d.date)}: neg=${d.negative}, neu=${d.neutral}, pos=${d.positive} (total ${d.negative + d.neutral + d.positive})`).join('\n')}

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

${legend}MUESTRAS DE MENCIONES (pre-filtradas a pertinencia 'alta' o 'media' — solo señal, sin ruido. Hay más menciones contadas en los agregados de arriba que NO aparecen aquí porque su pertinencia es baja o aún no fue evaluada; ignóralas para insights):

--- MUESTRAS NEGATIVAS (${samples.negative.length}) ---
${samples.negative.map((m, i) => formatSample(i + 1, m)).join('\n')}

--- MUESTRAS NEUTRALES (${samples.neutral.length}) ---
${samples.neutral.map((m, i) => formatSample(i + 1, m)).join('\n')}

--- MUESTRAS POSITIVAS (${samples.positive.length}) ---
${samples.positive.map((m, i) => formatSample(i + 1, m)).join('\n')}

TAREA — CUENTA QUÉ PASÓ EN CADA BLOQUE:
El correo pinta tres bloques de color: lo negativo, lo neutral y lo positivo. Para cada uno escribe hasta 2 frases, y cada frase tiene que contar UN HECHO — algo que alguien dijo, hizo, publicó o reclamó — con su cifra detrás como apoyo.

QUÉ CONTAR EN CADA BLOQUE:
- NEGATIVO: qué es concretamente lo que está molestando o siendo cuestionado. No "el tópico X es negativo", sino el reclamo, la denuncia o la crítica puntual, y quién la está haciendo.
- NEUTRAL: casi siempre es cobertura de prensa. Di QUÉ se cubrió y por qué eso deja el tono plano — un anuncio replicado, una transmisión en directo, un dato publicado sin opinión. El bloque neutral suele ser el más grande y hoy es el peor explicado: no lo despaches con "cobertura informativa".
- POSITIVO: quién está apoyando y desde dónde. Si el apoyo viene solo de cargos o cuentas institucionales, dilo con esas palabras: es distinto de que lo diga la gente. Si no hay menciones positivas, entrega el bloque vacío en lugar de forzar una frase.

REGLAS DE FORMA:
- Una sola oración por frase, de 20 a 45 palabras.
- Empieza por el hecho, no por el nombre del tópico ni por el conteo.
- Nombra al menos un medio, cargo público, organización o fecha concreta.
- Ninguna frase puede repetir lo que ya dijo otra, ni siquiera en otro bloque.
- Si un bloque no tiene material para 2 frases, entrega 1. Si no tiene para 1, entrega el arreglo vacío.

EJEMPLOS DE LA FORMA CORRECTA (adáptalos, no los copies):
${v2
    ? '- "Lo más criticado de la semana no fue el nombramiento sino lo que venía antes: la investigación sobre el titular saliente y los contratos de la firma cabildera recibieron críticas por su cuenta, con 78% y 89% de menciones adversas."'
    : '- "Lo más duro de la semana no es el nombramiento sino lo que venía antes: la investigación sobre el titular saliente y los contratos de la firma cabildera sostienen la crítica por su cuenta, con 78% y 89% de menciones adversas."'}
- "Los medios cubrieron el anuncio sin tomar partido: tres de cada cuatro menciones sin carga caen el lunes y el martes, cuando El Nuevo Día, Teleonce, El Vocero y Telemundo lo publicaron casi a la vez."
- "El respaldo existe pero es de coalición: las ocho menciones favorables vienen de los alcaldes de Bayamón y San Juan, la UPR y la gobernadora. Ningún ciudadano."

RECHAZA ESTAS FORMAS:
- "El tópico Nombramientos concentra 170 menciones (53%)." → es un conteo, no un hecho.
- "La negatividad tiene dos capas de naturaleza distinta." → es jerga de analista.
- "Se observa preocupación en la ciudadanía." → sin hecho, sin quién, sin número.

SALIDA: llama la herramienta con tres arreglos de cadenas — negative, neutral, positive.
`.trim();
}

// ============================================================
// PROMPT 2 — Resumen del día (descriptivo, sin recomendaciones)
// ============================================================

/** Titular, párrafo y viñetas del diario con las reglas v1 (texto congelado). */
const DAILY_PIECES_V1 = `1) "headline" — el titular. UNA oración de 8 a 16 palabras que diga lo más importante del día. Es un titular de prensa, no una etiqueta: tiene sujeto y verbo, y quien lea solo esa línea ya sabe qué pasó. Sin cifras dentro. Sin punto final.
   BIEN: "Se apaga la cobertura del nombramiento y queda el cuestionamiento"
   BIEN: "Un paro de empleados se monta sobre la crisis de agua"
   MAL:  "Resumen del día" · "Caída de 65% en el volumen" · "Gestión / Administración"

2) "paragraph" — el párrafo. De 3 a 4 oraciones (60 a 90 palabras) que EXPLIQUEN lo que anuncia el titular: qué pasó, a raíz de qué, y quién lo está diciendo. Es el único lugar del correo donde el lector puede entender la historia, así que no lo gastes repitiendo conteos. Como mucho dos cifras en todo el párrafo. Arranca por el hecho.

3) "highlights" — de 2 a 4 viñetas. CADA UNA CUENTA ALGO QUE PASÓ, con su cifra detrás como apoyo. No son etiquetas con números. Si una viñeta se puede leer entera sin entender qué pasó, rehazla. Elige entre estos ángulos los que el dato sostenga, sin forzar ninguno:
   - lo que se apagó o lo que arrancó ese día, y qué lo explica;
   - un frente que sigue vivo por su cuenta, independiente de la noticia del día;
   - quién está empujando la conversación — prensa, cargos públicos, o gente — y en qué se nota;
   - algo que NO apareció y uno esperaría que apareciera (una ausencia es un hallazgo).
   Cada viñeta: una sola oración de 20 a 40 palabras.
   BIEN: "El día más flojo de la semana fue también el más negativo: cuando se apaga la cobertura del anuncio, lo que sobrevive es la crítica."
   MAL:  "Negatividad: 54% del total, 20 de 37 menciones."

SI EL DÍA NO TIENE NOTICIA (muy pocas menciones, o ninguna historia identificable):
Dilo con todas sus letras en el titular y en el párrafo — que la agencia casi no apareció en la conversación es información útil. Entrega 2 viñetas en vez de 4. No inventes una historia para llenar el espacio.
`;

/** Titular, párrafo y viñetas del diario con las reglas v2 (spec 9.1–9.2 y 10.3). */
const DAILY_PIECES_V2 = `1) "headline" — el titular. UNA oración de 8 a 16 palabras y no más de 100 caracteres que diga quién dijo o hizo qué: el hecho más importante del día, con su sujeto y un verbo literal (dijo, pidió, exigió, informó, anunció, publicó, respondió, entregó, aprobó, criticó…). Es un enunciado factual y no busca llamar la atención: quien lea solo esa línea ya sabe qué pasó. Sin cifras (una fecha sí). Sin punto final. No puede contradecir el párrafo ni las viñetas.
   Si lo que más se comentó ese día fueron comentarios a una publicación de más de 2 días, es una reacción tardía y el titular DEBE decirlo con la fecha de esa publicación.
   Nada de verbos de fuerza, figuras ni intenciones (ley 08): si la fuente dice "queda en manos de", el titular dice eso.
   BIEN: "La Cámara pidió los contratos del programa y el secretario respondió que los entregará el viernes"
   BIEN: "El viernes llegaron comentarios tardíos a la publicación del martes 14 sobre la feria de empleo"
   BIEN: "La Fortaleza dijo que queda en manos del secretario aclarar las cifras del programa"
   MAL:  "Resumen del día" · "Caída de 65% en el volumen" · "Gestión / Administración"

2) "paragraph" — el párrafo. De 3 a 4 oraciones (60 a 90 palabras) que EXPLIQUEN lo que anuncia el titular: qué pasó, a raíz de qué, y quién lo está diciendo. Es el único lugar del correo donde el lector puede entender la historia, así que no lo gastes repitiendo conteos. Como mucho dos cifras en todo el párrafo. Arranca por el hecho. Cada opinión va con su autor o su página; un comentario a una publicación de otro día se cuenta como reacción a esa publicación, con su fecha.

3) "highlights" — de 2 a 4 viñetas. CADA UNA CUENTA ALGO QUE PASÓ, con su cifra detrás como apoyo. No son etiquetas con números. Si una viñeta se puede leer entera sin entender qué pasó, rehazla. Elige entre estos ángulos los que el dato sostenga, sin forzar ninguno:
   - lo que terminó o lo que empezó ese día, si las fechas de los datos lo muestran, y qué lo explica;
   - un asunto que sigue apareciendo por su cuenta, aparte de la noticia del día;
   - quién está hablando — prensa, cargos públicos, la propia agencia o la gente — y en qué se nota;
   - algo que no apareció, SOLO si un conteo de arriba lo muestra (por ejemplo, cero menciones negativas); que no esté entre las menciones de arriba no lo prueba.
   Cada viñeta: una sola oración de 20 a 40 palabras.
   BIEN: "Los comentarios a la publicación de la feria de empleo del martes 14 siguieron llegando el viernes, y la mayoría elogian a los negocios, no a la agencia."
   MAL:  "Negatividad: 54% del total, 20 de 37 menciones."

SI LO QUE MÁS SE COMENTÓ SON REACCIONES TARDÍAS (comentarios a publicaciones de más de 2 días):
Eso NO es un día sin noticia: el titular cuenta esas reacciones con la fecha de la publicación a la que responden, y el párrafo dice de qué publicación se trata y qué dicen los comentarios.

SI EL DÍA NO TIENE NOTICIA (muy pocas menciones, o ninguna historia identificable):
Dilo con todas sus letras en el titular y en el párrafo — que la agencia casi no apareció en la conversación es información útil. Entrega 2 viñetas en vez de 4. No inventes una historia para llenar el espacio. No digas que no hubo cobertura de prensa ni reacciones si un conteo de arriba no lo muestra.
`;

/**
 * Prompt del resumen del día (titular, párrafo y viñetas del correo diario).
 *
 * `todaySamples` puede venir anotado (`kind`, `author`, `parent` con su fecha,
 * `moreInThread`): entonces cada muestra se imprime con su tipo y, en los
 * comentarios, con la publicación original, su fecha y los días que pasaron
 * (spec 4.1: «etiquetar tipo y fecha del padre» es lo que corrige el «post de
 * hace 6 días como noticia del día»). Sin anotaciones sale como antes.
 *
 * `opts.rules` (opcional) elige la versión de las reglas de redacción; sin él
 * manda `ECO_EDITORIAL_RULES` y, si no está, `v1` (texto de antes de WP-5).
 */
export function buildDailySummaryPrompt(
  aggregates: WeeklyAggregates,
  todaySamples: MentionSample[],
  todayDate: string,
  opts: PromptLanguageOptions = {},
): string {
  const v2 = resolveEditorialRules(opts.rules) === 'v2';
  const today = aggregates.dailySeries.find((d) => d.date === todayDate);
  const totalToday = today ? today.negative + today.neutral + today.positive : 0;
  const idxToday = aggregates.dailySeries.findIndex((d) => d.date === todayDate);
  const prevDay = idxToday > 0 ? aggregates.dailySeries[idxToday - 1] : null;
  const prevTotal = prevDay ? prevDay.negative + prevDay.neutral + prevDay.positive : 0;
  const diffPct = prevTotal > 0 ? Math.round(((totalToday - prevTotal) / prevTotal) * 100) : 0;
  // El día en palabras — el modelo debe escribir "el miércoles", nunca el ISO.
  const dayLabel = formatLongDay(todayDate);
  const prevDayLabel = prevDay ? formatLongDay(prevDay.date) : null;

  return `
AGENCIA: ${aggregates.agencyName}
DÍA QUE SE RESUME: ${dayLabel} (en tu texto llámalo así, "${dayLabel}" o "el ${dayLabel.split(' ')[0]}" — NUNCA la fecha en números, NUNCA "hoy" ni "ayer"). Día calendario completo en America/Puerto_Rico. Es el último día cerrado del periodo de 7 días; el correo se entrega la mañana siguiente.

VOLUMEN DEL DÍA REPORTADO (${formatPromptDay(todayDate)}):
- Total: ${totalToday} menciones
- Negativo: ${today?.negative ?? 0}
- Neutral:  ${today?.neutral ?? 0}
- Positivo: ${today?.positive ?? 0}

COMPARACIÓN CON EL DÍA ANTERIOR:
- Día anterior (${prevDayLabel ?? 'n/d'}): ${prevTotal} menciones
- Variación absoluta: ${totalToday - prevTotal}
- Variación porcentual: ${signed(diffPct)}%
- Posición del día dentro de los últimos 7 días: ${rankInWeek(aggregates, todayDate)}

CONTEXTO SEMANAL (serie diaria completa):
${aggregates.dailySeries.map((d) => `- ${formatPromptDay(d.date)}: total=${d.negative + d.neutral + d.positive}, neg=${d.negative}`).join('\n')}

TOP TÓPICOS DE LA SEMANA (para identificar lo estructural vs. lo coyuntural):
${aggregates.byTopic.slice(0, 5).map((t) => `- ${t.topic}: ${t.total} (neg ${t.negative})`).join('\n') || '- (sin datos)'}

${mentionSamplesLegend(todaySamples)}LO QUE SE DIJO ESE DÍA (las menciones de más resonancia — úsalas para saber QUÉ pasó en concreto; no menciones jamás que son una selección):
${todaySamples.map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA — TRES PIEZAS: TITULAR, PÁRRAFO Y VIÑETAS.
Cuentas qué pasó el ${dayLabel} en la conversación pública sobre ${aggregates.agencyName}. Es lo primero que el lector ve al abrir el correo.

${v2 ? DAILY_PIECES_V2 : DAILY_PIECES_V1}
${HTML_INLINE_RULE}

SALIDA: llama la herramienta con los tres campos — headline, paragraph, highlights.
`.trim();
}

// ============================================================
// PROMPT 3 — Resumen del PERIODO (rango entero, no solo el último día)
// ============================================================
//
// Usado por el lambda eco-ai-tasks acción period-insights. Para 1D coincide
// semánticamente con el daily-summary; para 5D/7D/30D/custom describe la
// VENTANA ENTERA, no solo el último día. Mantiene los mismos guardrails
// descriptivos del INSIGHTS_SYSTEM_PROMPT.

/**
 * Día pico que el modelo debe rotular en la tendencia del Overview. Lo elige
 * el código (selectAnnotatedPeaks), no el modelo: el modelo solo nombra QUÉ
 * pasó ese día a partir de lo que se dijo.
 */
export interface PeriodPeakInput {
  /** YYYY-MM-DD en TZ PR. */
  date: string;
  total: number;
  negative: number;
  /** Las menciones de más resonancia de ese día. */
  samples: MentionSample[];
}

/** Nota candidata a foto de portada del Overview (la elige el modelo). */
export interface PeriodHeroCandidateInput {
  /** YYYY-MM-DD en TZ PR. */
  day: string;
  source: string;
  title: string;
}

/** Titular y viñetas del periodo con las reglas v1 (texto congelado). */
const PERIOD_PIECES_V1 = `1) "headline" — el titular del periodo. UNA oración de 8 a 16 palabras que diga lo más importante de la ventana. Es un titular de prensa, no una etiqueta: tiene sujeto y verbo, y quien lea solo esa línea ya sabe qué pasó. Sin cifras dentro. Sin punto final.
   BIEN: "La pesquisa del FEI contra el subsecretario domina la conversación del DDEC"
   BIEN: "Un paro de empleados se monta sobre la crisis de agua"
   MAL:  "Resumen del periodo" · "Caída de 65% en el volumen" · "Gestión / Administración"

2) "highlights" — de 2 a 4 viñetas. CADA UNA CUENTA ALGO QUE PASÓ en la ventana, con su cifra detrás como apoyo; no son etiquetas con números. Una sola oración de 20 a 40 palabras cada una. No repitas con las mismas palabras lo que ya dice el párrafo: aporta otro ángulo (un frente que sigue vivo por su cuenta, quién empuja la conversación, algo que no apareció y uno esperaría).
   BIEN: "El día más flojo de la semana fue también el más negativo: cuando se apaga la cobertura del anuncio, lo que sobrevive es la crítica."
   MAL:  "Negatividad: 54% del total, 20 de 37 menciones."
`;

/** Titular y viñetas del periodo con las reglas v2 (spec 9.1–9.2 y 10.3). */
const PERIOD_PIECES_V2 = `1) "headline" — el titular del periodo. UNA oración de 8 a 16 palabras y no más de 100 caracteres que diga quién dijo o hizo qué en la ventana: el hecho más importante, con su sujeto y un verbo literal (dijo, pidió, exigió, informó, anunció, publicó, respondió, entregó, aprobó, criticó…). Es un enunciado factual y no busca llamar la atención. Sin cifras (una fecha sí). Sin punto final. No puede contradecir el párrafo ni las viñetas. Nada de verbos de fuerza, figuras ni intenciones (ley 08).
   BIEN: "El FEI amplió la pesquisa contra el subsecretario y el DDEC respondió que colabora"
   BIEN: "La unión de empleados convocó un paro y la agencia informó que habrá servicio mínimo"
   MAL:  "Resumen del periodo" · "Caída de 65% en el volumen" · "Gestión / Administración"

2) "highlights" — de 2 a 4 viñetas. CADA UNA CUENTA ALGO QUE PASÓ en la ventana, con su cifra detrás como apoyo; no son etiquetas con números. Una sola oración de 20 a 40 palabras cada una. No repitas con las mismas palabras lo que ya dice el párrafo: aporta otro ángulo (un asunto que sigue apareciendo por su cuenta, quién está hablando, o algo que no apareció SOLO si un conteo de arriba lo muestra).
   BIEN: "El día con menos menciones de la semana fue también el más negativo: terminó la cobertura del anuncio y lo que quedó fueron las críticas al programa."
   MAL:  "Negatividad: 54% del total, 20 de 37 menciones."
`;

export function buildPeriodSummaryPrompt(
  aggregates: WeeklyAggregates,
  samples: { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] },
  peaks: PeriodPeakInput[] = [],
  heroCandidates: PeriodHeroCandidateInput[] = [],
  opts: PromptLanguageOptions = {},
): string {
  const v2 = resolveEditorialRules(opts.rules) === 'v2';
  const days = aggregates.dailySeries.length || 1;
  const { totals, deltaVsPrevWeek } = aggregates;
  const dominantTopic = aggregates.byTopic[0];
  const dominantSecondary = aggregates.byTopic[1];

  const dailyVolumeLine = aggregates.dailySeries.map((d) => {
    const t = d.negative + d.neutral + d.positive;
    return `${formatPromptDay(d.date)}=${t}`;
  }).join(' · ');

  const sampleSummary = (label: string, items: MentionSample[]): string => {
    if (items.length === 0) return `${label}: (sin muestras)`;
    return `${label}: ${items.length} muestras destacadas` +
      (items[0]?.topic ? ` (top: ${items[0].topic}${items[0].municipality ? ` · ${items[0].municipality}` : ''})` : '');
  };

  return `
AGENCIA: ${aggregates.agencyName} (abreviada: ${aggregates.agencyShortName})
VENTANA: ${aggregates.periodStart} al ${aggregates.periodEnd} (${days} ${days === 1 ? 'día' : 'días'} en TZ America/Puerto_Rico).
SCOPE: describe la VENTANA COMPLETA, NO solo el último día. El resumen debe sintetizar lo que pasó en TODO el periodo seleccionado.

TOTALES DEL PERIODO:
- Negativo: ${totals.negative} (${pct(totals.negative, totals.total)}%, ${signed(deltaVsPrevWeek.negative)}% vs ventana previa)
- Neutral:  ${totals.neutral}  (${pct(totals.neutral, totals.total)}%, ${signed(deltaVsPrevWeek.neutral)}% vs previa)
- Positivo: ${totals.positive} (${pct(totals.positive, totals.total)}%, ${signed(deltaVsPrevWeek.positive)}% vs previa)
- Total:    ${totals.total}

VOLUMEN POR DÍA DEL PERIODO:
${dailyVolumeLine}

TOP TÓPICOS DEL PERIODO:
${aggregates.byTopic.slice(0, 5).map((t) => `- ${t.topic}: ${t.total} menciones (neg ${t.negative}, pos ${t.positive})`).join('\n') || '- (sin tópicos clasificados)'}

GEOGRAFÍA (top 5 por volumen):
${aggregates.byMunicipality.slice(0, 5).map((m) => `- ${m.municipality}: ${m.total} (${m.negative} negativas)`).join('\n') || '- (sin datos geográficos)'}

AUTORES Y FUENTES DESTACADAS:
${(aggregates.topAuthors ?? []).slice(0, 3).map((a) => `- autor ${a.author}: ${a.mentions}`).join('\n') || '- (sin autores)'}
${(aggregates.topSources ?? []).slice(0, 3).map((s) => `- fuente ${s.source}: ${s.mentions}`).join('\n') || '- (sin fuentes)'}

MUESTRAS POR SENTIMIENTO:
${sampleSummary('negativas', samples.negative)}
${sampleSummary('neutrales', samples.neutral)}
${sampleSummary('positivas', samples.positive)}

TAREA — ANÁLISIS DEL PERIODO (no narración):
Redacta UN párrafo único de 3 a 5 oraciones que ANALICE el periodo ENTERO (${aggregates.periodStart} al ${aggregates.periodEnd}) para ${aggregates.agencyShortName}. Esto NO es un boletín — es un análisis. El usuario ya vio los conteos y los gráficos; lo que necesita es entender QUÉ ESTÁ PASANDO en su conversación pública.

ESTRUCTURA RECOMENDADA (puedes reordenar pero cubre los 3 planos):

1. **TENSIÓN PRINCIPAL del periodo**: ¿cuál es la dinámica central que define la ventana? (No "el sentimiento fue 60% neutral" — eso es enumeración. Sí: "el balance del periodo depende enteramente de un evento puntual de inversión extranjera; sin ese pico la conversación sería negativa". Eso es análisis.)

2. **MECANISMO + COMPARACIÓN CON VENTANA PREVIA**: ¿qué causó el comportamiento del volumen y del sentimiento? ${v2 ? 'Identifica el(los) hecho(s) concreto(s) que lo originaron y quién lo difundió (medio profesional, cuenta institucional, organización formal, activista).' : 'Identifica el(los) evento(s)-disparador concreto(s) y el(los) amplificador(es) (medio profesional, cuenta institucional, organización formal, activista).'} Conecta la acción de la agencia/contexto → la reacción cuantificable. **Si hay caídas o subidas grandes (>30%) en algún sentimiento vs la ventana previa, IDENTIFICA EXPLÍCITAMENTE qué evento del periodo previo (visible en la serie diaria) explica la diferencia** — el usuario que compara esta ventana con una más larga necesita saber qué pasó antes que ya no está pasando ahora. Ejemplo: "el -77% en negatividad refleja que el ciclo de controversia del PS 1183 (picos del 14 y 28 de abril, 324 menciones negativas combinadas) cerró sin reemplazo".

3. **POSICIÓN DE LA AGENCIA en su conversación**: ¿qué REVELA esta ventana sobre cómo se está construyendo la imagen pública de la agencia? ¿Hay narrativas en tensión (una positiva institucional vs una negativa estructural)? ¿Hay un tópico que está mutando de coyuntural a estructural? ¿Hay asimetría entre canales (negativo en LinkedIn, positivo en Facebook)?

REQUISITOS DE FORMA:
- Cita el volumen total del periodo (${totals.total}) Y la variación más significativa vs ventana previa (negativo ${signed(deltaVsPrevWeek.negative)}% / positivo ${signed(deltaVsPrevWeek.positive)}%).
- Nombra 2–3 elementos propios concretos del periodo (tópico, medio, autor, evento, municipio). No genérico.
- Cuando relevante, distingue ESTRUCTURAL (distribuido en días/autores) de COYUNTURAL (1-2 días/fuentes).
- Habla del PERIODO ("la ventana del X al Y", "los últimos N días", "la semana"). NUNCA "hoy" ni "el día reportado".
- Usa <strong>...</strong> inline para resaltar nombres propios y cifras clave. Sin otras etiquetas.

PROHIBIDO:
- "Durante la ventana X al Y, la agencia acumuló N menciones, con sentimiento predominantemente Z (M%)..." Esa apertura es ENUMERACIÓN, no análisis. Empieza por la TENSIÓN o por el MECANISMO. Los conteos vienen como soporte, no como sujeto principal.
- Recomendaciones, sugerencias, juicios prescriptivos ("se debería", "convendría", "urge").
- Hablar de la audiencia como bloque ("la ciudadanía", "el sector privado") sin identificar el actor concreto en los datos.

PIEZAS QUE ACOMPAÑAN AL PÁRRAFO (el Overview las muestra igual que el lede del correo diario):

${v2 ? PERIOD_PIECES_V2 : PERIOD_PIECES_V1}${peaks.length > 0 ? `
3) "peak_labels" — la tendencia del Overview marca los días pico de abajo. Para CADA uno, un rótulo de 3 a 7 palabras que nombre QUÉ pasó ese día (el hecho, no la cifra), a partir de lo que se dijo ese día. Sin cifras, sin punto final, sin <strong>. Si ese día no tiene un hecho identificable, omítelo — no inventes.
   BIEN: "FEI amplía la pesquisa a Lefranc Fortuño" · "Anuncio de inversión de PharmaEssentia"
   MAL:  "Pico de volumen" · "75 menciones" · "Día más activo"

${mentionSamplesLegend(peaks.flatMap((p) => p.samples))}DÍAS PICO QUE HAY QUE ROTULAR:
${peaks.map((p) => `- ${formatPromptDay(p.date)} (date=${p.date}): ${p.total} menciones, ${p.negative} negativas. Lo que se dijo ese día:
${p.samples.map((m, i) => '  ' + formatSample(i + 1, m)).join('\n') || '  - (sin muestras)'}`).join('\n')}
` : ''}
${heroCandidates.length > 0 ? `
${peaks.length > 0 ? '4' : '3'}) "hero_index" — la foto que acompaña al titular sale de UNA de estas notas de prensa del periodo. Elige el número de la nota que mejor ILUSTRA lo que dice tu titular: el mismo hecho, no solo el mismo tema. Si ninguna trata del hecho del titular, elige la que trate del asunto más cercano.
${heroCandidates.map((c, i) => `  [${i}] ${formatPromptDay(c.day)} · ${c.source} · ${c.title}`).join('\n')}
` : ''}
SALIDA: usa la tool emit_period_summary con "summary" (1 párrafo de 3-5 oraciones, 80-1400 chars), "headline" y "highlights"${peaks.length > 0 ? ', "peak_labels" (lista de {date, label})' : ''}${heroCandidates.length > 0 ? ' y "hero_index" (número entero)' : ''}.
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
  const dateShort = formatPromptDayOfInstant(m.createdAt);
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
  const tag = formatMentionSampleTag(m);
  // Sin anotaciones: la línea de siempre, byte a byte.
  if (!tag) return `${i}. (${dateShort} | ${meta}) "${clean}"`;
  return `${i}. ${tag} (${dateShort} | ${meta}) ${formatMentionSampleBody(m, 320)}`;
}

// ============================================================
// Anotación de muestras (tipo, publicación original, reacción tardía)
// ============================================================

/** Zona del calendario con que se cuentan los días entre publicación y comentario. */
const SAMPLE_TZ = 'America/Puerto_Rico';

/** Días calendario (hora de PR) entre la publicación original y el comentario. */
export function daysBetweenInstantsPr(fromIso: string | Date, toIso: string | Date): number | null {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const [ya, ma, da] = ymdInTimeZone(a, SAMPLE_TZ).split('-').map(Number);
  const [yb, mb, db] = ymdInTimeZone(b, SAMPLE_TZ).split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Una reacción a una publicación de MÁS de 2 días es reacción tardía (spec 9.1 y Anexo D). */
export const LATE_REACTION_MIN_DAYS = 3;

function hasAnnotation(m: MentionSample): boolean {
  return Boolean(m.kind || m.parent || (typeof m.moreInThread === 'number' && m.moreInThread > 0));
}

/**
 * Etiqueta entre corchetes que dice qué es la mención. Cadena vacía si la
 * muestra no trae anotaciones (así los callers de hoy no cambian).
 */
export function formatMentionSampleTag(m: MentionSample): string {
  if (!hasAnnotation(m)) return '';
  const where = m.source ?? m.pageType ?? null;
  const kind: SampleMentionKind | null = m.kind ?? (m.parent ? 'comment' : null);
  const parts: string[] = [];
  if (kind === 'article') {
    const who = m.source ?? m.author ?? null;
    parts.push(`[NOTA DE PRENSA O BLOG${who ? `: ${who}` : ''}]`);
  } else if (kind === 'agency_post') {
    parts.push(`[PUBLICACIÓN DE LA AGENCIA${where ? ` en ${where}` : ''}]`);
  } else if (kind === 'third_party_post') {
    parts.push(`[PUBLICACIÓN DE UN TERCERO${m.author ? `: ${m.author}` : ''}${where ? ` en ${where}` : ''}]`);
  } else if (kind === 'comment') {
    const p = m.parent ?? null;
    const of = p?.isAgency
      ? ` de la propia agencia${p.author ? ` (${p.author})` : ''}`
      : p?.author ? ` de ${p.author}` : '';
    let tag = `[COMENTARIO de un usuario${where ? ` en ${where}` : ''} a una publicación${of}`;
    if (p?.publishedAt) {
      tag += `; publicación original del ${formatPromptDayOfInstant(p.publishedAt)}`;
      const days = daysBetweenInstantsPr(p.publishedAt, m.createdAt);
      if (days !== null && days >= LATE_REACTION_MIN_DAYS) tag += `; pasaron ${days} días: REACCIÓN TARDÍA, no es noticia del día`;
      else if (days === 0) tag += '; del mismo día';
      else if (days !== null && days > 0) tag += `; pasaron ${days} ${days === 1 ? 'día' : 'días'}`;
    } else {
      tag += '; fecha de la publicación original desconocida';
    }
    parts.push(`${tag}]`);
  }
  if (typeof m.moreInThread === 'number' && m.moreInThread > 0) {
    parts.push(`[+${m.moreInThread} ${m.moreInThread === 1 ? 'comentario más' : 'comentarios más'} a esta misma publicación ese día]`);
  }
  return parts.join(' ');
}

/** Texto de la muestra; en comentarios con padre, «PUBLICACIÓN ORIGINAL … || COMENTARIO …». */
export function formatMentionSampleBody(m: MentionSample, max = 320): string {
  const clean = m.text.replace(/\s+/g, ' ').trim().slice(0, max);
  const parentText = m.parent?.text ? m.parent.text.replace(/\s+/g, ' ').trim().slice(0, 220) : '';
  if (parentText && (m.kind ?? 'comment') === 'comment') {
    return `PUBLICACIÓN ORIGINAL: "${parentText}" || COMENTARIO: "${clean}"`;
  }
  return `"${clean}"`;
}

/**
 * Leyenda de las etiquetas. Solo se imprime si alguna muestra viene anotada;
 * si ninguna lo está devuelve '' y el prompt queda como antes.
 */
export function mentionSamplesLegend(samples: MentionSample[]): string {
  if (!samples.some(hasAnnotation)) return '';
  return `CÓMO LEER CADA MENCIÓN: las que traen su TIPO entre corchetes se leen así.
- [NOTA DE PRENSA O BLOG]: nota publicada por un medio o un blog.
- [PUBLICACIÓN DE LA AGENCIA]: lo que la propia agencia publicó en sus redes. Es lo que la agencia comunica, no lo que la gente opina, y no se evalúa a sí misma.
- [PUBLICACIÓN DE UN TERCERO]: una página, medio, periodista o empresa en redes. No es la agencia ni es un hecho comprobado: atribuye lo que dice a esa página y no heredes su lenguaje; si usa un verbo dramático, cuenta el hecho con un verbo literal.
- [COMENTARIO]: reacción de un usuario a una publicación, con la fecha de esa publicación y los días que pasaron. El comentario es del día en que se escribió; la publicación, del suyo. Si pasaron más de 2 días es una REACCIÓN TARDÍA: no es noticia del día y nunca digas que la publicación salió ese día.
- [+N …]: N comentarios más a esa misma publicación ese día; sirve para dimensionar cuánta conversación hay, sin repetir su contenido.

`;
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
