import { NextRequest, NextResponse } from 'next/server';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { requireAdmin } from '@/lib/auth/require-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const lambda = new LambdaClient({});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SendTestBody {
  agencySlug: string;
  /** Si se provee, envía solo a estos destinatarios; si no, usa los de report_configs. */
  recipients?: string[];
}

/**
 * POST /api/reports/send-test
 * Invoca la Lambda eco-weekly-report con trigger='test' para enviar
 * inmediatamente el reporte de la agencia dada. Requiere rol admin.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: SendTestBody;
  try { body = (await request.json()) as SendTestBody; }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  if (!body.agencySlug) {
    return NextResponse.json({ error: 'agencySlug required' }, { status: 400 });
  }

  if (body.recipients) {
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      return NextResponse.json({ error: 'recipients must be non-empty array' }, { status: 422 });
    }
    for (const e of body.recipients) {
      if (typeof e !== 'string' || !EMAIL_REGEX.test(e)) {
        return NextResponse.json({ error: `invalid email: ${e}` }, { status: 422 });
      }
    }
  }

  console.log(`[reports/send-test] invoked by ${auth.user.email} · agency=${body.agencySlug}`);

  try {
    const payload = {
      agencySlug: body.agencySlug,
      recipients: body.recipients,
      dryRun: false,
      trigger: 'test' as const,
      triggeredBy: auth.user.sub,
    };

    const res = await lambda.send(new InvokeCommand({
      FunctionName: 'eco-weekly-report',
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }));

    const responsePayload = res.Payload
      ? JSON.parse(Buffer.from(res.Payload).toString('utf8'))
      : null;

    if (res.FunctionError) {
      console.error('[reports/send-test] lambda function error:', res.FunctionError, responsePayload);
      return NextResponse.json({
        error: 'lambda-error',
        detail: responsePayload,
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true, result: responsePayload });
  } catch (err: any) {
    console.error('[reports/send-test] invoke failed:', err);
    return NextResponse.json({
      error: 'invoke-failed',
      detail: err?.message ?? String(err),
    }, { status: 500 });
  }
}
