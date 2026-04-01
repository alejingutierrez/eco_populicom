'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  MessageSquare,
  TrendingUp,
  Hash,
  MapPin,
  Bell,
  Settings,
  LogOut,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Menciones', href: '/mentions', icon: MessageSquare },
  { name: 'Sentimiento', href: '/sentiment', icon: TrendingUp },
  { name: 'Tópicos', href: '/topics', icon: Hash },
  { name: 'Geografía', href: '/geography', icon: MapPin },
  { name: 'Alertas', href: '/alerts', icon: Bell },
  { name: 'Configuración', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center border-b border-border px-4">
        <span className="text-lg font-bold tracking-tight text-primary">ECO</span>
        <span className="ml-2 text-xs text-muted-foreground">Social Listening</span>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-3">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={() => {
            document.cookie = 'eco_id_token=; path=/; max-age=0';
            document.cookie = 'eco_access_token=; path=/; max-age=0';
            window.location.href = '/sign-in';
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
