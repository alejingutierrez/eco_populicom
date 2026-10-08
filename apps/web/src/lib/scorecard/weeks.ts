/**
 * Scorecard (oct-2026): las últimas semanas de la agencia y su rango usual.
 *
 * Cada semana es una ventana de 7 días que termina el mismo día que la
 * ventana del usuario, y sus índices se calculan con el MISMO
 * `calculateMetrics` que los KPI de arriba (agregados del periodo + 30
 * snapshots previos de historia), así que la semana actual de la cuadrícula
 * coincide con los KPI cuando el periodo es 7D. Las menciones se cuentan en
 * el universo pertinente, igual que el KPI de volumen.
 *
 * Lo usual = la mitad central (P25–P75) de las semanas anteriores desde el
 * 20-abr-2026: ese día cambió la calibración del sentimiento (DDEC pasó de
 * 54% a 6% de positivas) y mezclar semanas de antes compararía dos escalas.
 */
import { MIN_WINDOW_MENTIONS, addDaysYmd, calculateMetrics, type DailyAggregates, type HistoricalSnapshot } from '@eco/shared';

/** Primer lunes después del quiebre de serie del 19-abr-2026. */
export const BASELINE_FROM = '2026-04-20';
/** Semanas que muestra la cuadrícula. */
export const WEEKS_SHOWN = 12;
/** Semanas como máximo para calcular lo usual (un año). */
export const BASELINE_MAX_WEEKS = 52;

export interface DayAggregates extends DailyAggregates {
  /** YYYY-MM-DD en hora de Puerto Rico. */
  date: string;
}
export interface SnapshotRow extends HistoricalSnapshot {
  brandHealthIndex: number | null;
  crisisRiskScore: number | null;
  polarizationIndex: number | null;
}
export interface DailyCount { date: string; positive: number; neutral: number; negative: number }

const ZERO: DailyAggregates = {
  totalMentions: 0, positiveCount: 0, neutralCount: 0, negativeCount: 0, highPertinenceCount: 0,
  relevantMentionsCount: 0, relevantNegativeCount: 0, totalLikes: 0, totalComments: 0, totalShares: 0,
  totalReach: 0, totalImpact: 0, totalEngagementScore: 0,
};
const KEYS = Object.keys(ZERO) as (keyof DailyAggregates)[];

/** Suma los agregados diarios de [start, end] (inclusivos). */
export function sumAggregates(days: DayAggregates[], start: string, end: string): DailyAggregates {
  const out = { ...ZERO };
  for (const d of days) {
    if (d.date < start || d.date > end) continue;
    for (const k of KEYS) out[k] += Number(d[k]) || 0;
  }
  return out;
}

/** Los 30 snapshots ESTRICTAMENTE anteriores a `start`, del más reciente al más viejo (como loadHistoryBeforeWindow). */
export function historyBefore(snaps: SnapshotRow[], start: string): HistoricalSnapshot[] {
  return snaps.filter((s) => s.date < start).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
}

export interface WindowIndices {
  nss: number | null;
  /** 0–1 */
  crisis: number | null;
  /** 0–1 (la UI lo muestra 1–10) */
  bhi: number | null;
  polarization: number | null;
}

/** Índices de una ventana, idénticos a loadMetricsForWindow (incluido el mínimo de menciones). */
export function windowIndices(days: DayAggregates[], snaps: SnapshotRow[], start: string, end: string): WindowIndices {
  const agg = sumAggregates(days, start, end);
  if (agg.totalMentions < MIN_WINDOW_MENTIONS) return { nss: null, crisis: null, bhi: null, polarization: null };
  const windowDays = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000) + 1;
  const m = calculateMetrics(agg, historyBefore(snaps, start), windowDays);
  return { nss: m.nss, crisis: m.crisisRiskScore, bhi: m.brandHealthIndex, polarization: m.polarizationIndex };
}

export interface WeekRow {
  start: string;
  end: string;
  /** Menciones pertinentes. */
  n: number;
  nss: number | null;
  /** 0–100 */
  crisis: number | null;
  /** 1–10 */
  bhi: number | null;
  polarization: number | null;
}
export interface UsualRange { p25: number; p75: number; median: number; weeks: number }
export type UsualKey = 'n' | 'nss' | 'crisis' | 'bhi' | 'polarization';

const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

/** Percentil con interpolación lineal (como numpy). */
export function percentile(sorted: number[], p: number): number {
  const k = (sorted.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

export function weekRow(days: DayAggregates[], snaps: SnapshotRow[], counts: DailyCount[], end: string): WeekRow {
  const start = addDaysYmd(end, -6);
  const idx = windowIndices(days, snaps, start, end);
  const n = counts.filter((c) => c.date >= start && c.date <= end).reduce((s, c) => s + c.positive + c.neutral + c.negative, 0);
  return {
    start, end, n,
    nss: r1(idx.nss),
    crisis: idx.crisis == null ? null : r1(idx.crisis * 100),
    bhi: idx.bhi == null ? null : Math.round((1 + 9 * idx.bhi) * 100) / 100,
    polarization: r1(idx.polarization),
  };
}

/**
 * Las últimas `WEEKS_SHOWN` semanas que terminan en `endYmd` (la más reciente
 * al final) y lo usual de cada indicador, sobre las semanas ANTERIORES a la
 * actual que empiezan en o después de `BASELINE_FROM`.
 */
export function buildWeeks(args: { days: DayAggregates[]; snaps: SnapshotRow[]; counts: DailyCount[]; endYmd: string }) {
  const { days, snaps, counts, endYmd } = args;
  const ends: string[] = [];
  for (let k = 0; k < BASELINE_MAX_WEEKS + 1; k++) {
    const end = addDaysYmd(endYmd, -7 * k);
    if (k >= WEEKS_SHOWN && addDaysYmd(end, -6) < BASELINE_FROM) break;
    ends.push(end);
  }
  const rows = ends.map((e) => weekRow(days, snaps, counts, e)).reverse(); // del más viejo al más reciente
  const past = rows.slice(0, -1).filter((w) => w.start >= BASELINE_FROM);
  const usual = {} as Record<UsualKey, UsualRange | null>;
  for (const k of ['n', 'nss', 'crisis', 'bhi', 'polarization'] as UsualKey[]) {
    const vals = past.map((w) => w[k]).filter((v): v is number => v != null).sort((a, b) => a - b);
    usual[k] = vals.length >= 4
      ? { p25: r1(percentile(vals, 0.25))!, p75: r1(percentile(vals, 0.75))!, median: r1(percentile(vals, 0.5))!, weeks: vals.length }
      : null;
  }
  return { weeks: rows.slice(-WEEKS_SHOWN), usual, baselineFrom: BASELINE_FROM };
}
