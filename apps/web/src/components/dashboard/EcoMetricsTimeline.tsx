'use client';

import { useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { message } from 'antd';
import { EcoChartCard } from '../data-display/EcoChartCard';
import { CHART_THEME } from '../../theme/chart-theme';

interface MetricConfig {
  key: string;
  label: string;
  color: string;
  yAxisId?: 'left' | 'right';
}

interface Props {
  data: Record<string, unknown>[];
  availableMetrics: MetricConfig[];
  defaultActive?: string[];
  loading?: boolean;
}

export function EcoMetricsTimeline({
  data,
  availableMetrics,
  defaultActive,
  loading = false,
}: Props) {
  const [activeKeys, setActiveKeys] = useState<string[]>(
    defaultActive ?? availableMetrics.slice(0, 2).map((m) => m.key),
  );

  const handleToggle = (key: string) => {
    if (activeKeys.includes(key)) {
      setActiveKeys((prev) => prev.filter((k) => k !== key));
    } else {
      if (activeKeys.length >= 3) {
        message.warning('Maximo 3 metricas simultaneas');
        return;
      }
      setActiveKeys((prev) => [...prev, key]);
    }
  };

  const activeMetrics = availableMetrics.filter((m) => activeKeys.includes(m.key));
  const hasRightAxis = activeMetrics.some((m) => m.yAxisId === 'right');

  return (
    <EcoChartCard title="Tendencia de Metricas" loading={loading}>
      {/* Toggle pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {availableMetrics.map((metric) => {
          const isActive = activeKeys.includes(metric.key);
          return (
            <button
              key={metric.key}
              type="button"
              onClick={() => handleToggle(metric.key)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                border: 'none',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                backgroundColor: isActive ? metric.color : '#F0F4F8',
                color: isActive ? '#FFFFFF' : '#94A3B8',
              }}
            >
              {metric.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data}>
          <CartesianGrid
            stroke={CHART_THEME.grid.stroke}
            strokeDasharray={CHART_THEME.grid.strokeDasharray}
          />
          <XAxis
            dataKey="date"
            stroke={CHART_THEME.axis.stroke}
            fontSize={CHART_THEME.axis.fontSize}
            fill={CHART_THEME.axis.fill}
            tickLine={CHART_THEME.axis.tickLine}
            axisLine={CHART_THEME.axis.axisLine}
          />
          <YAxis
            yAxisId="left"
            stroke={CHART_THEME.axis.stroke}
            fontSize={CHART_THEME.axis.fontSize}
            fill={CHART_THEME.axis.fill}
            tickLine={CHART_THEME.axis.tickLine}
            axisLine={CHART_THEME.axis.axisLine}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke={CHART_THEME.axis.stroke}
              fontSize={CHART_THEME.axis.fontSize}
              fill={CHART_THEME.axis.fill}
              tickLine={CHART_THEME.axis.tickLine}
              axisLine={CHART_THEME.axis.axisLine}
            />
          )}
          <Tooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
          {activeMetrics.map((metric) => (
            <Line
              key={metric.key}
              dataKey={metric.key}
              yAxisId={metric.yAxisId ?? 'left'}
              stroke={metric.color}
              strokeWidth={2}
              dot={false}
              type="monotone"
              name={metric.label}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </EcoChartCard>
  );
}
