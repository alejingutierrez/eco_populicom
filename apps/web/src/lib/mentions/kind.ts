/**
 * Tipo de mención y resolución del post padre para el feed (WP-9a, spec
 * interpretación v1 secciones 5.1, 7 y 11.5).
 *
 * `mentions.mention_kind` y `parent_mention_id` están vacías hasta que el
 * processor (WP-2) o el backfill (WP-13) las pueblen. Mientras tanto el payload
 * las DERIVA, solo para las filas que devuelve la página (nunca escanea la
 * tabla), con la MISMA lógica del lambda: `infra/lambda/lib/mention-kind.ts` y
 * `infra/lambda/lib/parent-resolver.ts`. El código de aquí es una copia (la web
 * no puede importar de `infra/`; `packages/shared` es de WP-3/4) y
 * `kind.test.ts` prueba la PARIDAD contra el módulo del lambda con una tabla de
 * casos; si el lambda cambia una regla, ese test falla.
 *
 * Cuando la columna ya viene poblada manda la columna: `kind` = columna si no
 * es nula; si no, la derivada.
 */
import { sql, type SQL } from 'drizzle-orm';

export type MentionKind = 'article' | 'agency_post' | 'comment' | 'third_party_post';
export const MENTION_KINDS: readonly MentionKind[] = ['article', 'agency_post', 'comment', 'third_party_post'];

export interface MentionKindInput {
  url?: string | null;
  guid?: string | null;
  pubType?: string | null;
  pageType?: string | null;
  author?: string | null;
}
export interface MentionKindAgency { slug: string; name: string }

// ---- Copia de infra/lambda/lib/mention-kind.ts (paridad probada) ----------

const ARTICLE_PAGE_TYPES = new Set(['news', 'blog', 'forum']);
const OWNED_CHANNEL_PUB_TYPES = new Set(['FACEBOOK', 'INSTAGRAM_GRAPH_BUSINESS', 'LINKEDIN']);
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

export function isAgencyAuthor(author: string | null | undefined, agency: MentionKindAgency | null | undefined): boolean {
  if (!agency) return false;
  const a = normalizeAuthor(author);
  if (!a) return false;
  return ownAuthorsOf(agency).includes(a);
}

/** Autores propios de la agencia, normalizados (nombre + alias medidos). */
export function ownAuthorsOf(agency: MentionKindAgency): string[] {
  return [agency.name, ...(AGENCY_OWN_AUTHORS[agency.slug] ?? [])].map(normalizeAuthor).filter(Boolean);
}

const IG_COMMENT_URL = /instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?#\d+$/i;

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

export function deriveMentionKind(m: MentionKindInput, agency?: MentionKindAgency | null): MentionKind {
  if (isOwnedChannelComment(m)) return 'comment';
  if (ARTICLE_PAGE_TYPES.has((m.pageType ?? '').toLowerCase())) return 'article';
  if (isAgencyAuthor(m.author, agency)) return 'agency_post';
  const pub = (m.pubType ?? '').toUpperCase();
  if (OWNED_CHANNEL_PUB_TYPES.has(pub) && !(agency && AGENCY_OWN_AUTHORS[agency.slug])) return 'agency_post';
  return 'third_party_post';
}

// ---- Copia de parseParentRef (infra/lambda/lib/parent-resolver.ts) --------

export type ParentRef =
  | { platform: 'facebook'; postId: string }
  | { platform: 'instagram'; shortcode: string }
  | { platform: 'linkedin' };

const FB_COMMENT_URL = /facebook\.com\/(\d+)#channels_comment_\d+/i;
// Con grupo de captura del shortcode (la de isOwnedChannelComment no lo captura).
const IG_COMMENT_URL_CAPTURE = /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?#\d+$/i;

export function parseParentRef(m: MentionKindInput): ParentRef | null {
  if (!isOwnedChannelComment(m)) return null;
  const url = m.url ?? '';
  const guid = (m.guid ?? '').trim();
  const pub = (m.pubType ?? '').toUpperCase();

  if (pub === 'LINKEDIN' || /linkedin\.com/i.test(url)) return { platform: 'linkedin' };

  if (url.includes('#channels_comment') || pub === 'FACEBOOK') {
    const fromGuid = /^(\d+)_\d+$/.exec(guid)?.[1];
    const fromUrl = FB_COMMENT_URL.exec(url)?.[1];
    const postId = fromGuid ?? fromUrl;
    return postId ? { platform: 'facebook', postId } : null;
  }

  if (pub === 'INSTAGRAM_GRAPH_BUSINESS') {
    const fromGuid = guid.includes('#') ? guid.split('#')[0] : '';
    const shortcode = /^[A-Za-z0-9_-]+$/.test(fromGuid) ? fromGuid : IG_COMMENT_URL_CAPTURE.exec(url)?.[1];
    return shortcode ? { platform: 'instagram', shortcode } : null;
  }
  return null;
}

// ---- SQL: la misma derivación, para el filtro `mentionKind` ---------------

/** Letras con acento → sin acento, como el NFD + quitar marcas de normalizeAuthor. */
const ACCENTED = 'áàâäãéèêëíìîïóòôöõúùûüñç';
const PLAIN = 'aaaaaeeeeiiiiooooouuuunc';

/**
 * Expresión SQL (sobre la tabla `mentions`, sin alias) que da el tipo de la
 * mención: la columna `mention_kind` si está poblada y, si no, la derivación
 * de `deriveMentionKind`. Solo se evalúa sobre las filas que ya pasaron los
 * demás filtros (agencia + ventana), nunca sobre la tabla entera.
 *
 * La normalización del autor en SQL (`translate`) cubre las letras del español;
 * el TS usa NFD y quita CUALQUIER marca. Para los autores propios medidos las
 * dos coinciden (probado contra Postgres con la tabla de casos de kind.test.ts).
 */
export function mentionKindExprSql(agency: MentionKindAgency | null): SQL {
  const own = agency ? [...new Set(ownAuthorsOf(agency))] : [];
  const ownList = own.length ? sql.join(own.map((a) => sql`${a}`), sql`, `) : null;
  const hasOwnList = !!(agency && AGENCY_OWN_AUTHORS[agency.slug]);
  const authorNorm = sql.raw(
    `regexp_replace(translate(lower(btrim(coalesce(mentions.author, ''))), '${ACCENTED}', '${PLAIN}'), '\\s+', ' ', 'g')`,
  );
  const ownedComment = sql.raw(
    `(strpos(coalesce(mentions.url, ''), '#channels_comment') > 0
      OR (upper(coalesce(mentions.pub_type, '')) = 'INSTAGRAM_GRAPH_BUSINESS'
          AND (strpos(coalesce(mentions.bw_guid, ''), '#') > 0
               OR (coalesce(mentions.bw_guid, '') = ''
                   AND coalesce(mentions.url, '') ~* 'instagram\\.com/(?:p|reel|reels|tv)/[A-Za-z0-9_-]+/?#[0-9]+$')))
      OR (upper(coalesce(mentions.pub_type, '')) = 'LINKEDIN' AND coalesce(mentions.url, '') ~* '[?&]commentUrn='))`,
  );
  const agencyAuthor = ownList ? sql`(${authorNorm} <> '' AND ${authorNorm} IN (${ownList}))` : sql`false`;
  const ownedChannelPost = hasOwnList
    ? sql`false`
    : sql`upper(coalesce(mentions.pub_type, '')) IN ('FACEBOOK', 'INSTAGRAM_GRAPH_BUSINESS', 'LINKEDIN')`;
  return sql`COALESCE(mentions.mention_kind, CASE
      WHEN ${ownedComment} THEN 'comment'
      WHEN lower(coalesce(mentions.page_type, '')) IN ('news', 'blog', 'forum') THEN 'article'
      WHEN ${agencyAuthor} THEN 'agency_post'
      WHEN ${ownedChannelPost} THEN 'agency_post'
      ELSE 'third_party_post' END)`;
}
