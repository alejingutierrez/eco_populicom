import { baseRates, computeEpisodes, type Episode, type SnapshotIn } from '../history';

const AS_OF = '2026-10-28';
const COVER = '2026-09-01';

const snap = (date: string, score: number | null, computedAt: string = '2026-10-20T10:00:00Z'): SnapshotIn => ({ date, score, computedAt });

const ep = (peak: number, diasHastaBajo025: number | null, formulaIncierta = false): Episode => ({
  id: 'E-x',
  start: '2026-10-01',
  end: '2026-10-02',
  durationDays: 2,
  peak: { date: '2026-10-01', score: peak },
  maxBand: peak >= 0.6 ? 'CRISIS' : 'ALERTA',
  alertFired: false,
  formulaIncierta,
  diasHastaBajo025,
});

describe('computeEpisodes: unión y cortes', () => {
  test('dos días consecutivos ≥ 0.40 forman un episodio', () => {
    const eps = computeEpisodes([snap('2026-10-01', 0.5), snap('2026-10-02', 0.45)], COVER, { asOfYmd: AS_OF });
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ start: '2026-10-01', end: '2026-10-02', durationDays: 2, peak: { date: '2026-10-01', score: 0.5 } });
  });

  test('un solo día bajo el umbral entre dos tramos los une', () => {
    const eps = computeEpisodes(
      [snap('2026-10-01', 0.5), snap('2026-10-02', 0.3), snap('2026-10-03', 0.45)],
      COVER,
      { asOfYmd: AS_OF },
    );
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ start: '2026-10-01', end: '2026-10-03', durationDays: 3 });
  });

  test('dos días bajo el umbral separan dos episodios', () => {
    const eps = computeEpisodes(
      [snap('2026-10-01', 0.5), snap('2026-10-02', 0.3), snap('2026-10-03', 0.3), snap('2026-10-04', 0.45)],
      COVER,
      { asOfYmd: AS_OF },
    );
    expect(eps.map((e) => [e.start, e.end])).toEqual([['2026-10-01', '2026-10-01'], ['2026-10-04', '2026-10-04']]);
  });

  test('un día sin snapshot separa los tramos (no es «un día bajo el umbral»)', () => {
    const eps = computeEpisodes([snap('2026-10-01', 0.5), snap('2026-10-03', 0.45)], COVER, { asOfYmd: AS_OF });
    expect(eps).toHaveLength(2);
  });

  test('un score nulo rompe el tramo', () => {
    const eps = computeEpisodes([snap('2026-10-01', 0.5), snap('2026-10-02', null), snap('2026-10-03', 0.45)], COVER, { asOfYmd: AS_OF });
    expect(eps).toHaveLength(2);
  });

  test('0.40 exacto entra; 0.3999 no', () => {
    expect(computeEpisodes([snap('2026-10-01', 0.4)], COVER, { asOfYmd: AS_OF })).toHaveLength(1);
    expect(computeEpisodes([snap('2026-10-01', 0.3999)], COVER, { asOfYmd: AS_OF })).toHaveLength(0);
  });

  test('banda máxima: 0.60 exacto es CRISIS; 0.5999 es ALERTA', () => {
    expect(computeEpisodes([snap('2026-10-01', 0.6)], COVER, { asOfYmd: AS_OF })[0].maxBand).toBe('CRISIS');
    expect(computeEpisodes([snap('2026-10-01', 0.5999)], COVER, { asOfYmd: AS_OF })[0].maxBand).toBe('ALERTA');
  });

  test('excluye los días anteriores al inicio de cobertura', () => {
    const eps = computeEpisodes([snap('2026-08-30', 0.5), snap('2026-08-31', 0.5), snap('2026-09-01', 0.5)], COVER, { asOfYmd: AS_OF });
    expect(eps).toHaveLength(1);
    expect(eps[0].start).toBe('2026-09-01');
  });

  test('sin inicio de cobertura no hay historia', () => {
    expect(computeEpisodes([snap('2026-10-01', 0.9)], null, { asOfYmd: AS_OF })).toEqual([]);
  });
});

describe('computeEpisodes: fórmula, alertas y cierre', () => {
  test('snapshot de más de 45 días calculado antes de V5 marca formula_incierta', () => {
    const eps = computeEpisodes([snap('2026-08-01', 0.5, '2026-09-01T10:00:00Z')], '2026-07-01', { asOfYmd: AS_OF });
    expect(eps[0].formulaIncierta).toBe(true);
  });

  test('snapshot antiguo calculado con V5 no se marca', () => {
    const eps = computeEpisodes([snap('2026-08-01', 0.5, '2026-10-20T10:00:00Z')], '2026-07-01', { asOfYmd: AS_OF });
    expect(eps[0].formulaIncierta).toBe(false);
  });

  test('snapshot de 45 días o menos no se marca aunque venga de V4', () => {
    const eps = computeEpisodes([snap('2026-10-01', 0.5, '2026-09-01T10:00:00Z')], COVER, { asOfYmd: AS_OF });
    expect(eps[0].formulaIncierta).toBe(false);
  });

  test('alerta dentro del episodio (día PR) cuenta; fuera no', () => {
    const rows = [snap('2026-10-01', 0.5), snap('2026-10-02', 0.45)];
    const dentro = computeEpisodes(rows, COVER, { asOfYmd: AS_OF, alertTimes: [new Date('2026-10-02T12:00:00Z')] });
    expect(dentro[0].alertFired).toBe(true);
    const despues = computeEpisodes(rows, COVER, { asOfYmd: AS_OF, alertTimes: [new Date('2026-10-04T12:00:00Z')] });
    expect(despues[0].alertFired).toBe(false);
    // 2026-09-30 23:00 UTC es 19:00 del 30 en PR: antes del episodio.
    const antes = computeEpisodes(rows, COVER, { asOfYmd: AS_OF, alertTimes: [new Date('2026-09-30T23:00:00Z')] });
    expect(antes[0].alertFired).toBe(false);
  });

  test('días hasta bajar de 0.25 se cuentan desde el fin del episodio; 0.25 exacto no cuenta', () => {
    const eps = computeEpisodes(
      [snap('2026-10-01', 0.5), snap('2026-10-02', 0.45), snap('2026-10-03', 0.3), snap('2026-10-04', 0.2)],
      COVER,
      { asOfYmd: AS_OF },
    );
    expect(eps[0].diasHastaBajo025).toBe(2);

    const exacto = computeEpisodes(
      [snap('2026-10-01', 0.5), snap('2026-10-02', 0.45), snap('2026-10-03', 0.25), snap('2026-10-04', 0.24)],
      COVER,
      { asOfYmd: AS_OF },
    );
    expect(exacto[0].diasHastaBajo025).toBe(2);
  });

  test('sin caída por debajo de 0.25 en los datos: null', () => {
    const eps = computeEpisodes([snap('2026-10-01', 0.5), snap('2026-10-02', 0.45)], COVER, { asOfYmd: AS_OF });
    expect(eps[0].diasHastaBajo025).toBeNull();
  });
});

describe('baseRates', () => {
  test('n < 5: sin porcentajes ni mediana, con motivo n<5', () => {
    const r = baseRates([ep(0.7, 1), ep(0.5, 2), ep(0.45, 3), ep(0.6, 4)]);
    expect(r.n).toBe(4);
    expect(r.tasaCrisisDesdeAlerta).toEqual({ n: 4, casos: 2, fraccion: null, porcentaje: null, motivo: 'n<5' });
    expect(r.medianaDiasHastaBajo025.dias).toBeNull();
    expect(r.medianaDiasHastaBajo025.motivo).toBe('n<5');
  });

  test('n = 5: fracción de episodios que llegaron a CRISIS (pico ≥ 0.60)', () => {
    const r = baseRates([ep(0.7, 1), ep(0.45, 2), ep(0.6, 3), ep(0.5, 4), ep(0.42, 5)]);
    expect(r.n).toBe(5);
    expect(r.tasaCrisisDesdeAlerta).toEqual({ n: 5, casos: 2, fraccion: 0.4, porcentaje: 40, motivo: null });
  });

  test('mediana de días hasta < 0.25 con 5 resueltos; con 4 no se da', () => {
    const cinco = baseRates([ep(0.5, 1), ep(0.5, 2), ep(0.5, 3), ep(0.5, 4), ep(0.5, 10)]);
    expect(cinco.medianaDiasHastaBajo025).toEqual({ n: 5, dias: 3, motivo: null });
    const cuatro = baseRates([ep(0.5, 1), ep(0.5, 2), ep(0.5, 3), ep(0.5, 4), ep(0.5, null)]);
    expect(cuatro.medianaDiasHastaBajo025).toEqual({ n: 4, dias: null, motivo: 'n<5' });
  });

  test('episodios con formula_incierta quedan fuera de las tasas base', () => {
    const r = baseRates([ep(0.7, 1), ep(0.5, 2), ep(0.5, 3), ep(0.5, 4), ep(0.5, 5), ep(0.9, 6, true)]);
    expect(r.n).toBe(5);
    expect(r.excluidosFormulaIncierta).toBe(1);
    expect(r.tasaCrisisDesdeAlerta.casos).toBe(1);
  });

  test('si la exclusión deja n < 5, no hay porcentajes aunque existan más episodios', () => {
    const r = baseRates([ep(0.7, 1), ep(0.5, 2), ep(0.5, 3), ep(0.5, 4), ep(0.9, 5, true), ep(0.9, 6, true)]);
    expect(r.n).toBe(4);
    expect(r.tasaCrisisDesdeAlerta.porcentaje).toBeNull();
  });

  test('pico exacto 0.60 cuenta como CRISIS', () => {
    const r = baseRates([ep(0.6, 1), ep(0.6, 1), ep(0.6, 1), ep(0.6, 1), ep(0.6, 1)]);
    expect(r.tasaCrisisDesdeAlerta.fraccion).toBe(1);
  });

  test('sin episodios: n = 0 y motivo n<5', () => {
    const r = baseRates([]);
    expect(r.n).toBe(0);
    expect(r.tasaCrisisDesdeAlerta.motivo).toBe('n<5');
  });
});
