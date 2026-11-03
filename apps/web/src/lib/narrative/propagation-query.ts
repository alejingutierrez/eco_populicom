/**
 * SQL de la propagación de una narrativa (/api/narrative/[id]/propagation): las
 * menciones de la narrativa con las mismas reglas de dato que overview
 * (principal, sin duplicados, pertinente). Las filas las procesa processRows de
 * lib/narrative/overview.ts.
 */
import { universeFilterSql, type UniverseOptions } from '@eco/shared';

// WP-9a: `opts` vacío = universo histórico; `strictUniverse` = alta/media.
export const propagationRowsSql = (opts?: UniverseOptions) => `SELECT nm.narrative_id AS nid, m.id, m.published_at, m.url, m.title, m.page_type,
              m.author, m.author_fullname, m.domain,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0)) AS inter
         FROM narrative_mentions nm
         JOIN mentions m ON m.id = nm.mention_id
        WHERE nm.narrative_id = $1 AND nm.is_primary = true AND m.agency_id = $2
          ${universeFilterSql(opts, 'm.')}
          AND m.published_at < $3::timestamptz`;
export const PROPAGATION_ROWS_SQL = propagationRowsSql();
