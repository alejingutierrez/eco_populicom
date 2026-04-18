import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { alertHistory, alertRules } from '@eco/database';
import { sql, eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

export async function GET(request: NextRequest) {
  const db = getDb();

  const agencyId = await resolveAgencyId(request.nextUrl.searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

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
      .where(eq(alertHistory.agencyId, agencyId))
      .orderBy(sql`${alertHistory.triggeredAt} DESC`)
      .limit(50);

    return NextResponse.json({
      history: rows.map((r) => ({
        id: r.id,
        ruleName: r.ruleName,
        triggeredAt: r.triggeredAt.toISOString(),
        sentiment: (r.details as any)?.sentiment ?? 'neutral',
        mentionCount: (r.mentionIds as string[])?.length ?? 0,
      })),
    });
  } catch (err) {
    console.error('Alert history error:', err);
    return NextResponse.json({ history: [] });
  }
}
