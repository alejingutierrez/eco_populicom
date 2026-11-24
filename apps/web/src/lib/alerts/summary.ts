/**
 * Resumen de la pantalla de Alertas (rediseño de nov-2026).
 *
 * La pantalla anterior contaba eventos (mezcla de severidad, ranking de
 * reglas, activaciones por día) y no decía qué había pasado. Esta agrupa los
 * avisos en EPISODIOS para poder leerlos como una historia: «del 12 al 18 de
 * noviembre, 5 avisos, lectura más alta 93 %».
 *
 * Funciones puras: la ruta `/api/alerts/summary` les pasa las filas.
 */

export interface AlertRow {
  id: string;
  /** Instante del aviso (ISO). */
  at: string;
  /** Día detonante en Puerto Rico (YYYY-MM-DD). */
  day: string;
  ruleId: string;
  ruleName: string;
  ruleType: string | null;
  band: string | null;
  /** Crisis score 0–1 a la hora del aviso; null en reglas que no son de crisis. */
  score: number | null;
  total: number | null;
  negative: number | null;
  headline: string | null;
  /** Destinatarios a los que se envió. */
  sent: number | null;
  mentionIds: string[];
}

export interface Episode {
  /** Días del primer y del último aviso. */
  from: string;
  to: string;
  days: number;
  alertIds: string[];
  /** Cierre diario más alto entre `from` y `to`; null sin serie diaria de esos días. */
  peak: { score: number; day: string } | null;
  /** Sigue abierto según `crisis_episodes`. */
  open: boolean;
}

function dayDiff(a: string, b: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/**
 * Agrupa avisos de crisis en episodios: dos avisos pertenecen al mismo
 * episodio si entre sus días detonantes hay como mucho `gapDays` (3: un
 * episodio aguanta un fin de semana flojo sin partirse). Los avisos anteriores
 * a COR-02 no tienen episodio guardado, así que se reconstruye por cercanía.
 * Devuelve los episodios del más reciente al más antiguo.
 */
export function groupEpisodes(
  alerts: AlertRow[],
  dailyScores: Map<string, number>,
  opts: { gapDays?: number; openFromDay?: string | null } = {},
): Episode[] {
  const gap = opts.gapDays ?? 3;
  const sorted = [...alerts].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const groups: AlertRow[][] = [];
  for (const a of sorted) {
    const last = groups[groups.length - 1];
    if (last && dayDiff(last[last.length - 1].day, a.day) <= gap) last.push(a);
    else groups.push([a]);
  }
  return groups.map((g) => {
    const from = g[0].day;
    const to = g[g.length - 1].day;
    let peak: Episode['peak'] = null;
    for (const [day, score] of dailyScores) {
      if (day < from || day > to) continue;
      if (!peak || score > peak.score) peak = { score, day };
    }
    return {
      from,
      to,
      days: dayDiff(from, to) + 1,
      alertIds: g.map((a) => a.id).reverse(),
      peak,
      open: !!opts.openFromDay && to >= opts.openFromDay,
    };
  }).reverse();
}

/** Días de la serie que cerraron en o sobre el umbral y no tuvieron aviso. */
export function daysOverWithoutAlert(
  series: Array<{ date: string; score: number | null }>,
  alertDays: Set<string>,
  threshold: number,
  today: string,
): string[] {
  return series
    .filter((p) => p.date !== today && p.score != null && Math.round(p.score * 100) >= Math.round(threshold * 100) && !alertDays.has(p.date))
    .map((p) => p.date);
}

export interface AlertsWindow {
  /** Bordes del periodo elegido (YYYY-MM-DD, días de Puerto Rico, inclusivos). */
  from: string;
  to: string;
  days: number;
  /** Primer día del gráfico: puede abrir antes que `from` o después (ver abajo). */
  seriesFrom: string;
  /** El periodo es más corto que el gráfico mínimo y se le añadió contexto. */
  seriesExtended: boolean;
  /** El periodo es más largo que el gráfico máximo y se recortó a lo más reciente. */
  seriesTruncated: boolean;
}

export const ALERTS_DEFAULT_DAYS = 31;
/** Un gráfico de una o dos columnas no dice nada: mínimo una semana. */
export const ALERTS_MIN_SERIES_DAYS = 7;
/** Más de 120 columnas no se leen en 1,100 px. */
export const ALERTS_MAX_SERIES_DAYS = 120;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Ventana de la pantalla a partir del selector de fechas del encabezado.
 * `from`/`to` válidos mandan; sin ellos, los últimos 31 días hasta hoy. Un
 * `to` futuro se recorta a hoy. Los AVISOS se listan con el periodo exacto;
 * el GRÁFICO se ajusta para ser legible: mínimo 7 columnas (con días de
 * contexto anteriores al periodo) y máximo 120 (las más recientes).
 */
export function resolveAlertsWindow(fromParam: string | null, toParam: string | null, today: string): AlertsWindow {
  let from: string;
  let to: string;
  if (fromParam && toParam && YMD.test(fromParam) && YMD.test(toParam) && fromParam <= toParam && fromParam <= today) {
    from = fromParam;
    to = toParam > today ? today : toParam;
  } else {
    to = today;
    from = shiftYmd(today, -(ALERTS_DEFAULT_DAYS - 1));
  }
  const days = dayDiff(from, to) + 1;
  let seriesFrom = from;
  const seriesExtended = days < ALERTS_MIN_SERIES_DAYS;
  const seriesTruncated = days > ALERTS_MAX_SERIES_DAYS;
  if (seriesExtended) seriesFrom = shiftYmd(to, -(ALERTS_MIN_SERIES_DAYS - 1));
  if (seriesTruncated) seriesFrom = shiftYmd(to, -(ALERTS_MAX_SERIES_DAYS - 1));
  return { from, to, days, seriesFrom, seriesExtended, seriesTruncated };
}
