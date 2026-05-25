import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getDb, agencies, mentionImports, users } from '@eco/database';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IMPORT_PREVIEW_FUNCTION = process.env.IMPORT_PREVIEW_FUNCTION ?? 'eco-import-preview';

const lambda = new LambdaClient({});

interface UrlImportBody {
  url?: string;
  agencySlug?: string;
  defaultTimezone?: string;
}

/**
 * POST /api/admin/mentions/import/url
 * Body: { url, agencySlug, defaultTimezone? }
 *
 * Crea un mention_imports con sourceType='url', dispara el preview lambda
 * (que llama al scraper) y retorna { importId }. El UX es el mismo que el
 * file upload (poll + commit) para consistencia y porque scraping puede
 * tomar 10-30s — async desde el principio evita ALB timeouts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: UrlImportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const url = (body.url ?? '').trim();
  const agencySlug = (body.agencySlug ?? '').trim();
  const defaultTimezone = (body.defaultTimezone ?? 'America/Puerto_Rico').trim();

  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (!agencySlug) return NextResponse.json({ error: 'agencySlug required' }, { status: 400 });

  // Sanity check: parsea como URL absoluta
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return NextResponse.json({ error: 'only http/https URLs allowed' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'invalid URL' }, { status: 400 });
  }

  const db = getDb();
  const agencyRow = await db.select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, agencySlug))
    .limit(1);
  if (!agencyRow.length) {
    return NextResponse.json({ error: 'agency not found' }, { status: 404 });
  }
  const agencyId = agencyRow[0].id;

  let uploadedByUserId: string | null = null;
  if (auth.user.sub) {
    const userRow = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.cognitoSub, auth.user.sub))
      .limit(1);
    uploadedByUserId = userRow[0]?.id ?? null;
  }

  const importId = randomUUID();

  await db.insert(mentionImports).values({
    id: importId,
    agencyId,
    uploadedByUserId,
    sourceType: 'url',
    sourceUrl: url,
    status: 'pending',
    defaultTimezone,
  });

  try {
    await lambda.send(new InvokeCommand({
      FunctionName: IMPORT_PREVIEW_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ importId })),
    }));
  } catch (err) {
    await db.update(mentionImports)
      .set({ status: 'failed', errorMessage: `Lambda invoke failed: ${(err as Error).message}` })
      .where(eq(mentionImports.id, importId));
    return NextResponse.json({ error: 'failed to dispatch preview', importId }, { status: 500 });
  }

  return NextResponse.json({ importId, status: 'pending' }, { status: 202 });
}
