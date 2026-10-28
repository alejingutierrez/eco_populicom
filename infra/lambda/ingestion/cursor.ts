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
