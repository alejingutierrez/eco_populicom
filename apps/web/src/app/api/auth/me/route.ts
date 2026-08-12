import { NextResponse } from 'next/server';
import { getDb, users } from '@eco/database';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import { ensureUserProvisioned } from '@/lib/provision';
import { effectiveRole } from '@/lib/auth/require-admin';
import { capabilitiesFor } from '@/lib/auth/roles';
import { log } from '@/lib/log';

/**
 * Devuelve el usuario autenticado + su rol efectivo, capacidades y páginas
 * permitidas. El SPA lo consume al boot para gatear navegación y controles
 * (esconder páginas por usuario, mostrar templates solo a editor/admin, etc.).
 * Sin cache — la sesión es por-request.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await getSession();
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
  // JIT provisioning: mantiene la tabla `users` sincronizada con Cognito.
  // Best-effort — un fallo de DB nunca debe romper el auth check.
  try {
    await ensureUserProvisioned(user);
  } catch (err) {
    log.error('auth.me', 'provisioning failed', { msg: (err as Error).message });
  }

  const role = await effectiveRole(user);
  let allowedPages: string[] | null = null;
  let allAgencies = false;
  try {
    const db = getDb();
    const [row] = await db
      .select({ allowedPages: users.allowedPages, allAgencies: users.allAgencies })
      .from(users)
      .where(eq(users.cognitoSub, user.sub))
      .limit(1);
    allowedPages = (row?.allowedPages as string[] | null) ?? null;
    allAgencies = row?.allAgencies ?? false;
  } catch {
    /* fila aún no provisionada — defaults seguros (sin override de páginas) */
  }

  return NextResponse.json({
    user: {
      sub: user.sub,
      email: user.email,
      name: user.name,
      groups: user.groups ?? [],
      agencySlug: user.agencySlug,
      role,
      capabilities: capabilitiesFor(role),
      allowedPages,
      allAgencies,
    },
  });
}
