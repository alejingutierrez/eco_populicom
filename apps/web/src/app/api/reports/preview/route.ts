import { NextRequest, NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireCapability } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const lambda = new LambdaClient({});

/**
 * GET /api/reports/preview?agencySlug=ddecpr&template=weekly
 *
 * Renderiza el template de correo SIN enviar (dryRun) y devuelve el HTML para
 * previsualizarlo dentro de Configuración → Plantillas. Reusa el render real del
 * lambda eco-weekly-report (mismos datos que recibe el destinatario), así que no
 * duplica el renderer. Gateado por manage_templates (admin/editor).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireCapability('manage_templates');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const agencySlug = searchParams.get('agencySlug') || searchParams.get('agency') || '';
  const template = searchParams.get('template') || 'weekly';
  if (!agencySlug) return NextResponse.json({ error: 'agencySlug required' }, { status: 400 });
  // Hoy solo el reporte semanal soporta dryRun-render. La alerta de crisis se
  // previsualiza al dispararse (o vía una acción de preview futura).
  if (template !== 'weekly') {
    return NextResponse.json({ error: 'unsupported template', supported: ['weekly'] }, { status: 422 });
  }

  try {
    const res = await lambda.send(new InvokeCommand({
      FunctionName: 'eco-weekly-report',
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ agencySlug, dryRun: true })),
    }));
    const payload = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString('utf8')) : null;
    if (res.FunctionError) {
      return NextResponse.json({ error: 'lambda-error', detail: payload }, { status: 502 });
    }
    const html = payload?.html;
    if (typeof html !== 'string') {
      return NextResponse.json({ error: 'no html in lambda response' }, { status: 502 });
    }
    return NextResponse.json({ html, template, agencySlug });
  } catch (err) {
    return NextResponse.json({ error: 'invoke-failed', detail: (err as Error)?.message ?? String(err) }, { status: 500 });
  }
}
