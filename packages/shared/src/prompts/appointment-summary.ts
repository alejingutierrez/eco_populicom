/**
 * Prompt del correo de NOMBRAMIENTO (ago 2026).
 *
 * Se dispara UNA VEZ cuando se registra un nombramiento nuevo en una agencia
 * monitoreada y cubre desde el día del nombramiento hasta HOY. A diferencia del
 * semanal (que compara dos ventanas equivalentes) y del diario (que describe un
 * periodo rodante), aquí el eje es un HECHO ÚNICO: una persona asumió un cargo
 * y hay que decirle al lector cómo cayó eso en la conversación pública.
 *
 * Por eso el prompt pide dos cosas que los otros correos no piden:
 *  - la RECEPCIÓN: en qué ejes se está discutiendo el nombramiento y quién
 *    ocupa cada eje (respaldo institucional, reparo, escrutinio de trayectoria).
 *  - la comparación contra los días PREVIOS al nombramiento, para separar el
 *    efecto del anuncio del nivel base de la agencia.
 *
 * Comparte los guardrails del INSIGHTS_SYSTEM_PROMPT (sin recomendaciones, sin
 * handles personales, sin inferencia geográfica, números literales del dato).
 */

import type { MentionSample, WeeklyAggregates } from './weekly-report-insights';
import { HTML_INLINE_RULE } from './constitution';

export interface AppointmentFacts {
  /** Nombre de la persona nombrada, como se le nombra en prensa. */
  personName: string;
  /** Cargo que asume, p.ej. "Secretaria de la Gobernación". */
  position: string;
  /** A quién sustituye, si aplica. */
  predecessor?: string | null;
  /** YYYY-MM-DD del nombramiento (el hecho). */
  announcedOn: string;
  /** Contexto libre que registró el analista al dar de alta el nombramiento. */
  notes?: string | null;
}

export interface AppointmentSummaryInputs {
  facts: AppointmentFacts;
  /** Agregados de la ventana nombramiento → hoy. */
  current: WeeklyAggregates;
  /** Totales de la ventana equivalente INMEDIATAMENTE ANTERIOR al nombramiento. */
  baselineTotals: { negative: number; neutral: number; positive: number; total: number };
  /** Etiqueta humana de la ventana previa ("5 – 8 ago 2026"). */
  baselineLabel: string;
  /** Etiqueta humana de la ventana cubierta ("9 – 12 ago 2026"). */
  windowLabel: string;
  /** Días naturales que cubre la ventana (incluye hoy parcial). */
  windowDays: number;
  /** Indicadores compuestos ya formateados en escala pública. */
  indicatorLines: Array<{ label: string; cur: string; prev: string }>;
  samples: {
    negative: MentionSample[];
    neutral: MentionSample[];
    positive: MentionSample[];
  };
}

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function signedPct(cur: number, prev: number): string {
  if (prev <= 0) return cur > 0 ? 'nuevo' : '0%';
  const v = Math.round(((cur - prev) / prev) * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
}

function formatSample(i: number, m: MentionSample): string {
  const clean = m.text.replace(/\s+/g, ' ').trim().slice(0, 500);
  const dateShort = m.createdAt.slice(0, 10);
  const meta = [
    m.topic ? `topic=${m.topic}` : null,
    m.source ? `src=${m.source}` : null,
    m.pageType ? `tipo=${m.pageType}` : null,
    typeof m.engagement === 'number' ? `eng=${m.engagement}` : null,
  ].filter(Boolean).join(' ');
  return `${i}. (${dateShort} | ${meta}) "${clean}"`;
}

export function buildAppointmentSummaryPrompt(inputs: AppointmentSummaryInputs): string {
  const { facts, current, baselineTotals, indicatorLines, samples } = inputs;
  const { totals } = current;

  const topicBlock = current.byTopic.slice(0, 10)
    .map((t) => `- ${t.topic}: ${t.total} menciones (neg ${t.negative}, neu ${t.neutral}, pos ${t.positive})`)
    .join('\n');

  const indicatorBlock = indicatorLines
    .map((l) => `- ${l.label}: desde el nombramiento=${l.cur} · días previos (${inputs.baselineLabel})=${l.prev}`)
    .join('\n');

  const sourceBlock = (current.topSources ?? []).slice(0, 10)
    .map((s) => `- ${s.source}: ${s.mentions} menciones`).join('\n') || '- (sin datos)';

  const emotionBlock = (current.topEmotions ?? []).slice(0, 6)
    .map((e) => `- ${e.emotion}: ${e.count} menciones`).join('\n') || '- (sin datos)';

  const authorBlock = (current.topAuthors ?? []).slice(0, 10)
    .map((a) => `- ${a.author}: ${a.mentions} menciones (sentimiento dominante: ${a.sentiment})`).join('\n') || '- (sin datos)';

  const muniBlock = (current.byMunicipality ?? []).slice(0, 6)
    .map((m) => `- ${m.municipality}: ${m.total} menciones (${m.negative} neg)`).join('\n') || '- (sin datos)';

  return `
AGENCIA: ${current.agencyName} (abreviada: ${current.agencyShortName})
CORREO: NOMBRAMIENTO — se envía una sola vez, a raíz de un cambio de titular en la agencia. TZ America/Puerto_Rico.

EL HECHO:
- Persona nombrada: ${facts.personName}
- Cargo: ${facts.position}
${facts.predecessor ? `- Sustituye a: ${facts.predecessor}\n` : ''}- Fecha del nombramiento: ${facts.announcedOn}
${facts.notes ? `- Contexto registrado por el analista: ${facts.notes}\n` : ''}
PERIODO CUBIERTO: ${current.periodStart} a ${current.periodEnd} (${inputs.windowLabel}), ${inputs.windowDays} día(s) naturales. INCLUYE HOY, que es un día PARCIAL — no leas la caída del último día como una caída real de la conversación.
LÍNEA BASE DE COMPARACIÓN: los ${inputs.windowDays} día(s) inmediatamente ANTERIORES al nombramiento (${inputs.baselineLabel}). Sirve para separar el efecto del nombramiento del nivel normal de la agencia.

TOTALES — DESDE EL NOMBRAMIENTO vs DÍAS PREVIOS:
- Total:    ${totals.total} vs ${baselineTotals.total} (${signedPct(totals.total, baselineTotals.total)})
- Negativo: ${totals.negative} (${pct(totals.negative, totals.total)}%) vs ${baselineTotals.negative} (${signedPct(totals.negative, baselineTotals.negative)})
- Neutral:  ${totals.neutral} (${pct(totals.neutral, totals.total)}%) vs ${baselineTotals.neutral} (${signedPct(totals.neutral, baselineTotals.neutral)})
- Positivo: ${totals.positive} (${pct(totals.positive, totals.total)}%) vs ${baselineTotals.positive} (${signedPct(totals.positive, baselineTotals.positive)})

INDICADORES COMPUESTOS (escala pública del dashboard):
${indicatorBlock || '- (sin indicadores)'}

VOLUMEN DIARIO DESDE EL NOMBRAMIENTO:
${current.dailySeries.map((d) => `- ${d.date}: neg=${d.negative}, neu=${d.neutral}, pos=${d.positive} (total ${d.negative + d.neutral + d.positive})`).join('\n')}

TÓPICOS EN EL PERIODO (ordenados por volumen):
${topicBlock || '- (sin menciones clasificadas por tópico)'}

FUENTES / MEDIOS (top por volumen):
${sourceBlock}

AUTORES / CUENTAS MÁS ACTIVAS (recuerda: sin @handles personales ni nombres de ciudadanos privados en la salida — usa medios, cargos públicos o tipo de canal):
${authorBlock}

MUNICIPIOS (etiquetado automático del NLP — NO es ground truth del lugar del evento; aplica la regla geográfica del sistema):
${muniBlock}

EMOCIONES AGREGADAS:
${emotionBlock}

MUESTRAS DE MENCIONES DEL PERIODO (pre-filtradas a pertinencia alta/media, ORDENADAS POR ENGAGEMENT — las primeras son las de mayor resonancia; úsalas para anclar los hechos concretos y las posturas):
--- NEGATIVAS (${samples.negative.length}) ---
${samples.negative.slice(0, 14).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}
--- NEUTRALES (${samples.neutral.length}) ---
${samples.neutral.slice(0, 10).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}
--- POSITIVAS (${samples.positive.length}) ---
${samples.positive.slice(0, 10).map((m, i) => formatSample(i + 1, m)).join('\n') || '- (sin muestras)'}

TAREA — CUATRO PIEZAS. El sujeto de todas es el nombramiento de ${facts.personName} como ${facts.position}, no la agencia en abstracto.

1) "headline" — el titular. UNA oración de 8 a 18 palabras que diga el hallazgo central: cómo cayó el nombramiento. No anuncies el nombramiento (el lector ya lo sabe y sale en la ficha de arriba): di cómo se recibió. Sujeto y verbo, sin cifras, sin punto final.
   BIEN: "El nombramiento se discute por lo que dice de la administración, no por la persona"
   BIEN: "Mucha cobertura, poco respaldo: el relevo se cubrió en todos lados y se apoyó en pocos"
   MAL:  "Nombramiento de ${facts.personName}" · "266 menciones en cinco días"

2) "summary" — el párrafo. De 3 a 5 oraciones (80 a 120 palabras) que expliquen cómo cayó: de dónde salió el volumen, quién lo produjo, y sobre qué gira realmente la discusión — si sobre la persona, sobre el cargo, o sobre quien la nombró. Ojo con la trampa de este correo: un nombramiento SIEMPRE genera cobertura obligada, así que mucho volumen no es respaldo ni rechazo. Como mucho dos cifras.

3) "reception" — de 2 a 4 viñetas: cómo se está recibiendo. Cada una toma un ÁNGULO distinto y cuenta qué se dijo en concreto desde ahí, con su cifra de apoyo. Ángulos que suelen dar señal, sin forzar ninguno:
   - quién apoya y desde qué posición (¿es apoyo de cargos, o hay gente respaldando?);
   - quién pone reparos y con qué argumento puntual;
   - qué se dice de la trayectoria de la persona;
   - el ángulo de la salida del predecesor${facts.predecessor ? ` (${facts.predecessor})` : ''}, si sigue vivo;
   - qué NO se está discutiendo y uno esperaría que se discutiera — el silencio sobre las competencias o sobre el plan de trabajo es un hallazgo, no un vacío.
   Cada viñeta: una sola oración de 25 a 45 palabras, con un medio, cargo público u organización nombrado.
   Distingue siempre lo que dicen MEDIOS de lo que dicen ACTORES POLÍTICOS de lo que dice la gente: son tres cosas distintas y aquí se confunden con facilidad.

4) "highlights" — de 2 a 4 viñetas sobre lo que el nombramiento MOVIÓ frente a los días previos. También cuentan hechos, no cifras con etiqueta: qué conversación apareció que antes no existía, qué se disparó y por qué, qué siguió igual pese al relevo.

REGLAS PROPIAS DE ESTE CORREO:
- No lo caracterices como reacción unánime si los datos muestran los dos signos; tampoco fuerces equilibrio si el dato está cargado a un lado. Reporta lo que hay.
- Si una variación es "nuevo" (los días previos no registraban nada), dilo así en lugar de inventar un porcentaje.
- El último día de la ventana es HOY y va parcial: no leas su caída como una caída real de la conversación, ni la menciones como si lo fuera.
- Reporta a los actores políticos de forma factual y neutral, sin sugerir ventaja para ninguno.

${HTML_INLINE_RULE}

SALIDA: llama la herramienta con los cuatro campos — headline, summary, reception, highlights.
`.trim();
}
