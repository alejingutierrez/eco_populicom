import { NextRequest, NextResponse } from 'next/server';
import { getDb, alertRules } from '@eco/database';
import { and, eq } from 'drizzle-orm';
import { resolveCallerAgencyId } from '@/lib/agency';
import { requireCapability, requireAlertsAccess } from '@/lib/auth/require-admin';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/alerts/[id] — activa o desactiva una regla de alerta.
 * Body: { isActive: boolean }
 *
 * POR QUÉ EXISTE: la pestaña "Reglas" del dashboard pintaba un toggle
 * Activa/Inactiva que solo movía estado local de React y no llamaba a nada. Se
 * veía como un control que persiste, se quedaba puesto hasta recargar y la
 * regla seguía disparando igual. No había endpoint al que llamar; este lo es.
 *
 * El UPDATE va filtrado por `agency_id` ADEMÁS de por `id`: el id de una regla
 * es un uuid que viaja al cliente, y sin ese segundo filtro un administrador de
 * una agencia podría apagar la regla de otra pasando su uuid a mano. Si no
 * casa ninguna fila devolvemos 404 sin distinguir "no existe" de "no es tuya".
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAlertsAccess();
  if (!access.ok) return access.response;
  const gate = await requireCapability('manage_alert_rules');
  if (!gate.ok) return gate.response;

  const agencyId = await resolveCallerAgencyId(request);
  if (!agencyId) {
    return NextResponse.json({ error: 'Agency not resolved for caller' }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  let body: { isActive?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive booleano requerido' }, { status: 400 });
  }

  const db = getDb();
  try {
    const [rule] = await db
      .update(alertRules)
      .set({ isActive: body.isActive, updatedAt: new Date() })
      .where(and(eq(alertRules.id, id), eq(alertRules.agencyId, agencyId)))
      .returning({ id: alertRules.id, isActive: alertRules.isActive });

    if (!rule) {
      return NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 });
    }
    return NextResponse.json({ rule });
  } catch (err) {
    log.error('alerts.PATCH', (err as Error).message, { id });
    return NextResponse.json({ error: 'No se pudo actualizar la regla' }, { status: 500 });
  }
}
