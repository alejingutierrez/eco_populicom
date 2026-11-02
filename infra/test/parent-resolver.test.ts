import { readFileSync } from 'fs';
import * as path from 'path';
import { PARENT_FB_SQL, PARENT_IG_SQL, PARENT_LOOKBACK_DAYS, parseParentRef, resolveParent, type Queryable } from '../lambda/lib/parent-resolver';

/**
 * Casos reales del DDEC (26-oct a 1-nov-2026). `expectedParent` es lo que
 * devolvió en producción la misma consulta del resolver (SELECT del 2-nov);
 * el doble de pg de abajo reproduce su semántica sobre los posts del fixture.
 */
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/interp-v1-mentions.json'), 'utf8')) as {
  agencies: Record<string, { id: string; slug: string; name: string }>;
  parentPosts: Array<{ id: string; agency: string; guid: string; publishedAt: string }>;
  parentComments: Array<{
    platform: 'facebook' | 'instagram' | 'linkedin'; agency: string; pubType: string; pageType: string;
    url: string; guid: string | null; date: string; expectedParent: string | null;
    expectedParentPublishedAt: string | null; expectedStatus: string;
  }>;
};

type Row = { id: string; agency_id: string; bw_guid: string; published_at: Date };

/** Doble de pg: interpreta PARENT_FB_SQL / PARENT_IG_SQL sobre una tabla en memoria. */
function fakePg(table: Row[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pg: Queryable = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const [agencyId, needle, at, days] = params as [string, string, string, number];
      const t = new Date(at).getTime();
      const lo = t - days * 86_400_000;
      const hi = t + 86_400_000;
      let match: (g: string) => boolean;
      if (sql === PARENT_FB_SQL) {
        expect(needle.startsWith('%\\_')).toBe(true);
        const suffix = '_' + needle.slice(3);
        match = (g) => g.endsWith(suffix);
      } else if (sql === PARENT_IG_SQL) {
        match = (g) => g === needle;
      } else {
        throw new Error(`SQL inesperado: ${sql}`);
      }
      const rows = table
        .filter((r) => r.agency_id === agencyId && r.bw_guid && match(r.bw_guid))
        .filter((r) => r.published_at.getTime() >= lo && r.published_at.getTime() <= hi)
        .sort((a, b) => b.published_at.getTime() - a.published_at.getTime())
        .slice(0, 1)
        .map((r) => ({ id: r.id, published_at: r.published_at }));
      return { rows };
    },
  };
  return { pg, calls };
}

const table: Row[] = fixture.parentPosts.map((p) => ({
  id: p.id, agency_id: fixture.agencies[p.agency].id, bw_guid: p.guid, published_at: new Date(p.publishedAt),
}));

describe('resolveParent — casos reales', () => {
  for (const platform of ['facebook', 'instagram', 'linkedin'] as const) {
    const cases = fixture.parentComments.filter((c) => c.platform === platform);

    it(`${platform}: al menos 20 casos`, () => {
      expect(cases.length).toBeGreaterThanOrEqual(20);
    });

    it(`${platform}: mismo padre que la consulta en producción`, async () => {
      const { pg, calls } = fakePg(table);
      for (const c of cases) {
        const r = await resolveParent(pg, fixture.agencies[c.agency].id, {
          url: c.url, guid: c.guid, pubType: c.pubType, pageType: c.pageType, date: c.date,
        });
        expect({ url: c.url, status: r.status, parent: r.parentMentionId }).toEqual({ url: c.url, status: c.expectedStatus, parent: c.expectedParent });
        if (c.expectedParentPublishedAt) {
          expect(r.parentPublishedAt?.toISOString()).toBe(new Date(c.expectedParentPublishedAt).toISOString());
          // El padre nunca es posterior al comentario.
          expect(r.parentPublishedAt!.getTime()).toBeLessThanOrEqual(new Date(c.date).getTime());
        }
      }
      // LinkedIn no consulta la base (padre desconocido por diseño).
      if (platform === 'linkedin') expect(calls).toHaveLength(0);
      // Toda consulta va acotada por agencia y por la ventana de fechas.
      for (const call of calls) {
        expect(call.params[0]).toBe(fixture.agencies.ddecpr.id);
        expect(call.params[3]).toBe(PARENT_LOOKBACK_DAYS);
        expect(call.sql).toMatch(/agency_id = \$1/);
        expect(call.sql).toMatch(/published_at BETWEEN/);
        expect(call.sql).toMatch(/LIMIT 1/);
      }
    });
  }

  it('tasa de resolución ≥ 90 % en FB e IG (umbral 13.2)', async () => {
    const { pg } = fakePg(table);
    for (const platform of ['facebook', 'instagram'] as const) {
      const cases = fixture.parentComments.filter((c) => c.platform === platform);
      let ok = 0;
      for (const c of cases) {
        const r = await resolveParent(pg, fixture.agencies.ddecpr.id, { url: c.url, guid: c.guid, pubType: c.pubType, date: c.date });
        if (r.status === 'resolved') ok++;
      }
      expect(ok / cases.length).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe('resolveParent — bordes', () => {
  const agencyId = fixture.agencies.ddecpr.id;
  const post = (id: string, guid: string, at: string, agency = agencyId): Row => ({ id, agency_id: agency, bw_guid: guid, published_at: new Date(at) });

  it('otra agencia con el mismo post no cuenta', async () => {
    const { pg } = fakePg([post('x', '553558728043206_111', '2026-10-30T10:00:00Z', 'otra-agencia')]);
    const r = await resolveParent(pg, agencyId, { guid: '111_999', url: 'https://www.facebook.com/111#channels_comment_999', pubType: 'FACEBOOK', date: '2026-10-31T10:00:00Z' });
    expect(r).toMatchObject({ status: 'not_found', parentMentionId: null, platform: 'facebook' });
  });

  it('un post fuera de la ventana de 60 días es huérfano', async () => {
    const { pg } = fakePg([post('viejo', '553558728043206_111', '2026-08-01T10:00:00Z')]);
    const r = await resolveParent(pg, agencyId, { guid: '111_999', url: 'https://www.facebook.com/111#channels_comment_999', pubType: 'FACEBOOK', date: '2026-10-31T10:00:00Z' });
    expect(r.status).toBe('not_found');
  });

  it('el sufijo exige el separador: _1111 no es padre de 111', async () => {
    const { pg } = fakePg([post('falso', '553558728043206_1111', '2026-10-30T10:00:00Z')]);
    const r = await resolveParent(pg, agencyId, { guid: '111_999', url: 'https://www.facebook.com/111#channels_comment_999', pubType: 'FACEBOOK', date: '2026-10-31T10:00:00Z' });
    expect(r.status).toBe('not_found');
  });

  it('sin GUID se usa la URL (FB e IG)', () => {
    expect(parseParentRef({ url: 'https://www.facebook.com/1553736176780709#channels_comment_1655264229578184', pubType: 'FACEBOOK' }))
      .toEqual({ platform: 'facebook', postId: '1553736176780709' });
    expect(parseParentRef({ url: 'https://www.instagram.com/reel/De9aPgiRU_d/#18193888252402851', pubType: 'INSTAGRAM_GRAPH_BUSINESS' }))
      .toEqual({ platform: 'instagram', shortcode: 'De9aPgiRU_d' });
  });

  it('lo que no es comentario no consulta', async () => {
    const { pg, calls } = fakePg([]);
    const r = await resolveParent(pg, agencyId, { url: 'https://www.metro.pr/x', pageType: 'news', pubType: 'WISE_NEWS_PUBLIC' });
    expect(r.status).toBe('not_comment');
    expect(calls).toHaveLength(0);
  });

  it('si la consulta falla devuelve not_found sin lanzar', async () => {
    const pg: Queryable = { query: async () => { throw new Error('boom'); } };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await resolveParent(pg, agencyId, { guid: 'De9aPgiRU_d#1', pubType: 'INSTAGRAM_GRAPH_BUSINESS', url: 'https://www.instagram.com/reel/De9aPgiRU_d/#1' });
    expect(r).toMatchObject({ status: 'not_found', platform: 'instagram' });
    warn.mockRestore();
  });

  it('fecha inválida: usa ahora como referencia', async () => {
    const { pg, calls } = fakePg([]);
    await resolveParent(pg, agencyId, { guid: 'De9aPgiRU_d#1', pubType: 'INSTAGRAM_GRAPH_BUSINESS', date: 'no-es-fecha' });
    expect(Math.abs(new Date(calls[0].params[2] as string).getTime() - Date.now())).toBeLessThan(5000);
  });
});
