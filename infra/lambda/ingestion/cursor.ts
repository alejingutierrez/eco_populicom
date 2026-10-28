// Cálculo del cursor de ingesta (puro, sin I/O), separado del handler para
// poder probarlo sin AWS ni Brandwatch.
//
// Brandwatch devuelve en la MISMA página menciones con fecha y "shells" de
// X/Twitter con `date: null` (y title/snippet/url vacíos) que no se hidratan
// después. Los shells vienen intercalados según su fecha interna, así que el
// ÚLTIMO elemento de una página suele ser un shell. Tomar `lastMention.date`
// dejaba el cursor en `startDate` (= cursor − 1 min) y retrocedía 1 minuto en
// cada corrida.

interface DatedMention {
  date?: string | null;
}

/**
 * Fecha (epoch ms) de la mención más reciente con fecha válida de una página,
 * o null si ninguna la trae. Ignora null/''/no parseable y las fechas por
 * encima de `ceilingMs` (una fecha futura dejaría el cursor adelantado y la
 * ingesta ciega hasta que el reloj la alcance).
 */
export function latestMentionDateMs(
  mentions: ReadonlyArray<DatedMention>,
  ceilingMs: number = Infinity,
): number | null {
  let latest: number | null = null;
  for (const m of mentions) {
    if (!m.date) continue;
    const ms = Date.parse(m.date);
    if (Number.isNaN(ms) || ms > ceilingMs) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

export interface CursorCommitInput {
  isBackfill: boolean;
  /** Menciones ya traídas (y encoladas) en esta corrida para la query. */
  totalMentions: number;
  /** Entries que SQS rechazó tras reintentos. */
  sendFailures: number;
  /** Fecha máxima válida de las páginas ya procesadas (ver advanceCursorMs). */
  cursorMs: number | null;
  /** Inicio de la ventana de la corrida (cursor − lookback). */
  startDate: string;
  /** La query falló a media paginación (p. ej. 429 en la página 5 de 8). */
  partial?: boolean;
}

/**
 * Fecha ISO a la que hay que llevar el cursor al terminar (o abortar) una
 * query, o null si no se debe tocar. El cursor solo refleja páginas COMPLETAS
 * ya encoladas (las páginas vienen ascendentes por fecha y el cursor avanza
 * después de encolar), así que sigue siendo un punto de reanudación válido si
 * la query falla a media paginación: sin esto, un 429 en la página 12 de un
 * backlog obligaba a la corrida siguiente a repetir las 12 páginas (más cupo
 * gastado) y el backlog nunca avanzaba. Con fallos de encolado nunca avanza.
 */
export function cursorToCommit(input: CursorCommitInput): string | null {
  if (input.isBackfill || input.totalMentions <= 0 || input.sendFailures > 0) return null;
  if (input.cursorMs !== null) return new Date(input.cursorMs).toISOString();
  // Sin ninguna mención con fecha (todo shells): al terminar bien se registra
  // startDate (el GREATEST de updateCursor impide que mueva el cursor atrás);
  // a media paginación no hay nada que comprometer.
  return input.partial ? null : input.startDate;
}

/**
 * Avanza el cursor de una corrida con una página nueva: el máximo entre el
 * cursor acumulado y la mención más reciente de la página. Nunca retrocede.
 */
export function advanceCursorMs(
  currentMs: number | null,
  mentions: ReadonlyArray<DatedMention>,
  ceilingMs: number = Infinity,
): number | null {
  const pageMs = latestMentionDateMs(mentions, ceilingMs);
  if (pageMs === null) return currentMs;
  return currentMs === null ? pageMs : Math.max(currentMs, pageMs);
}
