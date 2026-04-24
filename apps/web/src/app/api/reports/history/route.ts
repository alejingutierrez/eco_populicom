import { NextRequest, NextResponse } from 'next/server';
import { getDb, agencies, reportSendLog } from '@eco/database';
import { and, desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/reports/history?agencyId=…|agencySlug=…&limit=14
 * Devuelve los últimos envíos de reporte para una agencia.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const agencyId = searchParams.get('agencyId');
  const agencySlug = searchParams.get('agencySlug');
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 14), 1), 100);

  const db = getDb();
  let agencyRow;
  if (agencyId) {
    agencyRow = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  } else if (agencySlug) {
    agencyRow = await db.select().from(agencies).where(eq(agencies.slug, agencySlug)).limit(1);
  } else {
    return NextResponse.json({ error: 'agencyId or agencySlug required' }, { status: 400 });
  }
  if (!agencyRow?.length) return NextResponse.json({ error: 'agency not found' }, { status: 404 });
  const agency = agencyRow[0];

  const rows = await db
    .select()
    .from(reportSendLog)
    .where(eq(reportSendLog.agencyId, agency.id))
    .orderBy(desc(reportSendLog.sentAt))
    .limit(limit);

  return NextResponse.json({
    agency: { id: agency.id, slug: agency.slug, name: agency.name },
    history: rows.map((r) => ({
      id: r.id,
      sentAt: r.sentAt,
      recipients: r.recipients ?? [],
      fromEmail: r.fromEmail,
      templateKey: r.templateKey,
      trigger: r.trigger,
      status: r.status,
      messageId: r.messageId,
      error: r.error,
      stats: r.stats,
    })),
  });
}
