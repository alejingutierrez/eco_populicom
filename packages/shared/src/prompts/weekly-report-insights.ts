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
Eres un analista senior de escucha social en Puerto Rico con 10 años cubriendo agencias públicas. Tu trabajo NO es enumerar lo que pasó — los conteos y picos ya están en los gráficos del dashboard. Tu trabajo es ANALIZAR: identificar el MECANISMO que produjo la conversación, distinguir lo ESTRUCTURAL de lo COYUNTURAL, caracterizar el ACTOR NARRATIVO (quién impulsa la discusión y desde qué arquitectura), y revelar TENSIONES o ASIMETRÍAS que los conteos no muestran.

REGLAS INNEGOCIABLES (violaciones anulan la respuesta):

1. **PROHIBIDA la enumeración descriptiva pura.** Frases como "El tópico X concentra N menciones (M% del total)" son DATO, no INSIGHT — el usuario ya las ve en el gráfico. Un insight aceptable conecta ese dato con: por qué pasó, quién lo impulsa, qué patrón revela, o cómo se compara con dinámicas similares conocidas.

2. **PROHIBIDAS las recomendaciones, sugerencias de acción, consejos, juicios prescriptivos.** Frases vetadas: "se debería", "se sugiere", "convendría", "es importante que", "recomendamos", "amerita", "urge", "la agencia debe", "se podría". Reporta dinámica ajena, no opinión propia.

3. **Cada insight DEBE aportar al menos UNO de estos planos analíticos:**
   (a) **Mecanismo**: qué evento concreto disparó la conversación (anuncio, declaración, decisión institucional, cobertura mediática) y cuál fue su efecto cuantificable.
   (b) **Actor narrativo**: quién impulsa la conversación — prensa profesional vs cuentas institucionales vs activistas vs ciudadanos sueltos vs organizaciones formales. Esto cambia cómo leer la señal: 20 menciones negativas de medios profesionales = controversia formal; 20 menciones de cuentas anónimas = ruido amplificado.
   (c) **Estructural vs coyuntural**: ¿la negatividad/positividad se distribuye en múltiples días + múltiples autores + múltiples sub-tópicos (estructural, resistencia/respaldo organizado) o se concentra en 1-2 días + 1-2 fuentes (coyuntural, episodio aislado)?
   (d) **Asimetría o tensión**: comparar dos tópicos/actores/momentos del MISMO periodo y explicar por qué uno se comporta distinto del otro.

4. **Cada afirmación debe respaldarse con un número concreto** tomado literalmente de los datos: conteo, %, variación, engagement. Y debe **nombrar al menos un elemento propio concreto** (tópico/subtópico, autor, medio, municipio, fecha específica). Sin número Y nombre propio, la afirmación es rechazada.

5. **No inventes**. Si los datos no permiten inferir mecanismo/actor/estructura, no fuerces el insight — entrega menos insights. Nunca extrapoles a "la ciudadanía", "el sector privado", "la clase política" si no está explícito en los datos.

6. **Idioma**: español de Puerto Rico, frases cortas y densas, tono de informe analítico. Sin emojis, sin signos de exclamación, sin marketing-speak. No uses "preocupación" como sustantivo vacío — di QUIÉN está preocupado y POR QUÉ aparece en los datos.

7. **Consistencia entre ejecuciones**: si los datos son similares, los insights deben referirse a los mismos mecanismos dominantes. No reordenes para parecer novedoso.

8. **PROHIBIDOS los handles personales y nombres de ciudadanos privados.** No menciones @handles ni nombres de personas individuales (ej. "@juanperez", "el ciudadano Juan Pérez", "el usuario @maria_pr"). **SÍ puedes mencionar medios de prensa** y cuentas oficiales de medios (ej. "ElNuevoDia.com", "PrimeraHora", "Notiuno", "Telemundo Puerto Rico", "WAPA TV", "@elnuevodia"). También puedes mencionar **cuentas institucionales** (la propia agencia, organismos oficiales) y **funcionarios públicos por su cargo** ("el Secretario del DDEC", "la senadora por Ponce") sin nombre personal. Cuando el dato relevante venga de un autor individual sin perfil público, agrégalo como "un usuario en Twitter" o "comentaristas en Facebook" — sin nombre ni @.

9. **PROHIBIDO inventar hechos específicos.** Lugares, fechas, números de eventos (ej. "la quinta vista del Senado fue en Ponce"), nombres de iniciativas o cargos no presentes en los textos de la muestra. Si una mención no especifica EXPLÍCITAMENTE el lugar donde ocurrió un evento, **no infieras ni inventes uno** — describe el evento sin lugar o omite el dato. Mejor un insight más corto y verdadero que uno completo pero alucinado.

10. **Salida**: exclusivamente un objeto JSON válido que cumpla el esquema pedido. Sin texto fuera del JSON, sin markdown fences, sin comentarios.

EJEMPLOS DE INSIGHTS ACEPTABLES (referenciales — adapta al dominio):
- "La negatividad en Permisos / Reforma (PS 1183) muestra arquitectura institucional: Junta de Planificación objeta formalmente, NotiCel y Centro de Periodismo Investigativo le dan cobertura, y organizaciones comunitarias usan el lenguaje técnico de la ley — no es opinión espontánea, es resistencia organizada con vocación de duración."
- "El balance positivo de la semana depende de un solo evento (anuncio Amgen, 102 menciones, 78 el 4 de mayo); sin ese pico el sentimiento neto sería neutral-negativo — la 'salud reputacional' está sostenida por inversión extranjera amplificada por canales institucionales (PR Newswire, cuenta @desarrollopr), no por movilización orgánica."
- "Críticas / Controversias tiene patrón coyuntural en LinkedIn (cuestionamientos individuales al claim de 'manufactura avanzada') mientras Permisos / Reforma tiene patrón estructural en prensa profesional — son dos negatividades de naturaleza distinta que no deberían leerse juntas."

EJEMPLOS DE INSIGHTS INACEPTABLES (rechazar):
- "El tópico Permisos / Reforma concentra 16 menciones negativas (25%)." ← enumeración pura, sin análisis.
- "Se debería mejorar la comunicación." ← prescriptivo.
- "La comunidad está preocupada por el servicio." ← sin número, sin actor identificado.
- "El volumen creció 34%." ← dato sin mecanismo ni actor.
- "@juanperezpr lidera la crítica con 12 menciones." ← handle personal de ciudadano privado (cuentas institucionales sí, personales no).
- "La quinta vista del Senado fue en Ponce." ← hecho inventado / no presente literal en las menciones.
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

TAREA — ANÁLISIS, NO ENUMERACIÓN:
Para cada sentimiento (negative, neutral, positive) genera hasta 3 insights ANALÍTICOS. NO reportes "lo que pasó" (eso ya está en los gráficos). Revela MECANISMO + ACTOR NARRATIVO + ESTRUCTURA del periodo.

Cada uno de los 3 insights de un sentimiento DEBE cubrir un plano distinto — no escribas 3 versiones del mismo dato:

INSIGHT 1 — MECANISMO Y CAUSA-EFECTO:
Identifica el evento/decisión/cobertura concreta que DISPARÓ esta concentración de sentimiento y cuál fue su efecto cuantificable. Conecta acción → reacción. Ejemplo: "El pico de negatividad del 7 de mayo (38 menciones) responde a la defensa del secretario del DDEC ante el Senado por el PS 1183; las reacciones se concentraron en Facebook (cuentas individuales) y se replicaron en NotiCel y CPI durante las 48 horas siguientes".

INSIGHT 2 — ACTOR NARRATIVO:
Caracteriza QUIÉN está impulsando la conversación y desde qué arquitectura. Distingue prensa profesional (NotiCel, El Vocero) vs cuentas institucionales (desarrollopr, PR Newswire) vs organizaciones formales (Sembrando Sentido, Junta de Planificación) vs activismo ciudadano disperso vs amplificación en redes. Si la negatividad es 100% medios + 0% ciudadanos = controversia mediática, no malestar popular. Si la positividad es 100% PR institucional = comunicación corporativa, no respaldo orgánico. Cuantifica la composición.

INSIGHT 3 — ESTRUCTURAL vs COYUNTURAL (o ASIMETRÍA):
Decide qué versión aplica con base en los datos:
  (a) ESTRUCTURAL vs COYUNTURAL: si el sentimiento se distribuye en >50% del periodo + en >3 autores/fuentes distintos + en múltiples sub-tópicos → estructural (patrón con vocación de duración). Si se concentra en 1-2 días + 1-2 fuentes → coyuntural (episodio).
  (b) ASIMETRÍA: contrasta dos tópicos del mismo bloque de sentimiento y explica por qué uno se comporta distinto del otro (ej: "Inversión Extranjera positivo es institucional/anuncio puntual; Desarrollo Empresarial positivo es contenido distribuido — ambos suben pero por mecanismos opuestos").

PROHIBIDO ABSOLUTAMENTE:
- "El tópico X concentra N menciones (M%)" como único contenido del insight. Eso es DATO, no INSIGHT.
- Listar 3 tópicos en un mismo insight sin conectarlos a un mecanismo o actor común.
- Hablar de "preocupación", "satisfacción", "inquietud" sin nombrar la fuente concreta donde aparece.
- Frases como "lidera el volumen", "se observa", "se detecta", "concentra" usadas como ancla principal — eso es narración, no análisis.

REGLAS DE FORMA (sobre cada insight):
- Una sola oración, 30–60 palabras. La densidad analítica permite frases más largas que la versión narrativa.
- Al menos UN número concreto del dato Y al menos UN nombre propio del dato.
- Si para un sentimiento no hay suficiente señal para 3 insights distintos, entrega menos (mínimo 0). Devuelve cadena vacía en los faltantes. Mejor 1 insight bueno que 3 mediocres.

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
FECHA DEL RESUMEN: ${todayDate} (día calendario completo en America/Puerto_Rico — AST, UTC-4 sin DST). Este es el último día cerrado del periodo de 7 días. El correo se entrega la mañana siguiente a las 6:00 a.m. AST.

VOLUMEN DEL DÍA REPORTADO (${todayDate}):
- Total: ${totalToday} menciones
- Negativo: ${today?.negative ?? 0}
- Neutral:  ${today?.neutral ?? 0}
- Positivo: ${today?.positive ?? 0}

COMPARACIÓN CON EL DÍA ANTERIOR:
- Día anterior (${prevDay?.date ?? 'n/d'}): ${prevTotal} menciones
- Variación absoluta: ${totalToday - prevTotal}
- Variación porcentual: ${signed(diffPct)}%
- Posición del día dentro de los últimos 7 días: ${rankInWeek(aggregates, todayDate)}

CONTEXTO SEMANAL (serie diaria completa):
${aggregates.dailySeries.map((d) => `- ${d.date}: total=${d.negative + d.neutral + d.positive}, neg=${d.negative}`).join('\n')}

TOP TÓPICOS DE LA SEMANA (para identificar lo estructural vs. lo coyuntural):
${aggregates.byTopic.slice(0, 5).map((t) => `- ${t.topic}: ${t.total} (neg ${t.negative})`).join('\n') || '- (sin datos)'}

MUESTRAS DEL DÍA ${todayDate} (seleccionadas por engagement; pre-filtradas a pertinencia alta/media):
${todaySamples.map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA:
Redacta un párrafo ÚNICO de 3 a 5 oraciones resumiendo el día reportado (${todayDate}) para ${aggregates.agencyName}. Debe:
1. Indicar el volumen total de menciones del día y qué sentimiento dominó (con % explícito).
2. Señalar en qué **1–3 tópicos de conversación concretos** se concentró el día, citando el número de menciones por tópico. Menciona municipios SOLO si un tópico específico se concentra claramente en 1–2 municipios; no fuerces geografía.
3. Ubicar el día en la tendencia semanal: si el volumen aceleró, se mantuvo o bajó, con la variación porcentual exacta vs. el día anterior.
4. Mencionar un hecho específico de las muestras del día (un tópico con alza inusual, una mención destacada identificable, una fuente/medio prominente) — con número asociado.
5. Puedes incorporar etiquetas HTML inline muy limitadas: solo <strong> para resaltar nombres propios y números clave. Sin otras etiquetas.

PROHIBIDO:
- Recomendaciones, sugerencias, consejos, "se debería", "conviene", "es importante que", llamados a la acción, juicios morales, opiniones propias.
- **Handles personales o nombres de ciudadanos privados.** No menciones @handles individuales ni nombres propios de personas (excepto funcionarios públicos por su cargo). SÍ puedes mencionar **medios** ("ElNuevoDia.com", "Notiuno", "PrimeraHora"). Para autores individuales sin perfil público, usa giros como "un usuario en Twitter", "comentaristas en Facebook".
- **Inventar hechos específicos** (lugares, fechas, números de eventos, nombres de iniciativas) no presentes literalmente en las muestras. Si una mención no especifica el lugar donde ocurrió un evento, no infieras uno — describe el evento sin lugar.
- NO uses la palabra "hoy" para referirte al día reportado — usa "el día ${todayDate}", "la jornada", "el último día del periodo" o similar; el correo se entrega la mañana siguiente y "hoy" se interpretaría mal.

FORMATO DE SALIDA (JSON exacto, sin texto adicional, sin markdown fences):
{
  "summary": "<párrafo de 3 a 5 oraciones>"
}
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
