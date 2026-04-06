'use client';

import { Card, Skeleton, Tooltip } from 'antd';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

interface EcoHeroKPIProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  accent: string;
  delta?: number | null;
  deltaLabel?: string;
  tooltip: string;
  sparklineData?: number[];
  loading?: boolean;
  valueColor?: string;
  children?: ReactNode;
}

function DeltaIndicator({
  delta,
  deltaLabel,
}: {
  delta: number;
  deltaLabel: string;
}) {
  if (delta > 0) {
    return (
      <span style={{ fontSize: 10, color: '#52C47A' }}>
        &#9650; +{delta.toFixed(1)} {deltaLabel}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span style={{ fontSize: 10, color: '#E86452' }}>
        &#9660; {delta.toFixed(1)} {deltaLabel}
      </span>
    );
  }
  return (
    <span style={{ fontSize: 10, color: '#94A3B8' }}>
      &mdash; 0 {deltaLabel}
    </span>
  );
}

function Sparkline({ data, accent }: { data: number[]; accent: string }) {
  if (data.length < 2) return null;

  const width = 200;
  const height = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block', marginTop: 8 }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={accent}
        strokeOpacity={0.5}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EcoHeroKPI({
  title,
  value,
  icon,
  accent,
  delta,
  deltaLabel = 'vs periodo anterior',
  tooltip,
  sparklineData,
  loading = false,
  valueColor,
  children,
}: EcoHeroKPIProps) {
  if (loading) {
    return (
      <Card
        size="small"
        style={{
          borderRadius: 12,
          borderLeft: `4px solid ${accent}`,
          background: '#fff',
        }}
      >
        <Skeleton active paragraph={{ rows: 3 }} />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      hoverable
      style={{
        borderRadius: 12,
        borderLeft: `4px solid ${accent}`,
        background: '#fff',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              color: '#94A3B8',
              fontWeight: 600,
              letterSpacing: '0.05em',
            }}
          >
            {title}
          </span>
          <Tooltip title={tooltip}>
            <Info size={12} color="#CBD5E1" style={{ cursor: 'help' }} />
          </Tooltip>
        </div>

        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: `${accent}0F`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: valueColor ?? accent,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>

      {/* Delta */}
      {delta != null && (
        <div style={{ marginTop: 4 }}>
          <DeltaIndicator delta={delta} deltaLabel={deltaLabel} />
        </div>
      )}

      {/* Sparkline */}
      {sparklineData && sparklineData.length >= 2 && (
        <Sparkline data={sparklineData} accent={accent} />
      )}

      {/* Children slot */}
      {children}
    </Card>
  );
}
