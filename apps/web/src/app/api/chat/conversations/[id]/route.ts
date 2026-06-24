/**
 * Rutas de un hilo de chat individual. Todas validan ownership por
 * (agencia activa + Cognito `sub`).
 *
 *   GET    → mensajes del hilo (orden cronológico).
 *   PATCH  → renombrar (`title`) o archivar (`status`).
 *   DELETE → borrar el hilo (cascada a sus mensajes).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, chatConversations, chatMessages } from '@eco/database';
import { and, asc, eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { getSessionFromRequest } from '@/lib/session';
import { ensureChatSchema } from '@/lib/chat-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

type Owned =
  | { ok: false; response: NextResponse }
  | { ok: true; db: ReturnType<typeof getDb>; conv: { id: string; title: string; status: string } };

async function resolveOwned(request: NextRequest, id: string): Promise<Owned> {
  const user = getSessionFromRequest(request);
  if (!user?.sub) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  const agencyId = await resolveAgencyId(new URL(request.url).searchParams);
  if (!agencyId) return { ok: false, response: NextResponse.json({ error: 'No agency resolved' }, { status: 404 }) };

  const db = getDb();
  await ensureChatSchema(getPool());
  const [conv] = await db
    .select({ id: chatConversations.id, title: chatConversations.title, status: chatConversations.status })
    .from(chatConversations)
    .where(and(
      eq(chatConversations.id, id),
      eq(chatConversations.agencyId, agencyId),
      eq(chatConversations.userSub, user.sub),
    ))
    .limit(1);
  if (!conv) return { ok: false, response: NextResponse.json({ error: 'Conversation not found' }, { status: 404 }) };
  return { ok: true, db, conv };
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = await resolveOwned(request, id);
  if (!r.ok) return r.response;

  const messages = await r.db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, id))
    .orderBy(asc(chatMessages.createdAt));

  const res = NextResponse.json({ conversation: r.conv, messages });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = await resolveOwned(request, id);
  if (!r.ok) return r.response;

  let body: { title?: string; status?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch: { title?: string; status?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 255);
  if (body.status === 'active' || body.status === 'archived') patch.status = body.status;

  await r.db.update(chatConversations).set(patch).where(eq(chatConversations.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  const r = await resolveOwned(request, id);
  if (!r.ok) return r.response;

  await r.db.delete(chatConversations).where(eq(chatConversations.id, id));
  return NextResponse.json({ ok: true });
}
