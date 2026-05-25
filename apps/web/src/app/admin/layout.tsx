import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

/**
 * Layout protegido para /admin/*. Mismo patrón que /settings/layout.tsx:
 * el middleware fuerza cookie de sesión y este layout valida que el grupo
 * Cognito 'admin' esté presente.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSession();
  if (!user) redirect('/sign-in');
  const isAdmin = user.groups?.includes('admin') ?? false;
  if (!isAdmin) redirect('/');
  return <>{children}</>;
}
