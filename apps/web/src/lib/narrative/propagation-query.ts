/**
 * SQL de la propagación de una narrativa (/api/narrative/[id]/propagation): las
 * menciones de la narrativa con las mismas reglas de dato que overview
 * (principal, sin duplicados, pertinente). Las filas las procesa processRows de
 * lib/narrative/overview.ts.
 */
export const PROPAGATION_ROWS_SQL = `SELECT nm.narrative_id AS nid, m.id, m.published_at, m.url, m.title, m.page_type,
              m.author, m.author_fullname, m.domain,
              COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
              (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0)) AS inter
         FROM narrative_mentions nm
         JOIN mentions m ON m.id = nm.mention_id
        WHERE nm.narrative_id = $1 AND nm.is_primary = true AND m.agency_id = $2
          AND m.is_duplicate = false
          AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
          AND m.published_at < $3::timestamptz`;
