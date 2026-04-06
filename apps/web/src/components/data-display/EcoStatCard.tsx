import { Card, Skeleton } from 'antd';
import { ChevronUp, ChevronDown, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

type AccentColor = 'ocean' | 'error' | 'mangrove' | 'amber' | 'violet' | 'sky' | 'orange';

interface Trend {
  value: number;
  direction: 'up' | 'down' | 'flat';
}

interface EcoStatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  accentColor: AccentColor;
  trend?: Trend;
  sparklineData?: number[];
  loading?: boolean;
  valueColor?: string;
}

const ACCENT_ICON_BG: Record<AccentColor, string> = {
  ocean: 'rgba(10,126,164,0.06)',
  error: 'rgba(232,100,82,0.06)',
  mangrove: 'rgba(46,139,106,0.06)',
  amber: 'rgba(245,166,35,0.06)',
  violet: 'rgba(139,92,246,0.06)',
  sky: 'rgba(56,189,248,0.06)',
  orange: 'rgba(251,146,60,0.06)',
};

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 80;
  const height = 20;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 16, marginTop: 4 }}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
}

function TrendIndicator({ trend }: { trend: Trend }) {
  const isUp = trend.direction === 'up';
  const isDown = trend.direction === 'down';
  const color = isUp ? '#2E8B6A' : isDown ? '#E86452' : '#94A3B8';
  const Icon = isUp ? ChevronUp : isDown ? ChevronDown : Minus;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginTop: 4 }}>
      <Icon size={12} color={color} strokeWidth={2.5} />
      {trend.value > 0 && (
        <span style={{ color, fontWeight: 600 }}>{trend.value}%</span>
      )}
      <span style={{ color: '#94A3B8' }}>
        {trend.direction === 'flat' ? 'sin cambio significativo' : 'vs mes anterior'}
      </span>
    </div>
  );
}

export function EcoStatCard({
  title,
  value,
  icon,
  accentColor,
  trend,
  sparklineData,
  loading = false,
  valueColor = '#0E1E2C',
}: EcoStatCardProps) {
  if (loading) {
    return (
      <Card className="eco-stat-card" data-accent={accentColor} size="small">
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      </Card>
    );
  }

  return (
    <Card className="eco-stat-card" data-accent={accentColor} size="small" hoverable>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 500 }}>{title}</div>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: ACCENT_ICON_BG[accentColor],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
      </div>

      <div style={{ fontSize: 28, fontWeight: 800, color: valueColor, lineHeight: 1, margin: '6px 0' }}>
        {value}
      </div>

      {sparklineData && sparklineData.length > 1 && (
        <div style={{ color: valueColor }}>
          <Sparkline data={sparklineData} />
        </div>
      )}

      {trend && <TrendIndicator trend={trend} />}
    </Card>
  );
}
