import { isAiCacheOutdated, claimAiTrigger, releaseAiTrigger, loadWindowFreshness, AI_TRIGGER_DEDUP_MS } from './ai-cache-freshness';

describe('isAiCacheOutdated', () => {
  // Casos reales del QA 23-oct-2026 (total vivo, llegadas después de generar).
  it('marca viejas las filas desfasadas de DF', () => {
    expect(isAiCacheOutdated({ total: 1037, newer: 315 })).toBe(true); // 15→21 oct
    expect(isAiCacheOutdated({ total: 55, newer: 22 })).toBe(true); // 1D 18-oct
    expect(isAiCacheOutdated({ total: 10, newer: 2 })).toBe(true); // tópico chico
  });
  it('no marca las vigentes ni el goteo de una mención tardía', () => {
    expect(isAiCacheOutdated({ total: 1109, newer: 0 })).toBe(false);
    expect(isAiCacheOutdated({ total: 9714, newer: 1 })).toBe(false); // DDEC 1A
    expect(isAiCacheOutdated({ total: 617, newer: 9 })).toBe(false); // < 5%
    expect(isAiCacheOutdated({ total: 33, newer: 1 })).toBe(false); // piso de 2
  });
  it('fila «sin señal»: vieja si llegó algo y ya hay el mínimo', () => {
    expect(isAiCacheOutdated({ total: 81, newer: 74 }, { wasEmpty: true })).toBe(true);
    expect(isAiCacheOutdated({ total: 3, newer: 1 }, { wasEmpty: true })).toBe(false);
    expect(isAiCacheOutdated({ total: 40, newer: 0 }, { wasEmpty: true })).toBe(false);
  });
});

describe('claimAiTrigger', () => {
  it('deja pasar una vez por clave dentro de la ventana de dedup', () => {
    const t0 = 1_000_000;
    expect(claimAiTrigger('k1', t0)).toBe(true);
    expect(claimAiTrigger('k1', t0 + 2_000)).toBe(false);
    expect(claimAiTrigger('k2', t0 + 2_000)).toBe(true);
    expect(claimAiTrigger('k1', t0 + AI_TRIGGER_DEDUP_MS)).toBe(true);
  });
  it('release permite reintentar de inmediato', () => {
    expect(claimAiTrigger('k3', 5)).toBe(true);
    releaseAiTrigger('k3');
    expect(claimAiTrigger('k3', 6)).toBe(true);
  });
});

describe('loadWindowFreshness', () => {
  it('manda bordes de día PR y filtra por tópico primario solo si se pide', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return { rows: [{ total: '12', newer: '3' }] };
      },
    };
    const g = new Date('2026-10-22T16:32:23.784Z');
    const r = await loadWindowFreshness(pool, { agencyId: 'a', startYmd: '2026-10-15', endYmd: '2026-10-21', generatedAt: g });
    expect(r).toEqual({ total: 12, newer: 3 });
    expect(calls[0].params).toEqual(['a', '2026-10-15', '2026-10-21', g.toISOString()]);
    expect(calls[0].sql).not.toContain('mention_topics');
    await loadWindowFreshness(pool, { agencyId: 'a', startYmd: '2026-10-15', endYmd: '2026-10-21', generatedAt: g, topicId: 7 });
    expect(calls[1].params[4]).toBe(7);
    expect(calls[1].sql).toContain('ORDER BY mt.confidence DESC NULLS LAST, mt.topic_id ASC');
  });
});
