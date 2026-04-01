import { NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { alertHistory, alertRules } from '@eco/database';
import { sql, eq } from 'drizzle-orm';

export async function GET() {
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
