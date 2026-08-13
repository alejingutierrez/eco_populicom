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
import { formatLongDay } from '../format-period';
import { ECO_ANALYST_ROLE, HTML_INLINE_RULE, buildSystemPrompt } from './constitution';

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

export const INSIGHTS_SYSTEM_PROMPT = buildSystemPrompt(
  ECO_ANALYST_ROLE,
  `
- Estos textos van dentro de un correo que el lector abre en el teléfono a las
  6 de la mañana. Cada oración tiene que ganarse el espacio.
- ${HTML_INLINE_RULE}
- No repitas entre bloques el mismo hecho con otras palabras. Si dos bloques
  cuentan lo mismo, uno de los dos sobra: entrega menos.
`,
);

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
PERIODO ANALIZADO: ${periodStart} al ${periodEnd} (7 días naturales cerrados, zona horaria America/Puerto_Rico — AST, UTC-4 sin DST). El reporte se envía a las 6:00 a.m. AST y NO incluye el día actual; el día más reciente del periodo es el de ayer cerrado completo.

NOTA SOBRE PERTINENCIA: las muestras de menciones que recibes a continuación están pre-filtradas a pertinencia 'alta' o 'media' por el NLP — son las relevantes para la agencia. Las menciones de pertinencia 'baja' SÍ están contadas en los totales del termómetro y la tendencia diaria (para mantener paridad con el dashboard), pero NO debes inventar insights sobre ellas porque no son señal — son ruido. Si describes el volumen total, descríbelo tal cual; no especules sobre lo que dicen las de baja pertinencia.

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

MUESTRAS DE MENCIONES (pre-filtradas a pertinencia 'alta' o 'media' — solo señal, sin ruido. Hay más menciones contadas en los agregados de arriba que NO aparecen aquí porque su pertinencia es baja o aún no fue evaluada; ignóralas para insights):

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
- "Lo más duro de la semana no es el nombramiento sino lo que venía antes: la investigación sobre el titular saliente y los contratos de la firma cabildera sostienen la crítica por su cuenta, con 78% y 89% de menciones adversas."
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
  // El día en palabras — el modelo debe escribir "el miércoles", nunca el ISO.
  const dayLabel = formatLongDay(todayDate);
  const prevDayLabel = prevDay ? formatLongDay(prevDay.date) : null;

  return `
AGENCIA: ${aggregates.agencyName}
DÍA QUE SE RESUME: ${dayLabel} (en tu texto llámalo así, "${dayLabel}" o "el ${dayLabel.split(' ')[0]}" — NUNCA ${todayDate}, NUNCA "hoy" ni "ayer"). Día calendario completo en America/Puerto_Rico. Es el último día cerrado del periodo de 7 días; el correo se entrega la mañana siguiente.

VOLUMEN DEL DÍA REPORTADO (${todayDate}):
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
${aggregates.dailySeries.map((d) => `- ${d.date}: total=${d.negative + d.neutral + d.positive}, neg=${d.negative}`).join('\n')}

TOP TÓPICOS DE LA SEMANA (para identificar lo estructural vs. lo coyuntural):
${aggregates.byTopic.slice(0, 5).map((t) => `- ${t.topic}: ${t.total} (neg ${t.negative})`).join('\n') || '- (sin datos)'}

LO QUE SE DIJO ESE DÍA (las menciones de más resonancia — úsalas para saber QUÉ pasó en concreto; no menciones jamás que son una selección):
${todaySamples.map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA — TRES PIEZAS: TITULAR, PÁRRAFO Y VIÑETAS.
Cuentas qué pasó el ${dayLabel} en la conversación pública sobre ${aggregates.agencyName}. Es lo primero que el lector ve al abrir el correo.

1) "headline" — el titular. UNA oración de 8 a 16 palabras que diga lo más importante del día. Es un titular de prensa, no una etiqueta: tiene sujeto y verbo, y quien lea solo esa línea ya sabe qué pasó. Sin cifras dentro. Sin punto final.
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

export function buildPeriodSummaryPrompt(
  aggregates: WeeklyAggregates,
  samples: { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] },
): string {
  const days = aggregates.dailySeries.length || 1;
  const { totals, deltaVsPrevWeek } = aggregates;
  const dominantTopic = aggregates.byTopic[0];
  const dominantSecondary = aggregates.byTopic[1];

  const dailyVolumeLine = aggregates.dailySeries.map((d) => {
    const t = d.negative + d.neutral + d.positive;
    return `${d.date}=${t}`;
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

2. **MECANISMO + COMPARACIÓN CON VENTANA PREVIA**: ¿qué causó el comportamiento del volumen y del sentimiento? Identifica el(los) evento(s)-disparador concreto(s) y el(los) amplificador(es) (medio profesional, cuenta institucional, organización formal, activista). Conecta la acción de la agencia/contexto → la reacción cuantificable. **Si hay caídas o subidas grandes (>30%) en algún sentimiento vs la ventana previa, IDENTIFICA EXPLÍCITAMENTE qué evento del periodo previo (visible en la serie diaria) explica la diferencia** — el usuario que compara esta ventana con una más larga necesita saber qué pasó antes que ya no está pasando ahora. Ejemplo: "el -77% en negatividad refleja que el ciclo de controversia del PS 1183 (picos del 14 y 28 de abril, 324 menciones negativas combinadas) cerró sin reemplazo".

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

SALIDA: usa la tool emit_period_summary con el campo "summary" (1 párrafo de 3-5 oraciones, 80-1400 chars).
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
