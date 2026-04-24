import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * Layout protegido para /settings/*. Verifica sesión; si no es admin, redirige
 * al root. El middleware ya fuerza que haya cookie, pero esto añade el check
 * de rol.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) redirect('/sign-in');
  const isAdmin = user.groups?.includes('admin') ?? false;
  if (!isAdmin) redirect('/');
  return <>{children}</>;
}
