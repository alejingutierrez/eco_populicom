'use client';

import { useEffect, useMemo, useState } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import esES from 'antd/locale/es_ES';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ecoThemeFor, type EcoMode } from '@/theme/eco-theme';
import { AgencyProvider } from '@/contexts/AgencyContext';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: true,
        refetchInterval: 5 * 60 * 1000,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

// El modo lo decide la SPA (`eco.mode.v2`, mismo origen). El script del <head>
// de layout.tsx ya lo puso en <html data-mode> antes del primer pintado; aquí se
// lee de ahí para que Ant y los tokens CSS nunca discrepen.
function readMode(): EcoMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [mode, setMode] = useState<EcoMode>('light');

  useEffect(() => {
    setMode(readMode());
    // Los paneles de Configuración viven en un iframe dentro de la SPA: cuando
    // la persona cambia de modo en el dashboard, el evento `storage` llega a
    // este documento (mismo origen) y el panel cambia con él, sin recargar.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'eco.mode.v2') return;
      const next: EcoMode = e.newValue === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-mode', next);
      setMode(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const theme = useMemo(() => ecoThemeFor(mode), [mode]);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={theme} locale={esES}>
        <AntApp>
          <AgencyProvider>{children}</AgencyProvider>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
