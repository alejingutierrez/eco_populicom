/**
 * Chequeo VIVO de identidades de consistencia contra la base de producción.
 * Complementa el test de contrato estático (apps/web/src/contracts/): aquí
 * validamos que, con datos reales, las distintas formas de contar que usan
 * los endpoints coinciden entre sí bajo el contrato canónico (ventana
 * cerrada AST + universo pertinente + atribución primaria).
 *
 * Corre vía el lambda eco-migration (custom-query, solo SELECT) — la DB está
 * en VPC privada, así que este script funciona desde cualquier máquina con
 * credenciales AWS (source .env del monorepo).
 *
 * Uso:
 *   set -a && source .env && set +a
 *   node_modules/.bin/tsx scripts/contract-check-live.ts [dias]
 *
 * Identidades por agencia activa (ventana de N días cerrados, default 7):
 *   I1  Σ serie diaria            == total del período
 *   I2  Σ tabla de tópicos (prim) == total del período (incl. sin clasificar)
 *   I3  primario ≤ multi para el top tópico
 *   I4  Σ fuentes (page_type)     == total del período
 *   I5  Σ heatmap (dow × hora)    == total del período
 *   I6  menciones geo (dedup)     <= total del período
 *   I7  day-slice del primer día  == punto de la serie diaria
 *
 * Exit code 0 = todas las identidades verdes; 1 = alguna falló.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const DAYS = Math.max(1, Number(process.argv[2] ?? 7));
const lambda = new LambdaClient({});

const UNIVERSE = `m.is_duplicate = false
    AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')`;
const IN_WINDOW = `(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date
        BETWEEN w.start_d AND w.end_d`;

function checksQuery(agencyId: string): string {
  // El guard del lambda exige que la query empiece con SELECT — los CTEs van
  // envueltos en un subquery.
  return `SELECT * FROM (
WITH w AS (
  SELECT ((NOW() AT TIME ZONE 'America/Puerto_Rico')::date - 1) AS end_d,
         ((NOW() AT TIME ZONE 'America/Puerto_Rico')::date - ${DAYS}) AS start_d
),
base AS (
  SELECT m.id, m.published_at, m.page_type,
         (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date AS day_ast,
         (SELECT topic_id FROM mention_topics
            WHERE mention_id = m.id
            ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS primary_topic
    FROM mentions m, w
   WHERE m.agency_id = '${agencyId}'
     AND ${UNIVERSE}
     AND ${IN_WINDOW}
),
tot AS (SELECT COUNT(*)::int AS n FROM base),
daily AS (SELECT COALESCE(SUM(c),0)::int AS n FROM (SELECT COUNT(*) AS c FROM base GROUP BY day_ast) d),
topics_sum AS (SELECT COALESCE(SUM(c),0)::int AS n FROM (SELECT COUNT(*) AS c FROM base GROUP BY primary_topic) t),
sources_sum AS (SELECT COALESCE(SUM(c),0)::int AS n FROM (SELECT COUNT(*) AS c FROM base GROUP BY COALESCE(page_type,'')) s),
heatmap_sum AS (SELECT COALESCE(SUM(c),0)::int AS n FROM (
  SELECT COUNT(*) AS c FROM base
  GROUP BY EXTRACT(DOW FROM (published_at AT TIME ZONE 'America/Puerto_Rico')),
           EXTRACT(HOUR FROM (published_at AT TIME ZONE 'America/Puerto_Rico'))) h),
top_topic AS (
  SELECT primary_topic AS topic_id, COUNT(*)::int AS prim
    FROM base WHERE primary_topic IS NOT NULL
   GROUP BY primary_topic ORDER BY prim DESC LIMIT 1
),
top_multi AS (
  SELECT COUNT(DISTINCT mt.mention_id)::int AS multi
    FROM mention_topics mt
    JOIN mentions m ON m.id = mt.mention_id, w, top_topic tt
   WHERE mt.topic_id = tt.topic_id
     AND m.agency_id = '${agencyId}'
     AND ${UNIVERSE}
     AND ${IN_WINDOW}
),
geo AS (
  SELECT COUNT(DISTINCT mm.mention_id)::int AS n
    FROM mention_municipalities mm
    JOIN mentions m ON m.id = mm.mention_id, w
   WHERE m.agency_id = '${agencyId}'
     AND ${UNIVERSE}
     AND ${IN_WINDOW}
),
first_day AS (
  SELECT (SELECT COUNT(*)::int FROM base WHERE day_ast = w.start_d) AS day_slice,
         (SELECT COALESCE((SELECT COUNT(*)::int FROM base b WHERE b.day_ast = w.start_d), 0)) AS series_point
    FROM w
)
SELECT
  (SELECT n FROM tot) AS total,
  (SELECT n FROM daily) AS i1_daily,
  (SELECT n FROM topics_sum) AS i2_topics,
  (SELECT COALESCE((SELECT prim FROM top_topic), 0)) AS i3_prim,
  (SELECT COALESCE((SELECT multi FROM top_multi), 0)) AS i3_multi,
  (SELECT n FROM sources_sum) AS i4_sources,
  (SELECT n FROM heatmap_sum) AS i5_heatmap,
  (SELECT n FROM geo) AS i6_geo,
  (SELECT day_slice FROM first_day) AS i7_day_slice,
  (SELECT series_point FROM first_day) AS i7_series_point
) checks`;
}

async function customQuery(query: string): Promise<Array<Record<string, string>>> {
  const res = await lambda.send(new InvokeCommand({
    FunctionName: 'eco-migration',
    Payload: Buffer.from(JSON.stringify({ action: 'custom-query', query })),
  }));
  const payload = JSON.parse(Buffer.from(res.Payload!).toString('utf8'));
  const body = typeof payload.body === 'string' ? JSON.parse(payload.body) : payload.body;
  if (!body || body.error) throw new Error(`custom-query: ${body?.error ?? 'sin body'}`);
  return body.rows ?? [];
}

async function main(): Promise<void> {
  const agencies = await customQuery(
    `SELECT id::text, slug FROM agencies WHERE is_active = true ORDER BY slug`,
  );
  let failures = 0;

  for (const a of agencies) {
    const [r] = await customQuery(checksQuery(a.id));
    const n = (k: string) => Number(r[k]);
    const checks: Array<[string, boolean, string]> = [
      ['I1 serie diaria', n('i1_daily') === n('total'), `${r.i1_daily} vs ${r.total}`],
      ['I2 Σ tópicos', n('i2_topics') === n('total'), `${r.i2_topics} vs ${r.total}`],
      ['I3 prim ≤ multi', n('i3_prim') <= n('i3_multi'), `${r.i3_prim} ≤ ${r.i3_multi}`],
      ['I4 Σ fuentes', n('i4_sources') === n('total'), `${r.i4_sources} vs ${r.total}`],
      ['I5 Σ heatmap', n('i5_heatmap') === n('total'), `${r.i5_heatmap} vs ${r.total}`],
      ['I6 geo ≤ total', n('i6_geo') <= n('total'), `${r.i6_geo} ≤ ${r.total}`],
      ['I7 day-slice = punto serie', n('i7_day_slice') === n('i7_series_point'), `${r.i7_day_slice} vs ${r.i7_series_point}`],
    ];
    console.log(`\n${a.slug} · ventana ${DAYS}D cerrada · total pertinente = ${r.total}`);
    for (const [name, ok, detail] of checks) {
      if (!ok) failures += 1;
      console.log(`  ${ok ? '✓' : '✗ FALLA'} ${name} (${detail})`);
    }
  }

  console.log(failures === 0 ? '\nTodas las identidades verdes.' : `\n${failures} identidades FALLARON.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('contract-check-live falló:', err);
  process.exit(1);
});
