import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getDb, agencies, mentionImports, users } from '@eco/database';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Next.js routes default cap es 4MB para body. Excels grandes pueden pasar.
// El cap funcional lo enforce el handler abajo (20 MB).
export const maxDuration = 60;

const IMPORTS_BUCKET = process.env.IMPORTS_BUCKET ?? 'eco-exports';
const IMPORT_PREVIEW_FUNCTION = process.env.IMPORT_PREVIEW_FUNCTION ?? 'eco-import-preview';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_EXT = ['xlsx', 'xls', 'csv'];

const s3 = new S3Client({});
const lambda = new LambdaClient({});

/**
 * POST /api/admin/mentions/import/file
 * Content-Type: multipart/form-data
 * Body: file=<File>, agencySlug=<slug>, defaultTimezone?=<tz>
 *
 * 1. Valida tamaño + extensión
 * 2. PutObject S3 (imports/<agencySlug>/<uuid>.<ext>)
 * 3. INSERT mention_imports (status='pending')
 * 4. Invoke async eco-import-preview con { importId }
 * 5. Retorna { importId } — el frontend hace polling a /api/admin/mentions/import/[id]
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const file = form.get('file');
  const agencySlug = String(form.get('agencySlug') ?? '').trim();
  const defaultTimezone = String(form.get('defaultTimezone') ?? 'America/Puerto_Rico').trim();

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  if (!agencySlug) {
    return NextResponse.json({ error: 'agencySlug required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file too large (max ${MAX_BYTES} bytes)` }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'file is empty' }, { status: 400 });
  }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: `extension not allowed (use ${ALLOWED_EXT.join(', ')})` }, { status: 400 });
  }

  const db = getDb();

  // Resuelve agency_id desde slug
  const agencyRow = await db.select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.slug, agencySlug))
    .limit(1);
  if (!agencyRow.length) {
    return NextResponse.json({ error: 'agency not found' }, { status: 404 });
  }
  const agencyId = agencyRow[0].id;

  // user.sub → users.id (lookup)
  let uploadedByUserId: string | null = null;
  if (auth.user.sub) {
    const userRow = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.cognitoSub, auth.user.sub))
      .limit(1);
    uploadedByUserId = userRow[0]?.id ?? null;
  }

  const importId = randomUUID();
  const s3Key = `imports/${agencySlug}/${importId}.${ext}`;

  // Upload to S3
  const bytes = new Uint8Array(await file.arrayBuffer());
  await s3.send(new PutObjectCommand({
    Bucket: IMPORTS_BUCKET,
    Key: s3Key,
    Body: bytes,
    ContentType: file.type || 'application/octet-stream',
    Metadata: {
      'agency-slug': agencySlug,
      'uploaded-by': auth.user.email ?? auth.user.sub,
      'original-filename': file.name.slice(0, 200),
    },
  }));

  // INSERT mention_imports
  await db.insert(mentionImports).values({
    id: importId,
    agencyId,
    uploadedByUserId,
    sourceType: 'excel',
    s3Key,
    status: 'pending',
    defaultTimezone,
  });

  // Trigger preview lambda async (InvocationType=Event)
  try {
    await lambda.send(new InvokeCommand({
      FunctionName: IMPORT_PREVIEW_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ importId })),
    }));
  } catch (err) {
    // No bloqueante — la lambda puede invocarse después manualmente. Pero
    // sí marcamos failed para que el UI muestre el problema.
    await db.update(mentionImports)
      .set({ status: 'failed', errorMessage: `Lambda invoke failed: ${(err as Error).message}` })
      .where(eq(mentionImports.id, importId));
    return NextResponse.json({ error: 'failed to dispatch preview', importId }, { status: 500 });
  }

  return NextResponse.json({ importId, status: 'pending' }, { status: 202 });
}
