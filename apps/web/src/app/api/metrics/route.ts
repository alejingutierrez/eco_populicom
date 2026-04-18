import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { dailyMetricSnapshots } from '@eco/database';
import { sql, desc, eq, gte, and } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';

const PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') ?? '30d';
  const days = PERIOD_DAYS[period] ?? 30;

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }

  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  try {
    // Get snapshots for the period
    const snapshots = await db
      .select()
      .from(dailyMetricSnapshots)
      .where(and(
        gte(dailyMetricSnapshots.date, sinceStr),
        eq(dailyMetricSnapshots.agencyId, agencyId),
      ))
      .orderBy(desc(dailyMetricSnapshots.date));

    if (snapshots.length === 0) {
      return NextResponse.json({
        current: null,
        timeline: [],
        rollingWindows: { nss7d: null, nss30d: null },
      });
    }

    // Most recent snapshot is "current"
    const current = snapshots[0];

    // Build timeline (oldest first for charts)
    const timeline = [...snapshots].reverse().map((s) => ({
      date: s.date,
      nss: s.nss,
      brandHealthIndex: s.brandHealthIndex,
      crisisRiskScore: s.crisisRiskScore,
      engagementRate: s.engagementRate,
      amplificationRate: s.amplificationRate,
      engagementVelocity: s.engagementVelocity,
      volumeAnomalyZscore: s.volumeAnomalyZscore,
      totalMentions: s.totalMentions,
      positiveCount: s.positiveCount,
      neutralCount: s.neutralCount,
      negativeCount: s.negativeCount,
    }));

    return NextResponse.json({
      current: {
        date: current.date,
        nss: current.nss,
        brandHealthIndex: current.brandHealthIndex,
        reputationMomentum: current.reputationMomentum,
        engagementRate: current.engagementRate,
        amplificationRate: current.amplificationRate,
        engagementVelocity: current.engagementVelocity,
        crisisRiskScore: current.crisisRiskScore,
        volumeAnomalyZscore: current.volumeAnomalyZscore,
        totalMentions: current.totalMentions,
        positiveCount: current.positiveCount,
        neutralCount: current.neutralCount,
        negativeCount: current.negativeCount,
      },
      timeline,
      rollingWindows: {
        nss7d: current.nss7d,
        nss30d: current.nss30d,
      },
    });
  } catch (err) {
    console.error('Metrics API error:', err);
    return NextResponse.json(
      { error: 'Error fetching metrics data' },
      { status: 500 },
    );
  }
}
