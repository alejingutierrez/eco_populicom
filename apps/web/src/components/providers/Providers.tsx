'use client';

import { ConfigProvider, App as AntApp } from 'antd';
import esES from 'antd/locale/es_ES';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ecoTheme } from '@/theme/eco-theme';
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

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={ecoTheme} locale={esES}>
        <AntApp>
          <AgencyProvider>{children}</AgencyProvider>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
