'use client';

import { useState, useEffect } from 'react';
import { Row, Col } from 'antd';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { EcoChartCard } from '@/components/data-display/EcoChartCard';
import { SENTIMENT_COLORS, CHART_THEME, CHART_COLORS } from '@/theme/chart-theme';

interface TimelinePoint {
  date: string;
  positivo: number;
  neutral: number;
  negativo: number;
}

interface SourcePoint {
  source: string;
  positivo: number;
  neutral: number;
  negativo: number;
}

interface EmotionPoint {
  emotion: string;
  count: number;
}

interface ComparisonPoint {
  label: string;
  bw: number;
  claude: number;
}

interface SentimentData {
  timeline: TimelinePoint[];
  bySource: SourcePoint[];
  emotions: EmotionPoint[];
  comparison: ComparisonPoint[];
}

const CHART_HEIGHT = 320;

export default function SentimentPage() {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const res = await fetch('/api/sentiment');
        if (!res.ok) throw new Error('Failed to fetch sentiment data');
        const json: SentimentData = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        console.error('Error fetching sentiment data:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Row gutter={[24, 24]}>
        {/* Sentiment over time -- Stacked Area Chart */}
        <Col xs={24} lg={12}>
          <EcoChartCard
            title="Sentimiento en el tiempo"
            subtitle="Tendencia de positivo, neutral y negativo"
            loading={loading}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <AreaChart data={data?.timeline ?? []}>
                <defs>
                  <linearGradient id="gradPositivo" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={SENTIMENT_COLORS.positivo}
                      stopOpacity={CHART_THEME.area.gradientOpacityStart}
                    />
                    <stop
                      offset="100%"
                      stopColor={SENTIMENT_COLORS.positivo}
                      stopOpacity={CHART_THEME.area.gradientOpacityEnd}
                    />
                  </linearGradient>
                  <linearGradient id="gradNeutral" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={SENTIMENT_COLORS.neutral}
                      stopOpacity={CHART_THEME.area.gradientOpacityStart}
                    />
                    <stop
                      offset="100%"
                      stopColor={SENTIMENT_COLORS.neutral}
                      stopOpacity={CHART_THEME.area.gradientOpacityEnd}
                    />
                  </linearGradient>
                  <linearGradient id="gradNegativo" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={SENTIMENT_COLORS.negativo}
                      stopOpacity={CHART_THEME.area.gradientOpacityStart}
                    />
                    <stop
                      offset="100%"
                      stopColor={SENTIMENT_COLORS.negativo}
                      stopOpacity={CHART_THEME.area.gradientOpacityEnd}
                    />
                  </linearGradient>
                </defs>
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
                  stroke={CHART_THEME.axis.stroke}
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                  tickLine={CHART_THEME.axis.tickLine}
                  axisLine={CHART_THEME.axis.axisLine}
                />
                <Tooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="positivo"
                  stackId="1"
                  stroke={SENTIMENT_COLORS.positivo}
                  fill="url(#gradPositivo)"
                />
                <Area
                  type="monotone"
                  dataKey="neutral"
                  stackId="1"
                  stroke={SENTIMENT_COLORS.neutral}
                  fill="url(#gradNeutral)"
                />
                <Area
                  type="monotone"
                  dataKey="negativo"
                  stackId="1"
                  stroke={SENTIMENT_COLORS.negativo}
                  fill="url(#gradNegativo)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </EcoChartCard>
        </Col>

        {/* Sentiment by source -- Grouped Bar Chart */}
        <Col xs={24} lg={12}>
          <EcoChartCard
            title="Sentimiento por fuente"
            subtitle="Distribucion por plataforma"
            loading={loading}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={data?.bySource ?? []}>
                <CartesianGrid
                  stroke={CHART_THEME.grid.stroke}
                  strokeDasharray={CHART_THEME.grid.strokeDasharray}
                />
                <XAxis
                  dataKey="source"
                  stroke={CHART_THEME.axis.stroke}
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                  tickLine={CHART_THEME.axis.tickLine}
                  axisLine={CHART_THEME.axis.axisLine}
                />
                <YAxis
                  stroke={CHART_THEME.axis.stroke}
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                  tickLine={CHART_THEME.axis.tickLine}
                  axisLine={CHART_THEME.axis.axisLine}
                />
                <Tooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
                <Legend />
                <Bar dataKey="positivo" fill={SENTIMENT_COLORS.positivo} radius={[4, 4, 0, 0]} />
                <Bar dataKey="neutral" fill={SENTIMENT_COLORS.neutral} radius={[4, 4, 0, 0]} />
                <Bar dataKey="negativo" fill={SENTIMENT_COLORS.negativo} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </EcoChartCard>
        </Col>

        {/* Emotion distribution -- Radar Chart */}
        <Col xs={24} lg={12}>
          <EcoChartCard
            title="Distribucion de emociones"
            subtitle="Perfil emocional detectado"
            loading={loading}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <RadarChart data={data?.emotions ?? []}>
                <PolarGrid stroke={CHART_THEME.grid.stroke} />
                <PolarAngleAxis
                  dataKey="emotion"
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                />
                <PolarRadiusAxis
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                />
                <Tooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
                <Radar
                  name="Emociones"
                  dataKey="count"
                  stroke={CHART_COLORS[0]}
                  fill={CHART_COLORS[0]}
                  fillOpacity={0.3}
                />
              </RadarChart>
            </ResponsiveContainer>
          </EcoChartCard>
        </Col>

        {/* Brandwatch vs Claude comparison -- Grouped Bar Chart */}
        <Col xs={24} lg={12}>
          <EcoChartCard
            title="Brandwatch vs Claude"
            subtitle="Comparacion de clasificacion de sentimiento"
            loading={loading}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={data?.comparison ?? []}>
                <CartesianGrid
                  stroke={CHART_THEME.grid.stroke}
                  strokeDasharray={CHART_THEME.grid.strokeDasharray}
                />
                <XAxis
                  dataKey="label"
                  stroke={CHART_THEME.axis.stroke}
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                  tickLine={CHART_THEME.axis.tickLine}
                  axisLine={CHART_THEME.axis.axisLine}
                />
                <YAxis
                  stroke={CHART_THEME.axis.stroke}
                  fontSize={CHART_THEME.axis.fontSize}
                  fill={CHART_THEME.axis.fill}
                  tickLine={CHART_THEME.axis.tickLine}
                  axisLine={CHART_THEME.axis.axisLine}
                />
                <Tooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
                <Legend />
                <Bar
                  dataKey="bw"
                  name="Brandwatch"
                  fill={CHART_COLORS[0]}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="claude"
                  name="Claude"
                  fill={CHART_COLORS[1]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </EcoChartCard>
        </Col>
      </Row>
    </div>
  );
}
