import { NextResponse } from 'next/server';
import { getSession, type SessionUser } from '@/lib/session';

/**
 * Helper para Route Handlers. Devuelve:
 * - { ok: true, user } si hay sesión válida y el usuario pertenece al grupo 'admin'
 * - { ok: false, response } con NextResponse 401/403 listo para devolver
 */
export async function requireAdmin(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  if (!user.groups || !user.groups.includes('admin')) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden', required: 'admin' }, { status: 403 }) };
  }
  return { ok: true, user };
}

/** Como requireAdmin pero acepta cualquier usuario autenticado. */
export async function requireAuth(): Promise<
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }
> {
  const user = await getSession();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  return { ok: true, user };
}
