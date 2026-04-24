import { NextRequest, NextResponse } from 'next/server';
import { getDb, agencies, reportConfigs, users } from '@eco/database';
import { eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KNOWN_TIMEZONES = new Set([
  'America/Bogota', 'America/Puerto_Rico', 'America/New_York',
  'America/Mexico_City', 'America/Lima', 'America/Santiago',
  'America/Argentina/Buenos_Aires', 'UTC',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ConfigBody {
  agencyId?: string;
  agencySlug?: string;
  isActive?: boolean;
  sendHourLocal?: number;
  timezone?: string;
  templateKey?: string;
  recipients?: string[];
  fromEmail?: string;
  fromName?: string;
}

/** GET /api/reports/config?agencyId=uuid  OR  ?agencySlug=ddecpr */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const agencyId = searchParams.get('agencyId');
  const agencySlug = searchParams.get('agencySlug');
  if (!agencyId && !agencySlug) {
    return NextResponse.json({ error: 'agencyId or agencySlug required' }, { status: 400 });
  }

  const db = getDb();

  // Resolvemos agencia
  const agencyRow = agencyId
    ? await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1)
    : await db.select().from(agencies).where(eq(agencies.slug, agencySlug!)).limit(1);

  if (!agencyRow.length) return NextResponse.json({ error: 'agency not found' }, { status: 404 });
  const agency = agencyRow[0];

  const cfgRow = await db.select().from(reportConfigs).where(eq(reportConfigs.agencyId, agency.id)).limit(1);
  const cfg = cfgRow[0] ?? null;

  return NextResponse.json({
    agency: { id: agency.id, slug: agency.slug, name: agency.name },
    config: cfg ? {
      agencyId: cfg.agencyId,
      isActive: cfg.isActive,
      sendHourLocal: cfg.sendHourLocal,
      timezone: cfg.timezone,
      templateKey: cfg.templateKey,
      recipients: cfg.recipients ?? [],
      fromEmail: cfg.fromEmail,
      fromName: cfg.fromName,
      updatedAt: cfg.updatedAt,
    } : null,
  });
}

/** PUT /api/reports/config  (crea o actualiza) */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: ConfigBody;
  try { body = (await request.json()) as ConfigBody; }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  // Resolver agency
  const db = getDb();
  let agencyRow;
  if (body.agencyId) {
    agencyRow = await db.select().from(agencies).where(eq(agencies.id, body.agencyId)).limit(1);
  } else if (body.agencySlug) {
    agencyRow = await db.select().from(agencies).where(eq(agencies.slug, body.agencySlug)).limit(1);
  } else {
    return NextResponse.json({ error: 'agencyId or agencySlug required' }, { status: 400 });
  }
  if (!agencyRow?.length) return NextResponse.json({ error: 'agency not found' }, { status: 404 });
  const agency = agencyRow[0];

  // Validación
  const errors: string[] = [];
  if (body.sendHourLocal != null && (!Number.isInteger(body.sendHourLocal) || body.sendHourLocal < 0 || body.sendHourLocal > 23)) {
    errors.push('sendHourLocal must be integer 0–23');
  }
  if (body.timezone && !KNOWN_TIMEZONES.has(body.timezone)) {
    errors.push(`timezone must be one of: ${[...KNOWN_TIMEZONES].join(', ')}`);
  }
  if (body.recipients) {
    if (!Array.isArray(body.recipients)) errors.push('recipients must be an array');
    else {
      if (body.recipients.length > 20) errors.push('recipients limit is 20');
      for (const e of body.recipients) {
        if (typeof e !== 'string' || !EMAIL_REGEX.test(e)) errors.push(`invalid email: ${e}`);
      }
    }
  }
  if (body.fromEmail && !EMAIL_REGEX.test(body.fromEmail)) errors.push('fromEmail invalid');
  if (body.fromName && body.fromName.length > 120) errors.push('fromName too long');
  if (body.templateKey && body.templateKey !== 'weekly-sentiment-summary') {
    errors.push('unknown templateKey');
  }
  if (errors.length) return NextResponse.json({ error: 'validation', details: errors }, { status: 422 });

  // Buscar o crear usuario (updated_by) — tolerante si no existe aún en tabla users
  let updatedByUuid: string | null = null;
  if (auth.user.email) {
    const u = await db.select().from(users).where(eq(users.email, auth.user.email)).limit(1);
    updatedByUuid = u[0]?.id ?? null;
  }

  // Upsert
  const now = new Date();
  const existing = await db.select().from(reportConfigs).where(eq(reportConfigs.agencyId, agency.id)).limit(1);
  if (existing.length) {
    await db.update(reportConfigs)
      .set({
        ...(body.isActive != null && { isActive: body.isActive }),
        ...(body.sendHourLocal != null && { sendHourLocal: body.sendHourLocal }),
        ...(body.timezone && { timezone: body.timezone }),
        ...(body.templateKey && { templateKey: body.templateKey }),
        ...(body.recipients && { recipients: body.recipients }),
        ...(body.fromEmail && { fromEmail: body.fromEmail }),
        ...(body.fromName && { fromName: body.fromName }),
        updatedBy: updatedByUuid,
        updatedAt: now,
      })
      .where(eq(reportConfigs.agencyId, agency.id));
  } else {
    await db.insert(reportConfigs).values({
      agencyId: agency.id,
      isActive: body.isActive ?? true,
      sendHourLocal: body.sendHourLocal ?? 16,
      timezone: body.timezone ?? 'America/Bogota',
      templateKey: body.templateKey ?? 'weekly-sentiment-summary',
      recipients: body.recipients ?? [],
      fromEmail: body.fromEmail ?? 'agutierrez@populicom.com',
      fromName: body.fromName ?? 'Populicom Radar',
      updatedBy: updatedByUuid,
      createdAt: now,
      updatedAt: now,
    });
  }

  const freshRow = await db.select().from(reportConfigs).where(eq(reportConfigs.agencyId, agency.id)).limit(1);
  const fresh = freshRow[0]!;

  console.log(`[reports/config] updated by ${auth.user.email} · agency=${agency.slug}`);

  return NextResponse.json({
    agency: { id: agency.id, slug: agency.slug, name: agency.name },
    config: {
      agencyId: fresh.agencyId,
      isActive: fresh.isActive,
      sendHourLocal: fresh.sendHourLocal,
      timezone: fresh.timezone,
      templateKey: fresh.templateKey,
      recipients: fresh.recipients ?? [],
      fromEmail: fresh.fromEmail,
      fromName: fresh.fromName,
      updatedAt: fresh.updatedAt,
    },
  });
}
