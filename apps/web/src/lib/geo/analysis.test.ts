import { buildGeoMunis, moveState, per10k, spansFor } from './analysis';

describe('spansFor', () => {
  test('7 días: lo usual son las 12 semanas previas y las 12 semanas terminan el último día', () => {
    const s = spansFor({ startYmd: '2026-10-06', endYmd: '2026-10-12' });
    expect(s.days).toBe(7);
    expect([s.baseStart, s.baseEnd, s.baseDays]).toEqual(['2026-07-14', '2026-10-05', 84]);
    expect(s.weeks[11]).toEqual({ start: '2026-10-06', end: '2026-10-12' });
    expect(s.weeks[0]).toEqual({ start: '2026-07-21', end: '2026-07-27' });
    expect(s.firstDay).toBe('2026-07-14');
  });
  test('un periodo más largo que 12 semanas compara contra uno igual de largo', () => {
    const s = spansFor({ startYmd: '2025-10-13', endYmd: '2026-10-12' });
    expect(s.days).toBe(365);
    expect(s.baseDays).toBe(365);
  });
});

describe('moveState', () => {
  test('nuevo, más, menos y como siempre', () => {
    expect(moveState(2, 0, 0)).toBe('nuevo');
    expect(moveState(14, 1.5, 18)).toBe('mas');
    expect(moveState(0, 3.5, 42)).toBe('menos');
    expect(moveState(7, 8.1, 97)).toBe('igual');
    expect(moveState(1, 0.4, 5)).toBe('igual'); // una sola mención no es «el doble»
  });
});

describe('buildGeoMunis', () => {
  const cat = [
    { slug: 'luquillo', name: 'Luquillo', region: 'Norte', population: 17190 },
    { slug: 'arroyo', name: 'Arroyo', region: 'Sur', population: 14744 },
  ];
  test('reparte cada día en el periodo, lo usual y su semana', () => {
    const w = { startYmd: '2026-10-06', endYmd: '2026-10-12' };
    const m = buildGeoMunis([
      { slug: 'luquillo', d: '2026-10-06', n: 14, pos: 1, neg: 1 },
      { slug: 'luquillo', d: '2026-09-01', n: 7, pos: 0, neg: 0 },
      { slug: 'luquillo', d: '2026-07-15', n: 2, pos: 0, neg: 0 }, // en lo usual, antes de las 12 semanas
      { slug: 'arroyo', d: '2026-10-09', n: 2, pos: 0, neg: 1 },
      { slug: 'desconocido', d: '2026-10-09', n: 5, pos: 0, neg: 0 },
    ], cat, w, spansFor(w));
    expect(m.map((x) => x.slug)).toEqual(['luquillo', 'arroyo']);
    const lq = m[0];
    expect([lq.n, lq.pos, lq.neg, lq.base]).toEqual([14, 1, 1, 9]);
    expect(lq.usual).toBe(0.8); // 9 en 84 días → 0.75 por semana
    expect(lq.state).toBe('mas');
    expect(lq.weeks[11]).toBe(14);
    expect(lq.weeks.reduce((a, b) => a + b, 0)).toBe(21);
    expect(m[1].state).toBe('nuevo');
  });
});

test('per10k', () => {
  expect(per10k(31, 17190)).toBe(18);
  expect(per10k(3, null)).toBeNull();
});
