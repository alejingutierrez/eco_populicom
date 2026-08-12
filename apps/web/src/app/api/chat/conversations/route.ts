/**
 * GET /api/chat/conversations — lista los hilos de chat del usuario actual
 * para la agencia activa (más reciente primero). Keyeado por Cognito `sub`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, getPool, chatConversations } from '@eco/database';
import { and, desc, eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { getSessionFromRequest } from '@/lib/session';
import { consume } from '@/lib/rate-limit';
import { ensureChatSchema } from '@/lib/chat-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = getSessionFromRequest(request);
  if (!user?.sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const rl = consume('chat-conversations:' + user.sub, { limit: 120, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ error: 'No agency resolved' }, { status: 404 });

  const db = getDb();
  await ensureChatSchema(getPool());

  const rows = await db
    .select({
      id: chatConversations.id,
      title: chatConversations.title,
      status: chatConversations.status,
      createdAt: chatConversations.createdAt,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(and(
      eq(chatConversations.agencyId, agencyId),
      eq(chatConversations.userSub, user.sub),
      eq(chatConversations.status, 'active'),
    ))
    .orderBy(desc(chatConversations.updatedAt))
    .limit(50);

  const res = NextResponse.json({ conversations: rows });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
