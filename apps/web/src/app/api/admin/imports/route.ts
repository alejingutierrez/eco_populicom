import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getDb } from '@eco/database';
import { sql } from 'drizzle-orm';
import { requireCapability } from '@/lib/auth/require-admin';
import {
  RAW_BUCKET, forbidAgency, importToJson, invokeImport, listImportableAgencies, tableExists,
} from '@/lib/imports';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const s3 = new S3Client({});
/** El exporte más grande hasta hoy (3,766 filas) pesó ~1.5 MB. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * GET /api/admin/imports?agencySlug=df
 * Agencias que aceptan importaciones + las últimas 20 importaciones de la
 * agencia pedida (o de todas las importables si no se pide ninguna).
 */
export async function GET(request: NextRequest) {
  const gate = await requireCapability('import_mentions');
  if (!gate.ok) return gate.response;
  const agencies = await listImportableAgencies();
  const slug = request.nextUrl.searchParams.get('agencySlug');
  const slugs = slug ? agencies.filter((a) => a.slug === slug).map((a) => a.slug) : agencies.map((a) => a.slug);
  let imports: ReturnType<typeof importToJson>[] = [];
  if (slugs.length && (await tableExists())) {
    const res = await getDb().execute(sql`
      SELECT * FROM mention_import_jobs
       WHERE agency_slug IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
         AND status <> 'discarded'
       ORDER BY created_at DESC LIMIT 20`);
    const rows = (Array.isArray(res) ? res : (res as { rows: Record<string, unknown>[] }).rows) as Record<string, unknown>[];
    imports = rows.map(importToJson);
  }
  return NextResponse.json({ agencies, imports });
}

/**
 * POST /api/admin/imports  (multipart: file, agencySlug)
 * Guarda el exporte en S3 y pide la vista previa a eco-mention-import: no
 * encola nada todavía. Devuelve la importación en estado `preview` con el
 * resumen (nuevas / ya cargadas / repetidas).
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Envía el archivo como multipart/form-data' }, { status: 400 });
  }
  const agencySlug = String(form.get('agencySlug') ?? '');
  const file = form.get('file');
  const gate = await requireCapability('import_mentions');
  if (!gate.ok) return gate.response;
  const denied = await forbidAgency(agencySlug || null);
  if (denied) return denied;
  if (!agencySlug) return NextResponse.json({ error: 'Falta la agencia' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: 'El archivo debe ser un .xlsx (exporte de Bunker)' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: `El archivo debe pesar entre 1 byte y ${MAX_BYTES / 1024 / 1024} MB` }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  // Un xlsx es un zip: «PK». Corta antes de subir cualquier otra cosa a S3.
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
    return NextResponse.json({ error: 'El archivo no es un .xlsx válido' }, { status: 400 });
  }
  const safeName = file.name.replace(/[^\w.\- ()]+/g, '_').slice(-120);
  const key = `bunker/${agencySlug}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: RAW_BUCKET, Key: key, Body: buf,
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    const out = await invokeImport({
      action: 'preview', s3Key: key, agencySlug, fileName: file.name, uploadedBy: gate.user.email ?? null,
    });
    if (out.error || !out.import) return NextResponse.json({ error: out.error ?? 'Sin vista previa' }, { status: 422 });
    log.info('imports', 'preview', { agencySlug, key, by: gate.user.email });
    return NextResponse.json({ import: importToJson(out.import) });
  } catch (err) {
    log.error('imports', 'preview failed', { agencySlug, error: (err as Error)?.message });
    return NextResponse.json({ error: (err as Error)?.message ?? 'No se pudo preparar la importación' }, { status: 500 });
  }
}
