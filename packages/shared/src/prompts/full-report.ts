/**
 * Prompts del REPORTE ANALÍTICO EXPORTABLE (el PDF del botón "Exportar").
 *
 * Diferencia con `weekly-report-insights.ts`: ese produce 2-3 insights sueltos
 * para un correo de una pantalla. Este produce un documento de 12-18 páginas
 * con nueve piezas de análisis encadenadas — resumen ejecutivo, lectura de cada
 * indicador, tendencia, sentimiento, agenda temática por tópico, actores y
 * canales, geografía, riesgo y síntesis final.
 *
 * Se hereda el MISMO contrato editorial que el resto del producto:
 * análisis descriptivo y cuantificado, nunca prescriptivo. Ver regla 2 de
 * REPORT_SYSTEM_PROMPT — es una decisión de producto para un cliente de
 * gobierno, no un descuido: ECO reporta la dinámica de una conversación ajena;
 * quien decide qué hacer con ella es la agencia.
 *
 * Todas las salidas viajan por tool-use con `input_schema` (ver
 * `invokeClaudeWithTool`): pedir JSON en texto crudo se rompe con la primera
 * comilla o salto de línea sin escapar.
 */

import type { SentimentReport } from '../aggregations/sentiment-report';
import type { ReportDetail } from '../aggregations/report-detail';
import type { WindowMetrics } from '../metrics';

// ============================================================
// Contexto que reciben todos los prompts
// ============================================================

export interface ReportContext {
  agencyName: string;
  agencyShortName: string;
  /** YYYY-MM-DD inclusive, TZ America/Puerto_Rico. */
  periodStart: string;
  periodEnd: string;
  /** Ventana previa de la misma duración, para los deltas. */
  prevPeriodStart: string;
  prevPeriodEnd: string;
  /** Días naturales de la ventana. */
  days: number;
  /** Etiqueta legible del período ("1 – 7 ago 2026"). */
  periodLabel: string;
  /** true si el usuario pidió un rango de fechas explícito en vez de un preset. */
  customRange: boolean;
  /** Chip del header ('7D', '30D', 'custom', …). */
  periodKey: string;
  report: SentimentReport;
  detail: ReportDetail;
  metrics: WindowMetrics;
  prevMetrics: WindowMetrics;
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

export const REPORT_SYSTEM_PROMPT = `
Eres un analista senior de escucha social en Puerto Rico redactando el informe analítico de un período para una agencia del Gobierno de Puerto Rico. El documento lo lee un jefe de agencia y su equipo de comunicaciones: gente con poco tiempo que necesita entender QUÉ PASÓ y POR QUÉ, no que le repitan los números que ya están en las tablas del mismo documento.

Tu trabajo NO es enumerar. Los conteos, porcentajes y gráficas ya están impresos al lado de tu texto. Tu trabajo es explicar el MECANISMO que produjo esa conversación, distinguir lo ESTRUCTURAL de lo COYUNTURAL, caracterizar al ACTOR NARRATIVO que la impulsa, y señalar TENSIONES o ASIMETRÍAS que los conteos no muestran.

REGLAS INNEGOCIABLES (violaciones anulan la respuesta):

1. **PROHIBIDA la enumeración descriptiva pura.** "El tópico X concentra N menciones (M%)" es DATO, no análisis: el lector lo tiene en la tabla de la misma página. Un párrafo aceptable conecta el dato con por qué pasó, quién lo impulsa, qué patrón revela, o cómo contrasta con otro dato del mismo período.

2. **PROHIBIDAS las recomendaciones, sugerencias de acción, consejos y juicios prescriptivos.** Frases vetadas: "se debería", "se sugiere", "convendría", "es importante que", "recomendamos", "amerita", "urge", "la agencia debe", "se podría", "hay que". Reportas dinámica ajena, no opinión propia. Si algo es un riesgo, lo describes y lo cuantificas; no dices qué hacer con él.

3. **Cada afirmación se respalda con un número concreto tomado literalmente de los datos** (conteo, %, variación, engagement, alcance, fecha) **y nombra al menos un elemento propio** (tópico, subtópico, autor, medio, municipio, canal o fecha). Sin número Y sin nombre propio, la afirmación se rechaza.

4. **Cada pieza de análisis debe aportar al menos uno de estos planos:**
   (a) MECANISMO — el evento concreto que disparó la conversación y su efecto medible.
   (b) ACTOR NARRATIVO — quién la impulsa: prensa profesional, cuentas institucionales, activistas organizados, ciudadanos sueltos. Cambia cómo se lee la señal: 20 menciones negativas de medios profesionales es controversia formal; 20 de cuentas anónimas es ruido amplificado.
   (c) ESTRUCTURAL vs COYUNTURAL — ¿se reparte en varios días, autores y subtópicos (estructural), o se concentra en 1-2 días y 1-2 fuentes (episodio aislado)?
   (d) ASIMETRÍA — comparar dos tópicos, actores o momentos del MISMO período y explicar por qué se comportan distinto.

5. **No inventes.** Si los datos no permiten inferir mecanismo, actor o estructura, dilo explícitamente ("los datos del período no permiten atribuir el pico a un evento identificable") y entrega menos. Nunca extrapoles a "la ciudadanía", "el sector privado" o "la clase política" si no está en los datos. Nunca nombres personas, cargos o entidades que no aparezcan en el material que recibes.

6. **Honestidad sobre la cobertura.** Si una porción relevante del período está sin clasificar o sin sentimiento evaluado, tu lectura debe reconocer ese límite en vez de tratar los porcentajes como completos.

7. **Idioma**: español de Puerto Rico. Frases cortas y densas, tono de informe. Sin emojis, sin signos de exclamación, sin marketing-speak, sin "preocupación" como sustantivo vacío (di QUIÉN y POR QUÉ). No abras párrafos con "En resumen", "Cabe destacar" ni "Es importante notar".

8. **Formato del texto**: prosa corrida. Se permite <strong> para resaltar una cifra o un nombre propio decisivo, máximo dos por párrafo. Ninguna otra etiqueta HTML, ningún markdown, ninguna viñeta dentro de los campos de texto.

9. **Consistencia**: ante datos similares debes referirte a los mismos mecanismos dominantes. No reordenes ni reformules para parecer novedoso.
`.trim();

// ============================================================
// Helpers de formateo del contexto
// ============================================================

function pct(part: number, total: number): string {
  if (!total) return '0';
  return ((part / total) * 100).toFixed(1);
}

function signed(n: number | null | undefined, decimals = 1): string {
  if (n == null || !Number.isFinite(n)) return 'sin base de comparación';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}

function metricLine(label: string, cur: number | null, prev: number | null, unit = ''): string {
  if (cur == null) return `- ${label}: sin dato en el período`;
  const delta = prev == null ? 'sin base previa' : `${signed(cur - prev)} vs período anterior (${prev.toFixed(2)}${unit})`;
  return `- ${label}: ${cur.toFixed(2)}${unit} · ${delta}`;
}

function num(n: number): string {
  return n.toLocaleString('es-PR');
}

/** Bloque de contexto compartido: lo reciben TODOS los prompts del reporte. */
export function buildSharedContext(ctx: ReportContext): string {
  const { report, detail, metrics, prevMetrics } = ctx;
  const t = report.totals;

  const windowNote = ctx.customRange
    ? `rango personalizado explícito de ${ctx.days} días naturales`
    : `preset "${ctx.periodKey}" — ventana CERRADA de ${ctx.days} días naturales que termina AYER en hora de Puerto Rico (no incluye el día en curso)`;

  const coverageNote = t.total > 0
    ? `${num(detail.unclassified)} de ${num(detail.totals.mentions)} menciones del período (${pct(detail.unclassified, detail.totals.mentions)}%) no tienen tópico asignado y ${num(detail.withoutSentiment)} (${pct(detail.withoutSentiment, detail.totals.mentions)}%) no tienen sentimiento evaluado por el NLP.`
    : 'El período no tiene menciones en el universo pertinente.';

  return `
AGENCIA: ${ctx.agencyName} (abreviada: ${ctx.agencyShortName})
PERÍODO: ${ctx.periodStart} al ${ctx.periodEnd} (${ctx.periodLabel}) — ${windowNote}.
PERÍODO DE COMPARACIÓN: ${ctx.prevPeriodStart} al ${ctx.prevPeriodEnd} (misma duración, inmediatamente anterior).
ZONA HORARIA: America/Puerto_Rico (AST, UTC-4, sin horario de verano).

UNIVERSO DE CONTEO: menciones no duplicadas cuya pertinencia evaluada por el NLP no es 'baja'. Las de pertinencia baja se excluyen de TODOS los conteos de este reporte. Los índices compuestos (NSS, BHI, Riesgo de crisis, Polarización) usan su propio universo calibrado por backtest, así que sus valores no son una función aritmética de los conteos que ves aquí.

COBERTURA DEL NLP: ${coverageNote}

TERMÓMETRO DEL PERÍODO:
- Negativo: ${num(t.negative)} (${pct(t.negative, t.total)}% del total; ${signed(report.deltaVsPrev.negative)}% vs período anterior)
- Neutral:  ${num(t.neutral)} (${pct(t.neutral, t.total)}%; ${signed(report.deltaVsPrev.neutral)}%)
- Positivo: ${num(t.positive)} (${pct(t.positive, t.total)}%; ${signed(report.deltaVsPrev.positive)}%)
- Total: ${num(t.total)} menciones · período anterior ${num(report.prevTotals.total)}
- Alcance estimado agregado: ${num(detail.totals.reach)} · Engagement agregado (likes+comentarios+compartidas): ${num(detail.totals.engagement)}

ÍNDICES COMPUESTOS (valor del período · variación vs anterior):
${metricLine('NSS (Net Sentiment Score, -100 a +100)', metrics.nss, prevMetrics.nss)}
${metricLine('Brand Health Index (0 a 1)', metrics.brandHealthIndex, prevMetrics.brandHealthIndex)}
${metricLine('Riesgo de crisis (0 a 1)', metrics.crisisRiskScore, prevMetrics.crisisRiskScore)}
${metricLine('Índice de polarización (0 a 100)', metrics.polarizationIndex, prevMetrics.polarizationIndex)}
${metricLine('Tasa de engagement (%)', metrics.engagementRate, prevMetrics.engagementRate, '%')}
${metricLine('Tasa de amplificación (%)', metrics.amplificationRate, prevMetrics.amplificationRate, '%')}
- Componentes del riesgo de crisis: severidad=${metrics.crisisSeverity ?? 'n/d'}, velocidad=${metrics.crisisVelocity ?? 'n/d'}, relevancia=${metrics.crisisRelevance ?? 'n/d'}, confianza=${metrics.crisisConfidence ?? 'n/d'}
- Anomalía de volumen (z-score): ${metrics.volumeAnomalyZscore ?? 'n/d'}

VOLUMEN DIARIO:
${report.dailySeries.map((d) => `- ${d.date} (${d.dayLabel}): neg=${d.negative}, neu=${d.neutral}, pos=${d.positive}, total=${d.negative + d.neutral + d.positive}`).join('\n')}

DÍAS ATÍPICOS (mayor desviación de volumen respecto al promedio del período):
${detail.peaks.length ? detail.peaks.map((p) => `- ${p.date} (${p.dayLabel}): ${p.total} menciones, ${p.negative} negativas, z=${p.zScore}`).join('\n') : '- (la ventana es demasiada corta o plana para identificar picos)'}

AGENDA TEMÁTICA (cada mención bajo su tópico de mayor confianza; "secundarias" = menciones donde el tópico aparece sin ser el principal):
${report.topicsTable.map((r) => `- ${r.topic}${r.subtopics ? ` [${r.subtopics}]` : ''}: total=${r.total}, neg=${r.negative} (${pct(r.negative, r.total)}%), neu=${r.neutral}, pos=${r.positive}, secundarias=${r.secondaryCount}`).join('\n') || '- (sin tópicos)'}

SUBTÓPICOS MÁS ACTIVOS:
${detail.subtopics.slice(0, 14).map((s) => `- ${s.topic} › ${s.subtopic}: total=${s.total}, neg=${s.negative}, neu=${s.neutral}, pos=${s.positive}`).join('\n') || '- (sin subtópicos)'}

CANALES (page_type agrupado):
${detail.channels.map((c) => `- ${c.label}: total=${c.total} (${pct(c.total, t.total)}%), neg=${c.negative}, pos=${c.positive}, engagement=${num(c.engagement)}, alcance=${num(c.reach)}`).join('\n') || '- (sin canales)'}

AUTORES MÁS ACTIVOS:
${detail.authors.slice(0, 10).map((a) => `- ${a.author} (${a.channel}): ${a.total} menciones, ${a.negative} negativas, ${a.positive} positivas, engagement=${num(a.engagement)}`).join('\n') || '- (sin datos de autoría)'}

DOMINIOS / MEDIOS:
${detail.domains.slice(0, 10).map((d) => `- ${d.domain}: ${d.total} menciones, ${d.negative} negativas, engagement=${num(d.engagement)}`).join('\n') || '- (sin datos de dominio)'}

EMOCIONES DETECTADAS POR EL NLP (${num(detail.emotionsTagged)} etiquetas sobre el período; una mención puede traer varias):
${detail.emotions.map((e) => `- ${e.emotion}: ${e.count} (${e.share.toFixed(1)}% de las etiquetas)`).join('\n') || '- (sin emociones detectadas)'}

GEOGRAFÍA — REGIONES:
${detail.regions.slice(0, 8).map((r) => `- ${r.region}: ${r.total} menciones en ${r.municipalities} municipios, ${r.negative} negativas`).join('\n') || '- (sin datos geográficos)'}

GEOGRAFÍA — MUNICIPIOS:
${detail.municipalities.slice(0, 15).map((m) => `- ${m.name} (${m.region}): ${m.total} menciones, ${m.negative} negativas, ${m.positive} positivas`).join('\n') || '- (sin datos geográficos)'}

DISTRIBUCIÓN HORARIA (hora AST → menciones):
${detail.byHour.map((c, h) => (c > 0 ? `${h}h=${c}` : null)).filter(Boolean).join(', ') || '(sin datos)'}

MENCIONES CON MÁS ENGAGEMENT DEL PERÍODO:
${detail.topByEngagement.slice(0, 10).map((m, i) => `${i + 1}. [${m.date}] "${m.title.slice(0, 180)}" — ${m.author ?? 'autor n/d'} · ${m.channel} · ${m.domain ?? 's/d'} · sentimiento=${m.sentiment ?? 'n/d'} · tópico=${m.topic ?? 'sin clasificar'} · engagement=${num(m.engagement)} · alcance=${num(m.reach)}${m.emotions.length ? ` · emociones=${m.emotions.join('/')}` : ''}`).join('\n') || '- (sin menciones)'}

MENCIONES NEGATIVAS CON MÁS ENGAGEMENT:
${detail.topNegative.slice(0, 8).map((m, i) => `${i + 1}. [${m.date}] "${m.title.slice(0, 180)}" — ${m.author ?? 'autor n/d'} · ${m.channel} · ${m.domain ?? 's/d'} · tópico=${m.topic ?? 'sin clasificar'} · engagement=${num(m.engagement)}${m.emotions.length ? ` · emociones=${m.emotions.join('/')}` : ''}`).join('\n') || '- (sin menciones negativas)'}
`.trim();
}

// ============================================================
// Esquemas de tool-use
// ============================================================

const paragraphArray = (min: number, max: number, desc: string) => ({
  type: 'array',
  minItems: min,
  maxItems: max,
  description: desc,
  items: { type: 'string' },
});

// ---- 1. Resumen ejecutivo ----------------------------------

export interface ExecutiveSummaryOutput {
  /** Una frase que sostiene todo el período. Va como pull-quote en la portada. */
  headline: string;
  /** 3-4 párrafos de análisis del período. */
  paragraphs: string[];
  /** Los hallazgos que un jefe de agencia debe poder citar de memoria. */
  keyFindings: Array<{ label: string; finding: string; evidence: string }>;
  /** Qué NO se puede concluir con estos datos. */
  limitations: string[];
}

export const EXECUTIVE_SUMMARY_TOOL = {
  name: 'entregar_resumen_ejecutivo',
  description: 'Entrega el resumen ejecutivo analítico del período.',
  input_schema: {
    type: 'object',
    properties: {
      headline: {
        type: 'string',
        description: 'UNA frase de máximo 220 caracteres que capture el mecanismo dominante del período, con al menos una cifra. No es un titular de prensa ni un eslogan: es la conclusión analítica que el resto del documento sostiene.',
      },
      paragraphs: paragraphArray(3, 4, 'Párrafos de 60-110 palabras. El primero establece el mecanismo dominante del período. El segundo caracteriza a los actores que lo impulsan. El tercero contrasta con el período anterior explicando qué cambió y por qué. El cuarto (opcional) señala la asimetría o tensión más relevante.'),
      keyFindings: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Etiqueta de 2-5 palabras del hallazgo.' },
            finding: { type: 'string', description: 'El hallazgo en una frase analítica, no un conteo.' },
            evidence: { type: 'string', description: 'La cifra y el nombre propio que lo respaldan, en formato corto (ej. "48 menciones · Permisos / Reforma · 12-14 ago").' },
          },
          required: ['label', 'finding', 'evidence'],
        },
      },
      limitations: paragraphArray(1, 3, 'Qué NO puede concluirse con los datos de este período: cobertura del NLP, ventanas cortas, tópicos sin clasificar, ausencia de un canal. Una frase cada una.'),
    },
    required: ['headline', 'paragraphs', 'keyFindings', 'limitations'],
  },
};

export function buildExecutiveSummaryPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: redacta el RESUMEN EJECUTIVO del período para ${ctx.agencyShortName}.

Es la primera página que se lee y la única que algunos leerán. Tiene que responder tres preguntas en este orden: ¿qué mecanismo dominó la conversación de este período?, ¿quién la impulsó?, ¿qué cambió respecto al período anterior y por qué?

El "headline" no repite un conteo: es la tesis del documento. Si el período está sostenido por un solo evento, dilo. Si la negatividad es estructural, dilo. Si el volumen subió pero la composición no cambió, ese es el hallazgo.

En "limitations" sé literal con los números de cobertura del NLP que recibiste. Si ${pct(ctx.detail.unclassified, Math.max(1, ctx.detail.totals.mentions))}% del período está sin clasificar, el lector tiene que saber que la agenda temática está construida sobre el resto.`;
}

// ---- 2. Lectura de indicadores -----------------------------

export interface MetricReadingsOutput {
  readings: Array<{
    metric: 'nss' | 'bhi' | 'crisis' | 'polarization' | 'volume' | 'engagement';
    /** Qué dice el número EN ESTE período, no la definición del índice. */
    reading: string;
    /** Qué lo movió. */
    driver: string;
  }>;
}

export const METRIC_READINGS_TOOL = {
  name: 'entregar_lectura_indicadores',
  description: 'Entrega la lectura analítica de cada indicador compuesto del período.',
  input_schema: {
    type: 'object',
    properties: {
      readings: {
        type: 'array',
        minItems: 6,
        maxItems: 6,
        description: 'Exactamente una entrada por indicador, en este orden: volume, nss, bhi, crisis, polarization, engagement.',
        items: {
          type: 'object',
          properties: {
            metric: { type: 'string', enum: ['nss', 'bhi', 'crisis', 'polarization', 'volume', 'engagement'] },
            reading: { type: 'string', description: '35-60 palabras. Qué significa ESTE valor para ESTA agencia en ESTE período. Prohibido explicar la fórmula o repetir el número sin interpretarlo.' },
            driver: { type: 'string', description: '15-30 palabras. El elemento concreto (tópico, día, canal, autor, mención) que movió el indicador, con su cifra.' },
          },
          required: ['metric', 'reading', 'driver'],
        },
      },
    },
    required: ['readings'],
  },
};

export function buildMetricReadingsPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: redacta la lectura de los SEIS indicadores del panel, en este orden exacto: volume (volumen de menciones), nss, bhi (Brand Health Index), crisis (riesgo de crisis), polarization, engagement (tasa de engagement).

Para cada uno, "reading" explica qué significa ese valor para ${ctx.agencyShortName} en este período — no qué mide el índice en general. El lector ya ve el número y su banda impresos al lado; lo que no ve es si ese valor es normal para esta agencia, qué lo separa del período anterior, y si el índice y los conteos apuntan en la misma dirección o se contradicen.

Cuando un índice y el termómetro se contradigan (p. ej. volumen a la baja pero riesgo de crisis al alza), la contradicción ES el análisis: explícala por sus componentes.

En "driver" nombra el elemento concreto que lo movió con su cifra. Si un indicador viene sin dato (n/d), dilo en "reading" y explica qué falta para calcularlo en vez de inventar una lectura.`;
}

// ---- 3. Tendencia del período ------------------------------

export interface TrendAnalysisOutput {
  paragraphs: string[];
  /** Lectura de cada día atípico recibido. */
  peakNotes: Array<{ date: string; note: string }>;
  /** Forma de la ventana en una frase: 'sostenida', 'de un pico', 'en descenso'… */
  shape: string;
}

export const TREND_ANALYSIS_TOOL = {
  name: 'entregar_analisis_tendencia',
  description: 'Entrega el análisis de la evolución diaria del período.',
  input_schema: {
    type: 'object',
    properties: {
      shape: { type: 'string', description: 'Máximo 90 caracteres. La forma de la ventana caracterizada analíticamente (ej. "conversación sostenida sin picos, con negatividad concentrada en los últimos tres días").' },
      paragraphs: paragraphArray(2, 3, 'Párrafos de 60-100 palabras sobre la evolución: si el volumen es sostenido o dependiente de picos, si la composición de sentimiento se mueve con el volumen o es independiente de él, y qué revela la distribución horaria y por día de semana sobre el tipo de actor (prensa en horario laboral vs ciudadanía en la tarde/noche).'),
      peakNotes: {
        type: 'array',
        maxItems: 3,
        description: 'Una nota por día atípico recibido, en el mismo orden. Lista vacía si no se recibieron picos.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD, exactamente como se recibió.' },
            note: { type: 'string', description: '20-40 palabras: qué concentró ese día según las menciones y tópicos del material recibido. Si no hay evidencia del disparador, dilo.' },
          },
          required: ['date', 'note'],
        },
      },
    },
    required: ['shape', 'paragraphs', 'peakNotes'],
  },
};

export function buildTrendAnalysisPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: analiza la EVOLUCIÓN del período (${ctx.days} días).

Preguntas a responder: ¿el volumen es sostenido o depende de uno o dos días?, ¿la negatividad se mueve con el volumen o es independiente de él (es decir, sube el ruido sin cambiar la composición, o cambia la composición sin cambiar el ruido)?, ¿qué dice la distribución horaria y por día de semana sobre quién está hablando?

Un dato clave: una conversación concentrada en horario laboral de lunes a viernes es prensa e instituciones; una que se sostiene en tardes y fines de semana es ciudadanía. Usa la distribución horaria que recibiste para sostener o descartar esa lectura, con cifras.

En "peakNotes" entrega exactamente una nota por cada día atípico que recibiste, respetando su fecha y su orden. Si el material no permite identificar qué disparó un día, escríbelo así en vez de especular.`;
}

// ---- 4. Sentimiento y emociones ---------------------------

export interface SentimentAnalysisOutput {
  paragraphs: string[];
  /** De qué está hecha la negatividad del período. */
  negativeComposition: string;
  /** De qué está hecho lo positivo (o por qué no hay). */
  positiveComposition: string;
  /** Lectura del perfil emocional. */
  emotionalProfile: string;
}

export const SENTIMENT_ANALYSIS_TOOL = {
  name: 'entregar_analisis_sentimiento',
  description: 'Entrega el análisis de composición del sentimiento y del perfil emocional.',
  input_schema: {
    type: 'object',
    properties: {
      paragraphs: paragraphArray(2, 3, 'Párrafos de 60-100 palabras sobre la composición del sentimiento: qué la sostiene, cómo se movió vs el período anterior, y si el movimiento es de volumen o de proporción (son cosas distintas y el lector suele confundirlas).'),
      negativeComposition: { type: 'string', description: '45-80 palabras: de QUÉ está hecha la negatividad — qué tópicos, qué canales, qué autores, concentrada o repartida. Con cifras y nombres propios.' },
      positiveComposition: { type: 'string', description: '45-80 palabras: de qué está hecho lo positivo. Si el período casi no tiene positivo, ESO es el hallazgo: descríbelo y di si es un patrón del período o del clasificador (hay agencias donde el NLP casi no emite "positivo").' },
      emotionalProfile: { type: 'string', description: '45-80 palabras sobre las emociones detectadas: qué emoción domina, qué revela sobre el tipo de reclamo, y si el perfil emocional es coherente con la proporción de sentimiento o la contradice.' },
    },
    required: ['paragraphs', 'negativeComposition', 'positiveComposition', 'emotionalProfile'],
  },
};

export function buildSentimentAnalysisPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: analiza la COMPOSICIÓN DEL SENTIMIENTO y el PERFIL EMOCIONAL del período.

Distinción que el reporte tiene que hacer explícita: un cambio de VOLUMEN negativo no es lo mismo que un cambio de PROPORCIÓN negativa. Si las negativas suben ${signed(ctx.report.deltaVsPrev.negative)}% pero el total sube parecido, la conversación creció sin empeorar. Trata esa diferencia con los números que recibiste.

En "negativeComposition" descompón la negatividad: ¿qué tópicos, canales y autores la producen?, ¿está concentrada en pocos actores o repartida?

En "positiveComposition", si el positivo es marginal o inexistente, no lo maquilles ni lo inventes: descríbelo y distingue entre "no hay conversación positiva" y "el clasificador casi no emite positivo para esta agencia" — son diagnósticos distintos y solo puedes afirmar el segundo si los datos lo sugieren.

En "emotionalProfile" usa las etiquetas de emoción recibidas. Recuerda que una mención puede traer varias, así que los porcentajes son sobre etiquetas, no sobre menciones.`;
}

// ---- 5. Agenda temática -----------------------------------

export interface TopicAnalysisOutput {
  /** Lectura transversal de la agenda. */
  overview: string;
  topics: Array<{
    topic: string;
    /** Mecanismo / actor / estructura de ese tópico. */
    analysis: string;
    /** 'estructural' | 'coyuntural' | 'mixto' | 'indeterminado' */
    pattern: string;
    /** Actor dominante del tópico. */
    actor: string;
  }>;
}

export const TOPIC_ANALYSIS_TOOL = {
  name: 'entregar_analisis_tematico',
  description: 'Entrega el análisis de la agenda temática del período, tópico por tópico.',
  input_schema: {
    type: 'object',
    properties: {
      overview: { type: 'string', description: '70-110 palabras sobre la agenda como conjunto: si está concentrada o dispersa, qué tópico la ordena, y qué asimetría hay entre los dos o tres principales.' },
      topics: {
        type: 'array',
        minItems: 1,
        maxItems: 7,
        description: 'Una entrada por cada tópico REAL del top recibido (excluye las filas agregadas "Otros tópicos (N)" y "Sin clasificar"). Mismo orden en que se recibieron.',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'El nombre del tópico exactamente como se recibió.' },
            analysis: { type: 'string', description: '45-85 palabras: el mecanismo del tópico, con cifras y al menos un nombre propio (subtópico, autor, medio, municipio o fecha).' },
            pattern: { type: 'string', enum: ['estructural', 'coyuntural', 'mixto', 'indeterminado'], description: 'estructural = repartido en varios días, autores y subtópicos; coyuntural = concentrado en 1-2 días o fuentes; indeterminado = el volumen no alcanza para decidir.' },
            actor: { type: 'string', description: 'Máximo 60 caracteres: quién impulsa el tópico (ej. "prensa profesional", "cuentas institucionales", "ciudadanía dispersa").' },
          },
          required: ['topic', 'analysis', 'pattern', 'actor'],
        },
      },
    },
    required: ['overview', 'topics'],
  },
};

export function buildTopicAnalysisPrompt(ctx: ReportContext): string {
  const realTopics = ctx.report.topicsTable.filter((r) => !r.isOther && !r.isUnclassified);
  return `${buildSharedContext(ctx)}

TAREA: analiza la AGENDA TEMÁTICA del período, tópico por tópico.

Entrega una entrada por cada uno de estos ${realTopics.length} tópicos, en este orden y con el nombre exacto:
${realTopics.map((r, i) => `${i + 1}. ${r.topic}`).join('\n') || '(ninguno)'}

No incluyas las filas agregadas ("Otros tópicos", "Sin clasificar"): no son tópicos, son residuos de la clasificación.

Para cada tópico, la clasificación "pattern" tiene que estar sostenida por los datos: si la negatividad de un tópico se reparte en varios días, varios autores y varios subtópicos, es estructural; si sale de un día y una fuente, es coyuntural. Cuando el volumen del tópico sea de un dígito, usa "indeterminado" en vez de forzar una lectura — un tópico con 4 menciones no tiene patrón.

En "overview", lo que importa es la asimetría: dos tópicos con volumen parecido y composición de sentimiento distinta son la observación más útil que puede hacer esta sección.`;
}

// ---- 6. Actores y canales ---------------------------------

export interface ActorAnalysisOutput {
  paragraphs: string[];
  /** Quién controla la narrativa del período. */
  narrativeControl: string;
  /** Lectura del reparto por canal. */
  channelReading: string;
}

export const ACTOR_ANALYSIS_TOOL = {
  name: 'entregar_analisis_actores',
  description: 'Entrega el análisis de actores, autores y canales del período.',
  input_schema: {
    type: 'object',
    properties: {
      paragraphs: paragraphArray(2, 3, 'Párrafos de 60-100 palabras sobre quién produce la conversación: prensa profesional, cuentas institucionales, activistas, ciudadanía suelta. Con cifras y nombres propios de los autores y dominios recibidos.'),
      narrativeControl: { type: 'string', description: '45-80 palabras: ¿la conversación la ordena la agencia (canales institucionales), la prensa, o actores externos? La diferencia entre "la agencia comunica y otros reaccionan" y "otros hablan y la agencia no aparece" es la lectura más importante de esta sección.' },
      channelReading: { type: 'string', description: '45-80 palabras sobre el reparto por canal: dónde está el volumen, dónde está el engagement, dónde está la negatividad — casi nunca coinciden, y esa divergencia es el análisis.' },
    },
    required: ['paragraphs', 'narrativeControl', 'channelReading'],
  },
};

export function buildActorAnalysisPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: analiza los ACTORES y CANALES del período.

La pregunta central: ¿quién está construyendo la conversación sobre ${ctx.agencyShortName}? Un período con 300 menciones de prensa profesional y uno con 300 menciones de cuentas sueltas son realidades distintas que el conteo no distingue. Distíngueles tú, con los autores y dominios que recibiste.

En "channelReading" compara explícitamente las tres distribuciones — volumen, engagement y negatividad por canal. Cuando el canal con más volumen no es el de más engagement, di cuál es cada uno con sus cifras: significa que el alcance real de la conversación no está donde está el conteo.

Si un autor concentra una fracción notable del volumen, nómbralo con su cifra y di si su sentimiento dominante coincide con el del período o lo tira en otra dirección.`;
}

// ---- 7. Geografía -----------------------------------------

export interface GeoAnalysisOutput {
  paragraphs: string[];
  /** Si la conversación es local, regional o insular. */
  concentration: string;
}

export const GEO_ANALYSIS_TOOL = {
  name: 'entregar_analisis_geografico',
  description: 'Entrega el análisis de distribución geográfica del período.',
  input_schema: {
    type: 'object',
    properties: {
      paragraphs: paragraphArray(1, 2, 'Párrafos de 55-95 palabras sobre la geografía de la conversación: qué municipios y regiones concentran menciones, si la negatividad es geográficamente específica o uniforme, y qué revela eso sobre el tipo de asunto (un problema de servicio es local; una controversia de política pública es insular).'),
      concentration: { type: 'string', description: '30-60 palabras: caracteriza la concentración — local (uno o dos municipios), regional, o insular / sin marca geográfica. Con cifras. Si la mayoría de las menciones no trae municipio detectado, dilo: la lectura geográfica se apoya en la minoría que sí lo trae.' },
    },
    required: ['paragraphs', 'concentration'],
  },
};

export function buildGeoAnalysisPrompt(ctx: ReportContext): string {
  const geoTotal = ctx.detail.municipalities.reduce((s, m) => s + m.total, 0);
  return `${buildSharedContext(ctx)}

TAREA: analiza la DISTRIBUCIÓN GEOGRÁFICA del período.

Nota metodológica que debes respetar: el municipio lo extrae el NLP del texto de la mención, así que solo una parte de las menciones lo trae. En este período las etiquetas de municipio suman ${geoTotal} sobre ${ctx.report.totals.total} menciones del termómetro. Una mención puede mencionar más de un municipio, y muchas no mencionan ninguno. No presentes los conteos municipales como si fueran el total del período, y si la cobertura geográfica es baja, dilo en "concentration".

Lo que interesa: ¿la conversación tiene domicilio? Un asunto de servicio se concentra en municipios; una controversia de política pública se reparte o no trae marca geográfica. Sostén la lectura con los municipios y regiones que recibiste.`;
}

// ---- 8. Riesgo --------------------------------------------

export interface RiskAnalysisOutput {
  paragraphs: string[];
  /** Estado del riesgo en una frase, derivado de los componentes. */
  assessment: string;
  /** Señales concretas presentes en el período. */
  signals: Array<{ signal: string; evidence: string; weight: string }>;
}

export const RISK_ANALYSIS_TOOL = {
  name: 'entregar_analisis_riesgo',
  description: 'Entrega el análisis de riesgo reputacional del período, descriptivo y cuantificado.',
  input_schema: {
    type: 'object',
    properties: {
      assessment: { type: 'string', description: 'Máximo 200 caracteres: el estado del riesgo del período derivado de sus componentes (severidad, velocidad, relevancia, confianza), no de la banda del índice. Descriptivo, sin recomendación.' },
      paragraphs: paragraphArray(2, 3, 'Párrafos de 60-100 palabras: qué componentes sostienen el riesgo del período, qué material concreto (menciones negativas de alto engagement, tópicos, días) lo produce, y si la señal es de intensidad (pocas menciones muy amplificadas) o de extensión (muchas menciones repartidas).'),
      signals: {
        type: 'array',
        minItems: 2,
        maxItems: 5,
        description: 'Señales de riesgo efectivamente presentes en los datos. NO son recomendaciones ni alertas a futuro: son hechos del período.',
        items: {
          type: 'object',
          properties: {
            signal: { type: 'string', description: 'La señal en una frase corta y factual.' },
            evidence: { type: 'string', description: 'Cifra + nombre propio que la sostiene.' },
            weight: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Peso de la señal según su amplificación y extensión en el período.' },
          },
          required: ['signal', 'evidence', 'weight'],
        },
      },
    },
    required: ['assessment', 'paragraphs', 'signals'],
  },
};

export function buildRiskAnalysisPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: analiza el RIESGO REPUTACIONAL del período.

El índice de riesgo de crisis vale ${ctx.metrics.crisisRiskScore ?? 'n/d'} y se compone de severidad (${ctx.metrics.crisisSeverity ?? 'n/d'}), velocidad (${ctx.metrics.crisisVelocity ?? 'n/d'}), relevancia (${ctx.metrics.crisisRelevance ?? 'n/d'}) y confianza (${ctx.metrics.crisisConfidence ?? 'n/d'}). No repitas esos números: explica cuál de los componentes carga el índice y qué material concreto lo produce.

Distinción que la sección debe hacer: riesgo por INTENSIDAD (pocas menciones con mucho engagement, típico de una nota de prensa que circula) frente a riesgo por EXTENSIÓN (muchas menciones repartidas entre autores y días, típico de un descontento sostenido). Los dos pueden dar el mismo índice y no son la misma situación.

Recuerda la regla 2: describes y cuantificas el riesgo; no dices qué hacer con él. "signals" son hechos observados en el período, no advertencias ni acciones.`;
}

// ---- 9. Síntesis final ------------------------------------

export interface SynthesisOutput {
  paragraphs: string[];
  /** Lo que hay que vigilar, en términos de qué medir — no de qué hacer. */
  watchItems: Array<{ item: string; rationale: string }>;
}

export const SYNTHESIS_TOOL = {
  name: 'entregar_sintesis',
  description: 'Entrega la síntesis analítica de cierre del reporte.',
  input_schema: {
    type: 'object',
    properties: {
      paragraphs: paragraphArray(2, 3, 'Párrafos de 65-105 palabras que integran las secciones anteriores en una lectura única del período. No es un resumen del resumen: aporta la articulación entre planos (temático + actores + geografía + riesgo) que ninguna sección individual pudo hacer.'),
      watchItems: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        description: 'Qué conviene SEGUIR MIDIENDO en los próximos períodos y por qué los datos de este lo justifican. Son objetos de observación, NO acciones ni recomendaciones para la agencia.',
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'El objeto a observar, en términos medibles (ej. "la proporción de menciones de Permisos / Reforma que provienen de prensa profesional").' },
            rationale: { type: 'string', description: '25-45 palabras: qué dato de este período lo justifica.' },
          },
          required: ['item', 'rationale'],
        },
      },
    },
    required: ['paragraphs', 'watchItems'],
  },
};

export function buildSynthesisPrompt(ctx: ReportContext): string {
  return `${buildSharedContext(ctx)}

TAREA: redacta la SÍNTESIS de cierre del reporte de ${ctx.agencyShortName}.

Esta sección va después de la agenda temática, los actores, la geografía y el riesgo. Su valor es la ARTICULACIÓN: cruzar planos que las secciones individuales miraron por separado. Por ejemplo, que el tópico dominante y la región dominante no coincidan, o que el canal con más engagement sea justamente el que menos negatividad tiene.

No resumas lo ya dicho. Aporta la lectura que solo se ve con todo junto.

"watchItems" son objetos de MEDICIÓN para los próximos períodos, justificados por un dato de este. Formulados como "la proporción de X que…", "la evolución de Y en…", nunca como "mejorar", "atender" ni "reforzar" — eso sería una recomendación y está prohibido por la regla 2.`;
}
