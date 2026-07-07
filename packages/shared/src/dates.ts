/**
 * Helpers de fecha en zona horaria — usados por el lambda eco-weekly-report
 * y por /api/overview para que ambos calculen exactamente la misma ventana de
 * "últimos N días naturales cerrados terminando ayer en TZ Puerto Rico".
 */

/**
 * Devuelve YYYY-MM-DD del día calendario en la timezone IANA dada.
 * Usa Intl.DateTimeFormat para no depender de offsets manuales (sin DST issues).
 */
export function ymdInTimeZone(utc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(utc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Suma `days` (puede ser negativo) a un YMD y devuelve el resultado. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Devuelve la hora local (0–23) en la timezone IANA dada. */
export function hourInTimeZone(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
  }).formatToParts(utc);
  const hourPart = parts.find((p) => p.type === 'hour');
  const h = Number(hourPart?.value ?? '-1');
  if (Number.isNaN(h)) return -1;
  return h === 24 ? 0 : h;
}

const DOW_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Día de la semana (0=domingo … 6=sábado, convención de JS `getDay`) del
 * instante dado en la timezone IANA dada. Usado por el gate del reporte
 * semanal (se envía solo cuando el día local coincide con
 * `report_configs.weekly_send_dow`, default 5 = viernes).
 */
export function dowInTimeZone(utc: Date, timeZone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(utc);
  return DOW_INDEX[wd] ?? -1;
}

export interface ClosedWindow {
  /** Inicio inclusive de la ventana actual (YYYY-MM-DD en TZ). */
  startYmd: string;
  /** Fin inclusive de la ventana actual (YYYY-MM-DD en TZ); típicamente "ayer". */
  endYmd: string;
  /** Inicio inclusive de la ventana anterior, misma duración. */
  prevStartYmd: string;
  /** Fin inclusive de la ventana anterior. */
  prevEndYmd: string;
}

/**
 * Ventana cerrada de `daysBack` días terminando AYER en la TZ dada. La ventana
 * previa tiene la misma duración y termina justo antes de `startYmd`.
 *
 * Para `daysBack=7`, matchea exactamente la lógica del lambda eco-weekly-report
 * (líneas 290–295 de buildReport): el correo se envía 6 AM PR, ayer ya es un
 * día completo, no incluimos hoy parcial.
 */
export function closedWindowYmdInTZ(
  daysBack: number,
  now: Date = new Date(),
  timeZone: string = 'America/Puerto_Rico',
): ClosedWindow {
  const today = ymdInTimeZone(now, timeZone);
  const endYmd = addDaysYmd(today, -1);
  const startYmd = addDaysYmd(endYmd, -(daysBack - 1));
  const prevEndYmd = addDaysYmd(startYmd, -1);
  const prevStartYmd = addDaysYmd(prevEndYmd, -(daysBack - 1));
  return { startYmd, endYmd, prevStartYmd, prevEndYmd };
}
