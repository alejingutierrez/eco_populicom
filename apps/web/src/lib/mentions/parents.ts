/**
 * Post padre de los comentarios del feed (WP-9a, spec interpretación v1
 * secciones 7 y 11.5).
 *
 * En un comentario de FB/IG, `title` es el texto del post padre y
 * `published_at` la hora del COMENTARIO: sin enlazar al padre, un post de hace
 * seis días se lee como noticia del día. Aquí se entrega, por cada comentario
 * de la página que se devuelve:
 *
 *   parent: { id, publishedAt, author, text }   (texto recortado)
 *   parentAgeDays / lateReaction                 (edad del padre al comentar)
 *
 * Si `parent_mention_id` ya viene poblado (processor/backfill) se lee por id.
 * Si no (hoy), se resuelve por GUID con la misma regla del lambda
 * (`infra/lambda/lib/parent-resolver.ts`): FB = `bw_guid LIKE '%\_<postId>'`,
 * IG = `bw_guid = <shortcode>`, ambos de la MISMA agencia y con el padre entre
 * 60 días antes y 1 día después del comentario. Es UNA consulta por página
 * (máx. `limit` comentarios), nunca un escaneo de la tabla.
 *
 * LinkedIn no trae el texto del post: `parentUnknown = true`. Un comentario sin
 * padre encontrado también es `parentUnknown`: su fecha de publicación original
 * se trata como DESCONOCIDA, no como del día (spec 7).
 */
import { sql } from 'drizzle-orm';
import type { getDb } from '@eco/database';
import { parseParentRef, type MentionKind, type MentionKindInput } from './kind';

type Db = ReturnType<typeof getDb>;

export const PARENT_LOOKBACK_DAYS = 60;
export const PARENT_TEXT_MAX = 280;
/** Un comentario con un padre de más de 2 días es una «reacción tardía» (spec 11.5). */
export const LATE_REACTION_HOURS = 48;

export interface ParentInfo {
  id: string;
  publishedAt: string;
  author: string;
  /** Texto del post padre, recortado a PARENT_TEXT_MAX caracteres (plegable en el front). */
  text: string;
}

export interface ParentFields {
  parent: ParentInfo | null;
  /** Comentario cuyo post padre no se conoce (LinkedIn o no encontrado). */
  parentUnknown: boolean;
  /** Edad del post padre cuando se escribió el comentario, en días (1 decimal); null si no hay padre. */
  parentAgeDays: number | null;
  /** Padre de más de 2 días al comentar. */
  lateReaction: boolean;
}

/** Fila mínima del feed que necesita la resolución. */
export interface ParentSourceRow extends MentionKindInput {
  id: string;
  kind: MentionKind;
  publishedAt: Date;
  parentMentionId: string | null;
}

interface RawParent {
  id: string;
  published_at: Date | string;
  author: string | null;
  author_fullname: string | null;
  title: string | null;
  snippet: string | null;
  bw_guid: string | null;
}

/** Recorta con puntos suspensivos por puntos de código (no deja sustitutos sueltos). */
export function trimText(s: string | null | undefined, max = PARENT_TEXT_MAX): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);
  return chars.length <= max ? t : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

const NO_PARENT: ParentFields = { parent: null, parentUnknown: false, parentAgeDays: null, lateReaction: false };

/** Aritmética de edad del padre (pura, probable sin DB). */
export function parentAge(commentAt: Date, parentAt: Date): { parentAgeDays: number; lateReaction: boolean } {
  const hours = (commentAt.getTime() - parentAt.getTime()) / 3_600_000;
  // Un padre posterior al comentario (desfase de relojes) no tiene edad negativa.
  const clamped = Math.max(0, hours);
  return { parentAgeDays: Number((clamped / 24).toFixed(1)), lateReaction: clamped > LATE_REACTION_HOURS };
}

function toParentInfo(p: RawParent): ParentInfo {
  return {
    id: p.id,
    publishedAt: new Date(p.published_at).toISOString(),
    author: (p.author_fullname && p.author_fullname.trim()) || (p.author && p.author.trim()) || '',
    text: trimText((p.snippet && p.snippet.trim()) || p.title),
  };
}

function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];
}

/**
 * Campos de padre de cada comentario de `rows`, por id de mención. Las filas
 * que no son comentarios no aparecen en el mapa (el llamante usa NO_PARENT).
 */
export async function loadParents(
  db: Db,
  agencyId: string,
  rows: ParentSourceRow[],
): Promise<Map<string, ParentFields>> {
  const out = new Map<string, ParentFields>();
  const comments = rows.filter((r) => r.kind === 'comment');
  if (comments.length === 0) return out;

  // 1) Padres ya enlazados (columna poblada): una lectura por id.
  const linkedIds = [...new Set(comments.map((c) => c.parentMentionId).filter((x): x is string => !!x))];
  const byId = new Map<string, RawParent>();
  if (linkedIds.length) {
    const res = await db.execute(sql`
      SELECT p.id::text AS id, p.published_at, p.author, p.author_fullname, p.title, p.snippet, p.bw_guid
        FROM mentions p
       WHERE p.agency_id = ${agencyId}::uuid
         AND p.id IN (${sql.join(linkedIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    for (const p of rowsOf<RawParent>(res)) byId.set(p.id, p);
  }

  // 2) Sin enlace: se resuelve por GUID (misma regla del lambda).
  const pending = comments.filter((c) => !c.parentMentionId || !byId.has(c.parentMentionId));
  const refs = new Map<string, ReturnType<typeof parseParentRef>>();
  for (const c of pending) refs.set(c.id, parseParentRef(c));
  const fbIds = new Set<string>(), igCodes = new Set<string>();
  for (const r of refs.values()) {
    if (r?.platform === 'facebook') fbIds.add(r.postId);
    else if (r?.platform === 'instagram') igCodes.add(r.shortcode);
  }
  const candidates: RawParent[] = [];
  if (fbIds.size + igCodes.size > 0) {
    const times = pending.map((c) => c.publishedAt.getTime());
    const minAt = new Date(Math.min(...times)).toISOString();
    const maxAt = new Date(Math.max(...times)).toISOString();
    // postId son solo dígitos y shortcode [A-Za-z0-9_-] (validados en parseParentRef):
    // el único comodín posible es `_`, que va escapado como literal en los patrones FB.
    const preds = [
      ...[...fbIds].map((id) => sql`p.bw_guid LIKE ${`%\\_${id}`}`),
      ...(igCodes.size ? [sql`p.bw_guid IN (${sql.join([...igCodes].map((c) => sql`${c}`), sql`, `)})`] : []),
    ];
    const res = await db.execute(sql`
      SELECT p.id::text AS id, p.published_at, p.author, p.author_fullname, p.title, p.snippet, p.bw_guid
        FROM mentions p
       WHERE p.agency_id = ${agencyId}::uuid
         AND p.published_at BETWEEN ${minAt}::timestamptz - (${PARENT_LOOKBACK_DAYS}::int * INTERVAL '1 day')
                                AND ${maxAt}::timestamptz + INTERVAL '1 day'
         AND (p.url IS NULL OR p.url NOT LIKE '%#channels\\_comment%')
         AND (${sql.join(preds, sql` OR `)})`);
    candidates.push(...rowsOf<RawParent>(res));
  }

  for (const c of comments) {
    let hit: RawParent | undefined = c.parentMentionId ? byId.get(c.parentMentionId) : undefined;
    if (!hit) {
      const ref = refs.get(c.id) ?? null;
      if (ref && ref.platform !== 'linkedin') {
        const at = c.publishedAt.getTime();
        const lo = at - PARENT_LOOKBACK_DAYS * 86_400_000, hi = at + 86_400_000;
        // El más reciente dentro de la ventana (igual que `ORDER BY published_at DESC LIMIT 1`).
        hit = candidates
          .filter((p) => {
            const t = new Date(p.published_at).getTime();
            if (t < lo || t > hi || !p.bw_guid) return false;
            return ref.platform === 'facebook' ? p.bw_guid.endsWith(`_${ref.postId}`) : p.bw_guid === ref.shortcode;
          })
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())[0];
      }
    }
    if (hit) {
      out.set(c.id, { parent: toParentInfo(hit), parentUnknown: false, ...parentAge(c.publishedAt, new Date(hit.published_at)) });
    } else {
      out.set(c.id, { ...NO_PARENT, parentUnknown: true });
    }
  }
  return out;
}

export { NO_PARENT };
