/**
 * Prueba VIVA del reporte exportable: datos reales de producción + Bedrock real.
 *
 * Por qué existe y por qué no es simplemente "levantar el dev server": la RDS
 * vive en una VPC privada y no es alcanzable desde una máquina de desarrollo (la
 * misma razón por la que `contract-check-live.ts` existe). Este script cierra ese
 * hueco explotando la costura que ya tienen las agregaciones: reciben un
 * `PgClientLike`, así que basta con implementar ese contrato sobre el lambda
 * `eco-migration` (acción `custom-query`, sólo SELECT) para que
 * `buildSentimentReport` y `buildReportDetail` ejecuten su SQL REAL, sin
 * modificar, contra la base REAL.
 *
 * Lo que SÍ ejercita de punta a punta:
 *   - las 11 queries de agregación, tal cual corren en producción
 *   - `loadMetricsForWindow` (métricas compuestas calibradas)
 *   - las 9 llamadas a Bedrock con los prompts reales y tool-use
 *   - el renderizador completo y la hoja de impresión
 *
 * Lo que NO ejercita (queda para la verificación post-deploy):
 *   - la capa HTTP: streaming, cabeceras, rate limit, auth del middleware
 *   - el pool de Drizzle/pg (aquí el transporte es el lambda)
 *
 * Uso:
 *   set -a && source .env && set +a
 *   node_modules/.bin/tsx scripts/live-export-report.ts <agencySlug> <period> [from] [to]
 *   node_modules/.bin/tsx scripts/live-export-report.ts ddecpr 7D
 *   node_modules/.bin/tsx scripts/live-export-report.ts aaa custom 2026-07-01 2026-07-31
 *
 * Escribe el HTML a apps/web/public/report-preview/live-<slug>-<period>.html
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { resolveWindow } from '../packages/shared/src/dates.ts';
import { formatPeriodLabel, formatUpdatedAtLabel } from '../packages/shared/src/format-period.ts';
import { buildSentimentReport } from '../packages/shared/src/aggregations/sentiment-report.ts';
import { buildReportDetail } from '../packages/shared/src/aggregations/report-detail.ts';
import { loadMetricsForWindow } from '../packages/shared/src/metrics.ts';
import { invokeClaudeWithTool } from '../packages/shared/src/bedrock.ts';
import type { PgClientLike } from '../packages/shared/src/aggregations/sentiment-report.ts';
import {
  REPORT_SYSTEM_PROMPT,
  buildReportExecutiveSummaryPrompt, EXECUTIVE_SUMMARY_TOOL,
  buildMetricReadingsPrompt, METRIC_READINGS_TOOL,
  buildTrendAnalysisPrompt, TREND_ANALYSIS_TOOL,
  buildSentimentAnalysisPrompt, SENTIMENT_ANALYSIS_TOOL,
  buildTopicAnalysisPrompt, TOPIC_ANALYSIS_TOOL,
  buildActorAnalysisPrompt, ACTOR_ANALYSIS_TOOL,
  buildGeoAnalysisPrompt, GEO_ANALYSIS_TOOL,
  buildRiskAnalysisPrompt, RISK_ANALYSIS_TOOL,
  buildSynthesisPrompt, SYNTHESIS_TOOL,
  type ReportContext,
} from '../packages/shared/src/prompts/full-report.ts';
import {
  renderDocumentHead, renderCover, renderToc, renderExecutiveSummary,
  renderIndicators, renderTrend, renderSentiment, renderTopics,
  renderActors, renderGeography, renderRisk, renderMentions,
  renderSynthesis, renderAnnex, renderDocumentFoot,
  type MetricSeries,
} from '../packages/shared/src/report/render-print-report.ts';

const TZ = 'America/Puerto_Rico';
const PRIMARY_MODEL = 'us.anthropic.claude-opus-4-6-v1';

const lambda = new LambdaClient({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// ============================================================
// PgClientLike sobre el lambda eco-migration
// ============================================================

/**
 * Interpola los parámetros posicionales en el SQL. `custom-query` no acepta
 * parámetros, así que hay que hacerlo aquí — con una lista blanca estricta de
 * formas, no con un escape genérico: los únicos parámetros que usan estas
 * queries son un UUID de agencia y dos fechas YYYY-MM-DD, y cualquier otra cosa
 * aborta en vez de intentar escaparse.
 */
function interpolate(sql: string, params: readonly unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_m, n) => {
    const v = params[Number(n) - 1];
    const s = String(v);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return `'${s}'`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `'${s}'`;
    throw new Error(`Parámetro no permitido en el adaptador de prueba: ${JSON.stringify(v)}`);
  });
}

let queryCount = 0;

const lambdaClient: PgClientLike = {
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    let text = interpolate(sql, params).trim();
    // `custom-query` rechaza cualquier cosa que no empiece con SELECT, y varias
    // agregaciones abren con WITH. Envolver el CTE en una subconsulta deja el
    // SQL interno IDÉNTICO al de producción y satisface el guardia.
    if (/^with\b/i.test(text)) text = `SELECT * FROM (${text}) _cte`;

    const res = await lambda.send(new InvokeCommand({
      FunctionName: 'eco-migration',
      Payload: Buffer.from(JSON.stringify({ action: 'custom-query', query: text })),
    }));
    const raw = JSON.parse(Buffer.from(res.Payload!).toString());
    const body = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw;
    if (body.error) {
      throw new Error(`custom-query falló: ${body.error}\n--- SQL ---\n${text.slice(0, 700)}`);
    }
    queryCount += 1;
    return { rows: (body.rows ?? []) as T[] };
  },
};

// ============================================================
// Análisis
// ============================================================

interface AnalysisResult { key: string; ok: boolean; ms: number; err?: string; value: unknown }

async function analyze(
  key: string,
  prompt: string,
  tool: { name: string; description?: string; input_schema: Record<string, unknown> },
  maxTokens: number,
): Promise<AnalysisResult> {
  const t0 = Date.now();
  try {
    const value = await invokeClaudeWithTool({
      client: bedrock,
      systemPrompt: REPORT_SYSTEM_PROMPT,
      userPrompt: prompt,
      maxTokens,
      primaryModel: PRIMARY_MODEL,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tool: tool as any,
      temperature: 0,
    });
    return { key, ok: true, ms: Date.now() - t0, value };
  } catch (err) {
    return { key, ok: false, ms: Date.now() - t0, err: (err as Error).message, value: null };
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const [slug = 'ddecpr', periodKey = '7D', fromArg, toArg] = process.argv.slice(2);

  const win = resolveWindow({ period: periodKey, from: fromArg ?? null, to: toArg ?? null, timeZone: TZ });
  if (!win) {
    console.error(`Período no soportado: ${periodKey}`);
    process.exit(1);
  }
  const { startYmd, endYmd, prevStartYmd, prevEndYmd, days, custom } = win;

  console.log(`\n▸ Agencia ${slug} · ${startYmd} → ${endYmd} (${days} días${custom ? ', rango personalizado' : ''})`);
  console.log(`  comparado contra ${prevStartYmd} → ${prevEndYmd}\n`);

  const agRes = await lambdaClient.query<{ id: string; name: string; slug: string }>(
    `SELECT id::text AS id, name, slug FROM agencies WHERE slug = '${slug.replace(/[^a-z0-9_-]/gi, '')}' LIMIT 1`,
  );
  const agency = agRes.rows[0];
  if (!agency) {
    console.error(`No existe la agencia '${slug}'`);
    process.exit(1);
  }
  const agencyShort = (() => {
    const paren = agency.name.match(/\(([^)]{2,12})\)\s*$/);
    if (paren) return paren[1].trim();
    return agency.name.length <= 12 ? agency.name : agency.slug.toUpperCase();
  })();

  // ---- Datos reales ----------------------------------------------------------
  const tData = Date.now();
  console.log('▸ Agregaciones (SQL real contra la base real vía eco-migration)…');
  const report = await buildSentimentReport(lambdaClient, agency.id, startYmd, endYmd, prevStartYmd, prevEndYmd);
  const [detail, metrics, prevMetrics] = await Promise.all([
    buildReportDetail(lambdaClient, agency.id, startYmd, endYmd, report.dailySeries),
    loadMetricsForWindow(lambdaClient, agency.id, startYmd, endYmd),
    loadMetricsForWindow(lambdaClient, agency.id, prevStartYmd, prevEndYmd),
  ]);
  const snapRes = await lambdaClient.query<{
    date: string; nss: string | null; bhi: string | null; crisis: string | null;
    pol: string | null; eng: string | null;
  }>(
    `SELECT date::text AS date, nss::text AS nss, brand_health_index::text AS bhi,
            crisis_risk_score::text AS crisis, polarization_index::text AS pol,
            engagement_rate::text AS eng
       FROM daily_metric_snapshots
      WHERE agency_id = $1 AND date >= $2::date AND date <= $3::date
      ORDER BY date`,
    [agency.id, startYmd, endYmd],
  );
  const numOrNull = (v: string | null): number | null => (v == null ? null : Number(v));
  const series: MetricSeries = {
    nss: snapRes.rows.map((r) => numOrNull(r.nss)),
    bhi: snapRes.rows.map((r) => (r.bhi == null ? null : 1 + Number(r.bhi) * 9)),
    crisis: snapRes.rows.map((r) => numOrNull(r.crisis)),
    polarization: snapRes.rows.map((r) => numOrNull(r.pol)),
    engagement: snapRes.rows.map((r) => numOrNull(r.eng)),
    volume: report.dailySeries.map((d) => d.negative + d.neutral + d.positive),
  };
  console.log(`  ${queryCount} queries · ${((Date.now() - tData) / 1000).toFixed(1)}s`);
  console.log(`  ${report.totals.total} menciones · ${report.topicsTable.length} filas de tópico · `
    + `${detail.channels.length} canales · ${detail.authors.length} autores · `
    + `${detail.municipalities.length} municipios · ${detail.emotions.length} emociones`);
  console.log(`  NSS=${metrics.nss} BHI=${metrics.brandHealthIndex} crisis=${metrics.crisisRiskScore} pol=${metrics.polarizationIndex}`);
  console.log(`  snapshots en la ventana: ${snapRes.rows.length}`);

  // ---- Invariantes de consistencia -----------------------------------------
  // El reporte pone en la MISMA página el termómetro (buildSentimentReport) y
  // las tablas de canales/tópicos/geografía (buildReportDetail). Si sus ventanas
  // o universos divergen, el documento se contradice a sí mismo y el modelo cita
  // las dos cifras. Pasó de verdad: 73 vs 75 por usar familias de cota distintas.
  const problems: string[] = [];
  if (report.totals.total !== detail.totals.mentions) {
    problems.push(
      `termómetro (${report.totals.total}) != universo del detalle (${detail.totals.mentions}); `
      + 'revisa que ambas agregaciones usen el corte por día AST',
    );
  }
  const channelSum = detail.channels.reduce((a, c) => a + c.total, 0);
  if (channelSum !== report.totals.total) {
    problems.push(`Σ canales (${channelSum}) != total (${report.totals.total})`);
  }
  const topicSum = report.topicsTable.reduce((a, t) => a + t.total, 0);
  if (topicSum !== report.totals.total) {
    problems.push(`Σ tópicos primarios (${topicSum}) != total (${report.totals.total})`);
  }
  const dailySum = report.dailySeries.reduce((a, d) => a + d.negative + d.neutral + d.positive, 0);
  if (dailySum !== report.totals.total) {
    problems.push(`Σ serie diaria (${dailySum}) != total (${report.totals.total})`);
  }
  const hourSum = detail.byHour.reduce((a, b) => a + b, 0);
  if (hourSum !== report.totals.total) {
    problems.push(`Σ heatmap horario (${hourSum}) != total (${report.totals.total})`);
  }
  if (problems.length) {
    console.log('\n  ✖ IDENTIDADES DE CONTEO ROTAS:');
    for (const p2 of problems) console.log(`     · ${p2}`);
    console.log();
  } else {
    console.log('  ✔ identidades de conteo: termómetro == detalle == Σ canales == Σ tópicos == Σ serie == Σ heatmap\n');
  }


  const ctx: ReportContext = {
    agencyName: agency.name, agencyShortName: agencyShort,
    periodStart: startYmd, periodEnd: endYmd,
    prevPeriodStart: prevStartYmd, prevPeriodEnd: prevEndYmd,
    days, periodLabel: formatPeriodLabel(startYmd, endYmd),
    customRange: custom, periodKey,
    report, detail, metrics, prevMetrics,
  };

  // ---- Bedrock real ----------------------------------------------------------
  console.log('▸ Nueve llamadas a Bedrock en paralelo (Opus 4.6, tool-use)…');
  const tAi = Date.now();
  const results = await Promise.all([
    analyze('exec', buildReportExecutiveSummaryPrompt(ctx), EXECUTIVE_SUMMARY_TOOL, 2600),
    analyze('metrics', buildMetricReadingsPrompt(ctx), METRIC_READINGS_TOOL, 2600),
    analyze('trend', buildTrendAnalysisPrompt(ctx), TREND_ANALYSIS_TOOL, 2000),
    analyze('sentiment', buildSentimentAnalysisPrompt(ctx), SENTIMENT_ANALYSIS_TOOL, 2200),
    analyze('topics', buildTopicAnalysisPrompt(ctx), TOPIC_ANALYSIS_TOOL, 3200),
    analyze('actors', buildActorAnalysisPrompt(ctx), ACTOR_ANALYSIS_TOOL, 2200),
    analyze('geo', buildGeoAnalysisPrompt(ctx), GEO_ANALYSIS_TOOL, 1600),
    analyze('risk', buildRiskAnalysisPrompt(ctx), RISK_ANALYSIS_TOOL, 2400),
    analyze('synth', buildSynthesisPrompt(ctx), SYNTHESIS_TOOL, 2200),
  ]);
  const byKey = new Map(results.map((r) => [r.key, r]));
  const okCount = results.filter((r) => r.ok).length;
  console.log(`  ${okCount}/9 en ${((Date.now() - tAi) / 1000).toFixed(1)}s (pared; corren en paralelo)`);
  for (const r of results) {
    console.log(`  ${r.ok ? '✔' : '✖'} ${r.key.padEnd(10)} ${String((r.ms / 1000).toFixed(1)).padStart(5)}s${r.err ? '  ' + r.err.slice(0, 120) : ''}`);
  }
  console.log();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (k: string): any => byKey.get(k)?.value ?? null;

  // ---- Render ----------------------------------------------------------------
  const generatedLabel = formatUpdatedAtLabel(new Date(), TZ);
  const html = [
    renderDocumentHead({
      agencyName: agency.name, agencyShortName: agencyShort,
      periodLabel: ctx.periodLabel, generatedLabel,
    }),
    renderCover({
      agencyName: agency.name,
      periodStart: startYmd, periodEnd: endYmd,
      prevPeriodStart: prevStartYmd, prevPeriodEnd: prevEndYmd,
      days, periodLabel: ctx.periodLabel, customRange: custom, periodKey,
    }, { generatedLabel }),
    renderToc(),
    renderExecutiveSummary(ctx, v('exec')),
    renderIndicators(ctx, v('metrics'), series),
    renderTrend(ctx, v('trend')),
    renderSentiment(ctx, v('sentiment')),
    renderTopics(ctx, v('topics')),
    renderActors(ctx, v('actors')),
    renderGeography(ctx, v('geo')),
    renderRisk(ctx, v('risk')),
    renderMentions(ctx),
    renderSynthesis(ctx, v('synth')),
    renderAnnex(ctx, { generatedLabel, model: PRIMARY_MODEL, aiSectionsOk: okCount, aiSectionsTotal: 9 }),
    renderDocumentFoot({ autoPrint: false, statusLabel: `Datos reales · ${okCount}/9 bloques de análisis` }),
  ].join('\n');

  const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'report-preview');
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `live-${slug}-${custom ? `${startYmd}_${endYmd}` : periodKey}.html`);
  writeFileSync(file, html, 'utf8');
  console.log(`▸ ${file}`);
  console.log(`  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB · ${queryCount} queries · ${okCount}/9 bloques de IA\n`);

  // Muestra del texto generado, para poder juzgar la CALIDAD del análisis sin
  // abrir el navegador.
  const exec = v('exec');
  if (exec) {
    console.log('── Titular del resumen ejecutivo ─────────────────────────────');
    console.log(exec.headline.replace(/<\/?strong>/g, '*'));
    console.log();
    if (exec.keyFindings?.length) {
      console.log('── Hallazgos ─────────────────────────────────────────────────');
      for (const f of exec.keyFindings) console.log(`  · ${f.label}: ${f.finding}\n    ${f.evidence}`);
      console.log();
    }
    if (exec.limitations?.length) {
      console.log('── Límites declarados ────────────────────────────────────────');
      for (const l of exec.limitations) console.log(`  · ${l}`);
      console.log();
    }
  }

  if (okCount < 9 || problems.length) process.exitCode = 1;

}

main().catch((err) => {
  console.error('\n✖ La corrida viva falló:', (err as Error).message);
  process.exit(1);
});
