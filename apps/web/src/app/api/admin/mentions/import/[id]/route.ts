import { NextRequest, NextResponse } from 'next/server';
import { getDb, mentionImports } from '@eco/database';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/mentions/import/[id]
 *
 * Detalle de un import — counters + status. NO incluye preview_json
 * (paginado en /preview). NO incluye errors_json (paginado en /errors).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const db = getDb();

  const row = await db.select({
    id: mentionImports.id,
    agencyId: mentionImports.agencyId,
    uploadedByUserId: mentionImports.uploadedByUserId,
    sourceType: mentionImports.sourceType,
    sourceUrl: mentionImports.sourceUrl,
    s3Key: mentionImports.s3Key,
    status: mentionImports.status,
    totalRows: mentionImports.totalRows,
    rowsNew: mentionImports.rowsNew,
    rowsDuplicate: mentionImports.rowsDuplicate,
    rowsUpdate: mentionImports.rowsUpdate,
    rowsError: mentionImports.rowsError,
    rowsProcessed: mentionImports.rowsProcessed,
    errorMessage: mentionImports.errorMessage,
    defaultTimezone: mentionImports.defaultTimezone,
    createdAt: mentionImports.createdAt,
    committedAt: mentionImports.committedAt,
    completedAt: mentionImports.completedAt,
  })
    .from(mentionImports)
    .where(eq(mentionImports.id, id))
    .limit(1);

  if (!row.length) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json(row[0]);
}
