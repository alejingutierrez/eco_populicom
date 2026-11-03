/**
 * Feed de /api/eco-mentions (WP-9a): filtros nuevos (mentionKind, adverseFact),
 * semántica de includeLow y campos nuevos por mención. Cliente espía como en
 * contracts/universe-routes.test.ts: nada toca una base de datos.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@eco/database';
import { queryMentions, mentionExtras, clearAdverseCache } from './query';
import { clearUniverseSlugCache } from './universe-config';

jest.mock('@/lib/log', () => ({ log: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

interface Q { sql: string; params: unknown[] }
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function spy(captured: Q[], pageRows?: unknown[][], adverseRows?: unknown[][]) {
  const query = async (arg: unknown, params?: unknown[]) => {
    const cfg = typeof arg === 'string' ? { text: arg } : (arg as { text: string; values?: unknown[]; rowMode?: string });
    const text = cfg.text;
    captured.push({ sql: norm(text), params: params ?? cfg.values ?? [] });
    const empty = { rows: [] as unknown[], rowCount: 0, fields: [] as unknown[], command: 'SELECT', oid: 0 };
    if (/count\(/i.test(text) && !/group by/i.test(text)) return { ...empty, rows: [[7]], rowCount: 1 };
    if (adverseRows && /nlp_adverse_fact" IS NOT NULL/.test(text)) return { ...empty, rows: adverseRows, rowCount: adverseRows.length };
    if (pageRows && /^select "id", "title"/.test(norm(text))) return { ...empty, rows: pageRows, rowCount: pageRows.length };
    return empty;
  };
  return { query, connect: async () => ({ query, release: () => undefined }), on: () => undefined };
}
const makeDb = (captured: Q[], adverseRows?: unknown[][]) => drizzle(spy(captured, undefined, adverseRows) as never, { schema });

const feed = async (qs: string, env?: string, adverseRows?: unknown[][]) => {
  clearUniverseSlugCache();
  clearAdverseCache();
  if (env === undefined) delete process.env.UNIVERSE_STRICT_AGENCIES; else process.env.UNIVERSE_STRICT_AGENCIES = env;
  const captured: Q[] = [];
  const res = await queryMentions(makeDb(captured, adverseRows), { agencyId: '00000000-0000-0000-0000-000000000001' }, new URLSearchParams(qs));
  return { res, captured, sqls: captured.map((c) => c.sql) };
};

afterEach(() => { delete process.env.UNIVERSE_STRICT_AGENCIES; });

describe('feed — universo y includeLow', () => {
  test('histórico por defecto: excluye baja y deja NULL dentro; declara el universo', async () => {
    const { res, sqls } = await feed('period=7D');
    expect(sqls[0]).toMatch(/"nlp_pertinence" IS NULL OR "mentions"\."nlp_pertinence" <> 'baja'/);
    expect(res.body.universe).toEqual({ strict: false, label: 'sin pertinencia baja', includeLow: false, pertinence: null });
    // Sin includeLow la lista ES el universo: no hay consulta extra.
    expect(res.body.universeTotal).toBe(res.body.total);
    expect(sqls.filter((s) => /select COUNT\(\*\) from "mentions"/.test(s))).toHaveLength(1);
  });

  test('includeLow=1 cambia la LISTA, pero universeTotal sigue siendo el del universo (sin baja)', async () => {
    const { res, sqls } = await feed('period=7D&includeLow=1');
    const counts = sqls.filter((s) => /^select COUNT\(\*\) from "mentions"/.test(s));
    expect(counts).toHaveLength(2); // lista + universo
    expect(counts[0]).not.toMatch(/'baja'/);            // la lista incluye baja
    expect(counts[1]).toMatch(/<> 'baja'/);             // el universo no
    expect(res.body.universe).toMatchObject({ includeLow: true, label: 'todas las pertinencias' });
    expect(res.body.universeTotal).toBe(7);
  });

  test('estricto: alta/media (NULL fuera) por defecto; con includeLow suma baja pero NULL sigue fuera', async () => {
    const def = await feed('period=7D', '*');
    expect(def.sqls[0]).toContain("mentions.nlp_pertinence IN ('alta','media')");
    expect(def.sqls[0]).not.toMatch(/IS NULL OR/);
    expect(def.res.body.universe?.strict).toBe(true);

    const low = await feed('period=7D&includeLow=1', '*');
    const counts = low.sqls.filter((s) => /^select COUNT\(\*\) from "mentions"/.test(s));
    expect(counts[0]).toContain("IN ('alta','media','baja')");
    expect(counts[1]).toContain("IN ('alta','media')");
    expect(counts[1]).not.toContain("'baja'");
  });

  test('pertinence explícita sigue mandando en la lista; el universo se cuenta aparte', async () => {
    const { res, sqls } = await feed('period=7D&pertinence=baja');
    expect(sqls[0]).toMatch(/"nlp_pertinence" = \$/);
    expect(res.body.universeTotal).toBe(7);
    expect(res.body.universe?.pertinence).toBe('baja');
  });
});

describe('feed — filtros nuevos', () => {
  test('adverseFact=1: solo hecho adverso confirmado (NULL no cuenta)', async () => {
    const { sqls } = await feed('period=7D&adverseFact=1');
    expect(sqls[0]).toContain('"nlp_adverse_fact" IS TRUE');
    const off = await feed('period=7D&adverseFact=false');
    expect(off.sqls[0]).toContain('"nlp_adverse_fact" IS NOT TRUE');
    const none = await feed('period=7D');
    expect(none.sqls[0]).not.toContain('nlp_adverse_fact');
  });

  test('mentionKind: columna si está poblada, si no la derivación; valores validados', async () => {
    const { sqls, captured } = await feed('period=7D&mentionKind=comment,article');
    const i = sqls.findIndex((q) => /^select COUNT\(\*\) from "mentions"/.test(q));
    expect(sqls[i]).toContain('COALESCE(mentions.mention_kind, CASE');
    expect(sqls[i]).toContain(' IN ($');
    expect(captured[i].params).toEqual(expect.arrayContaining(['comment', 'article']));
    const bad = await feed('period=7D&mentionKind=comment,spam');
    expect(bad.res.status).toBe(400);
    expect(bad.res.body.error).toBe('invalid mentionKind');
    const none = await feed('period=7D');
    expect(none.sqls[0]).not.toContain('mention_kind');
  });

  test('la consulta de agencia para el filtro se hace una sola vez', async () => {
    const { sqls } = await feed('period=7D&mentionKind=comment');
    expect(sqls.filter((s) => /from "agencies"/.test(s))).toHaveLength(1);
  });
});

describe('feed — adverseAvailable (el filtro de hecho adverso solo se ofrece con la rúbrica v2 encendida)', () => {
  test('sin ninguna mención evaluada (rúbrica apagada) → false: el front no ofrece el chip', async () => {
    const { res, sqls } = await feed('period=7D');
    expect(res.body.adverseAvailable).toBe(false);
    expect(sqls.some((q) => /nlp_adverse_fact" IS NOT NULL/.test(q) && /limit \$/.test(q))).toBe(true);
  });
  test('con al menos una mención evaluada → true', async () => {
    const { res } = await feed('period=7D', undefined, [[1]]);
    expect(res.body.adverseAvailable).toBe(true);
  });
});

describe('mentionExtras — tipo, hecho adverso y padre por mención', () => {
  const ag = { slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };
  const base = {
    pageType: 'facebook', author: 'Ana', publishedAt: new Date('2026-11-01T14:00:00Z'),
    mentionKind: null, parentMentionId: null, nlpAdverseFact: null, bwGuid: null, pubType: null, url: null,
  };

  test('deriva el tipo cuando la columna está vacía y respeta la columna cuando existe', async () => {
    const db = { execute: async () => ({ rows: [] }) } as never;
    const out = await mentionExtras(db, 'ag', ag, [
      { ...base, id: 'a', url: 'https://x.example/nota', pageType: 'news' },
      { ...base, id: 'b', pubType: 'FACEBOOK', author: 'Departamento de Desarrollo Económico y Comercio' },
      { ...base, id: 'c', url: 'https://x.example/p', pageType: 'news', mentionKind: 'third_party_post' as const, nlpAdverseFact: true },
    ]);
    expect(out.get('a')).toMatchObject({ mentionKind: 'article', mentionKindDerived: true, adverseFact: null, parent: null, parentUnknown: false });
    expect(out.get('b')).toMatchObject({ mentionKind: 'agency_post', mentionKindDerived: true });
    expect(out.get('c')).toMatchObject({ mentionKind: 'third_party_post', mentionKindDerived: false, adverseFact: true });
  });

  test('un comentario sin padre resoluble queda con padre DESCONOCIDO, no como noticia del día', async () => {
    const db = { execute: async () => ({ rows: [] }) } as never;
    const out = await mentionExtras(db, 'ag', ag, [
      { ...base, id: 'k', url: 'https://www.facebook.com/555#channels_comment_9', bwGuid: '555_9', pubType: 'FACEBOOK' },
    ]);
    expect(out.get('k')).toMatchObject({ mentionKind: 'comment', parent: null, parentUnknown: true, parentAgeDays: null, lateReaction: false });
  });
});
