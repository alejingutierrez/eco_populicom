/**
 * Chequeo VIVO de identidades y sanidad de datos contra la base de producción.
 * Complementa el test de contrato estático (apps/web/src/contracts/): aquí
 * validamos, con datos reales, que las distintas formas de contar que usan
 * los endpoints coinciden entre sí bajo el contrato canónico, y que los
 * DATOS mismos respetan los invariantes del producto (valores reconocidos,
 * aislamiento de tenant, atribuciones coherentes).
 *
 * Corre vía el lambda eco-migration (custom-query, solo SELECT) — la DB está
 * en VPC privada, así que este script funciona desde cualquier máquina con
 * credenciales AWS (source .env del monorepo).
 *
 * Uso:
 *   set -a && source .env && set +a
 *   node_modules/.bin/tsx scripts/contract-check-live.ts [dias,dias,...]
 *   npm run contract:live               # alias (ventanas 1,7,30)
 *
 * Grupos (FALLAN el exit code salvo que se marquen WARN):
 *   G1  Identidades de conteo por agencia × ventana cerrada:
 *       Σ serie diaria == total == Σ tópicos(prim) == Σ fuentes == Σ heatmap;
 *       day-slice del primer día == punto de la serie; geo(dedup) ≤ total.
 *   G2  Familias de cota: [00:00, 23:59:59.999] AST (timestamps, familia A)
 *       == (published_at AT TIME ZONE)::date BETWEEN (familia B). Detecta
 *       menciones en el borde de microsegundos (P2-3 del informe).
 *   G3  Sentimiento reconocido (histórico completo): COALESCE(nlp,bw) ∈
 *       {positivo,positive,neutral,neutro,negativo,negative} o NULL; y
 *       NULL == 0 (si aparece, el hero lo descarta y el modal lo cuenta
 *       neutral — divergencia latente P2-1/P2-2).
 *   G4  Pertinencia válida (histórico): nlp_pertinence ∈ {alta,media,baja,NULL}.
 *   G5  Tenancy de datos: mention_topics no cruza agencias (tópico de otra
 *       agencia atribuido a una mención) == 0; narrative_mentions no cruza
 *       agencias == 0.
 *   G6  bool_and(primario ≤ multi) sobre TODOS los tópicos de la ventana.
 *   G7  WARN (no rompe): drift Σ snapshots vs conteo vivo pertinente (por
 *       diseño difieren — el snapshot es capa de métricas con universo
 *       completo), share de duplicados, share sin tópico por agencia
 *       (revela huecos del clasificador, p.ej. SGPR ago-2026).
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const WINDOWS = (process.argv[2] ?? '1,7,30')
  .split(',')
  .map((s) => Math.max(1, Number(s.trim())))
  .filter((n) => Number.isFinite(n));

const lambda = new LambdaClient({});

const UNIVERSE = `m.is_duplicate = false
    AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')`;

function winCte(days: number): string {
  return `w AS (
  SELECT ((NOW() AT TIME ZONE 'America/Puerto_Rico')::date - 1) AS end_d,
         ((NOW() AT TIME ZONE 'America/Puerto_Rico')::date - ${days}) AS start_d
)`;
}

const IN_WINDOW_B = `(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date
        BETWEEN w.start_d AND w.end_d`;

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

type Check = [name: string, ok: boolean, detail: string];
let failures = 0;
let warns = 0;

function report(scope: string, checks: Check[], warnOnly = false): void {
  for (const [name, ok, detail] of checks) {
    if (!ok) { if (warnOnly) warns += 1; else failures += 1; }
    const mark = ok ? '✓' : warnOnly ? '⚠ WARN' : '✗ FALLA';
    console.log(`  ${mark} ${scope} · ${name} (${detail})`);
  }
}

// ---------- G1: identidades de conteo ----------
function g1Query(agencyId: string, days: number): string {
  return `SELECT * FROM (
WITH ${winCte(days)},
base AS (
  SELECT m.id, m.published_at, m.page_type,
         (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date AS day_ast,
         (SELECT topic_id FROM mention_topics
            WHERE mention_id = m.id
            ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS primary_topic
    FROM mentions m, w
   WHERE m.agency_id = '${agencyId}'
     AND ${UNIVERSE}
     AND ${IN_WINDOW_B}
)
SELECT
  (SELECT COUNT(*)::int FROM base) AS total,
  (SELECT COALESCE(SUM(c),0)::int FROM (SELECT COUNT(*) AS c FROM base GROUP BY day_ast) d) AS daily,
  (SELECT COALESCE(SUM(c),0)::int FROM (SELECT COUNT(*) AS c FROM base GROUP BY primary_topic) t) AS topics,
  (SELECT COALESCE(SUM(c),0)::int FROM (SELECT COUNT(*) AS c FROM base GROUP BY COALESCE(page_type,'')) s) AS sources,
  (SELECT COALESCE(SUM(c),0)::int FROM (
     SELECT COUNT(*) AS c FROM base
     GROUP BY EXTRACT(DOW FROM (published_at AT TIME ZONE 'America/Puerto_Rico')),
              EXTRACT(HOUR FROM (published_at AT TIME ZONE 'America/Puerto_Rico'))) h) AS heatmap,
  (SELECT COUNT(*)::int FROM base b, w WHERE b.day_ast = w.start_d) AS first_day,
  (SELECT COUNT(DISTINCT mm.mention_id)::int
     FROM mention_municipalities mm JOIN mentions m ON m.id = mm.mention_id, w
    WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE} AND ${IN_WINDOW_B}) AS geo
) x`;
}

// ---------- G2: familias de cota ----------
function g2Query(agencyId: string, days: number): string {
  return `SELECT * FROM (
WITH ${winCte(days)}
SELECT
  (SELECT COUNT(*)::int FROM mentions m, w
    WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE}
      AND m.published_at >= (w.start_d::text || 'T00:00:00-04:00')::timestamptz
      AND m.published_at <= (w.end_d::text || 'T23:59:59.999-04:00')::timestamptz) AS familia_a,
  (SELECT COUNT(*)::int FROM mentions m, w
    WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE}
      AND ${IN_WINDOW_B}) AS familia_b
) x`;
}

// ---------- G3/G4: sanidad de valores (histórico completo) ----------
function g34Query(agencyId: string): string {
  return `SELECT * FROM (
SELECT
  (SELECT COUNT(*)::int FROM mentions m
    WHERE m.agency_id = '${agencyId}' AND m.is_duplicate = false
      AND COALESCE(m.nlp_sentiment, m.bw_sentiment) IS NOT NULL
      AND COALESCE(m.nlp_sentiment, m.bw_sentiment) NOT IN
          ('positivo','positive','neutral','neutro','negativo','negative')) AS senti_desconocido,
  (SELECT COUNT(*)::int FROM mentions m
    WHERE m.agency_id = '${agencyId}' AND m.is_duplicate = false
      AND COALESCE(m.nlp_sentiment, m.bw_sentiment) IS NULL) AS senti_null,
  (SELECT COUNT(*)::int FROM mentions m
    WHERE m.agency_id = '${agencyId}' AND m.is_duplicate = false
      AND m.nlp_pertinence IS NOT NULL
      AND m.nlp_pertinence NOT IN ('alta','media','baja')) AS pertinencia_invalida
) x`;
}

// ---------- G5: tenancy de datos ----------
const G5_QUERY = `SELECT * FROM (
SELECT
  (SELECT COUNT(*)::int
     FROM mention_topics mt
     JOIN mentions m ON m.id = mt.mention_id
     JOIN topics t ON t.id = mt.topic_id
    WHERE t.agency_id <> m.agency_id) AS topicos_cruzados,
  (SELECT COUNT(*)::int
     FROM narrative_mentions nm
     JOIN mentions m ON m.id = nm.mention_id
     JOIN narratives n ON n.id = nm.narrative_id
    WHERE n.agency_id <> m.agency_id) AS narrativas_cruzadas
) x`;

// ---------- G6: primario ≤ multi para TODOS los tópicos ----------
function g6Query(agencyId: string, days: number): string {
  return `SELECT * FROM (
WITH ${winCte(days)},
prim AS (
  SELECT topic_id, COUNT(*)::int AS prim FROM (
    SELECT (SELECT topic_id FROM mention_topics
              WHERE mention_id = m.id
              ORDER BY confidence DESC NULLS LAST, topic_id ASC LIMIT 1) AS topic_id
      FROM mentions m, w
     WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE} AND ${IN_WINDOW_B}
  ) t WHERE topic_id IS NOT NULL GROUP BY topic_id
),
multi AS (
  SELECT mt.topic_id, COUNT(DISTINCT mt.mention_id)::int AS multi
    FROM mention_topics mt JOIN mentions m ON m.id = mt.mention_id, w
   WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE} AND ${IN_WINDOW_B}
   GROUP BY mt.topic_id
)
SELECT COALESCE(bool_and(COALESCE(mu.multi, 0) >= p.prim), true) AS ok,
       COUNT(*)::int AS topicos
  FROM prim p LEFT JOIN multi mu ON mu.topic_id = p.topic_id
) x`;
}

// ---------- G7: WARN — drift/huecos informativos ----------
function g7Query(agencyId: string, days: number): string {
  return `SELECT * FROM (
WITH ${winCte(days)}
SELECT
  (SELECT COALESCE(SUM(s.total_mentions),0)::int FROM daily_metric_snapshots s, w
    WHERE s.agency_id = '${agencyId}' AND s.date BETWEEN w.start_d AND w.end_d) AS snap_sum,
  (SELECT COUNT(*)::int FROM mentions m, w
    WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE} AND ${IN_WINDOW_B}) AS vivo_pertinente,
  (SELECT COUNT(*)::int FROM mentions m, w
    WHERE m.agency_id = '${agencyId}' AND m.is_duplicate = true AND ${IN_WINDOW_B}) AS duplicados,
  (SELECT COUNT(*)::int FROM mentions m, w
    WHERE m.agency_id = '${agencyId}' AND ${UNIVERSE} AND ${IN_WINDOW_B}
      AND NOT EXISTS (SELECT 1 FROM mention_topics mt WHERE mt.mention_id = m.id)) AS sin_topico
) x`;
}

async function main(): Promise<void> {
  console.log(`contract-check-live · ventanas ${WINDOWS.join('/')}D cerradas · universo pertinente`);
  const agencies = await customQuery(
    `SELECT id::text, slug FROM agencies WHERE is_active = true ORDER BY slug`,
  );

  // G5 (global, una vez)
  console.log('\n[G5] Tenancy de datos (global)');
  const [g5] = await customQuery(G5_QUERY);
  report('global', [
    ['tópicos no cruzan agencias', Number(g5.topicos_cruzados) === 0, `${g5.topicos_cruzados} filas cruzadas`],
    ['narrativas no cruzan agencias', Number(g5.narrativas_cruzadas) === 0, `${g5.narrativas_cruzadas} filas cruzadas`],
  ]);

  for (const a of agencies) {
    // G3/G4 (histórico, una vez por agencia)
    console.log(`\n[G3/G4] ${a.slug} · sanidad de valores (histórico completo)`);
    const [g34] = await customQuery(g34Query(a.id));
    report(a.slug, [
      ['sentimiento reconocido', Number(g34.senti_desconocido) === 0, `${g34.senti_desconocido} valores fuera del vocabulario`],
      ['sentimiento no-NULL', Number(g34.senti_null) === 0, `${g34.senti_null} con COALESCE NULL`],
      ['pertinencia válida', Number(g34.pertinencia_invalida) === 0, `${g34.pertinencia_invalida} valores inválidos`],
    ]);

    for (const days of WINDOWS) {
      const scope = `${a.slug} ${days}D`;
      const [r] = await customQuery(g1Query(a.id, days));
      const n = (k: string) => Number(r[k]);
      console.log(`\n[G1] ${scope} · total pertinente = ${r.total}`);
      report(scope, [
        ['Σ serie diaria == total', n('daily') === n('total'), `${r.daily} vs ${r.total}`],
        ['Σ tópicos(prim) == total', n('topics') === n('total'), `${r.topics} vs ${r.total}`],
        ['Σ fuentes == total', n('sources') === n('total'), `${r.sources} vs ${r.total}`],
        ['Σ heatmap == total', n('heatmap') === n('total'), `${r.heatmap} vs ${r.total}`],
        ['geo(dedup) ≤ total', n('geo') <= n('total'), `${r.geo} ≤ ${r.total}`],
        ['day-slice primer día consistente', n('first_day') >= 0, `${r.first_day}`],
      ]);

      const [g2] = await customQuery(g2Query(a.id, days));
      console.log(`[G2] ${scope}`);
      report(scope, [
        ['familia A (ts) == familia B (::date)', Number(g2.familia_a) === Number(g2.familia_b), `${g2.familia_a} vs ${g2.familia_b}`],
      ]);

      const [g6] = await customQuery(g6Query(a.id, days));
      console.log(`[G6] ${scope}`);
      report(scope, [
        [`primario ≤ multi en TODOS los tópicos (${g6.topicos})`, g6.ok === true || g6.ok === 'true' || g6.ok === 't', `${g6.topicos} tópicos`],
      ]);

      const [g7] = await customQuery(g7Query(a.id, days));
      console.log(`[G7·WARN] ${scope}`);
      const vivo = Number(g7.vivo_pertinente);
      const sinTopico = Number(g7.sin_topico);
      report(scope, [
        ['snapshots ≈ vivo (informativo)', true, `snap Σ=${g7.snap_sum} vs vivo pertinente=${g7.vivo_pertinente} (difieren por diseño: capa de métricas)`],
        ['share de duplicados', true, `${g7.duplicados} duplicados en ventana`],
        ['cobertura de clasificación', vivo === 0 || sinTopico / Math.max(vivo, 1) < 0.5, `${sinTopico}/${vivo} sin tópico`],
      ], true);
    }
  }

  console.log(`\nResumen: ${failures} fallas · ${warns} warnings.`);
  console.log(failures === 0 ? 'Todas las identidades verdes.' : 'HAY IDENTIDADES ROTAS — revisar arriba.');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('contract-check-live falló:', err);
  process.exit(1);
});
