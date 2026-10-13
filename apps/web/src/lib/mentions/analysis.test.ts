import { astYmd, buildAmplify, buildDays, buildShift, groupStories } from './analysis';

describe('astYmd: día calendario de Puerto Rico', () => {
  test('las 2 a. m. UTC todavía son el día anterior en PR', () => {
    expect(astYmd('2026-10-07T02:00:00Z')).toBe('2026-10-06');
    expect(astYmd('2026-10-07T04:00:00Z')).toBe('2026-10-07');
  });
});

describe('groupStories', () => {
  test('encadena parejas (A~B, B~C) en una sola historia y descarta las sueltas', () => {
    const g = groupStories([['a', 'b'], ['b', 'c'], ['x', 'y']]);
    expect(g.map((s) => s.join(',')).sort()).toEqual(['a,b,c', 'x,y']);
  });
  test('sin parejas no hay historias', () => {
    expect(groupStories([])).toEqual([]);
  });
});

describe('buildDays', () => {
  test('cuenta por día AST y deja en cero los días vacíos', () => {
    const d = buildDays([
      { ts: '2026-10-06T15:00:00Z', sent: 'negativo' },
      { ts: '2026-10-07T03:30:00Z', sent: 'neutral' }, // 11:30 p. m. del 6 en PR
      { ts: '2026-10-08T12:00:00Z', sent: 'neutral' },
    ], '2026-10-06', '2026-10-09');
    expect(d).toEqual([
      { date: '2026-10-06', n: 2, neg: 1 },
      { date: '2026-10-07', n: 0, neg: 0 },
      { date: '2026-10-08', n: 1, neg: 0 },
      { date: '2026-10-09', n: 0, neg: 0 },
    ]);
  });
});

describe('buildAmplify', () => {
  test('la voz que publicó primero es el origen; las demás, quienes repiten', () => {
    const byId = new Map([
      ['1', { ts: '2026-10-07T14:38:00Z', voice: 'agencia' as const, inter: 37 }],
      ['2', { ts: '2026-10-07T14:39:00Z', voice: 'agencia' as const, inter: 26 }],
      ['3', { ts: '2026-10-07T16:58:00Z', voice: 'ciudadania' as const, inter: 1 }],
      ['4', { ts: '2026-10-08T10:00:00Z', voice: 'prensa' as const, inter: 0 }],
      ['5', { ts: '2026-10-08T09:00:00Z', voice: 'ciudadania' as const, inter: 4 }],
    ]);
    const a = buildAmplify([['1', '2', '3'], ['4', '5']], byId);
    expect(a.origins).toEqual({ agencia: 1, prensa: 0, gobierno: 0, ciudadania: 1 });
    expect(a.cells.agencia.agencia).toEqual({ n: 1, inter: 26, stories: 1 });
    expect(a.cells.agencia.ciudadania).toEqual({ n: 1, inter: 1, stories: 1 });
    expect(a.cells.ciudadania.prensa).toEqual({ n: 1, inter: 0, stories: 1 });
  });
});

describe('buildShift', () => {
  test('compara por cada 100 menciones: una semana más grande no hace subir todo', () => {
    // 200 menciones ahora y 100 antes: «beca» 20→10 es el mismo 10% en las dos.
    const r = buildShift([
      { term: 'beca', now: 20, prev: 10, neg: 0 },
      { term: 'reforma', now: 30, prev: 5, neg: 20 },
      { term: 'informe', now: 2, prev: 12, neg: 0 },
    ], 200, 100);
    expect(r.up.map((x) => x.term)).toEqual(['reforma']);
    expect(r.down.map((x) => x.term)).toEqual(['informe']);
    expect(r.up[0].delta).toBe(10);
  });
  test('marca las palabras nuevas y exige una base mínima', () => {
    const r = buildShift([{ term: 'moscoso', now: 16, prev: 0, neg: 0 }, { term: 'rara', now: 1, prev: 0, neg: 0 }], 129, 104);
    expect(r.up.map((x) => [x.term, x.isNew])).toEqual([['moscoso', true]]);
  });
});
