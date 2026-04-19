import { NextRequest, NextResponse } from 'next/server';
import { getDb, alertHistory, alertRules } from '@eco/database';
import { sql, eq, and } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
  '24h': 1, '7d': 7, '30d': 30, '90d': 90,
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const periodKey = searchParams.get('period') ?? '1M';
  const days = PERIOD_DAYS[periodKey] ?? 30;

  // resolveAgencyId now prefers the session-derived x-eco-user-agency header
  // over query params, so a caller can't read another tenant's history.
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not resolved' }, { status: 403 });
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

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
      ))
      .orderBy(sql`${alertHistory.triggeredAt} DESC`)
      .limit(200);

    const res = NextResponse.json({
      history: rows.map((r) => ({
        id: r.id,
        ruleName: r.ruleName,
        triggeredAt: r.triggeredAt.toISOString(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sentiment: (r.details as any)?.sentiment ?? 'neutral',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        severity: (r.details as any)?.severity ?? 'media',
        mentionIds: (r.mentionIds as string[]) ?? [],
        mentionCount: (r.mentionIds as string[])?.length ?? 0,
      })),
    });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (err) {
    log.error('alerts.history', 'query failed', { msg: (err as Error).message, agencyId });
    return NextResponse.json({ history: [] });
  }
}
