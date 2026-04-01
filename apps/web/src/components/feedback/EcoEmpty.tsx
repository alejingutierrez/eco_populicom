import { Empty } from 'antd';
import { Search, Bell, BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';

type EmptyVariant = 'mentions' | 'data' | 'alerts' | 'generic';

const CONFIGS: Record<EmptyVariant, { icon: ReactNode; message: string }> = {
  mentions: {
    icon: <Search size={40} color="#CBD5E1" strokeWidth={1.5} />,
    message: 'No hay menciones para los filtros seleccionados',
  },
  data: {
    icon: <BarChart3 size={40} color="#CBD5E1" strokeWidth={1.5} />,
    message: 'No hay datos para el periodo seleccionado',
  },
  alerts: {
    icon: <Bell size={40} color="#CBD5E1" strokeWidth={1.5} />,
    message: 'No hay alertas configuradas',
  },
  generic: {
    icon: undefined,
    message: 'No hay datos disponibles',
  },
};

interface EcoEmptyProps {
  variant?: EmptyVariant;
  message?: string;
}

export function EcoEmpty({ variant = 'generic', message }: EcoEmptyProps) {
  const config = CONFIGS[variant];

  return (
    <Empty
      image={config.icon ?? Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <span style={{ color: '#94A3B8', fontSize: 13 }}>{message ?? config.message}</span>
      }
      style={{ padding: '40px 0' }}
    />
  );
}
