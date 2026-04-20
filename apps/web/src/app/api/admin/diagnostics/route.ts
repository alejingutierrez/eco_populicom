import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { sql } from 'drizzle-orm';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/diagnostics
 * Header: x-eco-cron-secret: <ECO_CRON_SECRET>
 *
 * Returns a single JSON with the key data-quality signals for the ingestion
 * and NLP pipelines. Use this to spot gaps between Brandwatch and the ECO
 * dashboard without having to open a DB client.
 */
function authorized(request: NextRequest): boolean {
  const required = process.env.ECO_CRON_SECRET;
  if (!required) return false;
  return request.headers.get('x-eco-cron-secret') === required;
}

// Drizzle's db.execute() returns a pg QueryResult; unwrap .rows.
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const obj = res as { rows?: T[] };
  return obj?.rows ?? [];
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const now = Date.now();

  try {
    // Global counts
    const totals = rowsOf<{ k: string; v: number | string }>(await db.execute(sql`
      SELECT 'mentions_total' AS k, COUNT(*)::bigint AS v FROM mentions
      UNION ALL SELECT 'mentions_processed', COUNT(*) FROM mentions WHERE processed_at IS NOT NULL
      UNION ALL SELECT 'mentions_nlp_sentiment_populated', COUNT(*) FROM mentions WHERE nlp_sentiment IS NOT NULL
      UNION ALL SELECT 'mentions_nlp_emotions_populated', COUNT(*) FROM mentions WHERE nlp_emotions IS NOT NULL AND jsonb_array_length(nlp_emotions) > 0
      UNION ALL SELECT 'mentions_nlp_pertinence_populated', COUNT(*) FROM mentions WHERE nlp_pertinence IS NOT NULL
      UNION ALL SELECT 'mentions_nlp_summary_populated', COUNT(*) FROM mentions WHERE nlp_summary IS NOT NULL
      UNION ALL SELECT 'mentions_bw_sentiment_populated', COUNT(*) FROM mentions WHERE bw_sentiment IS NOT NULL
      UNION ALL SELECT 'mentions_duplicates', COUNT(*) FROM mentions WHERE is_duplicate = true
      UNION ALL SELECT 'mentions_with_topic', (SELECT COUNT(DISTINCT mention_id) FROM mention_topics)
      UNION ALL SELECT 'mentions_with_municipality', (SELECT COUNT(DISTINCT mention_id) FROM mention_municipalities)
      UNION ALL SELECT 'mentions_with_media', COUNT(*) FROM mentions WHERE has_image = true OR has_video = true
    `));

    const totalMap: Record<string, number> = {};
    for (const r of totals) totalMap[r.k] = Number(r.v);
    const mentionsTotal = totalMap.mentions_total || 0;
    const pct = (n: number) => mentionsTotal > 0 ? Number(((n / mentionsTotal) * 100).toFixed(1)) : 0;

    // Sentiment distribution (NLP)
    const nlpDist = rowsOf<{ s: string | null; c: number | string }>(await db.execute(sql`
      SELECT COALESCE(nlp_sentiment, 'NULL') AS s, COUNT(*)::bigint AS c FROM mentions GROUP BY nlp_sentiment ORDER BY c DESC
    `));

    const bwDist = rowsOf<{ s: string | null; c: number | string }>(await db.execute(sql`
      SELECT COALESCE(bw_sentiment, 'NULL') AS s, COUNT(*)::bigint AS c FROM mentions GROUP BY bw_sentiment ORDER BY c DESC
    `));

    // Agreement between Brandwatch and our Claude NLP
    //   bw 'positive' ~ nlp 'positivo', bw 'negative' ~ nlp 'negativo', bw 'neutral' ~ nlp 'neutral'
    const agreement = rowsOf<{ match: string; c: number | string }>(await db.execute(sql`
      SELECT
        CASE
          WHEN bw_sentiment IS NULL OR nlp_sentiment IS NULL THEN 'missing-one-side'
          WHEN (bw_sentiment = 'positive' AND nlp_sentiment = 'positivo')
            OR (bw_sentiment = 'negative' AND nlp_sentiment = 'negativo')
            OR (bw_sentiment = 'neutral'  AND nlp_sentiment = 'neutral')
            THEN 'agree'
          ELSE 'disagree'
        END AS match,
        COUNT(*)::bigint AS c
      FROM mentions
      GROUP BY 1
    `));

    // BW vs NLP confusion matrix (only rows where both present)
    const confusion = rowsOf<{ bw: string; nlp: string; c: number | string }>(await db.execute(sql`
      SELECT bw_sentiment AS bw, nlp_sentiment AS nlp, COUNT(*)::bigint AS c
      FROM mentions
      WHERE bw_sentiment IS NOT NULL AND nlp_sentiment IS NOT NULL
      GROUP BY 1, 2
      ORDER BY c DESC
    `));

    // Pertinence distribution (NLP-only)
    const pertinence = rowsOf<{ p: string | null; c: number | string }>(await db.execute(sql`
      SELECT COALESCE(nlp_pertinence, 'NULL') AS p, COUNT(*)::bigint AS c FROM mentions GROUP BY nlp_pertinence ORDER BY c DESC
    `));

    // Per-agency stats. Join-based aggregates used to cartesian-multiply the
    // mentions count by the number of mention_topics/mention_municipalities
    // rows. We now aggregate each join separately and combine with scalar
    // subqueries to keep the counts accurate.
    const perAgency = rowsOf<{
      slug: string; name: string;
      total: number | string; processed: number | string; with_topic: number | string;
      with_muni: number | string; last_ingest: string | null; last_published: string | null;
      nlp_covered: number | string; agreement_rate: number | string | null;
    }>(await db.execute(sql`
      SELECT
        a.slug,
        a.name,
        (SELECT COUNT(*) FROM mentions m WHERE m.agency_id = a.id) AS total,
        (SELECT COUNT(*) FROM mentions m WHERE m.agency_id = a.id AND m.processed_at IS NOT NULL) AS processed,
        (SELECT COUNT(*) FROM mentions m WHERE m.agency_id = a.id AND m.nlp_sentiment IS NOT NULL) AS nlp_covered,
        (SELECT COUNT(DISTINCT mt.mention_id)
           FROM mention_topics mt
           JOIN mentions m ON m.id = mt.mention_id
           WHERE m.agency_id = a.id) AS with_topic,
        (SELECT COUNT(DISTINCT mm.mention_id)
           FROM mention_municipalities mm
           JOIN mentions m ON m.id = mm.mention_id
           WHERE m.agency_id = a.id) AS with_muni,
        (SELECT MAX(ingested_at) FROM mentions WHERE agency_id = a.id) AS last_ingest,
        (SELECT MAX(published_at) FROM mentions WHERE agency_id = a.id) AS last_published,
        (
          SELECT AVG(
            CASE
              WHEN bw_sentiment IS NULL OR nlp_sentiment IS NULL THEN NULL
              WHEN (bw_sentiment='positive' AND nlp_sentiment='positivo')
                OR (bw_sentiment='negative' AND nlp_sentiment='negativo')
                OR (bw_sentiment='neutral'  AND nlp_sentiment='neutral')
                THEN 1.0 ELSE 0.0
            END
          )::numeric(10,3)
          FROM mentions WHERE agency_id = a.id
        ) AS agreement_rate
      FROM agencies a
      WHERE a.is_active = true
      ORDER BY total DESC NULLS LAST
    `));

    // daily_metric_snapshots freshness per agency
    const snapshotsFresh = rowsOf<{ slug: string; last_date: string | null; nss: string | null; total: string | null }>(await db.execute(sql`
      WITH latest AS (
        SELECT agency_id, MAX(date) AS d FROM daily_metric_snapshots GROUP BY 1
      )
      SELECT a.slug,
        latest.d::text AS last_date,
        dms.nss::text AS nss,
        dms.total_mentions::text AS total
      FROM agencies a
      LEFT JOIN latest ON latest.agency_id = a.id
      LEFT JOIN daily_metric_snapshots dms ON dms.agency_id = a.id AND dms.date = latest.d
      WHERE a.is_active = true
      ORDER BY a.slug
    `));

    // Source (page_type) coverage
    const sources = rowsOf<{ page_type: string; c: number | string }>(await db.execute(sql`
      SELECT COALESCE(page_type, 'NULL') AS page_type, COUNT(*)::bigint AS c
      FROM mentions GROUP BY page_type ORDER BY c DESC LIMIT 20
    `));

    // Ingest lag — freshest vs stalest publish
    const lag = rowsOf<{ k: string; v: string | null }>(await db.execute(sql`
      SELECT 'oldest_unprocessed' AS k, MIN(ingested_at)::text AS v FROM mentions WHERE processed_at IS NULL
      UNION ALL SELECT 'newest_ingest', MAX(ingested_at)::text FROM mentions
      UNION ALL SELECT 'oldest_ingest', MIN(ingested_at)::text FROM mentions
      UNION ALL SELECT 'newest_published', MAX(published_at)::text FROM mentions
      UNION ALL SELECT 'oldest_published', MIN(published_at)::text FROM mentions
    `));

    // Ingestion cursors — schema is keyed by Brandwatch query_id only; we
    // correlate back to an agency via the jsonb brandwatch_query_ids array.
    const cursors = rowsOf<{
      query_id: string;
      last_mention_date: string | null;
      last_run_at: string | null;
      mentions_fetched: number | string;
      status: string;
      agency_slug: string | null;
    }>(await db.execute(sql`
      SELECT
        ic.query_id::text AS query_id,
        ic.last_mention_date::text AS last_mention_date,
        ic.last_run_at::text AS last_run_at,
        ic.mentions_fetched,
        ic.status,
        (SELECT a.slug FROM agencies a
          WHERE a.brandwatch_query_ids IS NOT NULL
            AND a.brandwatch_query_ids::jsonb @> to_jsonb(ic.query_id)
          LIMIT 1) AS agency_slug
      FROM ingestion_cursors ic
      ORDER BY ic.query_id
    `));

    // How many unique bw_resource_ids per day — trend line, makes outages visible
    const dailyIngest = rowsOf<{ d: string; c: number | string }>(await db.execute(sql`
      SELECT to_char(date_trunc('day', ingested_at AT TIME ZONE 'America/Puerto_Rico'), 'YYYY-MM-DD') AS d,
        COUNT(*)::bigint AS c
      FROM mentions
      WHERE ingested_at > now() - interval '14 days'
      GROUP BY 1 ORDER BY 1
    `));

    const summary = {
      mentionsTotal,
      processedPct: pct(totalMap.mentions_processed || 0),
      nlpSentimentCoveragePct: pct(totalMap.mentions_nlp_sentiment_populated || 0),
      nlpEmotionsCoveragePct: pct(totalMap.mentions_nlp_emotions_populated || 0),
      nlpPertinenceCoveragePct: pct(totalMap.mentions_nlp_pertinence_populated || 0),
      nlpSummaryCoveragePct: pct(totalMap.mentions_nlp_summary_populated || 0),
      bwSentimentCoveragePct: pct(totalMap.mentions_bw_sentiment_populated || 0),
      withTopicPct: pct(totalMap.mentions_with_topic || 0),
      withMunicipalityPct: pct(totalMap.mentions_with_municipality || 0),
      duplicatePct: pct(totalMap.mentions_duplicates || 0),
      withMediaPct: pct(totalMap.mentions_with_media || 0),
    };

    log.info('diagnostics', 'report generated', { mentionsTotal, elapsedMs: Date.now() - now });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary,
      totals: totalMap,
      sentimentDistribution: { nlp: nlpDist, brandwatch: bwDist, agreement, confusion },
      pertinence,
      sources,
      perAgency,
      snapshotsFresh,
      lag,
      cursors,
      dailyIngest,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('diagnostics', (err as Error).message);
    return NextResponse.json({ error: 'diagnostics failed', message: (err as Error).message }, { status: 500 });
  }
}
