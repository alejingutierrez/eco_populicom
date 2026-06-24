/**
 * POST /api/chat/stream — chat contextual del dashboard con streaming.
 *
 * Recibe la pregunta del usuario + el snapshot de la vista actual (métricas,
 * sentimiento, tópicos, fuentes y menciones del periodo/filtros en pantalla),
 * arma el prompt, y hace streaming de la respuesta de Claude token-por-token
 * vía NDJSON. NO es agentic: el modelo solo ve el contexto provisto (ver
 * CHAT_SYSTEM_PROMPT).
 *
 * Protocolo de salida (una línea JSON por evento, '\n'-terminadas):
 *   {"type":"meta","conversationId":"…","title":"…"}
 *   {"type":"delta","text":"…"}            (repetido)
 *   {"type":"done","tokensIn":N,"tokensOut":N}
 *   {"type":"error","message":"…"}
 *
 * Persiste el mensaje del usuario antes de invocar y el del asistente al
 * cerrar el stream (acumulado server-side). Si el cliente corta, persiste el
 * parcial con partial=true.
 *
 * Requiere el permiso IAM `bedrock:InvokeModelWithResponseStream` en el task
 * role de ECS (ver infra/lib/compute-stack.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, chatConversations, chatMessages } from '@eco/database';
import { and, asc, eq } from 'drizzle-orm';
import {
  CHAT_SYSTEM_PROMPT,
  buildChatUserTurn,
  type ChatViewContext,
} from '@eco/shared';
import { invokeClaudeStream } from '@eco/shared/src/bedrock';
import { getBedrockClient } from '@/lib/bedrock-client';
import { resolveAgencyId } from '@/lib/agency';
import { getSessionFromRequest } from '@/lib/session';
import { log } from '@/lib/log';
import { consume } from '@/lib/rate-limit';
import { ensureChatSchema, deriveConversationTitle, normalizeTurns } from '@/lib/chat-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PRIMARY_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const FALLBACK_MODEL = process.env.BEDROCK_FALLBACK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const MAX_MESSAGE_CHARS = 4000;
const MAX_ANSWER_TOKENS = 1500;

function ndjson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + '\n');
}

export async function POST(request: NextRequest): Promise<Response> {
  const start = Date.now();
  // Auth primero para poder limitar por usuario (no por IP): el X-Forwarded-For
  // izquierdo es spoofeable detrás del ALB, así que keyear por Cognito sub evita
  // que un usuario evada el cap de la ruta cara rotando IPs.
  const user = getSessionFromRequest(request);
  if (!user?.sub) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const rl = consume('chat-stream:' + user.sub, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) {
    return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });
  }

  let body: {
    conversationId?: string;
    message?: string;
    viewContext?: ChatViewContext;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const message = (body.message ?? '').toString().trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }
  const viewContext: ChatViewContext = body.viewContext ?? {};

  const db = getDb();
  const pool = getPool();

  try {
    await ensureChatSchema(pool);

    // ---- Resolver / crear la conversación (scope: agencia + userSub) ----
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
      if (!conv) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
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

    // ---- Historial previo (antes de insertar el turno actual) ----
    const priorRows = isNew
      ? []
      : await db
          .select({ role: chatMessages.role, content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.conversationId, conversationId))
          .orderBy(asc(chatMessages.createdAt));
    const priorTurns = normalizeTurns(priorRows);

    // ---- Persistir el mensaje del usuario (texto limpio + contexto en JSON) ----
    await db.insert(chatMessages).values({
      conversationId,
      role: 'user',
      content: message,
      contentJson: {
        viewContext: viewContext as Record<string, unknown>,
        period: viewContext.period ?? undefined,
        screen: viewContext.screen ?? undefined,
        filters: viewContext.filters ?? null,
      },
    });

    const llmMessages = [
      ...priorTurns,
      { role: 'user' as const, content: buildChatUserTurn(viewContext, message) },
    ];

    const convoId = conversationId;
    const stream = new ReadableStream({
      async start(controller) {
        let full = '';
        let usage: { inputTokens?: number; outputTokens?: number } = {};
        let clientGone = false;
        let persisted = false;

        // Persiste el mensaje del asistente EXACTAMENTE una vez. El flag evita
        // la doble inserción cuando un fallo tardío (p.ej. el cliente cierra la
        // conexión justo en el `done`/close) salta al catch con `full` ya
        // persistido. No persiste si no hubo texto (nada que guardar).
        const persistAssistant = async (partial: boolean) => {
          if (persisted || !full.trim()) return;
          persisted = true;
          await db.insert(chatMessages).values({
            conversationId: convoId,
            role: 'assistant',
            content: full,
            model: PRIMARY_MODEL,
            tokensIn: usage.inputTokens ?? null,
            tokensOut: usage.outputTokens ?? null,
            partial,
          });
          await db
            .update(chatConversations)
            .set({ updatedAt: new Date() })
            .where(eq(chatConversations.id, convoId));
        };

        try {
          controller.enqueue(ndjson({ type: 'meta', conversationId: convoId, title, isNew }));

          for await (const delta of invokeClaudeStream({
            client: getBedrockClient(),
            systemPrompt: CHAT_SYSTEM_PROMPT,
            messages: llmMessages,
            maxTokens: MAX_ANSWER_TOKENS,
            primaryModel: PRIMARY_MODEL,
            fallbackModel: FALLBACK_MODEL,
            temperature: 0.3,
            onUsage: (u) => { usage = u; },
          })) {
            full += delta;
            try {
              controller.enqueue(ndjson({ type: 'delta', text: delta }));
            } catch {
              // El cliente cerró la conexión: dejamos de emitir pero seguimos
              // para persistir lo acumulado como parcial.
              clientGone = true;
              break;
            }
          }

          // El modelo no devolvió texto (y el cliente sigue conectado): es un
          // fallo, no persistimos una fila vacía ni reportamos éxito.
          if (!full.trim() && !clientGone) {
            try {
              controller.enqueue(ndjson({ type: 'error', message: 'El modelo no devolvió respuesta. Intenta de nuevo.' }));
              controller.close();
            } catch { /* cliente ya cerrado */ }
            return;
          }

          await persistAssistant(clientGone);

          // `done` + close envueltos: si el cliente cerró justo aquí, el throw
          // NO debe caer al catch (eso duplicaría la fila ya persistida).
          if (!clientGone) {
            try {
              controller.enqueue(ndjson({
                type: 'done',
                tokensIn: usage.inputTokens ?? null,
                tokensOut: usage.outputTokens ?? null,
              }));
            } catch { /* cliente cerró al final */ }
          }
          try { controller.close(); } catch { /* ya cerrado */ }
        } catch (err) {
          log.error('chat-stream', 'stream failed', { msg: (err as Error).message, conversationId: convoId });
          // Persistir lo acumulado (con tokens si llegaron) para no perder el turno.
          try { await persistAssistant(true); } catch { /* best-effort */ }
          try {
            controller.enqueue(ndjson({ type: 'error', message: 'No se pudo generar la respuesta.' }));
            controller.close();
          } catch { /* controller ya cerrado */ }
        } finally {
          log.info('chat-stream', 'complete', {
            latencyMs: Date.now() - start, conversationId: convoId, chars: full.length, persisted,
          });
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    log.error('chat-stream', 'handler failed', { msg: (err as Error).message });
    return NextResponse.json(
      { error: 'chat-stream error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
