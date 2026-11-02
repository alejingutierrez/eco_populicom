import { readFileSync } from 'fs';
import * as path from 'path';
import { deriveMentionKind, isAgencyAuthor, isOwnedChannelComment, normalizeAuthor, type MentionKind } from '../lambda/lib/mention-kind';

/**
 * Casos reales de producción (22-oct a 1-nov-2026), pseudonimizados: ver
 * `_about` del fixture. La etiqueta esperada sigue el spec 5.1 y coincide con
 * la categoría del laboratorio (fb_comment/ig_comment/li_comment → comment,
 * own_post → agency_post, news → article, third_social → third_party_post),
 * salvo dos diferencias deliberadas: los foros son `article` y
 * INSTAGRAM_GRAPH_MENTION_COMMENT (comentario que etiqueta a la agencia en un
 * post ajeno) es `third_party_post`.
 */
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/interp-v1-mentions.json'), 'utf8')) as {
  agencies: Record<string, { id: string; slug: string; name: string }>;
  kindCases: Array<{ agency: string; pubType: string; pageType: string; url: string; guid: string | null; author: string | null; expected: MentionKind }>;
};

const kindOf = (c: (typeof fixture.kindCases)[number]) =>
  deriveMentionKind({ url: c.url, guid: c.guid, pubType: c.pubType, pageType: c.pageType, author: c.author }, fixture.agencies[c.agency]);

describe('deriveMentionKind — casos reales por plataforma', () => {
  const byPlatform = (pred: (c: (typeof fixture.kindCases)[number]) => boolean) => fixture.kindCases.filter(pred);
  const groups: Array<[string, ReturnType<typeof byPlatform>]> = [
    ['Facebook comentarios', byPlatform((c) => c.pubType === 'FACEBOOK' && c.expected === 'comment')],
    ['Facebook posts propios', byPlatform((c) => c.pubType === 'FACEBOOK' && c.expected === 'agency_post')],
    ['Facebook público', byPlatform((c) => c.pubType === 'FACEBOOK_PUBLIC')],
    ['Instagram comentarios', byPlatform((c) => c.pubType === 'INSTAGRAM_GRAPH_BUSINESS' && c.expected === 'comment')],
    ['Instagram posts propios', byPlatform((c) => c.pubType === 'INSTAGRAM_GRAPH_BUSINESS' && c.expected === 'agency_post')],
    ['Instagram de terceros', byPlatform((c) => c.pageType.startsWith('instagram') && !['INSTAGRAM_GRAPH_BUSINESS'].includes(c.pubType))],
    ['LinkedIn comentarios', byPlatform((c) => c.pubType === 'LINKEDIN' && c.expected === 'comment')],
    ['LinkedIn posts propios', byPlatform((c) => c.pubType === 'LINKEDIN' && c.expected === 'agency_post')],
    ['Prensa, blogs y foros', byPlatform((c) => ['news', 'blog', 'forum'].includes(c.pageType))],
    ['Bluesky', byPlatform((c) => c.pageType === 'bluesky')],
  ];

  it.each(groups)('%s: al menos 20 casos reales', (_name, cases) => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(groups)('%s: tipo correcto en todos', (_name, cases) => {
    const wrong = cases.filter((c) => kindOf(c) !== c.expected).map((c) => ({ ...c, got: kindOf(c) }));
    expect(wrong).toEqual([]);
  });

  it('todo el fixture (incluidos Reddit, YouTube, Tumblr) coincide', () => {
    const wrong = fixture.kindCases.filter((c) => kindOf(c) !== c.expected);
    expect(wrong).toEqual([]);
    expect(fixture.kindCases.length).toBeGreaterThan(300);
  });
});

describe('deriveMentionKind — reglas', () => {
  const ddec = { slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };
  const gob = { slug: 'gobernadora', name: 'Gobernadora de Puerto Rico' };
  const aaa = { slug: 'aaa', name: 'Autoridad de Acueductos y Alcantarillados' };

  it('comentario de FB por #channels_comment aunque falte el GUID', () => {
    expect(deriveMentionKind({ url: 'https://www.facebook.com/1553736176780709#channels_comment_1', pubType: 'FACEBOOK', pageType: 'facebook' }, ddec)).toBe('comment');
  });

  it('comentario de IG por la URL cuando no hay GUID', () => {
    expect(deriveMentionKind({ url: 'https://www.instagram.com/reel/De9aPgiRU_d/#18193888252402851', pubType: 'INSTAGRAM_GRAPH_BUSINESS', pageType: 'instagram' }, ddec)).toBe('comment');
    expect(deriveMentionKind({ url: 'https://www.instagram.com/p/DfFJFYfDibN/', guid: 'DfFJFYfDibN', pubType: 'INSTAGRAM_GRAPH_BUSINESS', pageType: 'instagram', author: 'desarrollopr' }, ddec)).toBe('agency_post');
  });

  it('un GUID con # fuera de INSTAGRAM_GRAPH_BUSINESS (Bluesky, mention comment) no es comentario de canal propio', () => {
    expect(isOwnedChannelComment({ guid: 'did:plc:x#3mykms7bhik22', pubType: 'BLUESKY_REPLY', url: 'https://bsky.app/profile/did:plc:x/post/3mykms7bhik22' })).toBe(false);
    expect(deriveMentionKind({ guid: 'DfI3V9DAPRz#1813', pubType: 'INSTAGRAM_GRAPH_MENTION_COMMENT', pageType: 'instagram', url: 'https://www.instagram.com/reel/DfI3V9DAPRz/#1813' }, ddec)).toBe('third_party_post');
  });

  it('el comentario gana sobre el page_type', () => {
    expect(deriveMentionKind({ url: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:1?commentUrn=urn%3Ali%3Acomment%3A%28urn%3Ali%3AugcPost%3A1%2C2%29', pubType: 'LINKEDIN', pageType: 'linkedin', author: '' }, ddec)).toBe('comment');
  });

  it('post de canal propio firmado por OTRA entidad en una agencia con lista de autores → tercero', () => {
    expect(deriveMentionKind({ url: 'https://www.facebook.com/553558728043206/posts/1#channels', pubType: 'FACEBOOK', pageType: 'facebook', author: 'Departamento de Desarrollo Económico y Comercio' }, gob)).toBe('third_party_post');
  });

  it('agencia sin lista de autores: el canal propio basta', () => {
    expect(deriveMentionKind({ url: 'https://www.facebook.com/1/posts/2#channels', pubType: 'FACEBOOK', pageType: 'facebook', author: 'AAA' }, aaa)).toBe('agency_post');
    expect(deriveMentionKind({ url: 'https://www.facebook.com/1/posts/2#channels', pubType: 'FACEBOOK_PUBLIC', pageType: 'facebook_public', author: 'Noticias' }, aaa)).toBe('third_party_post');
  });

  it('sin agencia no hay agency_post por autor', () => {
    expect(deriveMentionKind({ pubType: 'FACEBOOK_PUBLIC', pageType: 'facebook_public', author: 'Departamento de la Familia' })).toBe('third_party_post');
  });

  it('el autor se compara sin acentos ni mayúsculas', () => {
    expect(normalizeAuthor('  Jenniffer  GONZÁLEZ Colón ')).toBe('jenniffer gonzalez colon');
    expect(isAgencyAuthor('jenniffer gonzalez colon', gob)).toBe(true);
    expect(isAgencyAuthor('Telemundo PR', gob)).toBe(false);
  });
});
