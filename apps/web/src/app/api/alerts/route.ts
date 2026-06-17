import { NextRequest, NextResponse } from 'next/server';
import { getDb, alertRules, agencies } from '@eco/database';
import { sql, eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { requireCapability } from '@/lib/auth/require-admin';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const KNOWN_CONFIG_TYPES = new Set(['metric_threshold', 'crisis_threshold', 'volume_spike', 'negative_sentiment', 'keyword']);
const METRIC_KEYS = new Set(['crisis', 'bhi', 'polarization', 'engagement_velocity', 'volume_anomaly']);

/** Valida la forma de config para que NO se persistan reglas que ningún
 *  evaluador puede disparar (antes el editor guardaba config sin `type` → la
 *  regla nunca disparaba y aparecía como "Activa" para siempre). */
function validateAlertConfig(cfg: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  const type = cfg?.type;
  if (typeof type !== 'string' || !KNOWN_CONFIG_TYPES.has(type)) {
    return { ok: false, error: 'config.type inválido o ausente' };
  }
  if (type === 'metric_threshold') {
    if (typeof cfg.metric !== 'string' || !METRIC_KEYS.has(cfg.metric)) return { ok: false, error: 'metric inválida' };
    if (cfg.comparator !== 'gte' && cfg.comparator !== 'lte') return { ok: false, error: 'comparator debe ser gte|lte' };
    if (typeof cfg.threshold !== 'number' || !Number.isFinite(cfg.threshold)) return { ok: false, error: 'threshold numérico requerido' };
  }
  return { ok: true };
}

/** Resolve the agency the authenticated caller is allowed to act on. Prefers
 *  the slug pinned to their Cognito claims (header set by middleware); falls
 *  back to the URL param for read-only GETs. Never trusts body.agencyId. */
async function resolveCallerAgencyId(request: NextRequest): Promise<string | null> {
  const sessionSlug = request.headers.get('x-eco-user-agency');
  if (sessionSlug) {
    const db = getDb();
    const [row] = await db
      .select({ id: agencies.id })
      .from(agencies)
      .where(eq(agencies.slug, sessionSlug))
      .limit(1);
    if (row?.id) return row.id;
  }
  return resolveAgencyId(request.nextUrl.searchParams);
}

export async function GET(request: NextRequest) {
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
  }
  const db = getDb();
  try {
    const rules = await db
      .select()
      .from(alertRules)
      .where(eq(alertRules.agencyId, agencyId))
      .orderBy(sql`${alertRules.createdAt} DESC`);
    return NextResponse.json({
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        config: r.config,
        notifyEmails: r.notifyEmails,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    log.error('alerts.GET', (err as Error).message);
    return NextResponse.json({ rules: [] });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability('manage_alert_rules');
  if (!gate.ok) return gate.response;
  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not resolved for caller' }, { status: 403 });
  }
  let body: {
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
    notifyEmails?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!body.config || typeof body.config !== 'object') {
    return NextResponse.json({ error: 'config object is required' }, { status: 400 });
  }
  const cfgCheck = validateAlertConfig(body.config);
  if (!cfgCheck.ok) {
    return NextResponse.json({ error: cfgCheck.error }, { status: 422 });
  }
  const notifyEmails = Array.isArray(body.notifyEmails)
    ? body.notifyEmails.filter((s) => typeof s === 'string' && /.+@.+\..+/.test(s))
    : [];
  const db = getDb();
  try {
    const [rule] = await db
      .insert(alertRules)
      .values({
        agencyId, // trusted: from session header, not body
        name: body.name.trim(),
        description: body.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: body.config as any,
        notifyEmails,
      })
      .returning();
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    log.error('alerts.POST', (err as Error).message, { name: body?.name });
    return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });
  }
}
