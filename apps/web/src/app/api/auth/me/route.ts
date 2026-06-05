import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { ensureUserProvisioned } from '@/lib/provision';
import { log } from '@/lib/log';

/**
 * Devuelve el usuario actualmente autenticado (desde la cookie de sesión).
 * El cliente lo usa para verificar el rol (`groups.includes('admin')`) y
 * condicionar UI. Sin cache — la sesión es por-request.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await getSession();
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  // JIT provisioning: keep the `users` table in sync with real Cognito users
  // (the Users admin screen and per-user agency access read from it). Best
  // effort — never let a DB hiccup break the auth check.
  try {
    await ensureUserProvisioned(user);
  } catch (err) {
    log.error('auth.me', 'provisioning failed', { msg: (err as Error).message });
  }
  return NextResponse.json({
    user: {
      sub: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups ?? [],
      agencySlug: user.agencySlug,
    },
  });
}
