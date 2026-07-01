import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, agencies, alertHistory, alertRules } from '@eco/database';
import { sql, eq, inArray, and } from 'drizzle-orm';
import {
  buildSentimentReport,
  closedWindowYmdInTZ,
  formatPeriodLabel,
  loadMetricsForWindow,
  formatMetric,
  formatDelta,
  crisisBand,
} from '@eco/shared';
import type {
  PgClientLike,
  WindowMetrics,
  MetricDisplay,
  DeltaDisplay,
} from '@eco/shared';
import { resolveAllowedAgencySlugs, listActiveAgencies } from '@/lib/agency';
import { log } from '@/lib/log';
import { consume, clientKey } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

/**
 * Vista ejecutiva multi-agencia (Tabla / Sala / Radar). Solo staff — usuarios
 * con acceso a TODAS las agencias (resolveAllowedAgencySlugs() === null) — pueden
 * llamarla; cualquier otro recibe 403. Enumera todas las agencias activas,
 * recalcula las métricas compuestas sobre la misma ventana cerrada que
 * /api/overview (7 días cerrados en TZ PR por defecto, o period/custom), y
 * arma un composite gobierno reach-weighted.
 */

// Misma tabla de periodos que /api/overview.
const PERIOD_DAYS: Record<string, number> = {
  '1D': 1,
  '5D': 5,
  '7D': 7,
  '30D': 30,
  '90D': 90,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1A': 365,
  'Max': 730,
};

/** Copiado 1:1 de /api/overview: rango personalizado from/to. */
function parseCustomRange(
  fromParam: string | null,
  toParam: string | null,
): null | {
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
} {
  if (!fromParam || !toParam) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam) || !/^\d{4}-\d{2}-\d{2}$/.test(toParam)) return null;
  if (fromParam > toParam) return null;
  const fromDate = new Date(`${fromParam}T00:00:00Z`);
  const toDate = new Date(`${toParam}T00:00:00Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  const prevEnd = new Date(fromDate.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startYmd: fromParam,
    endYmd: toParam,
    prevStartYmd: fmt(prevStart),
    prevEndYmd: fmt(prevEnd),
  };
}

interface AgencyRow {
  slug: string;
  name: string;
  rank: number;
  rankDelta: number | null;
  bhi: number | null;
  nss: number | null;
  crisis: number | null;
  crisisBand: string;
  polarization: number | null;
  engagementRate: number | null;
  totalMentions: number;
  totalReach: number;
  pos: number;
  neu: number;
  neg: number;
  display: { bhi: MetricDisplay; nss: MetricDisplay; crisis: MetricDisplay; polarization: MetricDisplay };
  deltaDisplay: { bhi: DeltaDisplay; nss: DeltaDisplay; crisis: DeltaDisplay; totalMentions: DeltaDisplay };
}

interface CompositeRow {
  bhi: number | null;
  nss: number | null;
  crisis: number | null;
  crisisBand: string;
  polarization: number | null;
  totalMentions: number;
  totalReach: number;
  display: { bhi: MetricDisplay; nss: MetricDisplay; crisis: MetricDisplay; polarization: MetricDisplay };
  deltaDisplay: { bhi: DeltaDisplay; nss: DeltaDisplay; crisis: DeltaDisplay; totalMentions: DeltaDisplay };
}

interface CrisisFeedItem {
  agencySlug: string;
  agencyName: string;
  ruleName: string;
  band: string | null;
  triggeredAt: string;
  severity: string;
}

interface TopicWave {
  agencySlug: string;
  agencyName: string;
  topicSlug: string;
  label: string;
  volume: number;
  volumeDelta: number;
  nss: number | null;
}

interface ExecOverviewResponse {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  prevPeriodStart: string;
  prevPeriodEnd: string;
  agencies: AgencyRow[];
  composite: CompositeRow;
  crisisFeed: CrisisFeedItem[];
  topicWaves: TopicWave[];
}

/** Banda de crisis → severidad (misma tabla que /api/alerts/history). */
function bandToSeverity(band: unknown): 'alta' | 'media' | 'baja' | null {
  const b = String(band ?? '').toUpperCase();
  if (b === 'CRISIS' || b === 'ALERTA') return 'alta';
  if (b === 'ELEVADO') return 'media';
  if (b === 'NORMAL') return 'baja';
  return null;
}

/**
 * Composite reach-weighted de una métrica: Σ(metric·reach) / Σ(reach). Si el
 * reach total es 0 (agencias sin alcance estimado) cae a promedio ponderado por
 * volumen de menciones; si eso también es 0, promedio simple de los no-nulos.
 */
function reachWeighted(
  rows: WindowMetrics[],
  pick: (m: WindowMetrics) => number | null,
): number | null {
  let wSum = 0;
  let vSum = 0;
  let mSum = 0;
  let mWSum = 0;
  let plain = 0;
  let plainN = 0;
  for (const m of rows) {
    const v = pick(m);
    if (v == null) continue;
    plain += v;
    plainN += 1;
    const reach = m.totalReach || 0;
    wSum += reach;
    vSum += v * reach;
    const mentions = m.totals.total || 0;
    mSum += mentions;
    mWSum += v * mentions;
  }
  if (plainN === 0) return null;
  if (wSum > 0) return vSum / wSum;
  if (mSum > 0) return mWSum / mSum;
  return plain / plainN;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = consume('exec-overview:' + clientKey(request), { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  // Gate: solo staff (ve TODAS las agencias). null === todas.
  const allowed = await resolveAllowedAgencySlugs();
  if (allowed !== null) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const start = Date.now();
  const { searchParams } = new URL(request.url);
  const periodKey = searchParams.get('period') ?? '7D';
  const customRange = parseCustomRange(searchParams.get('from'), searchParams.get('to'));
  const daysBack = customRange ? null : PERIOD_DAYS[periodKey];
  if (!customRange && !daysBack) {
    return NextResponse.json(
      { error: `Unsupported period: ${periodKey}. Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, or pass from/to.` },
      { status: 400 },
    );
  }

  try {
    const window = customRange
      ? customRange
      : closedWindowYmdInTZ(daysBack as number, new Date(), TZ);
    const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;

    // Agencias activas (id + slug) + sus nombres. listActiveAgencies solo trae
    // id/slug; el nombre lo resolvemos en un query aparte para no cambiar su
    // firma (la reusa resolveAllowedAgencySlugs).
    const active = await listActiveAgencies();
    if (active.length === 0) {
      return NextResponse.json({ error: 'No active agencies' }, { status: 404 });
    }
    const db = getDb();
    const nameRows = await db
      .select({ id: agencies.id, name: agencies.name })
      .from(agencies)
      .where(inArray(agencies.id, active.map((a) => a.id)));
    const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

    const pool = getPool() as unknown as PgClientLike;

    // Por agencia: métricas de la ventana actual + previa + reporte de tópicos.
    const perAgency = await Promise.all(
      active.map(async (a) => {
        const [cur, prev, report] = await Promise.all([
          loadMetricsForWindow(pool, a.id, startYmd, endYmd),
          loadMetricsForWindow(pool, a.id, prevStartYmd, prevEndYmd),
          buildSentimentReport(pool, a.id, startYmd, endYmd, prevStartYmd, prevEndYmd),
        ]);
        return {
          id: a.id,
          slug: a.slug,
          name: nameById.get(a.id) ?? a.slug,
          cur,
          prev,
          report,
        };
      }),
    );

    // Ranking por BHI descendente (ventana actual y previa) para el rankDelta.
    const bhiOf = (m: WindowMetrics): number => m.brandHealthIndex ?? -Infinity;
    const curRank = new Map<string, number>();
    [...perAgency]
      .sort((x, y) => bhiOf(y.cur) - bhiOf(x.cur))
      .forEach((a, i) => curRank.set(a.slug, i + 1));

    // Ranking previo: null si NINGUNA agencia tenía baseline BHI.
    const prevHasBaseline = perAgency.some((a) => a.prev.brandHealthIndex != null);
    const prevRank = new Map<string, number>();
    if (prevHasBaseline) {
      [...perAgency]
        .sort((x, y) => bhiOf(y.prev) - bhiOf(x.prev))
        .forEach((a, i) => prevRank.set(a.slug, i + 1));
    }

    const agencyRows: AgencyRow[] = perAgency
      .map((a): AgencyRow => {
        const rank = curRank.get(a.slug)!;
        const pRank = prevRank.get(a.slug);
        const rankDelta = pRank != null ? pRank - rank : null; // + = subió puestos
        const crisis = a.cur.crisisRiskScore;
        return {
          slug: a.slug,
          name: a.name,
          rank,
          rankDelta,
          bhi: a.cur.brandHealthIndex,
          nss: a.cur.nss,
          crisis,
          crisisBand: crisis != null ? crisisBand(crisis) : 'NORMAL',
          polarization: a.cur.polarizationIndex,
          engagementRate: a.cur.engagementRate,
          totalMentions: a.cur.totals.total,
          totalReach: a.cur.totalReach,
          pos: a.cur.totals.positive,
          neu: a.cur.totals.neutral,
          neg: a.cur.totals.negative,
          display: {
            bhi: formatMetric('bhi', a.cur.brandHealthIndex),
            nss: formatMetric('nss', a.cur.nss),
            crisis: formatMetric('crisis', crisis),
            polarization: formatMetric('polarization', a.cur.polarizationIndex),
          },
          deltaDisplay: {
            // BHI se compara en la escala pública 1–10 (misma que muestra la tarjeta).
            bhi: formatDelta(a.cur.brandHealthIndex, a.prev.brandHealthIndex, { kind: 'absolute', decimals: 1, suffix: '' }),
            nss: formatDelta(a.cur.nss, a.prev.nss, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
            // Crisis: la caída es lo bueno (invert). Delta en puntos 0–1.
            crisis: formatDelta(crisis, a.prev.crisisRiskScore, { kind: 'absolute', decimals: 2, suffix: ' pts', invert: true }),
            totalMentions: formatDelta(a.cur.totals.total, a.prev.totals.total, { kind: 'percent', decimals: 0 }),
          },
        };
      })
      .sort((x, y) => x.rank - y.rank);

    // ---- Composite gobierno reach-weighted (ventana actual y previa) ----
    const curMetrics = perAgency.map((a) => a.cur);
    const prevMetrics = perAgency.map((a) => a.prev);
    const compBhi = reachWeighted(curMetrics, (m) => m.brandHealthIndex);
    const compNss = reachWeighted(curMetrics, (m) => m.nss);
    const compCrisis = reachWeighted(curMetrics, (m) => m.crisisRiskScore);
    const compPol = reachWeighted(curMetrics, (m) => m.polarizationIndex);
    const compBhiPrev = reachWeighted(prevMetrics, (m) => m.brandHealthIndex);
    const compNssPrev = reachWeighted(prevMetrics, (m) => m.nss);
    const compCrisisPrev = reachWeighted(prevMetrics, (m) => m.crisisRiskScore);
    const compMentions = curMetrics.reduce((s, m) => s + m.totals.total, 0);
    const compMentionsPrev = prevMetrics.reduce((s, m) => s + m.totals.total, 0);
    const compReach = curMetrics.reduce((s, m) => s + m.totalReach, 0);

    const composite: CompositeRow = {
      bhi: compBhi,
      nss: compNss,
      crisis: compCrisis,
      crisisBand: compCrisis != null ? crisisBand(compCrisis) : 'NORMAL',
      polarization: compPol,
      totalMentions: compMentions,
      totalReach: compReach,
      display: {
        bhi: formatMetric('bhi', compBhi),
        nss: formatMetric('nss', compNss),
        crisis: formatMetric('crisis', compCrisis),
        polarization: formatMetric('polarization', compPol),
      },
      deltaDisplay: {
        bhi: formatDelta(compBhi, compBhiPrev, { kind: 'absolute', decimals: 1, suffix: '' }),
        nss: formatDelta(compNss, compNssPrev, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
        crisis: formatDelta(compCrisis, compCrisisPrev, { kind: 'absolute', decimals: 2, suffix: ' pts', invert: true }),
        totalMentions: formatDelta(compMentions, compMentionsPrev, { kind: 'percent', decimals: 0 }),
      },
    };

    // ---- Crisis feed: alert_history de TODAS las agencias activas ----
    // Generaliza /api/alerts/history quitando el filtro de agencia única.
    const activeIds = active.map((a) => a.id);
    const feedRows = await db
      .select({
        agencyId: alertHistory.agencyId,
        ruleName: alertRules.name,
        triggeredAt: alertHistory.triggeredAt,
        details: alertHistory.details,
      })
      .from(alertHistory)
      .innerJoin(alertRules, eq(alertHistory.alertRuleId, alertRules.id))
      .where(and(
        inArray(alertHistory.agencyId, activeIds),
        sql`${alertHistory.triggeredAt} >= ${startYmd + 'T00:00:00-04:00'}`,
      ))
      .orderBy(sql`${alertHistory.triggeredAt} DESC`)
      .limit(100);

    const crisisFeed: CrisisFeedItem[] = feedRows.map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (r.details as any) || {};
      const severity = bandToSeverity(d.band) ?? d.severity ?? 'media';
      return {
        agencySlug: active.find((a) => a.id === r.agencyId)?.slug ?? '',
        agencyName: nameById.get(r.agencyId) ?? '',
        ruleName: r.ruleName,
        band: d.band ?? null,
        triggeredAt: r.triggeredAt.toISOString(),
        severity,
      };
    });

    // ---- Topic waves: top-3 tópicos por agencia ----
    // NOTA: no existe una taxonomía cross-agencia real (los tópicos están
    // scoped por agencia), así que "olas" es la unión de los top-3 de cada
    // agencia, etiquetados "Nombre agencia · Tópico". No agrega tópicos
    // homónimos entre agencias — eso requeriría un mapeo canónico que hoy no
    // existe en el modelo de datos.
    const topicWaves: TopicWave[] = [];
    for (const a of perAgency) {
      const top3 = a.report.topicsTable
        .filter((t) => !t.isOther && !t.isUnclassified)
        .slice(0, 3);
      for (const t of top3) {
        const denom = t.positive + t.neutral + t.negative;
        const nss = denom > 0 ? ((t.positive - t.negative) / denom) * 100 : null;
        topicWaves.push({
          agencySlug: a.slug,
          agencyName: a.name,
          topicSlug: t.topic,
          label: `${a.name} · ${t.topic}`,
          volume: t.total,
          // secondaryCount aproxima la "cola" del tópico; no hay serie temporal
          // por-tópico en el reporte, así que volumeDelta usa 0 como neutro.
          volumeDelta: 0,
          nss: nss != null ? Number(nss.toFixed(1)) : null,
        });
      }
    }

    const response: ExecOverviewResponse = {
      periodLabel: formatPeriodLabel(startYmd, endYmd),
      periodStart: startYmd,
      periodEnd: endYmd,
      prevPeriodStart: prevStartYmd,
      prevPeriodEnd: prevEndYmd,
      agencies: agencyRows,
      composite,
      crisisFeed,
      topicWaves,
    };

    const res = NextResponse.json(response);
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('exec-overview', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json(
      { error: 'exec-overview error', message: (err as Error).message },
      { status: 500 },
    );
  } finally {
    log.info('exec-overview', 'request complete', {
      latencyMs: Date.now() - start,
      period: customRange ? 'custom' : periodKey,
    });
  }
}
