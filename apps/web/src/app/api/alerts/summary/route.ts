import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { sql } from 'drizzle-orm';
import { ymdInTimeZone, addDaysYmd } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAlertsAccess } from '@/lib/auth/require-admin';
import { log } from '@/lib/log';
import { daysOverWithoutAlert, groupEpisodes, type AlertRow } from '@/lib/alerts/summary';

export const dynamic = 'force-dynamic';

const SERIES_DAYS = 31;
const ALERTS_DAYS = 45;
const TZ = 'America/Puerto_Rico';

/**
 * GET /api/alerts/summary — todo lo que pinta la pantalla de Alertas:
 * el estado de hoy, la serie diaria de riesgo de crisis con los días de
 * aviso, los avisos agrupados por episodio y las reglas con sus disparos.
 *
 * Ventanas FIJAS (31 días de serie, 45 de avisos), independientes del selector
 * de periodo: esta pantalla es un registro de operación, no un análisis.
 * La agencia se resuelve con `resolveAgencyId` (el selector, dentro de las
 * agencias del usuario).
 */
export async function GET(request: NextRequest) {
  const gate = await requireAlertsAccess();
  if (!gate.ok) return gate.response;
  const agencyId = await resolveAgencyId(request.nextUrl.searchParams);
  if (!agencyId) return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });

  const today = ymdInTimeZone(new Date(), TZ);
  const seriesFrom = addDaysYmd(today, -(SERIES_DAYS - 1));
  const db = getDb();
  try {
    const [seriesRes, alertsRes, rulesRes, episodeRes] = await Promise.all([
      db.execute(sql`
        SELECT to_char(date, 'YYYY-MM-DD') AS date, crisis_risk_score AS score,
               total_mentions AS total, negative_count AS negative
          FROM daily_metric_snapshots
         WHERE agency_id = ${agencyId} AND date BETWEEN ${seriesFrom}::date AND ${today}::date
         ORDER BY date`),
      db.execute(sql`
        SELECT h.id, h.triggered_at, h.details, h.mention_ids,
               r.id AS rule_id, r.name AS rule_name, r.config->>'type' AS rule_type
          FROM alert_history h
          JOIN alert_rules r ON r.id = h.alert_rule_id
         WHERE h.agency_id = ${agencyId}
           AND h.triggered_at > NOW() - (${ALERTS_DAYS}::int * INTERVAL '1 day')
         ORDER BY h.triggered_at DESC
         LIMIT 300`),
      db.execute(sql`
        SELECT r.id, r.name, r.description, r.is_active, r.config,
               jsonb_array_length(COALESCE(r.notify_emails, '[]'::jsonb)) AS notify_count,
               (SELECT COUNT(*) FROM alert_history h
                 WHERE h.alert_rule_id = r.id AND h.triggered_at > NOW() - INTERVAL '30 days')::int AS fired_30d,
               (SELECT MAX(h.triggered_at) FROM alert_history h WHERE h.alert_rule_id = r.id) AS last_fired
          FROM alert_rules r
         WHERE r.agency_id = ${agencyId}
         ORDER BY (r.config->>'type' = 'crisis_threshold') DESC, r.created_at DESC
         LIMIT 50`),
      // La tabla la crea eco-metrics-calculator; si aún no existe, sin episodio.
      db.execute(sql`
        SELECT to_char(opened_day, 'YYYY-MM-DD') AS opened_day, opened_at, alerts_sent, peak_score
          FROM crisis_episodes
         WHERE agency_id = ${agencyId} AND closed_at IS NULL
         ORDER BY opened_at DESC LIMIT 1`).catch(() => ({ rows: [] as unknown[] })),
    ]);

    const num = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
    const series = (seriesRes.rows as Array<Record<string, unknown>>).map((r) => ({
      date: String(r.date),
      score: num(r.score),
      total: num(r.total) ?? 0,
      negative: num(r.negative) ?? 0,
    }));
    const dailyScores = new Map<string, number>();
    for (const p of series) if (p.score != null) dailyScores.set(p.date, p.score);

    const alerts: AlertRow[] = (alertsRes.rows as Array<Record<string, unknown>>).map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (r.details as any) || {};
      const at = new Date(r.triggered_at as string).toISOString();
      const sentList = Array.isArray(d.recipients_sent) ? d.recipients_sent : null;
      return {
        id: String(r.id),
        at,
        day: typeof d.trigger_day === 'string' ? d.trigger_day : ymdInTimeZone(new Date(at), TZ),
        ruleId: String(r.rule_id),
        ruleName: String(r.rule_name),
        ruleType: (r.rule_type as string | null) ?? null,
        band: typeof d.band === 'string' ? d.band : null,
        score: num(d.crisis_risk_score),
        total: num(d.total_mentions),
        negative: num(d.negative_count),
        headline: d?.editorial?.headline ?? null,
        sent: sentList ? sentList.length : null,
        mentionIds: Array.isArray(r.mention_ids) ? (r.mention_ids as string[]) : [],
      };
    });

    const rules = (rulesRes.rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      description: (r.description as string | null) ?? null,
      isActive: r.is_active === true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      config: (r.config as any) ?? {},
      notifyCount: num(r.notify_count) ?? 0,
      fired30d: num(r.fired_30d) ?? 0,
      lastFiredAt: r.last_fired ? new Date(r.last_fired as string).toISOString() : null,
    }));
    const crisisRule = rules.find((r) => r.config?.type === 'crisis_threshold') ?? null;
    const threshold = num(crisisRule?.config?.crisis_min) ?? 0.4;

    const open = (episodeRes.rows as Array<Record<string, unknown>>)[0] ?? null;
    // Solo los avisos de crisis forman episodios; los de otras reglas van sueltos.
    const crisisAlerts = alerts.filter((a) => a.band != null);
    const episodes = groupEpisodes(crisisAlerts, dailyScores, { openFromDay: open ? String(open.opened_day) : null });
    const todayPoint = series.find((p) => p.date === today) ?? null;

    const res = NextResponse.json({
      today,
      threshold,
      now: {
        score: todayPoint?.score ?? null,
        total: todayPoint?.total ?? 0,
        negative: todayPoint?.negative ?? 0,
        openEpisode: open
          ? { openedDay: String(open.opened_day), openedAt: new Date(open.opened_at as string).toISOString(), alertsSent: num(open.alerts_sent) ?? 1, peakScore: num(open.peak_score) }
          : null,
      },
      series: series.map((p) => ({ ...p, alerted: crisisAlerts.some((a) => a.day === p.date) })),
      overWithoutAlert: daysOverWithoutAlert(series, new Set(crisisAlerts.map((a) => a.day)), threshold, today),
      alerts: alerts.map((a) => ({ ...a, closedScore: dailyScores.get(a.day) ?? null })),
      episodes,
      otherAlertIds: alerts.filter((a) => a.band == null).map((a) => a.id),
      alerts30d: crisisAlerts.filter((a) => a.day >= addDaysYmd(today, -29)).length,
      lastAlertAt: alerts[0]?.at ?? null,
      crisisRecipients: crisisRule?.notifyCount ?? 0,
      rules,
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('alerts.summary', (err as Error).message, { agencyId });
    return NextResponse.json({ error: 'No se pudo cargar el resumen de alertas' }, { status: 500 });
  }
}
