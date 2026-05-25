import { NextRequest, NextResponse } from 'next/server';
import { getDb, mentionImports, agencies } from '@eco/database';
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/mentions/import?limit=20&agencySlug=...
 *
 * Lista de imports recientes (sin preview_json para no inflar response).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get('limit') ?? 20)));
  const agencySlug = searchParams.get('agencySlug')?.trim() || null;

  const db = getDb();

  let agencyId: string | null = null;
  if (agencySlug) {
    const a = await db.select({ id: agencies.id }).from(agencies).where(eq(agencies.slug, agencySlug)).limit(1);
    agencyId = a[0]?.id ?? null;
    if (!agencyId) return NextResponse.json({ imports: [] });
  }

  // Drizzle no soporta `select except column` trivialmente — listamos lo que
  // queremos. previewJson y errorsJson se omiten (los trae el endpoint detail).
  const baseQuery = db.select({
    id: mentionImports.id,
    agencyId: mentionImports.agencyId,
    sourceType: mentionImports.sourceType,
    s3Key: mentionImports.s3Key,
    sourceUrl: mentionImports.sourceUrl,
    status: mentionImports.status,
    totalRows: mentionImports.totalRows,
    rowsNew: mentionImports.rowsNew,
    rowsDuplicate: mentionImports.rowsDuplicate,
    rowsUpdate: mentionImports.rowsUpdate,
    rowsError: mentionImports.rowsError,
    rowsProcessed: mentionImports.rowsProcessed,
    errorMessage: mentionImports.errorMessage,
    createdAt: mentionImports.createdAt,
    committedAt: mentionImports.committedAt,
    completedAt: mentionImports.completedAt,
  }).from(mentionImports);

  const rows = agencyId
    ? await baseQuery.where(eq(mentionImports.agencyId, agencyId)).orderBy(desc(mentionImports.createdAt)).limit(limit)
    : await baseQuery.orderBy(desc(mentionImports.createdAt)).limit(limit);

  return NextResponse.json({ imports: rows });
}
