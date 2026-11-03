import { buildComposition, loadComposition } from './composition';

const t = (negative: number, neutral: number, positive: number) => ({ negative, neutral, positive, total: negative + neutral + positive });

describe('buildComposition', () => {
  test('commentShare actual y previo, con delta en puntos', () => {
    const c = buildComposition(
      { comments: 535, total: 647, pct: (535 / 647) * 100 },
      { comments: 10, total: 100, pct: 10 },
      { cur: t(20, 100, 527), prev: t(5, 60, 35) },
      {},
    );
    expect(c.commentShare.current.pct).toBeCloseTo(82.7, 1);
    expect(c.commentShare.previous.pct).toBe(10);
    expect(c.commentShare.deltaPts).toBe(72.7);
    expect(c.universe).toEqual({ strict: false, label: 'sin pertinencia baja' });
  });

  test('delta con base mínima: el porcentaje solo con base previa >= 30 (nunca «+1400 %»)', () => {
    const c = buildComposition(
      { comments: 0, total: 162, pct: 0 }, { comments: 0, total: 100, pct: 0 },
      { cur: t(5, 22, 135), prev: t(5, 86, 9) }, { strictUniverse: true },
    );
    expect(c.deltas.positive).toMatchObject({ prev: 9, cur: 135, abs: 126, pct: null }); // base 9 < 30
    expect(c.deltas.neutral.pct).toBeCloseTo(((22 - 86) / 86) * 100, 5);                  // base 86 >= 30
    expect(c.deltas.total).toMatchObject({ prev: 100, cur: 162, abs: 62 });
    expect(c.universe.strict).toBe(true);
  });

  test('ventana vacía: sin delta de composición', () => {
    const c = buildComposition(
      { comments: 0, total: 0, pct: 0 }, { comments: 3, total: 10, pct: 30 },
      { cur: t(0, 0, 0), prev: t(1, 2, 7) }, {},
    );
    expect(c.commentShare.deltaPts).toBeNull();
  });
});

describe('loadComposition', () => {
  test('dos consultas acotadas por agencia y fechas, con el universo de la ruta', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        seen.push({ sql: sql.replace(/\s+/g, ' '), params });
        return { rows: [{ total: 10, comments: 4 }] };
      },
    };
    const win = { startYmd: '2026-10-25', endYmd: '2026-10-31', prevStartYmd: '2026-10-18', prevEndYmd: '2026-10-24' };
    const c = await loadComposition(pool as never, 'ag', win, {}, { cur: t(1, 2, 7), prev: t(1, 2, 7) });
    expect(seen).toHaveLength(2);
    expect(seen[0].params).toEqual(['ag', '2026-10-25', '2026-10-31']);
    expect(seen[1].params).toEqual(['ag', '2026-10-18', '2026-10-24']);
    // Universo histórico en la ruta → histórico aquí (el default de commentShare es estricto).
    for (const q of seen) { expect(q.sql).toContain('IS NULL OR'); expect(q.sql).not.toContain("IN ('alta','media')"); }
    expect(c.commentShare.current).toEqual({ comments: 4, total: 10, pct: 40 });
  });

  test('con universo estricto la composición cuenta alta/media', async () => {
    const seen: string[] = [];
    const pool = { query: async (sql: string) => { seen.push(sql); return { rows: [{ total: 0, comments: 0 }] }; } };
    await loadComposition(pool as never, 'ag', { startYmd: 'a', endYmd: 'b', prevStartYmd: 'c', prevEndYmd: 'd' }, { strictUniverse: true }, { cur: t(0, 0, 0), prev: t(0, 0, 0) });
    for (const q of seen) expect(q).toContain("IN ('alta','media')");
  });
});
