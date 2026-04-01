import { Card, Skeleton } from 'antd';
import type { ReactNode } from 'react';

interface EcoChartCardProps {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  style?: React.CSSProperties;
}

export function EcoChartCard({
  title,
  subtitle,
  extra,
  children,
  loading = false,
  style,
}: EcoChartCardProps) {
  return (
    <Card size="small" hoverable={false} style={style}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0E1E2C' }}>{title}</div>
          {subtitle && <div className="eco-chart-subtitle">{subtitle}</div>}
        </div>
        {extra && <div>{extra}</div>}
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} title={false} />
      ) : (
        children
      )}
    </Card>
  );
}
