/**
 * Helpers de formateo en español de PR — usados por el lambda eco-weekly-report
 * y por /api/overview para que las etiquetas de periodo y día coincidan.
 */

import { ymdInTimeZone } from './dates';

const ES_MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ES_DOW_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const ES_DOW_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const ES_MONTH_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "29 abr – 5 may 2026" o "29 – 30 abr 2026" si están en el mismo mes. */
export function formatPeriodLabel(startYmd: string, endYmd: string): string {
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  const startMonth = ES_MONTH_SHORT[sm - 1];
  const endMonth = ES_MONTH_SHORT[em - 1];
  if (sm === em && sy === ey) return `${sd} – ${ed} ${endMonth} ${ey}`;
  return `${sd} ${startMonth} – ${ed} ${endMonth} ${ey}`;
}

/** "5 may" — usado para etiquetar el "Resumen del día". */
export function formatShortDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  return `${d} ${ES_MONTH_SHORT[m - 1]}`;
}

/**
 * "miércoles 12 de agosto" — la forma en que el día se NOMBRA dentro del texto
 * redactado. Existe porque los prompts recibían el día en formato ISO y el
 * modelo lo copiaba literal a la prosa ("La jornada del 2026-08-12 registró…").
 * Ver la ley 05 de la constitución editorial.
 */
export function formatLongDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${ES_DOW_LONG[dt.getUTCDay()]} ${d} de ${ES_MONTH_LONG[m - 1]}`;
}

/**
 * "jueves 24 sep 2026" — la fecha tal como entra en los DATOS de un prompt.
 *
 * Existe porque los prompts pasaban fechas ISO sueltas (2026-09-24) y el
 * modelo deducía el día de la semana por su cuenta, y se equivocaba: el
 * diario del 28-sep-2026 atribuyó al "miércoles" el pico que la serie ponía
 * el jueves, y el editorial de crisis del mismo día llamó "sábado" a un
 * lunes. Con el día ya calculado, el modelo solo tiene que copiarlo (ley 05
 * de la constitución editorial). El año va para que no haya que inferirlo.
 */
export function formatPromptDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${ES_DOW_LONG[dt.getUTCDay()]} ${d} ${ES_MONTH_SHORT[m - 1]} ${y}`;
}

/**
 * El día de un INSTANTE (published_at de una mención) en hora de Puerto Rico,
 * con su día de la semana. `iso.slice(0, 10)` daba la fecha en UTC: una
 * mención de las 10 p.m. del miércoles quedaba fechada el jueves.
 */
export function formatPromptDayOfInstant(iso: string | Date, timeZone = 'America/Puerto_Rico'): string {
  const dt = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso).slice(0, 10);
  return formatPromptDay(ymdInTimeZone(dt, timeZone));
}

/** "mié 29" — etiqueta del eje X de la tendencia diaria. */
export function formatDayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${ES_DOW_SHORT[dt.getUTCDay()]} ${d}`;
}

/** "5 may, 6:00 a.m. AST" — usado en el header del correo. */
export function formatUpdatedAtLabel(nowUtc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(nowUtc).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const day = Number(parts.day);
  const monthIdx = Number(parts.month) - 1;
  const month = ES_MONTH_SHORT[monthIdx] ?? '';
  const hour = Number(parts.hour);
  const minute = parts.minute ?? '00';
  const ampm = (parts.dayPeriod ?? '').toLowerCase().startsWith('p') ? 'p.m.' : 'a.m.';
  const tzLabel = timeZone === 'America/Puerto_Rico' ? 'AST' : timeZone.split('/').pop() ?? timeZone;
  return `${day} ${month}, ${hour}:${minute} ${ampm} ${tzLabel}`;
}
