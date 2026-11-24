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
