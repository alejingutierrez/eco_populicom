import { calculateMetrics, addDaysYmd } from '@eco/shared';
import { buildWeeks, historyBefore, percentile, sumAggregates, windowIndices, BASELINE_FROM, WEEKS_SHOWN, type DayAggregates, type SnapshotRow } from './weeks';

function day(date: string, o: Partial<DayAggregates> = {}): DayAggregates {
  return { date, totalMentions: 20, positiveCount: 2, neutralCount: 15, negativeCount: 3, highPertinenceCount: 12,
    relevantMentionsCount: 16, relevantNegativeCount: 3, totalLikes: 40, totalComments: 10, totalShares: 5,
    totalReach: 5000, totalImpact: 10, totalEngagementScore: 55, ...o };
}
function snap(date: string, o: Partial<SnapshotRow> = {}): SnapshotRow {
  return { date, totalMentions: 20, negativeCount: 3, nss: -5, totalReach: 5000, totalEngagementScore: 55, engagementRate: 1.1,
    brandHealthIndex: 0.45, crisisRiskScore: 0.2, polarizationIndex: 25, ...o };
}
const range = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDaysYmd(d, 1)) out.push(d); return out; };

describe('semanas del Scorecard', () => {
  const END = '2026-10-06';
  const dates = range('2026-02-01', END);
  const days = dates.map((d, i) => day(d, { negativeCount: i % 7, totalMentions: 18 + (i % 5) }));
  const snaps = dates.map((d, i) => snap(d, { nss: -10 + (i % 9), totalMentions: 18 + (i % 5) }));
  const counts = dates.map((d) => ({ date: d, positive: 1, neutral: 10, negative: 2 }));

  test('los índices de una ventana son los de calculateMetrics (como loadMetricsForWindow)', () => {
    const start = '2026-09-30';
    const agg = sumAggregates(days, start, END);
    const ref = calculateMetrics(agg, historyBefore(snaps, start), 7);
    expect(windowIndices(days, snaps, start, END)).toEqual({ nss: ref.nss, crisis: ref.crisisRiskScore, bhi: ref.brandHealthIndex, polarization: ref.polarizationIndex });
    expect(agg.totalMentions).toBe(days.filter((d) => d.date >= start).reduce((s, d) => s + d.totalMentions, 0));
  });

  test('la historia son los 30 snapshots previos al inicio, del más reciente al más viejo', () => {
    const h = historyBefore(snaps, '2026-09-30');
    expect(h).toHaveLength(30);
    expect(h[0].date).toBe('2026-09-29');
    expect(h[29].date).toBe('2026-08-31');
  });

  test('12 semanas que terminan en el último día, la más reciente al final', () => {
    const r = buildWeeks({ days, snaps, counts, endYmd: END });
    expect(r.weeks).toHaveLength(WEEKS_SHOWN);
    expect(r.weeks[11]).toMatchObject({ start: '2026-09-30', end: END, n: 7 * 13 });
    expect(r.weeks[10].end).toBe('2026-09-29');
    expect(r.weeks[0].end).toBe('2026-07-21');
  });

  test('lo usual usa solo semanas previas que empiezan después del quiebre de serie', () => {
    const r = buildWeeks({ days, snaps, counts, endYmd: END });
    // 30 sep es la actual; las previas que empiezan en o después del 20 abr.
    let weeks = 0;
    for (let k = 1; addDaysYmd(addDaysYmd(END, -7 * k), -6) >= BASELINE_FROM; k++) weeks++;
    expect(r.usual.n?.weeks).toBe(weeks);
    expect(r.usual.n).toMatchObject({ p25: 91, p75: 91, median: 91 });
    expect(r.baselineFrom).toBe(BASELINE_FROM);
  });

  test('percentil con interpolación', () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
  });
});
