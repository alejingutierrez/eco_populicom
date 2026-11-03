import { buildComposition, loadComposition, toKindCounts, emptyKindCounts, kindExprForPool } from './composition';

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

describe('toKindCounts', () => {
  test('suma por tipo y un tipo desconocido solo entra al total', () => {
    const k = toKindCounts([
      { kind: 'comment', n: 468 }, { kind: 'agency_post', n: '12' }, { kind: 'article', n: 30 },
      { kind: 'third_party_post', n: 7 }, { kind: 'raro', n: 3 }, { kind: null, n: 1 },
    ]);
    expect(k).toEqual({ comment: 468, agency_post: 12, article: 30, third_party_post: 7, total: 521 });
  });
  test('sin filas: todo en cero', () => {
    expect(toKindCounts([])).toEqual(emptyKindCounts());
  });
});

describe('kindExprForPool', () => {
  test('renumera los parámetros de Drizzle detrás de los de la consulta', () => {
    const k = kindExprForPool({ slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' }, 3);
    expect(k.params.length).toBeGreaterThan(0);
    // Los autores propios van como $4..$N; ningún $1..$3 de Drizzle queda suelto.
    expect(k.text).toContain('$4');
    expect(k.text).toContain(`$${3 + k.params.length}`);
    expect(k.text).not.toMatch(/\$[123]\b/);
    expect(k.text).toContain("'#channels_comment'");
  });
  test('agencia sin autores propios: sin parámetros', () => {
    const k = kindExprForPool(null, 3);
    expect(k.params).toEqual([]);
    expect(k.text).toContain("'third_party_post'");
  });
});

describe('loadComposition', () => {
  const win = { startYmd: '2026-10-25', endYmd: '2026-10-31', prevStartYmd: '2026-10-18', prevEndYmd: '2026-10-24' };
  const ag = { slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };
  const mkPool = () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        const flat = sql.replace(/\s+/g, ' ');
        seen.push({ sql: flat, params });
        if (flat.includes('GROUP BY 1')) {
          return { rows: [{ kind: 'comment', n: 4 }, { kind: 'article', n: 3 }, { kind: 'agency_post', n: 1 }, { kind: 'third_party_post', n: 2 }] };
        }
        return { rows: [{ total: 10, comments: 4 }] };
      },
    };
    return { pool, seen };
  };

  test('commentShare (2) + volumen por tipo (2), acotados por agencia y fechas, con el universo de la ruta', async () => {
    const { pool, seen } = mkPool();
    const c = await loadComposition(pool as never, 'ag', win, {}, { cur: t(1, 2, 7), prev: t(1, 2, 7) }, ag);
    expect(seen).toHaveLength(4);
    const shares = seen.filter((q) => !q.sql.includes('GROUP BY 1'));
    const kinds = seen.filter((q) => q.sql.includes('GROUP BY 1'));
    expect(shares.map((q) => q.params)).toEqual([['ag', '2026-10-25', '2026-10-31'], ['ag', '2026-10-18', '2026-10-24']]);
    expect(kinds.map((q) => q.params.slice(0, 3))).toEqual([['ag', '2026-10-25', '2026-10-31'], ['ag', '2026-10-18', '2026-10-24']]);
    // Universo histórico en la ruta → histórico aquí (el default de commentShare es estricto).
    for (const q of seen) { expect(q.sql).toContain('IS NULL OR'); expect(q.sql).not.toContain("IN ('alta','media')"); }
    expect(c.commentShare.current).toEqual({ comments: 4, total: 10, pct: 40 });
    expect(c.byKind.current).toEqual({ comment: 4, agency_post: 1, article: 3, third_party_post: 2, total: 10 });
    expect(c.byKind.previous.total).toBe(10);
  });

  test('sin agencia a mano la consulta una vez (slug y nombre)', async () => {
    const seen: string[] = [];
    const pool = {
      query: async (sql: string) => {
        seen.push(sql);
        if (sql.includes('FROM agencies a')) return { rows: [{ slug: 'df', name: 'Departamento de la Familia' }] };
        if (sql.includes('GROUP BY 1')) return { rows: [] };
        return { rows: [{ total: 0, comments: 0 }] };
      },
    };
    await loadComposition(pool as never, 'ag', win, {}, { cur: t(0, 0, 0), prev: t(0, 0, 0) });
    expect(seen.filter((q) => q.includes('FROM agencies a'))).toHaveLength(1);
    expect(seen).toHaveLength(5);
  });

  test('con universo estricto la composición y el volumen por tipo cuentan alta/media', async () => {
    const { pool, seen } = mkPool();
    await loadComposition(pool as never, 'ag', win, { strictUniverse: true }, { cur: t(0, 0, 0), prev: t(0, 0, 0) }, ag);
    for (const q of seen) expect(q.sql).toContain("IN ('alta','media')");
  });
});
