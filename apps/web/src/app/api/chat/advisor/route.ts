/**
 * POST /api/chat/advisor?agency=slug — asesor de crisis (spec §9.1).
 *
 * Primero el triaje (spec §8.1) decide el camino. Camino 1 responde en streaming. Camino 2
 * corre en proceso y el cliente lo sigue por GET /runs/:id/events. El camino 3 (consejo
 * completo) llega en la fase 2: si el triaje lo pide, se usa el panel y el motivo lo dice.
 *
 * NDJSON (application/x-ndjson), una línea por evento:
 *   meta {conversationId,title,isNew}
 *   triage {camino,piso,motivo,clasificacion}
 *   status {texto} · tool_call {nombre,argsResumen} · tool_result {nombre,ok,resumen}
 *   delta {text}                      solo camino 1
 *   run {runId,camino}                caminos 2 y 3: el stream se cierra y el cliente hace polling
 *   done {...}                        solo camino 1
 *   error {code,message} · ping {}    ping cada 15 s
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
import { triage, type TriageDecision } from '@/lib/advisor/triage';
import { runPanel } from '@/lib/advisor/council';
import { createRun, appendEvent, setRunStatus, type Pool } from '@/lib/advisor/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Camino 1 puede tardar varios turnos con herramientas. El panel corre después del stream.
export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 4000;
const PING_MS = 15_000;
const DAILY_LIMIT = 10;
const PER_MINUTE_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_LIKE = /^[0-9a-f-]{36}$/i;

type ToolRunner = { defs: ReturnType<typeof advisorToolDefs>; run: (n: string, args: unknown) => Promise<{ ok: boolean; text: string; resultTokens: number }> };

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

function dateInWords(now: Date): string {
  return new Intl.DateTimeFormat('es-PR', { timeZone: 'America/Puerto_Rico', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
}

/** Lee el JSON de una herramienta; si no es JSON válido devuelve null (nunca rompe el triaje). */
function parseTool(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const gate = await requireCapability('advise');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  if (advisorBackend() !== 'runtime') {
    return NextResponse.json({ error: 'backend_no_disponible', message: 'El backend mantle no está cableado.' }, { status: 503 });
  }

  const rl = consume(`advisor:${user.sub}`, { limit: PER_MINUTE_LIMIT, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } });
  }

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });

  const pool = getPool();
  const db = getDb();
  const { rows: agRows } = await pool.query<{ slug: string; name: string }>('SELECT slug, name FROM agencies WHERE id = $1', [agencyId]);
  const agency = agRows[0];
  if (!agency) return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });

  const allowed = advisorAllowed({ email: user.email }, agency.slug);
  if (!allowed.ok) return NextResponse.json({ error: 'forbidden', reason: allowed.reason }, { status: 403 });

  let body: { conversationId?: string; message?: string; force?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const message = (body.message ?? '').toString().trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  const override = body.force === 'council' ? 'council' : body.force === 'quick' ? 'quick' : null;
  const conversationIdIn = (body.conversationId ?? '').toString();
  if (conversationIdIn && !UUID_LIKE.test(conversationIdIn)) return NextResponse.json({ error: 'invalid_conversation' }, { status: 400 });

  await ensureChatSchema(pool);
  await ensureAdvisorSchema(pool);

  const { rows: dayRows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM advisor_runs WHERE user_sub = $1 AND created_at > $2',
    [user.sub, new Date(Date.now() - DAY_MS)],
  );
  if ((dayRows[0]?.n ?? 0) >= DAILY_LIMIT) return NextResponse.json({ error: 'daily_limit', limit: DAILY_LIMIT }, { status: 429 });

  // ---- Conversación -----------------------------------------------------------------
  let conversationId = conversationIdIn || null;
  let title = '';
  let isNew = false;
  if (conversationId) {
    const [conv] = await db
      .select({ id: chatConversations.id, title: chatConversations.title })
      .from(chatConversations)
      .where(and(eq(chatConversations.id, conversationId), eq(chatConversations.agencyId, agencyId), eq(chatConversations.userSub, user.sub)))
      .limit(1);
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    title = conv.title;
  } else {
    title = deriveConversationTitle(message);
    const [created] = await db.insert(chatConversations).values({ agencyId, userSub: user.sub, userEmail: user.email ?? null, title }).returning({ id: chatConversations.id });
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
  await db.insert(chatMessages).values({ conversationId, role: 'user', content: message, contentJson: { mode: 'advisor' as const } });

  const now = new Date();
  const knowledgeVersion = { manual: MANUAL_TEXT_SHA256, legal: LEGAL_RULES_TEXT_SHA256, templates: TEMPLATES_TEXT_SHA256 };
  const ctx: AdvisorToolCtx = { agencyId, agencySlug: agency.slug, agencyName: agency.name, userSub: user.sub, asOf: now, runId: null, pool };
  const llm = new RuntimeLLM(getBedrockClient());
  const models = { fast: advisorModelId('FAST'), main: advisorModelId('MAIN'), deep: advisorModelId('DEEP') };
  const dateLabel = dateInWords(now);
  const tools: ToolRunner = { defs: advisorToolDefs(), run: (name, args) => runAdvisorTool(name, args, ctx) };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(ndjson(obj));
        } catch {
          // El cliente se fue; la corrida sigue y se persiste.
        }
      };
      const ping = setInterval(() => send({ type: 'ping' }), PING_MS);
      send({ type: 'meta', conversationId, title, isNew });

      try {
        // ---- Triaje (spec §8.1): el índice y la veda salen de las herramientas, no del modelo ----
        const situacion = parseTool((await tools.run('situacion_actual', {})).text);
        const calendario = parseTool((await tools.run('calendario_legal', {})).text);
        const indiceRaw = situacion && typeof situacion.indice_crisis === 'object' && situacion.indice_crisis !== null
          ? (situacion.indice_crisis as { valor?: unknown }).valor
          : null;
        const vedaEstado = calendario && typeof calendario.veda_electoral === 'object' && calendario.veda_electoral !== null
          ? (calendario.veda_electoral as { estado?: unknown }).estado
          : null;
        const { rows: alertRows } = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM alert_history WHERE agency_id = $1::uuid AND triggered_at >= $2`,
          [agencyId, new Date(now.getTime() - 12 * 60 * 60 * 1000)],
        );
        const vedaActiva = vedaEstado === 'activa';
        const decision: TriageDecision = await triage({
          llm,
          question: message,
          inputs: {
            indiceHoy: typeof indiceRaw === 'number' ? indiceRaw : null,
            alertasUltimas12h: alertRows[0]?.n ?? 0,
            riesgoPersonas: false,
            vedaActiva,
            guiaProbable: null,
          },
          override,
        });
        // Fase 1: el consejo completo (camino 3) no está cableado; se usa el panel.
        const caminoRun: 1 | 2 = decision.camino === 1 ? 1 : 2;
        const motivo = decision.camino === 3 ? `${decision.motivo} Consejo completo llega en la fase 2; se usa el panel.` : decision.motivo;
        send({ type: 'triage', camino: decision.camino, piso: decision.piso, motivo, clasificacion: decision.clasificacion });

        const triageJson = { camino: decision.camino, piso: decision.piso, motivo, clasificacion: decision.clasificacion, legalObligatorio: decision.legalObligatorio, override: decision.override };

        if (caminoRun === 1) {
          await runCaminoUno({
            send, pool, db, tools, llm, models, dateLabel, now, agency, message, priorTurns, conversationId,
            knowledgeVersion, triageJson, userSub: user.sub, userEmail: user.email ?? null, agencyId,
          });
        } else {
          const runId = await createRun(pool, {
            agencyId, userSub: user.sub, userEmail: user.email ?? null, conversationId, question: message, camino: 2, forced: override,
            asOf: now, knowledgeVersion, triage: triageJson,
          });
          await db.insert(chatMessages).values({ conversationId, role: 'assistant', content: 'Consejo de panel en curso.', model: models.main, contentJson: { mode: 'advisor' as const, runId, camino: 2 } });
          send({ type: 'run', runId, camino: 2 });
          // Corre sin esperar al cliente. Los eventos quedan en advisor_events.
          void executePanel({
            pool, runId, llm, tools, models, dateLabel, agency, message,
            signals: { guiaProbable: decision.clasificacion?.guia_probable ?? null, riesgoPersonas: decision.clasificacion?.riesgo_personas ?? false, vedaActiva },
            startedAt: Date.now(),
          });
        }
      } catch (err) {
        const budget = err instanceof AdvisorBudgetError;
        const code = budget ? 'error_budget' : 'error';
        log.error('advisor', 'route.failed', { code });
        send({ type: 'error', code, message: budget ? 'La consulta superó el presupuesto de costo.' : 'No pudimos responder ahora. Intenta de nuevo en un momento.' });
      } finally {
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  });
}

/** Camino 1: streaming directo. El triaje ya quedó registrado en triage_json. */
async function runCaminoUno(a: {
  send: (o: unknown) => void;
  pool: Pool;
  db: ReturnType<typeof getDb>;
  tools: ToolRunner;
  llm: RuntimeLLM;
  models: { fast: string; main: string; deep: string };
  dateLabel: string;
  now: Date;
  agency: { slug: string; name: string };
  message: string;
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  conversationId: string;
  knowledgeVersion: Record<string, string>;
  triageJson: Record<string, unknown>;
  userSub: string;
  userEmail: string | null;
  agencyId: string;
}): Promise<void> {
  const started = Date.now();
  const runId = await createRun(a.pool, {
    agencyId: a.agencyId, userSub: a.userSub, userEmail: a.userEmail, conversationId: a.conversationId, question: a.message, camino: 1, forced: null,
    asOf: a.now, knowledgeVersion: a.knowledgeVersion, triage: a.triageJson,
  });
  const out = await runCamino1(
    { question: a.message, priorTurns: a.priorTurns, dateLabel: a.dateLabel, model: a.models.main, agencySlug: a.agency.slug },
    {
      llm: a.llm,
      tools: a.tools,
      events: {
        status: (texto) => a.send({ type: 'status', texto }),
        toolCall: (nombre, argsResumen) => a.send({ type: 'tool_call', nombre, argsResumen }),
        toolResult: (nombre, ok, resumen) => a.send({ type: 'tool_result', nombre, ok, resumen }),
        delta: (text) => a.send({ type: 'delta', text }),
      },
    },
  );
  const tokensIn = out.usage.inputNew + out.usage.cacheWrite1h + out.usage.cacheWrite5m + out.usage.cacheRead;
  await a.db.insert(chatMessages).values({
    conversationId: a.conversationId, role: 'assistant', content: out.text, model: out.model,
    tokensIn, tokensOut: out.usage.output, contentJson: { mode: 'advisor' as const, runId, camino: 1 },
  });
  await setRunStatus(a.pool, runId, 'done', {
    usage: { usage: out.usage, stopReason: out.stopReason, turns: out.turns, toolCalls: out.toolCalls, model: out.model },
    costUsd: out.costUsd ?? 0,
    citations: { total: out.citations.total, invalid: out.citations.invalid },
    durationMs: Date.now() - started,
  });
  a.send({
    type: 'done', runId, tokensIn, tokensOut: out.usage.output, cacheRead: out.usage.cacheRead, costUsd: out.costUsd,
    citations: { total: out.citations.total, invalid: out.citations.invalid }, revision: { alertas: out.review.alertas },
  });
}

/** Corrida del panel en proceso: persiste el estado final y los errores como eventos. */
async function executePanel(a: {
  pool: Pool;
  runId: string;
  llm: RuntimeLLM;
  tools: ToolRunner;
  models: { fast: string; main: string; deep: string };
  dateLabel: string;
  agency: { slug: string; name: string };
  message: string;
  signals: { guiaProbable: string | null; riesgoPersonas: boolean; vedaActiva: boolean };
  startedAt: number;
}): Promise<void> {
  try {
    const out = await runPanel({
      llm: a.llm, tools: a.tools, pool: a.pool, runId: a.runId, models: a.models, dateLabel: a.dateLabel,
      agency: a.agency, signals: a.signals, question: a.message,
    });
    if (out.status === 'cancelled') {
      await appendEvent(a.pool, a.runId, 'cancelled', {});
      await setRunStatus(a.pool, a.runId, 'cancelled', { usage: out.usage, costUsd: out.costUsd ?? 0, durationMs: Date.now() - a.startedAt });
      return;
    }
    await setRunStatus(a.pool, a.runId, 'done', {
      memo: out.memo, usage: out.usage, costUsd: out.costUsd ?? 0, citations: out.citations, durationMs: Date.now() - a.startedAt,
    });
  } catch (err) {
    const e = err as { code?: string };
    const code = err instanceof AdvisorBudgetError ? 'error_budget' : (e.code ?? 'error');
    log.error('advisor', 'panel.failed', { runId: a.runId, code });
    await appendEvent(a.pool, a.runId, 'error', { code, message: 'El panel no pudo terminar. Puedes intentar de nuevo.' }).catch(() => undefined);
    await setRunStatus(a.pool, a.runId, code === 'error_budget' ? 'error_budget' : 'error', { errorCode: code, durationMs: Date.now() - a.startedAt }).catch(() => undefined);
  }
}
