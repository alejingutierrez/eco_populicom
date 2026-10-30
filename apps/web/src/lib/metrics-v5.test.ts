/**
 * Índices V5 (oct-2026): las propiedades que motivaron el cambio, como pruebas.
 * Ver el encabezado de packages/shared/src/metrics.ts.
 */
import { MIN_WINDOW_MENTIONS, calculateMetrics, loadMetricsForWindow, longUsualNegShare, type DailyAggregates, type HistoricalSnapshot } from '@eco/shared';

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
  test('V5.1: un pico de negativas que solo acompaña al volumen (% igual o menor que lo usual) no sube la velocidad', () => {
    const steady = history().map((h, i) => ({ ...h, negativeCount: i % 2 ? 28 : 32 })); // usual 30%
    // 4× el volumen y 4× las negativas absolutas (z enorme), pero 27.9% < 30%.
    const m = calculateMetrics(agg({ totalMentions: 430, positiveCount: 60, neutralCount: 250, negativeCount: 120 }), steady);
    expect(m.crisisVelocity).toBe(0);
  });
  test('V5.1: caso real DDEC 27-oct (155 menciones, 12 negativas, usual ~10%) no llega a Alerta', () => {
    const usual = history({ totalMentions: 20, negativeCount: 2 }); // 10% usual, ~2 negativas/día
    const m = calculateMetrics(agg({ totalMentions: 155, positiveCount: 39, neutralCount: 104, negativeCount: 12 }), usual);
    expect(m.crisisVelocity).toBe(0);
    expect(m.crisisRiskScore!).toBeLessThan(0.25); // Normal (antes: velocidad 1.0 → 0.53 = Alerta)
  });
  describe('V5.2: la velocidad entra en rampa hasta 6 puntos sobre lo usual', () => {
    const steady = () => history().map((h, i) => ({ ...h, negativeCount: i % 2 ? 28 : 32 })); // usual 30%, ~30 negativas/día
    // 400 menciones y las negativas indicadas: el z absoluto es enorme (satura en 1), así que la velocidad es la rampa pura.
    const at = (negativeCount: number) =>
      calculateMetrics(agg({ totalMentions: 400, positiveCount: 40, neutralCount: 360 - negativeCount, negativeCount }), steady());

    test('en lo usual o por debajo la velocidad es 0', () => {
      expect(at(120).crisisVelocity).toBe(0); // 30.0%
      expect(at(110).crisisVelocity).toBe(0); // 27.5%
    });
    test('apenas por encima de lo usual casi no cuenta (antes del gate binario contaba entera)', () => {
      expect(at(122).crisisVelocity).toBeCloseTo(0.5 / 6, 2); // 30.5%
    });
    test('es lineal: a 3 puntos sobre lo usual cuenta la mitad', () => {
      expect(at(132).crisisVelocity).toBeCloseTo(0.5, 2); // 33%
    });
    test('a 6 puntos o más sobre lo usual cuenta entera', () => {
      expect(at(144).crisisVelocity).toBe(1); // 36%
      expect(at(200).crisisVelocity).toBe(1); // 50%: mayoritariamente negativa
    });
    test('caso real DDEC 28-oct (160 menciones, 20 negativas = 12.5% vs ~10.5% usual) ya no es Alerta', () => {
      const usual = history({ totalMentions: 19, negativeCount: 2 }); // 10.5% usual, ~2 negativas/día
      const m = calculateMetrics(agg({ totalMentions: 160, positiveCount: 24, neutralCount: 116, negativeCount: 20 }), usual);
      expect(m.crisisBaselineNegShare).toBe(0.105);
      expect(m.crisisVelocity).toBeCloseTo(0.33, 2); // z enorme, pero solo 2 puntos sobre lo usual
      expect(m.crisisRiskScore!).toBeLessThan(0.25); // Normal (con el gate binario: velocidad 1.0 → 0.56 = Alerta)
    });
    test('un pico real sigue arriba: 24.8% vs 12% usual (Gobernadora 21-jul) conserva la velocidad entera', () => {
      const usual = history({ totalMentions: 100, negativeCount: 12 });
      const m = calculateMetrics(agg({ totalMentions: 222, positiveCount: 10, neutralCount: 157, negativeCount: 55 }), usual);
      expect(m.crisisVelocity).toBe(1);
      expect(m.crisisRiskScore!).toBeGreaterThanOrEqual(0.6); // Crisis
    });
  });
  describe('V5.1: excepción para conversaciones mayoritariamente negativas (≥50%)', () => {
    // Agencia crítica por naturaleza (como AAA): usual 70% de negativas, ~14/día.
    const chronic = () => history().map((h, i) => ({ ...h, totalMentions: 20, negativeCount: i % 2 ? 13 : 15 }));

    test('caso real AAA 9–15 jun (460 menciones, 254 negativas = 55% vs 69% usual) sigue siendo Crisis', () => {
      const m = calculateMetrics(agg({ totalMentions: 460, positiveCount: 6, neutralCount: 200, negativeCount: 254 }), chronic(), 7);
      expect(m.crisisBaselineNegShare).toBe(0.7);
      expect(m.crisisVelocity).toBe(1); // 55% < 70% usual, pero ≥ 50%: la velocidad cuenta
      expect(m.crisisRiskScore!).toBeGreaterThanOrEqual(0.6); // Crisis (con el gate simple habría sido 0.20)
    });
    test('justo en 50% cuenta; en 49% no', () => {
      const at = calculateMetrics(agg({ totalMentions: 400, positiveCount: 0, neutralCount: 200, negativeCount: 200 }), chronic(), 7);
      const below = calculateMetrics(agg({ totalMentions: 400, positiveCount: 0, neutralCount: 204, negativeCount: 196 }), chronic(), 7);
      expect(at.crisisVelocity).toBe(1);
      expect(below.crisisVelocity).toBe(0);
    });
    test('no rescata el caso DDEC: 7.7% de negativas con volumen 10× sigue sin velocidad', () => {
      const usual = history({ totalMentions: 20, negativeCount: 2 });
      expect(calculateMetrics(agg({ totalMentions: 155, positiveCount: 39, neutralCount: 104, negativeCount: 12 }), usual).crisisVelocity).toBe(0);
    });
  });
  test('V5.1: sin baseline (historia sin menciones) la velocidad no se condiciona', () => {
    const empty = history({ totalMentions: 0, negativeCount: 0 });
    const m = calculateMetrics(agg({ totalMentions: 100, neutralCount: 70, negativeCount: 25 }), empty);
    expect(m.crisisBaselineNegShare).toBeNull();
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

describe('Riesgo de crisis V5.3: una crisis sostenida no se vuelve «lo usual»', () => {
  /** `days` snapshots que terminan el 24-oct-2026, el más reciente primero; `at(i)` da [menciones, negativas] del día i (0 = 24-oct). */
  function dated(days: number, at: (i: number) => [number, number]): HistoricalSnapshot[] {
    return Array.from({ length: days }, (_, i) => {
      const [totalMentions, negativeCount] = at(i);
      return {
        date: new Date(Date.UTC(2026, 9, 24 - i)).toISOString().slice(0, 10), totalMentions, negativeCount, nss: -25,
        totalReach: 20_000, totalEngagementScore: 900, engagementRate: 1.85,
      };
    });
  }
  // DF: 30 días de crisis (200 menciones/día, 65% negativas) sobre 60 tranquilos (40/día, 15%).
  const df = dated(90, (i) => (i < 30 ? [200, 130] : [40, 6]));
  const window55 = agg({ totalMentions: 185, positiveCount: 10, neutralCount: 73, negativeCount: 102 });

  test('DF 24–28-oct: con 55% de negativas ya no es «más tranquilo que lo usual»', () => {
    const before = calculateMetrics(window55, df.slice(0, 30), 5); // V5.2: solo 30 días de historia
    const after = calculateMetrics(window55, df, 5);
    expect(before.crisisBaselineNegShare).toBe(0.65);
    expect(before.crisisRiskScore!).toBeLessThan(0.25); // Normal
    expect(after.crisisBaselineNegShare!).toBeLessThan(0.4);
    expect(after.crisisRiskScore!).toBeGreaterThanOrEqual(0.25);
  });
  test('los días de crisis, de mucho volumen, no dominan la referencia larga', () => {
    // Sin el tope en la mediana sería (30·130 + 60·6) / (30·200 + 60·40) = 51%.
    expect(longUsualNegShare(df)!).toBeLessThan(0.35);
  });
  test('si los últimos 30 días no se apartan más de 5 puntos de la referencia larga, lo usual no cambia', () => {
    const steady = dated(90, (i) => (i < 30 ? [100, 33] : [100, 30])); // 33% vs 31%
    expect(calculateMetrics(agg(), steady).crisisBaselineNegShare).toBe(0.33);
  });
  test('la referencia larga no cruza el quiebre de serie del 20-abr-2026', () => {
    // 30 días de 13-may a 11-jun en 60%; antes del quiebre, 15%. Desde el 20-abr hay 23 días más en 60%.
    const h = Array.from({ length: 90 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 5, 11 - i)).toISOString().slice(0, 10);
      return { date, totalMentions: 100, negativeCount: date >= '2026-04-20' ? 60 : 15, nss: -25, totalReach: 20_000, totalEngagementScore: 900, engagementRate: 1.85 };
    });
    expect(longUsualNegShare(h)).toBe(0.6);
    expect(calculateMetrics(agg(), h).crisisBaselineNegShare).toBe(0.6);
  });
  test('acepta fechas como Date (pg devuelve DATE así en el lambda)', () => {
    const asDates = df.map((h) => ({ ...h, date: new Date(h.date + 'T00:00:00Z') as unknown as string }));
    expect(longUsualNegShare(asDates)).toBe(longUsualNegShare(df));
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
