/**
 * Paridad del tipo de mención y del padre del feed (WP-9a) con la lógica del
 * lambda (`infra/lambda/lib/mention-kind.ts` y `parent-resolver.ts`), de la que
 * `kind.ts` es copia: si el lambda cambia una regla, este test falla y obliga a
 * actualizar la copia de la web.
 */
import * as lambdaKind from '../../../../../infra/lambda/lib/mention-kind';
import * as lambdaParent from '../../../../../infra/lambda/lib/parent-resolver';
import {
  deriveMentionKind, parseParentRef, isOwnedChannelComment, normalizeAuthor, mentionKindExprSql, AGENCY_OWN_AUTHORS,
  type MentionKindInput,
} from './kind';
import { PgDialect } from 'drizzle-orm/pg-core';

const DDEC = { slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };
const DF = { slug: 'df', name: 'Departamento de la Familia' };
const AAA = { slug: 'aaa', name: 'Autoridad de Acueductos y Alcantarillados' };
const AGENCIES = [DDEC, DF, AAA, { slug: 'gobernadora', name: 'Gobernadora' }, null];

// Casos sintéticos (sin texto ni autores reales): cubren cada rama de la regla.
const CASES: MentionKindInput[] = [
  { url: 'https://www.facebook.com/123456#channels_comment_789', guid: '123456_789', pubType: 'FACEBOOK', pageType: 'facebook', author: 'Ana Prueba' },
  { url: 'https://www.instagram.com/p/AbC123/#1789', guid: 'AbC123#1789', pubType: 'INSTAGRAM_GRAPH_BUSINESS', pageType: 'instagram', author: 'user_x' },
  { url: 'https://www.instagram.com/reel/AbC123/#1789', guid: null, pubType: 'INSTAGRAM_GRAPH_BUSINESS', pageType: 'instagram', author: 'user_x' },
  { url: 'https://www.instagram.com/p/AbC123/', guid: 'AbC123', pubType: 'INSTAGRAM_GRAPH_BUSINESS', pageType: 'instagram', author: 'desarrollopr' },
  { url: 'https://www.linkedin.com/feed/update/urn:li:activity:1?commentUrn=urn%3Ali%3Acomment', guid: null, pubType: 'LINKEDIN', pageType: 'linkedin', author: 'Persona' },
  { url: 'https://www.linkedin.com/feed/update/urn:li:activity:1', guid: null, pubType: 'LINKEDIN', pageType: 'linkedin', author: 'Departamento de Desarrollo Económico y Comercio' },
  { url: 'https://periodico.example/nota', guid: 'g1', pubType: null, pageType: 'news', author: 'Redacción' },
  { url: 'https://blog.example/post', guid: 'g2', pubType: null, pageType: 'Blog', author: 'Departamento de la Familia' },
  { url: 'https://www.facebook.com/100/posts/1', guid: '100_1', pubType: 'FACEBOOK', pageType: 'facebook', author: 'Departamento  de la  Familia ' },
  { url: 'https://www.facebook.com/100/posts/2', guid: '100_2', pubType: 'FACEBOOK', pageType: 'facebook', author: 'Otra Página' },
  { url: 'https://www.facebook.com/100/posts/3', guid: '100_3', pubType: 'FACEBOOK_PUBLIC', pageType: 'facebook_public', author: 'Tercero' },
  { url: 'https://x.com/u/status/1', guid: null, pubType: 'TWITTER', pageType: 'twitter', author: 'tercero' },
  { url: 'https://x.com/u/status/2', guid: null, pubType: null, pageType: 'twitter', author: null },
  { url: null, guid: null, pubType: null, pageType: 'instagram', author: 'JENNIFFERGONZALEZCOLON' },
  { url: 'https://www.youtube.com/watch?v=1#channels_commentary', guid: null, pubType: 'YOUTUBE', pageType: 'youtube', author: 'canal' },
  { url: 'https://reddit.example/r/x/comments/1/#2', guid: null, pubType: 'REDDIT', pageType: 'reddit', author: 'u' },
];

describe('paridad con el lambda (mention-kind / parent-resolver)', () => {
  test.each(AGENCIES.map((a) => [a?.slug ?? 'sin-agencia', a] as const))('deriveMentionKind — %s', (_n, agency) => {
    for (const c of CASES) {
      expect({ c, kind: deriveMentionKind(c, agency) }).toEqual({ c, kind: lambdaKind.deriveMentionKind(c, agency) });
      expect(isOwnedChannelComment(c)).toBe(lambdaKind.isOwnedChannelComment(c));
    }
  });

  test('parseParentRef coincide en todos los casos', () => {
    for (const c of CASES) expect(parseParentRef(c)).toEqual(lambdaParent.parseParentRef(c));
  });

  test('autores propios y normalización coinciden', () => {
    expect(AGENCY_OWN_AUTHORS).toEqual(lambdaKind.AGENCY_OWN_AUTHORS);
    for (const s of ['  Jenniffer   González Colón ', 'DESARROLLOPR', null, undefined, 'Ñandú Ç']) {
      expect(normalizeAuthor(s)).toBe(lambdaKind.normalizeAuthor(s));
    }
  });

  test('las reglas de los casos dan lo esperado (anclas de la tabla)', () => {
    expect(deriveMentionKind(CASES[0], DDEC)).toBe('comment');
    expect(deriveMentionKind(CASES[1], DDEC)).toBe('comment');
    expect(deriveMentionKind(CASES[3], DDEC)).toBe('agency_post');     // alias medido de DDEC
    expect(deriveMentionKind(CASES[6], DDEC)).toBe('article');
    expect(deriveMentionKind(CASES[8], DF)).toBe('agency_post');       // espacios repetidos normalizados
    expect(deriveMentionKind(CASES[9], DF)).toBe('third_party_post');  // canal propio, otro autor, agencia CON lista
    expect(deriveMentionKind(CASES[9], AAA)).toBe('agency_post');      // agencia SIN lista: canal propio basta
    expect(deriveMentionKind(CASES[10], DF)).toBe('third_party_post'); // FACEBOOK_PUBLIC es de terceros
  });
});

describe('mentionKindExprSql — la misma derivación en SQL (filtro mentionKind)', () => {
  const dialect = new PgDialect();
  const render = (agency: { slug: string; name: string } | null) => dialect.sqlToQuery(mentionKindExprSql(agency));

  test('con lista de autores propios: parámetros normalizados y sin rama de canal propio', () => {
    const q = render(DF);
    expect(q.sql).toContain('COALESCE(mentions.mention_kind, CASE');
    expect(q.sql).toContain("THEN 'comment'");
    expect(q.params).toEqual(['departamento de la familia']);
    // DF tiene lista: el canal propio NO basta para agency_post.
    expect(q.sql).toMatch(/WHEN false THEN 'agency_post'/);
  });

  test('sin lista (AAA): el canal propio basta para agency_post', () => {
    const q = render(AAA);
    expect(q.sql).toContain("upper(coalesce(mentions.pub_type, '')) IN ('FACEBOOK', 'INSTAGRAM_GRAPH_BUSINESS', 'LINKEDIN')");
    expect(q.params).toEqual(['autoridad de acueductos y alcantarillados']);
  });

  test('DDEC trae nombre + alias, todos normalizados', () => {
    expect(render(DDEC).params).toEqual(['departamento de desarrollo economico y comercio', 'desarrollopr']);
  });

  test('sin agencia: nadie es autor propio', () => {
    const q = render(null);
    expect(q.params).toEqual([]);
    expect(q.sql).toMatch(/WHEN false THEN 'agency_post'/);
  });
});
