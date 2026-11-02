import { clusteredMean, cohenKappa, kappaBand, mean, sd } from '@eco/shared/src/advisor/eval/stats';
import { decide, COUNCIL_MARGIN_POINTS, PANEL_MARGIN_POINTS, type DecisionInput } from '@eco/shared/src/advisor/eval/decision';

describe('estadística', () => {
  test('media y desviación', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(sd([1, 2, 3])).toBeCloseTo(1);
    expect(mean([])).toBeNaN();
  });

  test('SE agrupado: repeticiones del mismo episodio no cuentan como crisis distintas', () => {
    // 4 episodios, 3 repeticiones idénticas por episodio.
    const vals = (ys: number[]) => ys.flatMap((y, g) => [0, 1, 2].map(() => ({ cluster: `e${g}`, y })));
    const cm = clusteredMean(vals([100, 0, 100, 0]));
    expect(cm.n).toBe(12);
    expect(cm.clusters).toBe(4);
    expect(cm.mean).toBe(50);
    // Con 4 clústeres, el SE es el de 4 observaciones (no el de 12): sd=57.7 → 57.7/2 = 28.9
    expect(cm.se).toBeCloseTo(28.87, 1);
    // Ingenuo (12 obs independientes) sería ~16.7: el agrupado es mayor.
    expect(cm.se).toBeGreaterThan(sd(vals([100, 0, 100, 0]).map((v) => v.y)) / Math.sqrt(12));
  });

  test('SE agrupado con un solo clúster no se inventa', () => {
    expect(clusteredMean([{ cluster: 'a', y: 1 }, { cluster: 'a', y: 3 }]).se).toBeNaN();
    expect(clusteredMean([]).n).toBe(0);
  });

  test('kappa de Cohen: acuerdo perfecto, azar y casos conocidos', () => {
    expect(cohenKappa(['X', 'Y', 'X', 'Y'], ['X', 'Y', 'X', 'Y'])).toBe(1);
    expect(cohenKappa(['X', 'X', 'Y', 'Y'], ['X', 'Y', 'X', 'Y'])).toBe(0);
    // Ejemplo clásico: po = 0.7, pe = 0.5 → 0.4
    const a = [...Array(20).fill('s'), ...Array(5).fill('s'), ...Array(5).fill('n'), ...Array(20).fill('n')];
    const b = [...Array(20).fill('s'), ...Array(5).fill('n'), ...Array(5).fill('s'), ...Array(20).fill('n')];
    expect(cohenKappa(a, b)).toBeCloseTo(0.6, 5);
    expect(cohenKappa([], [])).toBeNaN();
    expect(() => cohenKappa(['a'], [])).toThrow();
    expect(cohenKappa(['a', 'a'], ['a', 'a'])).toBe(1);
  });

  test('bandas de kappa', () => {
    expect(kappaBand(0.9)).toBe('casi perfecto');
    expect(kappaBand(0.5)).toBe('moderado');
    expect(kappaBand(-0.1)).toBe('peor que el azar');
    expect(kappaBand(NaN)).toBe('sin datos');
  });
});

const base = (o: Partial<DecisionInput> = {}): DecisionInput => ({
  cVsA2: { points: 20, se: 3 }, bVsA: { points: 12, se: 2 },
  brier: { c: 0.1, a2: 0.12 }, citeRate: { c: 0.95, a2: 0.93 }, ...o,
});

describe('regla de decisión §13.3', () => {
  test('constantes del spec', () => {
    expect(COUNCIL_MARGIN_POINTS).toBe(15);
    expect(PANEL_MARGIN_POINTS).toBe(10);
  });

  test('el consejo se queda: gana por ≥15 y no empeora Brier ni citas', () => {
    const r = decide(base());
    expect(r.council).toBe('consejo_se_queda');
    expect(r.councilAsVisibleDeliberationMode).toBe(false);
    expect(r.panel).toBe('panel_se_queda');
  });

  test('exactamente 15 puntos cuenta como ganar; 14.99 no', () => {
    expect(decide(base({ cVsA2: { points: 15, se: 1 } })).council).toBe('consejo_se_queda');
    expect(decide(base({ cVsA2: { points: 14.99, se: 1 } })).council).toBe('camino3_es_a2_con_premortem');
  });

  test('si el Brier empeora, el consejo no se queda aunque gane por mucho', () => {
    const r = decide(base({ brier: { c: 0.13, a2: 0.12 } }));
    expect(r.council).toBe('camino3_es_a2_con_premortem');
    expect(r.councilAsVisibleDeliberationMode).toBe(true);
    expect(r.reasons.join(' ')).toContain('empeora');
  });

  test('si la tasa de citas válidas empeora, el consejo no se queda', () => {
    expect(decide(base({ citeRate: { c: 0.9, a2: 0.93 } })).council).toBe('camino3_es_a2_con_premortem');
  });

  test('Brier o citas iguales no «empeoran»', () => {
    expect(decide(base({ brier: { c: 0.12, a2: 0.12 }, citeRate: { c: 0.93, a2: 0.93 } })).council).toBe('consejo_se_queda');
  });

  test('el panel: 10 puntos exactos se queda; 9.9 pasa el camino 2 a (a)', () => {
    expect(decide(base({ bVsA: { points: 10, se: 1 } })).panel).toBe('panel_se_queda');
    expect(decide(base({ bVsA: { points: 9.9, se: 1 } })).panel).toBe('camino2_es_a');
    expect(decide(base({ bVsA: { points: -30, se: 5 } })).panel).toBe('camino2_es_a');
  });

  test('sin datos no se decide ni se inventa: pendiente_datos con la razón', () => {
    const r = decide(base({ brier: { c: null, a2: 0.1 } }));
    expect(r.council).toBe('pendiente_datos');
    expect(r.reasons.join(' ')).toContain('Brier');
    expect(decide(base({ cVsA2: { points: null, se: null } })).council).toBe('pendiente_datos');
    expect(decide(base({ bVsA: { points: null, se: null } })).panel).toBe('pendiente_datos');
  });

  test('el SE no mueve el umbral, solo avisa si el IC95 lo cruza', () => {
    const r = decide(base({ cVsA2: { points: 16, se: 5 } }));
    expect(r.council).toBe('consejo_se_queda'); // la regla decide por el punto estimado
    expect(r.councilIndistinguishable).toBe(true);
    expect(r.reasons.join(' ')).toContain('cruza el umbral');
    expect(decide(base({ cVsA2: { points: 30, se: 2 } })).councilIndistinguishable).toBe(false);
    expect(decide(base({ cVsA2: { points: 30, se: null } })).councilIndistinguishable).toBeNull();
  });
});
