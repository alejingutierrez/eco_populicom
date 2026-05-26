import { NextRequest, NextResponse } from 'next/server';
import { getDb, mentionImports } from '@eco/database';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { ImportPreviewRow } from '@eco/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/mentions/import/[id]/preview?status=new|duplicate|update|error&limit=100&offset=0
 *
 * Devuelve preview_json paginado, opcionalmente filtrado por status.
 * Para 1280 filas no podemos volcar todo de una.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status');
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') ?? 100)));
  const offset = Math.max(0, Number(searchParams.get('offset') ?? 0));

  const db = getDb();
  const row = await db.select({ previewJson: mentionImports.previewJson })
    .from(mentionImports)
    .where(eq(mentionImports.id, id))
    .limit(1);

  if (!row.length) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const all = (row[0].previewJson ?? []) as ImportPreviewRow[];
  const filtered = statusFilter
    ? all.filter((r) => r.status === statusFilter)
    : all;
  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);

  return NextResponse.json({ total, limit, offset, rows: slice });
}
