/**
 * Tipo de mención (spec interpretación v1, sección 5.1).
 *
 * El processor clasificaba un comentario de Facebook o Instagram con el post
 * padre como «Título» y sin saber que era un comentario: pertinencia, tópico y
 * sentimiento se decidían sobre el texto de la agencia y no sobre lo que
 * escribió el usuario. Este módulo decide, sin red ni base de datos, qué es
 * cada mención a partir de los campos que trae Brandwatch.
 *
 * Valores (columna `mentions.mention_kind`, varchar(24)):
 *   - `comment`          comentario de un usuario en una publicación de un canal
 *                        propio de la agencia (FB `#channels_comment`, GUID de IG
 *                        con `#` en INSTAGRAM_GRAPH_BUSINESS, LinkedIn `commentUrn`)
 *   - `article`          nota de prensa, blog o foro (page_type news/blog/forum)
 *   - `agency_post`      publicación de una página de la propia agencia en redes
 *   - `third_party_post` publicación de un tercero (medio, página, persona)
 */

export type MentionKind = 'article' | 'agency_post' | 'comment' | 'third_party_post';

export const MENTION_KINDS: readonly MentionKind[] = ['article', 'agency_post', 'comment', 'third_party_post'];

/** Campos de la mención que bastan para decidir el tipo (BrandwatchMention o fila de `mentions`). */
export interface MentionKindInput {
  url?: string | null;
  guid?: string | null;
  pubType?: string | null;
  pageType?: string | null;
  author?: string | null;
}

export interface MentionKindAgency {
  slug: string;
  name: string;
}

/** page_types de prensa y blogs: lo mismo que el processor usa para el fetch del cuerpo. */
export const ARTICLE_PAGE_TYPES = new Set(['news', 'blog', 'forum']);

/**
 * pub_types de los CANALES PROPIOS conectados en Brandwatch (owned channels):
 * lo que no es comentario en ellos es una publicación de la página conectada.
 * Las variantes `*_PUBLIC`, `INSTAGRAM_GRAPH_MENTION_*` y `*_TAGGED` son
 * contenido de terceros que menciona o etiqueta a la agencia.
 */
export const OWNED_CHANNEL_PUB_TYPES = new Set(['FACEBOOK', 'INSTAGRAM_GRAPH_BUSINESS', 'LINKEDIN']);

/**
 * Autores que son la propia agencia en redes, además de `agencies.name`.
 * Medido en producción (oct-2026): DF publica por su página pública
 * (FACEBOOK_PUBLIC, autor «Departamento de la Familia»); la Gobernadora por su
 * página personal y la de La Fortaleza; DDEC por sus canales propios (FB y
 * LinkedIn con el nombre de la agencia, IG como «desarrollopr»).
 * Se compara normalizado (minúsculas, sin acentos ni espacios repetidos).
 */
export const AGENCY_OWN_AUTHORS: Record<string, readonly string[]> = {
  ddecpr: ['Departamento de Desarrollo Económico y Comercio', 'desarrollopr'],
  df: ['Departamento de la Familia'],
  gobernadora: ['Jenniffer González Colón', 'jenniffergonzalezcolon', 'La Fortaleza de PR'],
};

export function normalizeAuthor(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿El autor es la propia agencia? (nombre de la agencia o alias medidos). */
export function isAgencyAuthor(author: string | null | undefined, agency: MentionKindAgency | null | undefined): boolean {
  if (!agency) return false;
  const a = normalizeAuthor(author);
  if (!a) return false;
  const own = [agency.name, ...(AGENCY_OWN_AUTHORS[agency.slug] ?? [])].map(normalizeAuthor).filter(Boolean);
  return own.includes(a);
}

/** URL de comentario de IG: `instagram.com/(p|reel|tv)/<shortcode>/#<commentId>`. */
const IG_COMMENT_URL = /instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?#\d+$/i;

/**
 * ¿Es un comentario en un canal propio? Solo los tres formatos medidos:
 *   - Facebook: URL `facebook.com/<postId>#channels_comment_<commentId>`.
 *   - Instagram: pub_type INSTAGRAM_GRAPH_BUSINESS y GUID `<shortcode>#<commentId>`
 *     (o, sin GUID, la URL del post con `#<commentId>`).
 *   - LinkedIn: pub_type LINKEDIN y URL con `?commentUrn=`.
 * Las respuestas en Reddit, YouTube o Bluesky son contenido de terceros, no
 * comentarios a publicaciones de la agencia.
 */
export function isOwnedChannelComment(m: MentionKindInput): boolean {
  const url = m.url ?? '';
  const pub = (m.pubType ?? '').toUpperCase();
  if (url.includes('#channels_comment')) return true;
  if (pub === 'INSTAGRAM_GRAPH_BUSINESS') {
    if ((m.guid ?? '').includes('#')) return true;
    if (!m.guid && IG_COMMENT_URL.test(url)) return true;
  }
  if (pub === 'LINKEDIN' && /[?&]commentUrn=/i.test(url)) return true;
  return false;
}

/**
 * Tipo de la mención. Orden de las reglas: comentario → artículo → página de
 * la agencia → tercero.
 *
 * Una publicación de un canal propio (FACEBOOK, INSTAGRAM_GRAPH_BUSINESS,
 * LINKEDIN) cuenta como `agency_post` cuando el autor es la agencia o, si para
 * esa agencia no hay lista de autores propios, por el solo hecho de venir del
 * canal conectado. Con lista, un post de canal propio firmado por OTRA
 * entidad (p. ej. el DDEC dentro de la query de la Gobernadora) es tercero.
 */
export function deriveMentionKind(m: MentionKindInput, agency?: MentionKindAgency | null): MentionKind {
  if (isOwnedChannelComment(m)) return 'comment';
  if (ARTICLE_PAGE_TYPES.has((m.pageType ?? '').toLowerCase())) return 'article';
  if (isAgencyAuthor(m.author, agency)) return 'agency_post';
  const pub = (m.pubType ?? '').toUpperCase();
  if (OWNED_CHANNEL_PUB_TYPES.has(pub) && !(agency && AGENCY_OWN_AUTHORS[agency.slug])) return 'agency_post';
  return 'third_party_post';
}
