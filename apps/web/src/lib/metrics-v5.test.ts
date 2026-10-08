/**
 * Índices V5 (oct-2026): las propiedades que motivaron el cambio, como pruebas.
 * Ver el encabezado de packages/shared/src/metrics.ts.
 */
import { MIN_WINDOW_MENTIONS, calculateMetrics, loadMetricsForWindow, type DailyAggregates, type HistoricalSnapshot } from '@eco/shared';

function agg(over: Partial<DailyAggregates> = {}): DailyAggregates {
  return {
    totalMentions: 100, positiveCount: 5, neutralCount: 65, negativeCount: 30, highPertinenceCount: 40,
    relevantMentionsCount: 80, relevantNegativeCount: 25, totalLikes: 300, totalComments: 50, totalShares: 20,
    totalReach: 20_000, totalImpact: 0, totalEngagementScore: 900, ...over,
  };
}

/** 30 días previos iguales (el más reciente primero, como loadHistoryBeforeWindow). */
function history(over: Partial<HistoricalSnapshot> = {}): HistoricalSnapshot[] {
  return Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(30 - i).padStart(2, '0')}`, totalMentions: 100, negativeCount: 30, nss: -25,
    totalReach: 20_000, totalEngagementScore: 900, engagementRate: 1.85, ...over,
  }));
}

describe('Polarización V5: que haya dos bandos', () => {
  test('sin positivas no hay polarización, aunque haya muchas negativas', () => {
    expect(calculateMetrics(agg({ positiveCount: 0, neutralCount: 40, negativeCount: 60 }), history()).polarizationIndex).toBe(0);
  });
  test('mitad a favor y mitad en contra, sin neutrales, es 100', () => {
    expect(calculateMetrics(agg({ positiveCount: 50, neutralCount: 0, negativeCount: 50 }), history()).polarizationIndex).toBe(100);
  });
  test('cuenta el bando más chico: 10 a favor y 30 en contra de 100 → 20', () => {
    expect(calculateMetrics(agg({ positiveCount: 10, neutralCount: 60, negativeCount: 30 }), history()).polarizationIndex).toBe(20);
  });
});

describe('Brand Health V5: los componentes son de la propia ventana', () => {
  test('la historia previa no cambia el índice', () => {
    const a = calculateMetrics(agg(), history({ nss: 60, engagementRate: 5, totalReach: 9_000_000 }));
    const b = calculateMetrics(agg(), history({ nss: -60, engagementRate: 0.1, totalReach: 10 }));
    expect(a.brandHealthIndex).toBe(b.brandHealthIndex);
  });
  test('sube cuando el NSS de la ventana sube', () => {
    const worse = calculateMetrics(agg({ positiveCount: 5, negativeCount: 30, neutralCount: 65 }), history());
    const better = calculateMetrics(agg({ positiveCount: 15, negativeCount: 20, neutralCount: 65 }), history());
    expect(better.brandHealthIndex!).toBeGreaterThan(worse.brandHealthIndex!);
  });
  test('el alcance es continuo: un punto de NSS no hace saltar el índice', () => {
    // V2 tenía un escalón de ~0.10 en NSS = −20 (signo del NSS); aquí −19 y −21 quedan pegados.
    const a = calculateMetrics(agg({ positiveCount: 6, negativeCount: 25, neutralCount: 69 }), history()); // NSS −19
    const b = calculateMetrics(agg({ positiveCount: 6, negativeCount: 27, neutralCount: 67 }), history()); // NSS −21
    expect(Math.abs(a.brandHealthIndex! - b.brandHealthIndex!)).toBeLessThan(0.02);
  });
});

describe('Riesgo de crisis V5', () => {
  test('sin negativas no hay piso: el riesgo es 0', () => {
    const m = calculateMetrics(agg({ positiveCount: 10, neutralCount: 90, negativeCount: 0, highPertinenceCount: 100 }), history());
    expect(m.crisisRiskScore).toBe(0);
    expect(m.crisisRelevance).toBeNull();
  });
  test('un pico de menciones NEUTRALES no sube la velocidad', () => {
    const m = calculateMetrics(agg({ totalMentions: 400, neutralCount: 365, negativeCount: 30 }), history());
    expect(m.crisisVelocity).toBe(0);
  });
  test('un pico de NEGATIVAS sí sube la velocidad', () => {
    const steady = history().map((h, i) => ({ ...h, negativeCount: i % 2 ? 28 : 32 }));
    const m = calculateMetrics(agg({ totalMentions: 200, neutralCount: 80, negativeCount: 115 }), steady);
    expect(m.crisisVelocity).toBe(1);
  });
  test('tan negativa como siempre: la mitad «contra lo usual» no suma', () => {
    const m = calculateMetrics(agg(), history()); // 30% negativas hoy y en lo usual
    expect(m.crisisBaselineNegShare).toBe(0.3);
    expect(m.crisisSeverity).toBeCloseTo(0.5 * (0.3 / 0.7), 3);
  });
  test('25 puntos más negativa que lo usual satura la mitad relativa', () => {
    const m = calculateMetrics(agg({ neutralCount: 40, negativeCount: 55 }), history());
    expect(m.crisisSeverity).toBeCloseTo(0.5 * (0.55 / 0.7) + 0.5, 3);
  });
  test('sin 7 días de historia, la severidad es solo la absoluta', () => {
    const m = calculateMetrics(agg(), history().slice(0, 3));
    expect(m.crisisBaselineNegShare).toBeNull();
    expect(m.crisisSeverity).toBeCloseTo(0.3 / 0.7, 3);
  });
});

describe('Muestra mínima por ventana', () => {
  const row = (total: number) => ({
    total_mentions: total, positive_count: 1, neutral_count: total - 3, negative_count: 2, high_pertinence_count: 2,
    relevant_mentions_count: 3, relevant_negative_count: 1, total_likes: 0, total_comments: 0, total_shares: 0,
    total_reach: 0, total_impact: 0, total_engagement_score: 0,
  });
  const client = (total: number) => ({
    query: async (sql: string) => ({ rows: sql.includes('FROM mentions') ? [row(total)] : [], rowCount: 1 }),
  });

  test(`con menos de ${MIN_WINDOW_MENTIONS} menciones no se publican índices, pero sí los totales`, async () => {
    const w = await loadMetricsForWindow(client(MIN_WINDOW_MENTIONS - 1) as never, 'a', '2026-10-01', '2026-10-07');
    expect(w.lowSample).toBe(true);
    expect([w.nss, w.brandHealthIndex, w.crisisRiskScore, w.polarizationIndex]).toEqual([null, null, null, null]);
    expect(w.totals.total).toBe(MIN_WINDOW_MENTIONS - 1);
  });
  test(`con ${MIN_WINDOW_MENTIONS} sí`, async () => {
    const w = await loadMetricsForWindow(client(MIN_WINDOW_MENTIONS) as never, 'a', '2026-10-01', '2026-10-07');
    expect(w.lowSample).toBe(false);
    expect(w.nss).not.toBeNull();
  });
  test('la consulta de la ventana usa el universo pertinente', async () => {
    const seen: string[] = [];
    const c = { query: async (sql: string) => { seen.push(sql); return { rows: sql.includes('FROM mentions') ? [row(30)] : [], rowCount: 1 }; } };
    await loadMetricsForWindow(c as never, 'a', '2026-10-01', '2026-10-07');
    const q = seen.find((s) => s.includes('FROM mentions'))!;
    expect(q).toContain('is_duplicate = false');
    expect(q).toContain("(nlp_pertinence IS NULL OR nlp_pertinence <> 'baja')");
  });
});
