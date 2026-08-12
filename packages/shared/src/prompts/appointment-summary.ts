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

TAREA — TRES SALIDAS. El eje de TODAS es el nombramiento de ${facts.personName} como ${facts.position}, no la agencia en abstracto:

1) "summary" — UN párrafo COMPLETO de 4 a 6 oraciones (~120–170 palabras) para un lector ejecutivo: cómo cayó el nombramiento en la conversación pública. Debe abrir por el hallazgo central (cómo se recibió, no "se anunció el nombramiento de…" — eso el lector ya lo sabe), citar el volumen del periodo y su variación vs los días previos (${signedPct(totals.total, baselineTotals.total)}), identificar el MECANISMO dominante (qué cobertura o qué actor está produciendo el volumen) y cerrar diciendo si la discusión gira sobre la persona, sobre el cargo o sobre la administración que la nombra. Usa <strong> para cifras y nombres propios clave.

2) "reception" — 2 a 4 oraciones independientes, cada una sobre un EJE distinto de cómo se está recibiendo el nombramiento. Los ejes útiles suelen ser: respaldo explícito (quién y desde qué posición institucional), reparo o rechazo (quién y con qué argumento concreto), lectura de la trayectoria de la persona, y el ángulo de la salida del predecesor${facts.predecessor ? ` (${facts.predecessor})` : ''}. Cada oración: 25–50 palabras, con al menos un número del dato y al menos un nombre propio (medio, cargo público u organización). Si un eje no está en los datos, NO lo inventes: entrega menos oraciones.

3) "highlights" — 2 a 4 oraciones sobre lo que el nombramiento MOVIÓ en los números, comparando contra los días previos: un salto de volumen o sentimiento con su mecanismo, un tópico que apareció o se disparó (con los números de ambas ventanas), un indicador compuesto que se movió (valores de escala pública tal cual: "36%", "6.8 / 10"), o una asimetría de canal o actor. Cada highlight: una sola oración, 25–50 palabras, número + nombre propio.

REGLAS (además de las del sistema):
- El nombramiento es el SUJETO. Nada de describir la agencia como si el hecho no hubiera ocurrido.
- PRECISIÓN SOBRE CATEGORÍAS: di QUÉ se dijo en concreto (el respaldo, el reparo, la comparación con su paso por el gobierno), no solo el nombre del tópico con un conteo.
- Distingue lo que dicen MEDIOS de lo que dicen ACTORES POLÍTICOS de lo que dice el público. Un nombramiento genera cobertura obligada; el volumen alto por sí solo no es respaldo ni rechazo.
- No caracterices la reacción como unánime si los datos muestran ambos signos; tampoco fuerces equilibrio si el dato está cargado a un lado.
- Si una variación es "nuevo" (los días previos no registraban), dilo explícitamente en lugar de inventar un porcentaje.
- NUNCA "hoy"/"ayer": habla de "desde el nombramiento" o de fechas concretas.
`.trim();
}
