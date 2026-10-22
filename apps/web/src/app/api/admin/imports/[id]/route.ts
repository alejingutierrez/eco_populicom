import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/auth/require-admin';
import { forbidAgency, getImportRow, importToJson, invokeImport } from '@/lib/imports';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/imports/:id — estado y avance (la pantalla lo consulta cada pocos segundos). */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireCapability('import_mentions');
  if (!gate.ok) return gate.response;
  const row = await getImportRow(id);
  const denied = await forbidAgency(row ? String(row.agency_slug) : null);
  if (denied) return denied;
  if (!row) return NextResponse.json({ error: 'No existe esa importación' }, { status: 404 });
  return NextResponse.json({ import: importToJson(row) });
}

/**
 * POST /api/admin/imports/:id  { action: 'start' | 'discard' | 'resume' }
 *   start   confirma la vista previa: rehace el plan y arranca el ETL.
 *   discard descarta la vista previa (no se encoló nada).
 *   resume  relanza una importación que lleva 5 min sin avanzar.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const gate = await requireCapability('import_mentions');
  if (!gate.ok) return gate.response;
  const row = await getImportRow(id);
  const denied = await forbidAgency(row ? String(row.agency_slug) : null);
  if (denied) return denied;
  if (!row) return NextResponse.json({ error: 'No existe esa importación' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const action = body.action;
  if (action !== 'start' && action !== 'discard' && action !== 'resume') {
    return NextResponse.json({ error: 'action debe ser start, discard o resume' }, { status: 400 });
  }
  try {
    const out = await invokeImport({ action, importId: id });
    if (out.error || !out.import) return NextResponse.json({ error: out.error ?? 'Sin respuesta' }, { status: 409 });
    log.info('imports', action, { id, agencySlug: row.agency_slug, by: gate.user.email });
    return NextResponse.json({ import: importToJson(out.import) });
  } catch (err) {
    log.error('imports', `${action} failed`, { id, error: (err as Error)?.message });
    return NextResponse.json({ error: (err as Error)?.message ?? 'Falló la importación' }, { status: 500 });
  }
}
