/**
 * POST /api/chat/advisor?agency=slug — asesor de crisis, camino 1 (spec §9.1).
 *
 * Fase 0: solo el camino directo, sin triaje. Respuesta NDJSON (application/x-ndjson):
 *   {"type":"meta","conversationId","title","isNew"}
 *   {"type":"status","texto"}                     notas de progreso entre herramientas
 *   {"type":"tool_call","nombre","argsResumen"}
 *   {"type":"tool_result","nombre","ok","resumen"} (sin texto de terceros)
 *   {"type":"delta","text"}                        repetido: la respuesta en streaming
 *   {"type":"ping"}                                cada 15 s: el ALB corta a los 60 s sin bytes
 *   {"type":"done","runId","tokensIn","tokensOut","cacheRead","costUsd","citations","revision"}
 *   {"type":"error","code","message"}
 *
 * Acceso: capacidad `advise` + staff (ADVISOR_STAFF_ONLY) + agencia en ADVISOR_AGENCIES.
 * La agencia y la fecha las pone el servidor; ninguna herramienta las recibe del modelo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, chatConversations, chatMessages } from '@eco/database';
import { and, asc, eq } from 'drizzle-orm';
import { RuntimeLLM } from '@eco/shared/src/advisor/llm';
import { advisorBackend, advisorModelId } from '@eco/shared/src/advisor/models';
import { MANUAL_TEXT_SHA256 } from '@eco/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT_SHA256 } from '@eco/shared/src/advisor/legal-rules';
import { TEMPLATES_TEXT_SHA256 } from '@eco/shared/src/advisor/templates';
import { getBedrockClient } from '@/lib/bedrock-client';
import { resolveAgencyId } from '@/lib/agency';
import { requireCapability } from '@/lib/auth/require-admin';
import { log } from '@/lib/log';
import { consume } from '@/lib/rate-limit';
import { ensureChatSchema, deriveConversationTitle } from '@/lib/chat-store';
import { ensureAdvisorSchema } from '@/lib/advisor/store';
import { advisorAllowed } from '@/lib/advisor/config';
import { runAdvisorTool, advisorToolDefs, type AdvisorToolCtx } from '@/lib/advisor/tools';
import { runCamino1, AdvisorBudgetError } from '@/lib/advisor/camino1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un camino 1 con varias herramientas puede tardar más que el chat normal.
export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 4000;
const PING_MS = 15_000;
const DAILY_LIMIT = 10;
const PER_MINUTE_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

function dateInWords(now: Date): string {
  return new Intl.DateTimeFormat('es-PR', {
    timeZone: 'America/Puerto_Rico',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
}

export async function POST(request: NextRequest): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  if (advisorBackend() !== 'runtime') {
    return NextResponse.json({ error: 'backend_no_disponible', message: 'El backend mantle no está cableado en fase 0.' }, { status: 503 });
  }

  const rl = consume(`advisor:${user.sub}`, { limit: PER_MINUTE_LIMIT, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });

  const pool = getPool();
  const db = getDb();
  const { rows: agRows } = await pool.query<{ slug: string; name: string }>(
    'SELECT slug, name FROM agencies WHERE id = $1',
    [agencyId],
  );
  const agency = agRows[0];
  if (!agency) return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });

  const allowed = advisorAllowed({ email: user.email }, agency.slug);
  if (!allowed.ok) {
    return NextResponse.json({ error: 'forbidden', reason: allowed.reason }, { status: 403 });
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const message = (body.message ?? '').toString().trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return NextResponse.json({ error: 'Empty message' }, { status: 400 });

  await ensureChatSchema(pool);
  await ensureAdvisorSchema(pool);

  // Límite diario por usuario, leído de advisor_runs (el límite en memoria no sirve con varias tareas de ECS).
  const { rows: dayRows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM advisor_runs WHERE user_sub = $1 AND created_at > $2',
    [user.sub, new Date(Date.now() - DAY_MS)],
  );
  if ((dayRows[0]?.n ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ error: 'daily_limit', limit: DAILY_LIMIT }, { status: 429 });
  }

  // ---- Conversación (mismas tablas del chat, con content_json.mode = 'advisor') ----
  let conversationId = (body.conversationId ?? '').toString() || null;
  let title = '';
  let isNew = false;
  if (conversationId) {
    const [conv] = await db
      .select({ id: chatConversations.id, title: chatConversations.title })
      .from(chatConversations)
      .where(and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.agencyId, agencyId),
        eq(chatConversations.userSub, user.sub),
      ))
      .limit(1);
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    title = conv.title;
  } else {
    title = deriveConversationTitle(message);
    const [created] = await db
      .insert(chatConversations)
      .values({ agencyId, userSub: user.sub, userEmail: user.email ?? null, title })
      .returning({ id: chatConversations.id });
    conversationId = created.id;
    isNew = true;
  }

  const priorRows = isNew
    ? []
    : await db
        .select({ role: chatMessages.role, content: chatMessages.content })
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversationId))
        .orderBy(asc(chatMessages.createdAt));
  const priorTurns = priorRows
    .filter((r): r is { role: 'user' | 'assistant'; content: string } => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({ role: r.role, content: r.content }));

  await db.insert(chatMessages).values({
    conversationId,
    role: 'user',
    content: message,
    contentJson: { mode: 'advisor' as const },
  });

  const now = new Date();
  const knowledgeVersion = { manual: MANUAL_TEXT_SHA256, legal: LEGAL_RULES_TEXT_SHA256, templates: TEMPLATES_TEXT_SHA256 };
  const { rows: runRows } = await pool.query<{ id: string }>(
    `INSERT INTO advisor_runs (agency_id, user_sub, user_email, conversation_id, question, camino, status, as_of, knowledge_version)
     VALUES ($1, $2, $3, $4, $5, 1, 'running', $6, $7) RETURNING id`,
    [agencyId, user.sub, user.email ?? null, conversationId, message, now, JSON.stringify(knowledgeVersion)],
  );
  const runId = runRows[0].id;

  const ctx: AdvisorToolCtx = {
    agencyId,
    agencySlug: agency.slug,
    agencyName: agency.name,
    userSub: user.sub,
    asOf: now,
    runId,
    pool,
  };
  const llm = new RuntimeLLM(getBedrockClient());
  const model = advisorModelId('MAIN');
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(ndjson(obj));
        } catch {
          // El cliente se fue: el stream ya no acepta bytes. La corrida sigue y se persiste.
        }
      };
      const ping = setInterval(() => send({ type: 'ping' }), PING_MS);
      send({ type: 'meta', conversationId, title, isNew });

      try {
        const out = await runCamino1(
          {
            question: message,
            priorTurns,
            dateLabel: dateInWords(now),
            model,
            agencySlug: agency.slug,
          },
          {
            llm,
            tools: {
              defs: advisorToolDefs(),
              run: (name, args) => runAdvisorTool(name, args, ctx),
            },
            events: {
              status: (texto) => send({ type: 'status', texto }),
              toolCall: (nombre, argsResumen) => send({ type: 'tool_call', nombre, argsResumen }),
              toolResult: (nombre, ok, resumen) => send({ type: 'tool_result', nombre, ok, resumen }),
              delta: (text) => send({ type: 'delta', text }),
            },
          },
        );

        await db.insert(chatMessages).values({
          conversationId: conversationId!,
          role: 'assistant',
          content: out.text,
          model: out.model,
          tokensIn: out.usage.inputNew + out.usage.cacheWrite1h + out.usage.cacheWrite5m + out.usage.cacheRead,
          tokensOut: out.usage.output,
          contentJson: { mode: 'advisor' as const, runId, camino: 1 },
        });
        await pool.query(
          `UPDATE advisor_runs SET status = 'done', usage_json = $2, cost_usd = $3, citations_total = $4,
             citations_invalid = $5, duration_ms = $6, updated_at = now() WHERE id = $1`,
          [
            runId,
            JSON.stringify({ usage: out.usage, stopReason: out.stopReason, turns: out.turns, toolCalls: out.toolCalls, model: out.model, toolsFingerprint: out.toolsFingerprint }),
            out.costUsd ?? 0,
            out.citations.total,
            out.citations.invalid,
            Date.now() - started,
          ],
        );
        await db
          .update(chatConversations)
          .set({ updatedAt: new Date() })
          .where(eq(chatConversations.id, conversationId!));

        send({
          type: 'done',
          runId,
          tokensIn: out.usage.inputNew + out.usage.cacheWrite1h + out.usage.cacheWrite5m + out.usage.cacheRead,
          tokensOut: out.usage.output,
          cacheRead: out.usage.cacheRead,
          costUsd: out.costUsd,
          citations: { total: out.citations.total, invalid: out.citations.invalid },
          revision: { alertas: out.review.alertas },
        });
        log.info('advisor', 'camino1.done', { runId, turns: out.turns, toolCalls: out.toolCalls, ms: out.ms });
      } catch (err) {
        const budget = err instanceof AdvisorBudgetError;
        const code = budget ? 'error_budget' : 'error';
        // Nunca se registra el texto de la pregunta ni de las menciones: solo el run y el código.
        log.error('advisor', 'camino1.failed', { runId, code });
        await pool
          .query(`UPDATE advisor_runs SET status = $2, error_code = $3, updated_at = now() WHERE id = $1`, [runId, code, code])
          .catch(() => undefined);
        send({
          type: 'error',
          code,
          message: budget
            ? 'La consulta superó el presupuesto de costo. Intenta con una pregunta más corta.'
            : 'No pudimos responder ahora. Intenta de nuevo en un momento.',
        });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // Ya cerrado por el cliente.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
