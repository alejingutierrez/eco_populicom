/**
 * Helpers de formateo en español de PR — usados por el lambda eco-weekly-report
 * y por /api/overview para que las etiquetas de periodo y día coincidan.
 */

const ES_MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const ES_DOW_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

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
