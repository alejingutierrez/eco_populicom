import { NextRequest, NextResponse } from 'next/server';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { getDb, mentionImports } from '@eco/database';
import { eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { ImportPreviewRow, ManualMentionInput } from '@eco/database';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const INGESTION_QUEUE_URL = process.env.INGESTION_QUEUE_URL!;
const sqs = new SQSClient({});

/**
 * POST /api/admin/mentions/import/[id]/commit
 *
 * Despacha las filas 'new' y 'update' a SQS (ingestion queue), donde el
 * processor las consume y persiste. Las 'duplicate' y 'error' no se envían.
 *
 * Idempotente: si status ya es 'committing' o 'completed', responde 409.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const db = getDb();

  const row = await db.select({
    id: mentionImports.id,
    agencyId: mentionImports.agencyId,
    sourceType: mentionImports.sourceType,
    status: mentionImports.status,
    previewJson: mentionImports.previewJson,
    rowsNew: mentionImports.rowsNew,
    rowsUpdate: mentionImports.rowsUpdate,
  })
    .from(mentionImports)
    .where(eq(mentionImports.id, id))
    .limit(1);

  if (!row.length) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const imp = row[0];

  if (imp.status !== 'preview_ready') {
    return NextResponse.json({
      error: `commit only allowed when status='preview_ready' (current: ${imp.status})`,
    }, { status: 409 });
  }

  const preview = (imp.previewJson ?? []) as ImportPreviewRow[];
  const toDispatch = preview.filter((r) =>
    (r.status === 'new' || r.status === 'update') && r.mention,
  );

  if (toDispatch.length === 0) {
    // Nada que despachar — marcar completed inmediatamente.
    await db.update(mentionImports)
      .set({
        status: 'completed',
        committedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(mentionImports.id, id));
    return NextResponse.json({ dispatched: 0, status: 'completed' });
  }

  // Transición a 'committing' (locking suave contra doble click).
  const upd = await db.update(mentionImports)
    .set({ status: 'committing', committedAt: new Date() })
    .where(sql`${mentionImports.id} = ${id} AND ${mentionImports.status} = 'preview_ready'`)
    .returning({ id: mentionImports.id });
  if (upd.length === 0) {
    return NextResponse.json({ error: 'concurrent commit; retry' }, { status: 409 });
  }

  // Despacho SQS batch (max 10 messages por batch)
  const source = imp.sourceType === 'excel' ? 'manual_excel' : 'manual_url';
  let dispatched = 0;
  for (let i = 0; i < toDispatch.length; i += 10) {
    const chunk = toDispatch.slice(i, i + 10);
    const entries = chunk.map((r, idx) => ({
      Id: `r${i + idx}`, // unique within batch
      MessageBody: JSON.stringify({
        __source: source,
        sourceImportId: id,
        agencyId: imp.agencyId,
        mention: r.mention as ManualMentionInput,
      }),
    }));
    try {
      await sqs.send(new SendMessageBatchCommand({
        QueueUrl: INGESTION_QUEUE_URL,
        Entries: entries,
      }));
      dispatched += chunk.length;
    } catch (err) {
      console.error('SQS batch send failed:', err);
      await db.update(mentionImports)
        .set({
          status: 'failed',
          errorMessage: `SQS dispatch failed at chunk ${i}: ${(err as Error).message}`,
        })
        .where(eq(mentionImports.id, id));
      return NextResponse.json({ error: 'SQS dispatch failed', dispatched }, { status: 500 });
    }
  }

  return NextResponse.json({ dispatched, status: 'committing' });
}
