/**
 * Resolución del post padre de un comentario (spec interpretación v1, sección 7).
 *
 * En un comentario de FB/IG, `title` es el texto del post padre y
 * `published_at` la hora del comentario: sin el enlace al padre, el correo
 * presentaba un post de hace 6 días como noticia del día. Aquí se enlaza el
 * comentario con la mención de la MISMA agencia que es su publicación.
 *
 *   - Facebook: GUID del comentario `<postId>_<commentId>`; el padre tiene GUID
 *     `<pageId>_<postId>` → `bw_guid LIKE '%\_<postId>'`.
 *   - Instagram: GUID del comentario `<shortcode>#<commentId>`; el padre tiene
 *     GUID `<shortcode>` → igualdad.
 *   - LinkedIn: el comentario llega con `?commentUrn=` y sin texto del post:
 *     padre desconocido (`parent_unknown`), sin consulta.
 *   - Sin padre en la base (llegó después, o es más viejo que la ventana):
 *     `not_found`; el motor de redacción trata la fecha como desconocida.
 *
 * La consulta va acotada por agencia y por fecha (el padre es anterior al
 * comentario: ventana de PARENT_LOOKBACK_DAYS hacia atrás y 1 día hacia
 * delante por desfase de relojes). Medido en producción (2-nov-2026): 18 ms
 * con acierto y 25–33 ms sin acierto en las agencias más grandes; resolución
 * 544/545 en FB y 201/201 en IG del DDEC (26-oct a 1-nov), retraso máximo
 * comentario-post de 24.9 días.
 */
import { isOwnedChannelComment, type MentionKindInput } from './mention-kind';

export const PARENT_LOOKBACK_DAYS = 60;

export type ParentStatus = 'resolved' | 'not_found' | 'parent_unknown' | 'not_comment';

export interface ParentResolution {
  parentMentionId: string | null;
  parentPublishedAt: Date | null;
  status: ParentStatus;
  platform: 'facebook' | 'instagram' | 'linkedin' | null;
}

export type ParentRef =
  | { platform: 'facebook'; postId: string }
  | { platform: 'instagram'; shortcode: string }
  | { platform: 'linkedin' };

export interface ParentLookupMention extends MentionKindInput {
  /** Fecha del comentario (ISO o Date); acota la ventana de búsqueda. */
  date?: string | Date | null;
}

/** Cliente mínimo de pg (pg.Client o un doble de prueba). */
export interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

const FB_COMMENT_URL = /facebook\.com\/(\d+)#channels_comment_\d+/i;
const IG_COMMENT_URL = /instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?#\d+$/i;

/**
 * Referencia al padre a partir del GUID (o de la URL cuando el GUID falta,
 * p. ej. filas importadas o reprocesadas). Nulo si no es un comentario de
 * canal propio o si el formato no se reconoce.
 */
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
    const shortcode = /^[A-Za-z0-9_-]+$/.test(fromGuid) ? fromGuid : IG_COMMENT_URL.exec(url)?.[1];
    return shortcode ? { platform: 'instagram', shortcode } : null;
  }
  return null;
}

// `url NOT LIKE '%#channels_comment%'`: el padre es un POST. Si Brandwatch
// entregara una respuesta a comentario con GUID `<commentId>_<replyId>`, el
// sufijo `_<commentId>` casaría con el comentario (`<postId>_<commentId>`) y
// no con el post; así queda `not_found` en vez de un padre equivocado.
export const PARENT_FB_SQL = `SELECT id, published_at FROM mentions
  WHERE agency_id = $1 AND bw_guid LIKE $2
    AND (url IS NULL OR url NOT LIKE '%#channels\\_comment%')
    AND published_at BETWEEN $3::timestamptz - ($4::int * INTERVAL '1 day') AND $3::timestamptz + INTERVAL '1 day'
  ORDER BY published_at DESC LIMIT 1`;

export const PARENT_IG_SQL = `SELECT id, published_at FROM mentions
  WHERE agency_id = $1 AND bw_guid = $2
    AND published_at BETWEEN $3::timestamptz - ($4::int * INTERVAL '1 day') AND $3::timestamptz + INTERVAL '1 day'
  ORDER BY published_at DESC LIMIT 1`;

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Busca el padre del comentario dentro de la agencia. Nunca lanza: si la
 * consulta falla, devuelve `not_found` (la mención se guarda igual y el
 * backfill puede reintentar).
 */
export async function resolveParent(
  pg: Queryable,
  agencyId: string,
  mention: ParentLookupMention,
  opts: { lookbackDays?: number } = {},
): Promise<ParentResolution> {
  const ref = parseParentRef(mention);
  if (!ref) {
    return isOwnedChannelComment(mention)
      ? { parentMentionId: null, parentPublishedAt: null, status: 'not_found', platform: null }
      : { parentMentionId: null, parentPublishedAt: null, status: 'not_comment', platform: null };
  }
  if (ref.platform === 'linkedin') {
    return { parentMentionId: null, parentPublishedAt: null, status: 'parent_unknown', platform: 'linkedin' };
  }

  const at = asDate(mention.date) ?? new Date();
  const days = Math.max(1, Math.floor(opts.lookbackDays ?? PARENT_LOOKBACK_DAYS));
  // El postId son solo dígitos (validado en parseParentRef): no hay comodines
  // que escapar salvo el `_` separador, que va como literal (`\_`).
  const [sql, needle] = ref.platform === 'facebook'
    ? [PARENT_FB_SQL, `%\\_${ref.postId}`]
    : [PARENT_IG_SQL, ref.shortcode];
  try {
    const { rows } = await pg.query(sql, [agencyId, needle, at.toISOString(), days]);
    const hit = rows[0];
    if (hit?.id) {
      return { parentMentionId: hit.id, parentPublishedAt: asDate(hit.published_at), status: 'resolved', platform: ref.platform };
    }
  } catch (err) {
    console.warn(`[parent] consulta falló (${ref.platform}): ${(err as Error).message}`);
  }
  return { parentMentionId: null, parentPublishedAt: null, status: 'not_found', platform: ref.platform };
}
