import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/**
 * Devuelve el usuario actualmente autenticado (desde la cookie de sesión).
 * El cliente lo usa para verificar el rol (`groups.includes('admin')`) y
 * condicionar UI. Sin cache — la sesión es por-request.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const user = await getSession();
  if (!user) return NextResponse.json({ user: null }, { status: 200 });
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
