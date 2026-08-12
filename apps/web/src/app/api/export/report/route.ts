/**
 * GET /api/export/report — reporte analítico completo, listo para imprimir a PDF.
 *
 * Reemplaza al viejo botón "Exportar" del modal de menciones (un CSV de las
 * filas cargadas). Aquí la exportación es del PRODUCTO, no de una tabla: el
 * documento cubre indicadores, tendencia, sentimiento, agenda temática, actores,
 * geografía, riesgo y menciones determinantes, con nueve bloques de análisis
 * generados con Claude vía Bedrock.
 *
 * RESPONDE A LOS FILTROS DEL HEADER. `agency`, `period` y `from`/`to` se
 * resuelven con el MISMO `resolveWindow` de `@eco/shared` que usan /api/overview
 * y /api/eco-data, así que el reporte describe exactamente la ventana que el
 * usuario tiene en pantalla — incluido un rango personalizado.
 *
 * POR QUÉ DEVUELVE HTML EN STREAMING Y NO UN PDF BINARIO:
 *  - Generar el PDF en el servidor exigiría Chromium headless en el contenedor
 *    de ECS (~350 MB en la imagen) o un lambda con capa de Chromium + S3. El
 *    usuario eligió la vista de impresión del navegador, que además produce un
 *    PDF vectorial con la tipografía real y sin infraestructura nueva.
 *  - El streaming es lo que hace usable la espera. Las nueve llamadas a Bedrock
 *    tardan decenas de segundos; si el handler acumulara todo antes de
 *    responder, el usuario vería una pestaña en blanco (y el ALB cortaría la
 *    conexión por idle timeout de 60 s). Emitiendo el `<head>` y la portada de
 *    inmediato, y anexando cada sección conforme se resuelve, el documento se
 *    construye a la vista y la conexión nunca queda inactiva.
 *
 * El `<script>` de auto-impresión va al FINAL del stream, así que sólo se
 * dispara cuando el documento está completo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies, dailyMetricSnapshots } from '@eco/database';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  resolveWindow,
  PERIOD_DAYS,
  formatPeriodLabel,
  formatUpdatedAtLabel,
  buildSentimentReport,
  buildReportDetail,
  loadMetricsForWindow,
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
  renderDocumentHead, renderCover, renderToc, renderExecutiveSummary,
  renderIndicators, renderTrend, renderSentiment, renderTopics,
  renderActors, renderGeography, renderRisk, renderMentions,
  renderSynthesis, renderAnnex, renderDocumentFoot, renderProgress,
  renderFatalError,
} from '@eco/shared';
import type {
  PgClientLike, ReportContext, MetricSeries,
  ReportExecutiveSummaryOutput, MetricReadingsOutput, TrendAnalysisOutput,
  SentimentAnalysisOutput, TopicAnalysisOutput, ActorAnalysisOutput,
  GeoAnalysisOutput, RiskAnalysisOutput, SynthesisOutput,
} from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
// El documento completo puede tardar ~40-70 s entre las nueve llamadas a
// Bedrock. El streaming mantiene la conexión activa, pero Next necesita saber
// que el handler es de larga duración.
export const maxDuration = 300;

const TZ = 'America/Puerto_Rico';

/** Modelo primario del reporte. El helper cae a Sonnet si Opus falla o throttlea. */
const PRIMARY_MODEL = 'us.anthropic.claude-opus-4-6-v1';

/** Nombre corto de la agencia para asuntos y encabezados ("DDEC", "AAA"). */
function shortName(name: string, slug: string): string {
  // Muchos nombres vienen como "Departamento de Desarrollo Económico y Comercio
  // (DDEC)": si hay siglas entre paréntesis, ésas son el nombre corto.
  const paren = name.match(/\(([^)]{2,12})\)\s*$/);
  if (paren) return paren[1].trim();
  // Si el nombre ya es corto, se usa tal cual; si no, el slug en mayúsculas.
  if (name.length <= 12) return name;
  return slug.toUpperCase();
}

/**
 * Series diarias de los índices para las sparklines de los mosaicos. Salen de
 * `daily_metric_snapshots` (la capa calibrada), igual que el TIMELINE del
 * Scorecard; el volumen sale de la serie de conteos del propio reporte para que
 * la sparkline y la gráfica de tendencia no puedan discrepar.
 */
async function loadMetricSeries(
  agencyId: string,
  startYmd: string,
  endYmd: string,
  volume: number[],
): Promise<MetricSeries> {
  const db = getDb();
  const rows = await db
    .select({
      date: dailyMetricSnapshots.date,
      nss: dailyMetricSnapshots.nss,
      bhi: dailyMetricSnapshots.brandHealthIndex,
      crisis: dailyMetricSnapshots.crisisRiskScore,
      polarization: dailyMetricSnapshots.polarizationIndex,
      engagement: dailyMetricSnapshots.engagementRate,
    })
    .from(dailyMetricSnapshots)
    .where(and(
      eq(dailyMetricSnapshots.agencyId, agencyId),
      gte(dailyMetricSnapshots.date, startYmd),
      lte(dailyMetricSnapshots.date, endYmd),
    ))
    .orderBy(dailyMetricSnapshots.date);

  return {
    nss: rows.map((r) => (r.nss != null ? Number(r.nss) : null)),
    // BHI se guarda 0-1 y se muestra 1-10: la sparkline usa la escala de display
    // para que su forma coincida con el número grande del mosaico.
    bhi: rows.map((r) => (r.bhi != null ? 1 + Number(r.bhi) * 9 : null)),
    crisis: rows.map((r) => (r.crisis != null ? Number(r.crisis) : null)),
    polarization: rows.map((r) => (r.polarization != null ? Number(r.polarization) : null)),
    engagement: rows.map((r) => (r.engagement != null ? Number(r.engagement) : null)),
    volume,
  };
}

/**
 * Una llamada de análisis. Nunca lanza: un fallo devuelve null y la sección se
 * imprime con su marca de "no pudo generarse". Un reporte con ocho de nueve
 * bloques sirve; uno que aborta a mitad del stream, no.
 */
async function analyze<T>(
  label: string,
  prompt: string,
  tool: { name: string; description?: string; input_schema: Record<string, unknown> },
  maxTokens: number,
): Promise<T | null> {
  try {
    const { getBedrockClient } = await import('@/lib/bedrock-client');
    const { invokeClaudeWithTool } = await import('@eco/shared/src/bedrock');
    const out = await invokeClaudeWithTool<T>({
      client: getBedrockClient(),
      systemPrompt: REPORT_SYSTEM_PROMPT,
      userPrompt: prompt,
      maxTokens,
      primaryModel: PRIMARY_MODEL,
      tool: tool as Parameters<typeof invokeClaudeWithTool>[0]['tool'],
      temperature: 0,
    });
    return out;
  } catch (err) {
    log.warn('export-report', 'analysis failed', { section: label, msg: (err as Error).message });
    return null;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  // Límite estricto: cada reporte son nueve invocaciones de Opus. No es un
  // endpoint de dashboard que se pueda llamar en bucle.
  const rl = consume('export-report:' + clientKey(request), { limit: 6, windowMs: 10 * 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', message: 'Espera un momento antes de generar otro reporte.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? '7D';
  const autoPrint = searchParams.get('print') !== '0';

  const win = resolveWindow({
    period: periodKey,
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    timeZone: TZ,
  });
  if (!win) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, or pass from/to.` },
      { status: 400 },
    );
  }

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  const db = getDb();
  const [agencyRow] = await db
    .select({ name: agencies.name, slug: agencies.slug })
    .from(agencies)
    .where(eq(agencies.id, agencyId))
    .limit(1);
  if (!agencyRow) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  const { startYmd, endYmd, prevStartYmd, prevEndYmd, days, custom } = win;
  const agencyName = agencyRow.name;
  const agencyShort = shortName(agencyRow.name, agencyRow.slug);
  const periodLabel = formatPeriodLabel(startYmd, endYmd);
  const generatedLabel = formatUpdatedAtLabel(new Date(), TZ);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (html: string): void => {
        try {
          controller.enqueue(encoder.encode(html));
        } catch {
          // El cliente cerró la pestaña: dejar de empujar sin ruido.
        }
      };

      // 1 · Cabecera y portada salen antes de tocar la base de datos: el
      //     navegador pinta algo en el primer segundo.
      push(renderDocumentHead({ agencyName, agencyShortName: agencyShort, periodLabel, generatedLabel }));
      push(renderCover(
        {
          agencyName,
          periodStart: startYmd, periodEnd: endYmd,
          prevPeriodStart: prevStartYmd, prevPeriodEnd: prevEndYmd,
          days, periodLabel, customRange: custom, periodKey,
        },
        { generatedLabel },
      ));
      push(renderToc());
      push(renderProgress('Consultando datos del período…'));

      let aiOk = 0;
      const AI_TOTAL = 9;

      try {
        const pool = getPool() as unknown as PgClientLike;

        // 2 · Datos. Todo en paralelo; es la parte rápida (~1-3 s).
        const report = await buildSentimentReport(pool, agencyId, startYmd, endYmd, prevStartYmd, prevEndYmd);
        const [detail, metrics, prevMetrics] = await Promise.all([
          buildReportDetail(pool, agencyId, startYmd, endYmd, report.dailySeries),
          loadMetricsForWindow(pool, agencyId, startYmd, endYmd),
          loadMetricsForWindow(pool, agencyId, prevStartYmd, prevEndYmd),
        ]);
        const series = await loadMetricSeries(
          agencyId, startYmd, endYmd,
          report.dailySeries.map((d) => d.negative + d.neutral + d.positive),
        );

        const ctx: ReportContext = {
          agencyName, agencyShortName: agencyShort,
          periodStart: startYmd, periodEnd: endYmd,
          prevPeriodStart: prevStartYmd, prevPeriodEnd: prevEndYmd,
          days, periodLabel, customRange: custom, periodKey,
          report, detail, metrics, prevMetrics,
        };

        // Un período sin menciones no necesita nueve llamadas a Bedrock para
        // decir que está vacío: se emite el documento con sus tablas vacías y
        // se ahorra el gasto.
        if (report.totals.total === 0) {
          push(renderProgress('El período no tiene menciones.'));
          push(renderExecutiveSummary(ctx, null));
          push(renderIndicators(ctx, null, series));
          push(renderTrend(ctx, null));
          push(renderSentiment(ctx, null));
          push(renderTopics(ctx, null));
          push(renderActors(ctx, null));
          push(renderGeography(ctx, null));
          push(renderRisk(ctx, null));
          push(renderMentions(ctx));
          push(renderSynthesis(ctx, null));
          push(renderAnnex(ctx, { generatedLabel, model: PRIMARY_MODEL, aiSectionsOk: 0, aiSectionsTotal: 0 }));
          push(renderDocumentFoot({ autoPrint, statusLabel: 'Sin menciones en el período' }));
          controller.close();
          return;
        }

        // 3 · Las nueve llamadas arrancan JUNTAS. El costo total es el de la
        //     más lenta, no la suma; después se consumen en orden de documento.
        push(renderProgress(`Analizando ${report.totals.total.toLocaleString('es-PR')} menciones con IA…`));

        const pExec = analyze<ReportExecutiveSummaryOutput>('executive', buildReportExecutiveSummaryPrompt(ctx), EXECUTIVE_SUMMARY_TOOL, 2600);
        const pMetrics = analyze<MetricReadingsOutput>('metrics', buildMetricReadingsPrompt(ctx), METRIC_READINGS_TOOL, 2600);
        const pTrend = analyze<TrendAnalysisOutput>('trend', buildTrendAnalysisPrompt(ctx), TREND_ANALYSIS_TOOL, 2000);
        const pSent = analyze<SentimentAnalysisOutput>('sentiment', buildSentimentAnalysisPrompt(ctx), SENTIMENT_ANALYSIS_TOOL, 2200);
        const pTopics = analyze<TopicAnalysisOutput>('topics', buildTopicAnalysisPrompt(ctx), TOPIC_ANALYSIS_TOOL, 3200);
        const pActors = analyze<ActorAnalysisOutput>('actors', buildActorAnalysisPrompt(ctx), ACTOR_ANALYSIS_TOOL, 2200);
        const pGeo = analyze<GeoAnalysisOutput>('geo', buildGeoAnalysisPrompt(ctx), GEO_ANALYSIS_TOOL, 1600);
        const pRisk = analyze<RiskAnalysisOutput>('risk', buildRiskAnalysisPrompt(ctx), RISK_ANALYSIS_TOOL, 2400);
        const pSynth = analyze<SynthesisOutput>('synthesis', buildSynthesisPrompt(ctx), SYNTHESIS_TOOL, 2200);

        // Se emite en orden de lectura. Cada `await` es sobre una promesa que ya
        // está corriendo, así que la espera acumulada no se suma.
        const step = async <T>(
          promise: Promise<T | null>,
          label: string,
          render: (v: T | null) => string,
        ): Promise<void> => {
          const value = await promise;
          if (value) aiOk += 1;
          push(render(value));
          push(renderProgress(label));
        };

        await step(pExec, 'Resumen listo · armando indicadores…', (v) => renderExecutiveSummary(ctx, v));
        await step(pMetrics, 'Indicadores listos · evaluando tendencia…', (v) => renderIndicators(ctx, v, series));
        await step(pTrend, 'Tendencia lista · analizando sentimiento…', (v) => renderTrend(ctx, v));
        await step(pSent, 'Sentimiento listo · analizando tópicos…', (v) => renderSentiment(ctx, v));
        await step(pTopics, 'Tópicos listos · analizando actores…', (v) => renderTopics(ctx, v));
        await step(pActors, 'Actores listos · analizando geografía…', (v) => renderActors(ctx, v));
        await step(pGeo, 'Geografía lista · evaluando riesgo…', (v) => renderGeography(ctx, v));
        await step(pRisk, 'Riesgo listo · cerrando el documento…', (v) => renderRisk(ctx, v));

        push(renderMentions(ctx));
        await step(pSynth, 'Documento completo', (v) => renderSynthesis(ctx, v));

        push(renderAnnex(ctx, {
          generatedLabel, model: PRIMARY_MODEL, aiSectionsOk: aiOk, aiSectionsTotal: AI_TOTAL,
        }));
        push(renderDocumentFoot({
          autoPrint,
          statusLabel: aiOk === AI_TOTAL
            ? 'Reporte completo'
            : `Reporte completo · ${aiOk} de ${AI_TOTAL} bloques de análisis`,
        }));
        controller.close();
      } catch (err) {
        // El `<head>` ya salió, así que el error se cuenta DENTRO del documento
        // en vez de dejar la pestaña a medias.
        log.error('export-report', 'handler failed', { msg: (err as Error).message });
        push(renderFatalError(
          'Ocurrió un error consultando los datos del período.',
          (err as Error).message,
        ));
        push(renderDocumentFoot({ autoPrint: false, statusLabel: 'Error al generar el reporte' }));
        controller.close();
      } finally {
        log.info('export-report', 'request complete', {
          latencyMs: Date.now() - started,
          agency: agencyRow.slug,
          period: custom ? 'custom' : periodKey,
          startYmd, endYmd, days,
          aiSectionsOk: aiOk,
        });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      // Sin esto algunos proxies bufferean la respuesta completa y el streaming
      // (que es lo que hace usable la espera) se pierde.
      'X-Accel-Buffering': 'no',
      'Content-Disposition': 'inline',
    },
  });
}
