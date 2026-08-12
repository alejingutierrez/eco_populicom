import { NextRequest, NextResponse } from 'next/server';
import { getDb, alertHistory, alertRules } from '@eco/database';
import { sql, eq, and } from 'drizzle-orm';
import { PERIOD_DAYS, ymdInTimeZone, addDaysYmd } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { requireAlertsAccess } from '@/lib/auth/require-admin';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/** Banda de crisis (la escribe metrics-calculator) → severidad alta/media/baja. */
function bandToSeverity(band: unknown): 'alta' | 'media' | 'baja' | null {
  const b = String(band ?? '').toUpperCase();
  if (b === 'CRISIS' || b === 'ALERTA') return 'alta';
  if (b === 'ELEVADO') return 'media';
  if (b === 'NORMAL') return 'baja';
  return null;
}

export async function GET(request: NextRequest) {
  // Alertas restringida por correo (ver ALERTS_ALLOWED_EMAILS).
  const gate = await requireAlertsAccess();
  if (!gate.ok) return gate.response;
  const { searchParams } = request.nextUrl;
  const periodKey = searchParams.get('period') ?? '1M';
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const limitParamRaw = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitParamRaw) && limitParamRaw > 0 ? Math.min(limitParamRaw, 500) : 200;

  // resolveAgencyId now prefers the session-derived x-eco-user-agency header
  // over query params, so a caller can't read another tenant's history.
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  }

  // Ventana en días calendario AST *incluyendo hoy*: esto es un LOG de
  // eventos operativos — ocultar la alerta de hace una hora (ventana cerrada
  // en ayer) sería peor producto. La cota inferior ancla a la medianoche AST
  // de (hoy − days + 1); antes era rolling `now − days` con la hora actual,
  // que se deslizaba intra-día (auditoría 2026-08, P1-4). from/to (YYYY-MM-DD
  // AST) se honran siempre que sean válidos — antes solo con period=custom.
  let since: Date;
  let until: Date | null = null;
  if (fromParam && toParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam) && fromParam <= toParam) {
    since = new Date(`${fromParam}T00:00:00-04:00`);
    until = new Date(`${toParam}T23:59:59.999-04:00`);
  } else {
    const days = PERIOD_DAYS[periodKey] ?? 30;
    const todayAst = ymdInTimeZone(new Date(), 'America/Puerto_Rico');
    since = new Date(`${addDaysYmd(todayAst, -(days - 1))}T00:00:00-04:00`);
  }

  const db = getDb();
  try {
    const rows = await db
      .select({
        id: alertHistory.id,
        ruleName: alertRules.name,
        triggeredAt: alertHistory.triggeredAt,
        details: alertHistory.details,
        mentionIds: alertHistory.mentionIds,
      })
      .from(alertHistory)
      .innerJoin(alertRules, eq(alertHistory.alertRuleId, alertRules.id))
      .where(and(
        eq(alertHistory.agencyId, agencyId),
        sql`${alertHistory.triggeredAt} >= ${since.toISOString()}`,
        ...(until ? [sql`${alertHistory.triggeredAt} <= ${until.toISOString()}`] : []),
      ))
      .orderBy(sql`${alertHistory.triggeredAt} DESC`)
      .limit(limit);

    const res = NextResponse.json({
      history: rows.map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = (r.details as any) || {};
        // Severidad real: las alertas de crisis escriben details.band
        // (NORMAL/ELEVADO/ALERTA/CRISIS); antes se leía details.severity (que el
        // productor no escribe) y TODO salía 'media'. Fallback a severity/legacy.
        const severity = bandToSeverity(d.band) ?? d.severity ?? 'media';
        return {
          id: r.id,
          ruleName: r.ruleName,
          triggeredAt: r.triggeredAt.toISOString(),
          sentiment: d.sentiment ?? 'neutral',
          severity,
          band: d.band ?? null,
          crisisScore: typeof d.crisis_risk_score === 'number' ? d.crisis_risk_score : null,
          headline: d?.editorial?.headline ?? null,
          mentionIds: (r.mentionIds as string[]) ?? [],
          mentionCount: (r.mentionIds as string[])?.length ?? 0,
        };
      }),
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('alerts.history', 'query failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ history: [] });
  }
}
