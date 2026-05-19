import { NextRequest, NextResponse } from 'next/server';
import { getDb, agencies, alertRules, users } from '@eco/database';
import { and, eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/require-admin';
import type { CrisisThresholdConfig } from '@eco/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RULE_NAME_DEFAULT = 'Crisis Score · umbral';

interface ConfigBody {
  agencyId?: string;
  agencySlug?: string;
  isActive?: boolean;
  crisisMin?: number;
  severityMin?: number;
  cooldownHours?: number;
  notifyEmails?: string[];
}

/**
 * GET /api/alerts/crisis-config?agencySlug=ddecpr
 *
 * Devuelve la regla `crisis_threshold` activa de la agencia. Si no hay
 * ninguna, devuelve `config: null` para que el front muestre el formulario
 * en blanco con defaults razonables.
 */
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
  const agencyRow = agencyId
    ? await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1)
    : await db.select().from(agencies).where(eq(agencies.slug, agencySlug!)).limit(1);
  if (!agencyRow.length) return NextResponse.json({ error: 'agency not found' }, { status: 404 });
  const agency = agencyRow[0];

  // Buscamos cualquier regla del agency cuyo config.type sea crisis_threshold.
  // Usamos SQL crudo para acceder al JSONB key porque drizzle no expone helpers
  // directos para jsonb_path queries en este código base aún.
  const rules = await db.execute(sql`
    SELECT id, name, description, is_active, config, notify_emails, updated_at
      FROM alert_rules
     WHERE agency_id = ${agency.id}
       AND config->>'type' = 'crisis_threshold'
     ORDER BY created_at DESC
     LIMIT 1
  `);
  const row = (rules.rows as Array<{
    id: string;
    name: string;
    description: string | null;
    is_active: boolean;
    config: CrisisThresholdConfig;
    notify_emails: string[];
    updated_at: string | null;
  }>)[0] ?? null;

  return NextResponse.json({
    agency: { id: agency.id, slug: agency.slug, name: agency.name },
    config: row ? {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      crisisMin: row.config.crisis_min ?? 0.40,
      severityMin: row.config.severity_min ?? 0.50,
      cooldownHours: row.config.cooldown_hours ?? 12,
      notifyEmails: Array.isArray(row.notify_emails) ? row.notify_emails : [],
      updatedAt: row.updated_at,
    } : null,
    /** Defaults sugeridos cuando no hay regla; los muestra el front. */
    defaults: {
      crisisMin: 0.40,
      severityMin: 0.50,
      cooldownHours: 12,
    },
  });
}

/**
 * PUT /api/alerts/crisis-config
 *
 * Crea la regla `crisis_threshold` si no existe, o actualiza la existente
 * (en `alert_rules`). El lambda `eco-metrics-calculator` no necesita
 * cambios — ya lee las reglas en cada cron.
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: ConfigBody;
  try { body = (await request.json()) as ConfigBody; }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

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
  if (body.crisisMin != null) {
    if (typeof body.crisisMin !== 'number' || body.crisisMin < 0 || body.crisisMin > 1) {
      errors.push('crisisMin must be a number between 0 and 1');
    }
  }
  if (body.severityMin != null) {
    if (typeof body.severityMin !== 'number' || body.severityMin < 0 || body.severityMin > 1) {
      errors.push('severityMin must be a number between 0 and 1');
    }
  }
  if (body.cooldownHours != null) {
    if (!Number.isInteger(body.cooldownHours) || body.cooldownHours < 1 || body.cooldownHours > 168) {
      errors.push('cooldownHours must be integer 1–168 (max 7 days)');
    }
  }
  if (body.notifyEmails) {
    if (!Array.isArray(body.notifyEmails)) errors.push('notifyEmails must be an array');
    else {
      if (body.notifyEmails.length > 20) errors.push('notifyEmails limit is 20');
      for (const e of body.notifyEmails) {
        if (typeof e !== 'string' || !EMAIL_REGEX.test(e)) errors.push(`invalid email: ${e}`);
      }
    }
  }
  if (errors.length) return NextResponse.json({ error: 'validation', details: errors }, { status: 422 });

  // updated_by lookup (best effort).
  let updatedByUuid: string | null = null;
  if (auth.user.email) {
    const u = await db.select().from(users).where(eq(users.email, auth.user.email)).limit(1);
    updatedByUuid = u[0]?.id ?? null;
  }

  // Buscamos la regla existente
  const existing = await db.execute(sql`
    SELECT id FROM alert_rules
     WHERE agency_id = ${agency.id} AND config->>'type' = 'crisis_threshold'
     LIMIT 1
  `);
  const existingId = (existing.rows[0] as { id?: string } | undefined)?.id;

  const newConfig: CrisisThresholdConfig = {
    type: 'crisis_threshold',
    crisis_min: body.crisisMin ?? 0.40,
    severity_min: body.severityMin ?? 0.50,
    cooldown_hours: body.cooldownHours ?? 12,
  };

  if (existingId) {
    await db
      .update(alertRules)
      .set({
        ...(body.isActive != null && { isActive: body.isActive }),
        config: newConfig,
        ...(body.notifyEmails && { notifyEmails: body.notifyEmails }),
        updatedAt: new Date(),
      })
      .where(eq(alertRules.id, existingId));
  } else {
    await db.insert(alertRules).values({
      agencyId: agency.id,
      name: RULE_NAME_DEFAULT,
      description: 'Dispara correo editorial de crisis cuando el Crisis Risk Score y la severidad cruzan los umbrales configurados.',
      isActive: body.isActive ?? true,
      config: newConfig,
      notifyEmails: body.notifyEmails ?? [],
      createdBy: updatedByUuid,
    });
  }

  const fresh = await db.execute(sql`
    SELECT id, name, is_active, config, notify_emails, updated_at
      FROM alert_rules
     WHERE agency_id = ${agency.id} AND config->>'type' = 'crisis_threshold'
     LIMIT 1
  `);
  const row = (fresh.rows as Array<{
    id: string;
    name: string;
    is_active: boolean;
    config: CrisisThresholdConfig;
    notify_emails: string[];
    updated_at: string | null;
  }>)[0];

  console.log(`[alerts/crisis-config] updated by ${auth.user.email} · agency=${agency.slug}`);

  return NextResponse.json({
    agency: { id: agency.id, slug: agency.slug, name: agency.name },
    config: {
      id: row.id,
      name: row.name,
      isActive: row.is_active,
      crisisMin: row.config.crisis_min,
      severityMin: row.config.severity_min,
      cooldownHours: row.config.cooldown_hours,
      notifyEmails: row.notify_emails,
      updatedAt: row.updated_at,
    },
  });
}
