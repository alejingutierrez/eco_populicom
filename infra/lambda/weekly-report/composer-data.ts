/**
 * Capa de datos del motor de redacción para el correo diario (WP-6; spec
 * interpretación v1, secciones 7 y 10.2).
 *
 * El motor (`@eco/shared` composer) no conoce pg: recibe muestras crudas y una
 * `ComposerDataAccess` inyectada que, por id de mención, devuelve su tipo, su
 * GUID/URL y, si es un comentario, la publicación original (texto, autor y
 * fecha). Aquí vive esa implementación contra pg.
 *
 * Padre del comentario: hoy `mentions.parent_mention_id` está vacío (el
 * processor solo lo llena con MENTION_ENRICHMENT_ENABLED, apagado), así que
 * el adaptador lo resuelve por consulta con la MISMA lógica del processor
 * (`../lib/parent-resolver`): FB por sufijo del GUID, IG por shortcode,
 * LinkedIn desconocido. Las consultas van acotadas por agencia y fecha, y se
 * hace UNA por publicación original (no por comentario): un hilo de 400
 * comentarios cuesta una consulta.
 *
 * Muestras del día y de la semana en DÍA CALENDARIO PR (rango de instantes con
 * `prWindowRangeSql`, usa el índice por fecha). El correo legacy cortaba las
 * muestras en día UTC (9 a 12 % eran de la noche anterior); el legacy no se
 * toca, este camino solo corre con `composer_mode` distinto de `legacy`.
 */
import {
  prWindowRangeSql,
  type ComposerDataAccess,
  type RawComposerSample,
  type RawSampleGroups,
  type SampleContext,
  type UniverseOptions,
} from '@eco/shared';
import { deriveMentionKind, isOwnedChannelComment, type MentionKindAgency } from '../lib/mention-kind';
import { parseParentRef, resolveParent, type ParentStatus, type Queryable } from '../lib/parent-resolver';

/**
 * Universo de las cifras del correo en modo motor: el MISMO que ya cuentan los
 * indicadores del correo y el dashboard (histórico: `NULL o <> 'baja'`), para
 * que el texto y los números de al lado no digan cosas distintas. El universo
 * estricto (P1, NULL fuera) se enciende junto con los conteos visibles en la
 * activación (WP-15, tras el backfill), no aquí.
 */
export const MAIL_UNIVERSE: UniverseOptions = { strictUniverse: false };

/** Muestras por grupo que se cargan (antes del tope por hilo). */
export const TODAY_SAMPLE_LIMIT = 40;
export const WEEK_SAMPLE_LIMIT = 20;
/** Muestras por grupo que llegan al motor después del tope por hilo. */
export const MAX_SAMPLES_PER_GROUP = 20;

const SENTIMENT_DB: Record<'negative' | 'neutral' | 'positive', string> = {
  negative: 'negativo',
  neutral: 'neutral',
  positive: 'positivo',
};

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normSentiment(s: unknown): 'negative' | 'neutral' | 'positive' | null {
  const v = String(s ?? '').toLowerCase();
  if (v.startsWith('neg')) return 'negative';
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neu')) return 'neutral';
  return null;
}

/** Fila de muestra → muestra cruda del motor. `text` conserva la forma legacy («título — snippet»). */
export function rowToRawSample(row: any): RawComposerSample {
  const title: string | null = row.title ?? null;
  const snippet: string | null = row.snippet ?? null;
  return {
    id: String(row.id),
    createdAt: iso(row.published_at) ?? String(row.published_at),
    text: `${title ? title + ' — ' : ''}${snippet ?? ''}`.trim(),
    sentiment: normSentiment(row.sentiment),
    topic: row.topic ?? null,
    author: row.author ?? null,
    source: row.content_source_name ?? null,
    url: row.url ?? null,
    pageType: row.page_type ?? null,
    pubType: row.pub_type ?? null,
    bwGuid: row.bw_guid ?? null,
    title,
    snippet,
    engagement: row.engagement_score != null ? Number(row.engagement_score) : null,
    mentionKind: row.mention_kind ?? null,
    parentMentionId: row.parent_mention_id ?? null,
    parentPublishedAt: iso(row.parent_published_at),
  };
}

const SAMPLE_COLUMNS = `m.id, m.published_at, m.title, m.snippet, m.author, m.content_source_name, m.url,
              m.page_type, m.pub_type, m.bw_guid, m.engagement_score, m.mention_kind,
              m.parent_mention_id, m.parent_published_at,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              t.name AS topic`;

const TOPIC_JOIN = `LEFT JOIN LATERAL (
           SELECT topic_id FROM mention_topics WHERE mention_id = m.id ORDER BY confidence DESC NULLS LAST LIMIT 1
         ) mt ON true
         LEFT JOIN topics t ON t.id = mt.topic_id`;

/**
 * Muestras crudas del motor: las del día resumido (`dayYmd`) y las de la
 * semana por sentimiento, en días PR, con pertinencia alta o media (mismo
 * criterio de muestras que el legacy). Orden: engagement y luego recencia.
 */
export async function loadComposerSamples(
  client: Queryable,
  agencyId: string,
  window: { startYmd: string; endYmd: string; dayYmd: string },
  /** `includeToday: false` (semanal, WP-7): sin las muestras del día, que el perfil `weekly` no usa. */
  opts: { includeToday?: boolean } = {},
): Promise<RawSampleGroups> {
  const out: RawSampleGroups = { today: [] };
  if (opts.includeToday !== false) {
    const today = await client.query(
      `SELECT ${SAMPLE_COLUMNS}
         FROM mentions m
         ${TOPIC_JOIN}
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND m.nlp_pertinence IN ('alta','media')
          ${prWindowRangeSql('m.', '$2', '$3')}
        ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
        LIMIT ${TODAY_SAMPLE_LIMIT}`,
      [agencyId, window.dayYmd, window.dayYmd],
    );
    out.today = today.rows.map(rowToRawSample);
  }
  for (const key of ['negative', 'neutral', 'positive'] as const) {
    const r = await client.query(
      `SELECT ${SAMPLE_COLUMNS}
         FROM mentions m
         ${TOPIC_JOIN}
        WHERE m.agency_id = $1
          AND m.is_duplicate = false
          AND m.nlp_pertinence IN ('alta','media')
          AND COALESCE(m.nlp_sentiment, m.bw_sentiment) = $4
          ${prWindowRangeSql('m.', '$2', '$3')}
        ORDER BY COALESCE(m.engagement_score, 0) DESC, m.published_at DESC
        LIMIT ${WEEK_SAMPLE_LIMIT}`,
      [agencyId, window.startYmd, window.endYmd, SENTIMENT_DB[key]],
    );
    out[key] = r.rows.map(rowToRawSample);
  }
  return out;
}

export interface ParentResolutionStats {
  comments: number;
  fromColumn: number;
  resolved: number;
  notFound: number;
  parentUnknown: number;
  queries: number;
}

export interface PgComposerDataAccess extends ComposerDataAccess {
  /** Cómo se resolvieron los padres en la última carga (va al archivo de la composición). */
  stats(): ParentResolutionStats;
}

/**
 * `ComposerDataAccess` contra pg. `loadSampleContext(ids)`:
 *   1. lee las menciones (agencia + ids);
 *   2. tipo: `mention_kind` si ya está poblado; si no, `deriveMentionKind`
 *      del processor (mismas reglas, con los autores propios de la agencia);
 *   3. padre: columnas `parent_*` si están; si no, `resolveParent` una vez por
 *      publicación original (la fecha de búsqueda es la del comentario más
 *      reciente del hilo, así la ventana hacia atrás cubre a todos);
 *   4. lee los padres (texto, autor, fecha) en una sola consulta.
 * Nunca inventa un padre: si no se encuentra, el motor ve «fecha desconocida».
 */
export function createPgComposerDataAccess(client: Queryable, agency: { id: string } & MentionKindAgency): PgComposerDataAccess {
  let last: ParentResolutionStats = { comments: 0, fromColumn: 0, resolved: 0, notFound: 0, parentUnknown: 0, queries: 0 };
  return {
    stats: () => ({ ...last }),
    async loadSampleContext(ids: string[]): Promise<Record<string, SampleContext>> {
      const st: ParentResolutionStats = { comments: 0, fromColumn: 0, resolved: 0, notFound: 0, parentUnknown: 0, queries: 0 };
      last = st;
      const out: Record<string, SampleContext> = {};
      if (!ids.length) return out;
      const r = await client.query(
        `SELECT id, bw_guid, url, pub_type, page_type, author, title, snippet, published_at,
                mention_kind, parent_mention_id, parent_published_at
           FROM mentions
          WHERE agency_id = $1 AND id = ANY($2::uuid[])`,
        [agency.id, ids],
      );
      st.queries++;
      const rows = r.rows as any[];

      // Padres por resolver, agrupados por publicación original.
      type Pending = { ref: string; mention: any; latest: string };
      const pending = new Map<string, Pending>();
      const parentOf = new Map<string, { id: string | null; publishedAt: string | null; status: ParentStatus | 'column' }>();
      for (const row of rows) {
        const input = { url: row.url, guid: row.bw_guid, pubType: row.pub_type, pageType: row.page_type, author: row.author };
        const kind = row.mention_kind || deriveMentionKind(input, agency);
        if (kind !== 'comment' && !isOwnedChannelComment(input)) continue;
        st.comments++;
        if (row.parent_mention_id) {
          st.fromColumn++;
          parentOf.set(row.id, { id: row.parent_mention_id, publishedAt: iso(row.parent_published_at), status: 'column' });
          continue;
        }
        const ref = parseParentRef(input);
        if (!ref) { st.notFound++; parentOf.set(row.id, { id: null, publishedAt: null, status: 'not_found' }); continue; }
        if (ref.platform === 'linkedin') { st.parentUnknown++; parentOf.set(row.id, { id: null, publishedAt: null, status: 'parent_unknown' }); continue; }
        const key = ref.platform === 'facebook' ? `fb:${ref.postId}` : `ig:${ref.shortcode}`;
        const at = iso(row.published_at) ?? new Date().toISOString();
        const cur = pending.get(key);
        if (!cur) pending.set(key, { ref: key, mention: { ...input, date: at }, latest: at });
        else if (at > cur.latest) { cur.latest = at; cur.mention = { ...input, date: at }; }
        parentOf.set(row.id, { id: null, publishedAt: null, status: 'not_found' });
      }

      // Una consulta por publicación original (resolveParent nunca lanza).
      const byRef = new Map<string, { id: string | null; publishedAt: string | null; status: ParentStatus }>();
      for (const p of pending.values()) {
        const res = await resolveParent(client, agency.id, p.mention);
        st.queries++;
        byRef.set(p.ref, { id: res.parentMentionId, publishedAt: iso(res.parentPublishedAt), status: res.status });
      }
      for (const row of rows) {
        const cur = parentOf.get(row.id);
        if (!cur || cur.status === 'column' || cur.status === 'parent_unknown') continue;
        const ref = parseParentRef({ url: row.url, guid: row.bw_guid, pubType: row.pub_type, pageType: row.page_type, author: row.author });
        if (!ref || ref.platform === 'linkedin') continue;
        const key = ref.platform === 'facebook' ? `fb:${ref.postId}` : `ig:${ref.shortcode}`;
        const hit = byRef.get(key);
        if (hit?.id) { st.resolved++; parentOf.set(row.id, { id: hit.id, publishedAt: hit.publishedAt, status: 'resolved' }); }
        else st.notFound++;
      }

      // Texto, autor y fecha de los padres.
      const parentIds = Array.from(new Set(Array.from(parentOf.values()).map((p) => p.id).filter((x): x is string => !!x)));
      const parents = new Map<string, any>();
      if (parentIds.length) {
        const pr = await client.query(
          `SELECT id, published_at, author, title, snippet
             FROM mentions
            WHERE agency_id = $1 AND id = ANY($2::uuid[])`,
          [agency.id, parentIds],
        );
        st.queries++;
        for (const p of pr.rows as any[]) parents.set(String(p.id), p);
      }

      for (const row of rows) {
        const input = { url: row.url, guid: row.bw_guid, pubType: row.pub_type, pageType: row.page_type, author: row.author };
        const ctx: SampleContext = {
          bwGuid: row.bw_guid ?? null,
          url: row.url ?? null,
          pubType: row.pub_type ?? null,
          pageType: row.page_type ?? null,
          author: row.author ?? null,
          title: row.title ?? null,
          snippet: row.snippet ?? null,
          mentionKind: row.mention_kind || deriveMentionKind(input, agency),
        };
        const p = parentOf.get(row.id);
        if (p?.id) {
          const prow = parents.get(p.id);
          ctx.parentMentionId = p.id;
          ctx.parentPublishedAt = p.publishedAt ?? iso(prow?.published_at);
          if (prow) {
            ctx.parentAuthor = prow.author ?? null;
            const txt = [prow.title, prow.snippet].map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
            // El post de FB/IG suele venir en `snippet` y a veces repetido en `title`.
            ctx.parentText = txt.length ? (txt.length === 2 && txt[1].startsWith(txt[0]) ? txt[1] : txt.join(' — ')) : null;
          }
        }
        out[String(row.id)] = ctx;
      }
      return out;
    },
  };
}

/**
 * Nombres propios con dígitos (p. ej. «En Contacto 787 Tv») que el lint del
 * motor no debe tratar como cifras sin fuente. Salen de las muestras.
 */
export function namesWithDigits(raw: RawSampleGroups): string[] {
  const names = new Set<string>();
  for (const list of [raw.today, raw.negative, raw.neutral, raw.positive]) {
    for (const s of list ?? []) {
      for (const n of [s.author, s.source]) if (n && /\d/.test(n)) names.add(n);
    }
  }
  return Array.from(names);
}
