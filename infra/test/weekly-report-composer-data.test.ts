import { prepareSamples, sampleLine, type RawSampleGroups } from '@eco/shared';
import {
  createPgComposerDataAccess,
  loadComposerSamples,
  namesWithDigits,
  rowToRawSample,
  TODAY_SAMPLE_LIMIT,
} from '../lambda/weekly-report/composer-data';

/**
 * Adaptador pg del motor para el correo diario (WP-6): tipo de mención, padre
 * del comentario resuelto por consulta (columnas parent_* vacías mientras
 * MENTION_ENRICHMENT_ENABLED esté apagado), muestras anotadas y tope por hilo.
 * Datos sintéticos: ninguna persona real.
 */
const AGENCY = { id: 'a0000000-0000-0000-0000-000000000001', slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };
const POST_TEXT = 'En el Mes de la Manufactura destacamos una panadería de Caguas.';

type Row = Record<string, any>;
const fbComment = (i: number, at: string): Row => ({
  id: `c${i}`, bw_guid: `200_90${i}`, url: `https://www.facebook.com/200#channels_comment_90${i}`, pub_type: 'FACEBOOK', page_type: 'facebook',
  author: `Usuario ${String.fromCharCode(64 + i)}`, title: POST_TEXT, snippet: `¿Dónde queda? (${i})`, published_at: new Date(at), mention_kind: null, parent_mention_id: null, parent_published_at: null,
});
const ROWS: Row[] = [
  // Publicación de la agencia (lunes 26) y cinco comentarios del domingo 1.
  { id: 'p1', bw_guid: '100_200', url: 'https://www.facebook.com/100/posts/200', pub_type: 'FACEBOOK', page_type: 'facebook', author: 'Departamento de Desarrollo Económico y Comercio', title: null, snippet: POST_TEXT, published_at: new Date('2026-10-26T15:00:00Z'), mention_kind: null, parent_mention_id: null, parent_published_at: null },
  ...[1, 2, 3, 4, 5].map((i) => fbComment(i, `2026-11-01T1${i}:00:00Z`)),
  // Instagram: post y comentario.
  { id: 'p2', bw_guid: 'ABC123', url: 'https://www.instagram.com/p/ABC123/', pub_type: 'INSTAGRAM_GRAPH_BUSINESS', page_type: 'instagram', author: 'desarrollopr', title: null, snippet: 'Reel de la feria de empleo', published_at: new Date('2026-10-31T20:00:00Z'), mention_kind: null, parent_mention_id: null, parent_published_at: null },
  { id: 'i1', bw_guid: 'ABC123#777', url: 'https://www.instagram.com/p/ABC123/#777', pub_type: 'INSTAGRAM_GRAPH_BUSINESS', page_type: 'instagram', author: 'usuaria_ig', title: 'Reel de la feria de empleo', snippet: '¡Qué bueno!', published_at: new Date('2026-11-01T22:00:00Z'), mention_kind: null, parent_mention_id: null, parent_published_at: null },
  // LinkedIn: padre desconocido sin consulta.
  { id: 'l1', bw_guid: 'urn:li:comment:1', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1?commentUrn=urn%3Ali%3Acomment%3A1', pub_type: 'LINKEDIN', page_type: 'linkedin', author: 'Persona LinkedIn', title: null, snippet: 'Felicidades', published_at: new Date('2026-11-01T13:00:00Z'), mention_kind: null, parent_mention_id: null, parent_published_at: null },
  // Comentario de FB cuyo post no está en la base.
  { ...fbComment(9, '2026-11-01T18:00:00Z'), id: 'o1', bw_guid: '999_1', url: 'https://www.facebook.com/999#channels_comment_1', title: 'Post viejo que no está' },
  // Nota de prensa (fuente con dígitos en el nombre).
  { id: 'n1', bw_guid: 'news-1', url: 'https://medio.example/nota', pub_type: null, page_type: 'news', author: 'Redacción', title: 'Nota', snippet: 'El DDEC anunció…', published_at: new Date('2026-11-01T12:00:00Z'), mention_kind: null, parent_mention_id: null, parent_published_at: null },
];

function fakeClient() {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const byId = new Map(ROWS.map((r) => [r.id, r]));
  return {
    log,
    async query(sql: string, params: unknown[] = []) {
      log.push({ sql, params });
      if (/bw_guid LIKE \$2/.test(sql)) {
        const needle = String(params[1]).replace('%\\_', '');
        return { rows: ROWS.filter((r) => r.bw_guid?.endsWith(`_${needle}`) && !r.url?.includes('#channels_comment')).map((r) => ({ id: r.id, published_at: r.published_at })) };
      }
      if (/bw_guid = \$2/.test(sql)) return { rows: ROWS.filter((r) => r.bw_guid === params[1]).map((r) => ({ id: r.id, published_at: r.published_at })) };
      if (/id = ANY\(\$2::uuid\[\]\)/.test(sql)) {
        expect(params[0]).toBe(AGENCY.id);
        return { rows: (params[1] as string[]).map((id) => byId.get(id)).filter(Boolean) };
      }
      throw new Error(`consulta inesperada: ${sql.slice(0, 80)}`);
    },
  };
}

const raw = (ids: string[]) => ids.map((id) => rowToRawSample({ ...ROWS.find((r) => r.id === id)!, sentiment: 'neutral', topic: 'Desarrollo Empresarial', content_source_name: id === 'n1' ? 'En Contacto 787 Tv' : 'Facebook' }));

describe('createPgComposerDataAccess', () => {
  test('resuelve el padre UNA vez por publicación y no inventa padres', async () => {
    const client = fakeClient();
    const data = createPgComposerDataAccess(client, AGENCY);
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'i1', 'l1', 'o1', 'n1'];
    const ctx = await data.loadSampleContext(ids);
    // 1 lectura + FB 200 + FB 999 + IG ABC123 + lectura de padres = 5 (no 1 por comentario).
    expect(client.log).toHaveLength(5);
    expect(data.stats()).toEqual({ comments: 8, fromColumn: 0, resolved: 6, notFound: 1, parentUnknown: 1, queries: 5 });
    expect(ctx.c3).toMatchObject({ mentionKind: 'comment', parentMentionId: 'p1', parentPublishedAt: '2026-10-26T15:00:00.000Z', parentText: POST_TEXT, parentAuthor: AGENCY.name });
    expect(ctx.i1).toMatchObject({ mentionKind: 'comment', parentMentionId: 'p2', parentAuthor: 'desarrollopr' });
    expect(ctx.l1.parentMentionId).toBeUndefined();
    expect(ctx.o1.parentMentionId).toBeUndefined();
    expect(ctx.n1.mentionKind).toBe('article');
    // Las consultas del padre van acotadas por agencia y fecha (parent-resolver).
    const fb = client.log.find((q) => /bw_guid LIKE/.test(q.sql))!;
    expect(fb.params[0]).toBe(AGENCY.id);
    expect(fb.sql).toMatch(/published_at BETWEEN/);
  });

  test('usa parent_mention_id cuando el processor ya lo pobló', async () => {
    const client = fakeClient();
    const row = ROWS.find((r) => r.id === 'c1')!;
    const saved = { ...row };
    Object.assign(row, { parent_mention_id: 'p1', parent_published_at: new Date('2026-10-26T15:00:00Z'), mention_kind: 'comment' });
    try {
      const data = createPgComposerDataAccess(client, AGENCY);
      const ctx = await data.loadSampleContext(['c1']);
      expect(client.log).toHaveLength(2); // lectura + padres; sin resolveParent
      expect(data.stats().fromColumn).toBe(1);
      expect(ctx.c1.parentMentionId).toBe('p1');
    } finally {
      Object.assign(row, saved);
    }
  });

  test('muestras anotadas: tipo, padre fechado, reacción tardía y tope de 3 por hilo', async () => {
    const data = createPgComposerDataAccess(fakeClient(), AGENCY);
    const groups: RawSampleGroups = { today: raw(['c1', 'c2', 'c3', 'c4', 'c5', 'i1', 'l1', 'o1', 'n1']) };
    const { samples, contextError } = await prepareSamples(data, groups, { timeZone: 'America/Puerto_Rico', agencyAuthors: [AGENCY.name] });
    expect(contextError).toBeNull();
    const thread = samples.today.filter((s) => s.parent?.key === 'p1');
    expect(thread).toHaveLength(3);
    expect(thread[2].moreInThread).toBe(2);
    expect(samples.droppedByThreadCap.today).toBe(2);
    expect(thread[0]).toMatchObject({ kind: 'comment', isComment: true, lateReaction: true, dayYmd: '2026-11-01' });
    expect(thread[0].parent).toMatchObject({ dayYmd: '2026-10-26', author: AGENCY.name });
    expect(thread[0].parent!.ageDays).toBeGreaterThan(5);
    const line = sampleLine(thread[0]);
    expect(line).toMatch(/PUBLICACIÓN ORIGINAL de Departamento de Desarrollo Económico y Comercio del lunes 26 de octubre/);
    expect(line).toMatch(/REACCIÓN TARDÍA/);
    expect(line).toMatch(/comentario: ¿Dónde queda\? \(1\)/);
    // IG del día anterior: no es reacción tardía.
    expect(samples.today.find((s) => s.id === 'i1')).toMatchObject({ lateReaction: false });
    // LinkedIn y huérfano: fecha desconocida, nunca «noticia del día».
    for (const id of ['l1', 'o1']) expect(sampleLine(samples.today.find((s) => s.id === id)!)).toMatch(/FECHA DESCONOCIDA/);
    expect(samples.today.find((s) => s.id === 'n1')).toMatchObject({ kind: 'article', isComment: false });
    // Numeración consecutiva tras el tope.
    expect(samples.today.map((s) => s.sid)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
  });

  test('si la base falla, se anota sin contexto (el motor sigue)', async () => {
    const broken = { query: async () => { throw new Error('conexión caída'); } };
    const data = createPgComposerDataAccess(broken, AGENCY);
    const { samples, contextError } = await prepareSamples(data, { today: raw(['c1']) });
    expect(contextError).toMatch(/conexión caída/);
    expect(samples.today).toHaveLength(1);
  });
});

describe('loadComposerSamples', () => {
  test('día PR (rango de instantes en America/Puerto_Rico) y límites', async () => {
    const log: Array<{ sql: string; params: unknown[] }> = [];
    const client = { query: async (sql: string, params: unknown[] = []) => { log.push({ sql, params }); return { rows: [] }; } };
    await loadComposerSamples(client, AGENCY.id, { startYmd: '2026-10-26', endYmd: '2026-11-01', dayYmd: '2026-11-01' });
    expect(log).toHaveLength(4);
    expect(log[0].params).toEqual([AGENCY.id, '2026-11-01', '2026-11-01']);
    expect(log[0].sql).toContain(`LIMIT ${TODAY_SAMPLE_LIMIT}`);
    for (const q of log) {
      expect(q.sql).toContain("AT TIME ZONE 'America/Puerto_Rico'");
      expect(q.sql).toContain("nlp_pertinence IN ('alta','media')");
      expect(q.sql).toContain('m.is_duplicate = false');
      // Ningún corte por día UTC (`published_at >= $2::date`).
      expect(q.sql).not.toMatch(/published_at >= \(\$2::date\)\s/);
    }
    expect(log.slice(1).map((q) => q.params[3])).toEqual(['negativo', 'neutral', 'positivo']);
  });

  test('nombres propios con dígitos para el lint', () => {
    expect(namesWithDigits({ today: raw(['n1', 'c1']) })).toEqual(['En Contacto 787 Tv']);
  });
});
