import { PgDialect } from 'drizzle-orm/pg-core';
import { loadParents, parentAge, trimText, PARENT_TEXT_MAX, type ParentSourceRow } from './parents';

const dialect = new PgDialect();

/** db.execute falso: registra el SQL renderizado y responde según la consulta. */
function fakeDb(respond: (sqlText: string, params: unknown[]) => unknown[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    execute: async (q: unknown) => {
      const r = dialect.sqlToQuery(q as Parameters<PgDialect['sqlToQuery']>[0]);
      const sqlText = r.sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: sqlText, params: r.params });
      return { rows: respond(sqlText, r.params) };
    },
  };
  return { db: db as unknown as Parameters<typeof loadParents>[0], calls };
}

const T0 = new Date('2026-11-01T14:00:00Z');
const fbComment = (over: Partial<ParentSourceRow> = {}): ParentSourceRow => ({
  id: 'c1', kind: 'comment', publishedAt: T0, parentMentionId: null,
  url: 'https://www.facebook.com/555#channels_comment_9', guid: '555_9', pubType: 'FACEBOOK', pageType: 'facebook', author: 'Ana',
  ...over,
});

describe('parentAge', () => {
  test('edad en días con un decimal y reacción tardía solo si el padre tiene más de 2 días', () => {
    expect(parentAge(T0, new Date(T0.getTime() - 24 * 3600e3))).toEqual({ parentAgeDays: 1, lateReaction: false });
    expect(parentAge(T0, new Date(T0.getTime() - 48 * 3600e3))).toEqual({ parentAgeDays: 2, lateReaction: false });
    expect(parentAge(T0, new Date(T0.getTime() - 49 * 3600e3))).toEqual({ parentAgeDays: 2, lateReaction: true });
    expect(parentAge(T0, new Date(T0.getTime() - 6 * 24 * 3600e3))).toEqual({ parentAgeDays: 6, lateReaction: true });
  });
  test('un padre posterior al comentario (desfase de relojes) no da edad negativa', () => {
    expect(parentAge(T0, new Date(T0.getTime() + 3600e3))).toEqual({ parentAgeDays: 0, lateReaction: false });
  });
});

describe('trimText', () => {
  test('recorta a PARENT_TEXT_MAX por puntos de código, sin dejar sustitutos sueltos', () => {
    const t = trimText('𝐁'.repeat(400));
    expect(Array.from(t).length).toBe(PARENT_TEXT_MAX);
    expect(t.endsWith('…')).toBe(true);
    expect(JSON.parse(JSON.stringify(t))).toBe(t);
  });
  test('colapsa espacios y no toca textos cortos', () => {
    expect(trimText('  hola \n  mundo ')).toBe('hola mundo');
    expect(trimText(null)).toBe('');
  });
});

describe('loadParents', () => {
  test('sin comentarios no consulta nada', async () => {
    const { db, calls } = fakeDb(() => []);
    const out = await loadParents(db, 'ag', [fbComment({ kind: 'article' })]);
    expect(out.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('comentario de Facebook: se resuelve por GUID en UNA consulta acotada por agencia y fechas', async () => {
    const parentAt = new Date(T0.getTime() - 6 * 24 * 3600e3);
    const { db, calls } = fakeDb(() => [{
      id: 'p1', published_at: parentAt.toISOString(), author: 'DDEC', author_fullname: null,
      title: 'Titulo del post', snippet: 'Texto del post padre', bw_guid: '777_555',
    }]);
    const out = await loadParents(db, 'ag', [fbComment()]);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('p.agency_id = $1::uuid');
    expect(calls[0].sql).toContain('p.published_at BETWEEN');
    expect(calls[0].params).toContain('%\\_555');
    expect(out.get('c1')).toEqual({
      parent: { id: 'p1', publishedAt: parentAt.toISOString(), author: 'DDEC', text: 'Texto del post padre' },
      parentUnknown: false, parentAgeDays: 6, lateReaction: true,
    });
  });

  test('el padre de otro post (sufijo distinto) no se asigna', async () => {
    const { db } = fakeDb(() => [{
      id: 'p9', published_at: new Date(T0.getTime() - 3600e3).toISOString(), author: 'x', author_fullname: null,
      title: 't', snippet: null, bw_guid: '777_5559',
    }]);
    const out = await loadParents(db, 'ag', [fbComment()]);
    expect(out.get('c1')).toMatchObject({ parent: null, parentUnknown: true, parentAgeDays: null, lateReaction: false });
  });

  test('Instagram: igualdad con el shortcode y elige el padre más reciente dentro de la ventana', async () => {
    const old = new Date(T0.getTime() - 70 * 24 * 3600e3); // fuera de los 60 días
    const recent = new Date(T0.getTime() - 3 * 24 * 3600e3);
    const { db, calls } = fakeDb(() => [
      { id: 'viejo', published_at: old.toISOString(), author: 'a', author_fullname: null, title: 'x', snippet: null, bw_guid: 'AbC123' },
      { id: 'reciente', published_at: recent.toISOString(), author: 'a', author_fullname: 'Página', title: 'x', snippet: null, bw_guid: 'AbC123' },
    ]);
    const ig: ParentSourceRow = {
      id: 'c2', kind: 'comment', publishedAt: T0, parentMentionId: null,
      url: 'https://www.instagram.com/p/AbC123/#1', guid: 'AbC123#1', pubType: 'INSTAGRAM_GRAPH_BUSINESS', pageType: 'instagram', author: 'u',
    };
    const out = await loadParents(db, 'ag', [ig]);
    expect(calls[0].params).toContain('AbC123');
    expect(out.get('c2')?.parent?.id).toBe('reciente');
    expect(out.get('c2')?.parent?.author).toBe('Página');
    expect(out.get('c2')?.lateReaction).toBe(true);
  });

  test('LinkedIn: sin texto del post → padre desconocido y ninguna consulta', async () => {
    const { db, calls } = fakeDb(() => []);
    const li: ParentSourceRow = {
      id: 'c3', kind: 'comment', publishedAt: T0, parentMentionId: null,
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:1?commentUrn=urn%3Ali%3Acomment', guid: null, pubType: 'LINKEDIN', pageType: 'linkedin', author: 'p',
    };
    const out = await loadParents(db, 'ag', [li]);
    expect(calls).toHaveLength(0);
    expect(out.get('c3')).toMatchObject({ parent: null, parentUnknown: true });
  });

  test('con parent_mention_id poblado se lee por id (sin resolver por GUID)', async () => {
    const parentAt = new Date(T0.getTime() - 3600e3);
    const { db, calls } = fakeDb((sqlText) => (/p\.id IN/.test(sqlText)
      ? [{ id: 'pp', published_at: parentAt.toISOString(), author: 'DDEC', author_fullname: null, title: 'T', snippet: null, bw_guid: '1_2' }]
      : []));
    const out = await loadParents(db, 'ag', [fbComment({ parentMentionId: 'pp' })]);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('p.id IN');
    expect(out.get('c1')?.parent?.id).toBe('pp');
    expect(out.get('c1')?.lateReaction).toBe(false);
  });
});
