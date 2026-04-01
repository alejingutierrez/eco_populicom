'use client';

import { useEffect, useState } from 'react';
import { Row, Col, Card, List, Skeleton, Typography } from 'antd';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { MessageSquare, AlertTriangle, Heart, Globe } from 'lucide-react';

import { EcoStatCard } from '@/components/data-display/EcoStatCard';
import { EcoChartCard } from '@/components/data-display/EcoChartCard';
import { EcoSentimentBadge } from '@/components/ui/EcoSentimentBadge';
import { EcoSourceBadge } from '@/components/ui/EcoSourceBadge';
import { EcoPeriodSelector } from '@/components/ui/EcoPeriodSelector';
import {
  CHART_COLORS,
  SENTIMENT_COLORS,
  CHART_THEME,
  SOURCE_COLORS,
} from '@/theme/chart-theme';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DashboardData {
  kpis: {
    totalMentions: number;
    negativePct: number;
    avgEngagement: number;
    totalReach: number;
  };
  timeline: Array<{ date: string; count: number }>;
  sentimentBreakdown: Array<{ name: string; value: number; color: string }>;
  topSources: Array<{ source: string; count: number }>;
  recentMentions: Array<{
    id: string;
    title: string;
    domain: string;
    pageType: string;
    nlpSentiment: string;
    publishedAt: string;
    engagementScore: number;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const PERIOD_OPTIONS = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
];

const SENTIMENT_LABELS: Record<string, string> = {
  positivo: 'Positivo',
  neutral: 'Neutral',
  negativo: 'Negativo',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30d');

  useEffect(() => {
    setLoading(true);
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  /* ---- Loading skeleton ---- */
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ marginBottom: 4 }}>
          <Skeleton active title={{ width: 180 }} paragraph={{ rows: 0 }} />
        </div>
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map((i) => (
            <Col key={i} xs={24} sm={12} lg={6}>
              <EcoStatCard
                title=""
                value=""
                icon={null}
                accentColor="ocean"
                loading
              />
            </Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <EcoChartCard title="Menciones por Dia" loading>
              <div />
            </EcoChartCard>
          </Col>
          <Col xs={24} lg={8}>
            <EcoChartCard title="Sentimiento" loading>
              <div />
            </EcoChartCard>
          </Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <EcoChartCard title="Top Fuentes" loading>
              <div />
            </EcoChartCard>
          </Col>
          <Col xs={24} lg={16}>
            <EcoChartCard title="Menciones Recientes" loading>
              <div />
            </EcoChartCard>
          </Col>
        </Row>
      </div>
    );
  }

  /* ---- Empty state ---- */
  if (!data) {
    return (
      <div
        style={{
          display: 'flex',
          height: 256,
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94A3B8',
          fontSize: 14,
        }}
      >
        No hay datos disponibles. Esperando ingestion de menciones.
      </div>
    );
  }

  /* ---- Derived values ---- */
  const sparklineCounts = data.timeline.map((t) => t.count);
  const maxSourceCount =
    data.topSources.length > 0
      ? Math.max(...data.topSources.map((s) => s.count))
      : 1;
  const sentimentTotal = data.sentimentBreakdown.reduce(
    (acc, s) => acc + s.value,
    0,
  );

  /* ---- Render ---- */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <Typography.Title level={4} style={{ margin: 0, color: '#0E1E2C' }}>
            Dashboard
          </Typography.Title>
          <Typography.Text style={{ fontSize: 13, color: '#94A3B8' }}>
            AAA — Autoridad de Acueductos y Alcantarillados
          </Typography.Text>
        </div>
        <EcoPeriodSelector
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
        />
      </div>

      {/* KPI Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <EcoStatCard
            title="Total Menciones"
            value={data.kpis.totalMentions.toLocaleString()}
            icon={<MessageSquare size={14} color="#0A7EA4" />}
            accentColor="ocean"
            sparklineData={sparklineCounts}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <EcoStatCard
            title="Menciones Negativas"
            value={`${data.kpis.negativePct}%`}
            icon={<AlertTriangle size={14} color="#E86452" />}
            accentColor="error"
            valueColor="#E86452"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <EcoStatCard
            title="Engagement Promedio"
            value={data.kpis.avgEngagement.toFixed(1)}
            icon={<Heart size={14} color="#2E8B6A" />}
            accentColor="mangrove"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <EcoStatCard
            title="Alcance Total"
            value={formatNumber(data.kpis.totalReach)}
            icon={<Globe size={14} color="#F5A623" />}
            accentColor="amber"
          />
        </Col>
      </Row>

      {/* Charts Row: Timeline + Sentiment */}
      <Row gutter={[16, 16]}>
        {/* Timeline Area Chart */}
        <Col xs={24} lg={16}>
          <EcoChartCard
            title="Menciones por Dia"
            subtitle="Tendencia de volumen en el periodo seleccionado"
          >
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.timeline}
                  margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
                >
                  <defs>
                    <linearGradient
                      id="areaGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={CHART_COLORS[0]}
                        stopOpacity={CHART_THEME.area.gradientOpacityStart}
                      />
                      <stop
                        offset="100%"
                        stopColor={CHART_COLORS[0]}
                        stopOpacity={CHART_THEME.area.gradientOpacityEnd}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke={CHART_THEME.grid.stroke}
                    strokeDasharray={CHART_THEME.grid.strokeDasharray}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    fontSize={CHART_THEME.axis.fontSize}
                    fill={CHART_THEME.axis.fill}
                    tickLine={CHART_THEME.axis.tickLine}
                    axisLine={CHART_THEME.axis.axisLine}
                    dy={8}
                  />
                  <YAxis
                    fontSize={CHART_THEME.axis.fontSize}
                    fill={CHART_THEME.axis.fill}
                    tickLine={CHART_THEME.axis.tickLine}
                    axisLine={CHART_THEME.axis.axisLine}
                    dx={-4}
                  />
                  <Tooltip
                    contentStyle={CHART_THEME.tooltip.contentStyle}
                    labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke={CHART_COLORS[0]}
                    strokeWidth={2}
                    fill="url(#areaGradient)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </EcoChartCard>
        </Col>

        {/* Sentiment Donut */}
        <Col xs={24} lg={8}>
          <EcoChartCard
            title="Sentimiento"
            subtitle="Distribucion general por tono"
          >
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.sentimentBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {data.sentimentBreakdown.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={
                          SENTIMENT_COLORS[
                            entry.name as keyof typeof SENTIMENT_COLORS
                          ] ?? '#CBD5E1'
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CHART_THEME.tooltip.contentStyle}
                    formatter={(value: number, name: string) => [
                      value,
                      SENTIMENT_LABELS[name] ?? name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Sentiment Legend */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 20,
                marginTop: 8,
              }}
            >
              {data.sentimentBreakdown.map((s) => {
                const pct =
                  sentimentTotal > 0
                    ? Math.round((s.value / sentimentTotal) * 100)
                    : 0;
                return (
                  <div
                    key={s.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: '#64748B',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background:
                          SENTIMENT_COLORS[
                            s.name as keyof typeof SENTIMENT_COLORS
                          ] ?? '#CBD5E1',
                      }}
                    />
                    <span>
                      {SENTIMENT_LABELS[s.name] ?? s.name} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </EcoChartCard>
        </Col>
      </Row>

      {/* Bottom Row: Sources + Recent Mentions */}
      <Row gutter={[16, 16]}>
        {/* Top Sources - horizontal progress bars */}
        <Col xs={24} lg={8}>
          <EcoChartCard
            title="Top Fuentes"
            subtitle="Por volumen de menciones"
          >
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {data.topSources.map((src, idx) => {
                const color =
                  SOURCE_COLORS[src.source.toLowerCase()] ??
                  CHART_COLORS[idx % CHART_COLORS.length];
                const pct =
                  maxSourceCount > 0
                    ? (src.count / maxSourceCount) * 100
                    : 0;
                return (
                  <div key={src.source}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <EcoSourceBadge
                        source={src.source}
                        showLabel
                        size={22}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#0E1E2C',
                        }}
                      >
                        {src.count.toLocaleString()}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        background: '#F0F4F8',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: `linear-gradient(90deg, ${color}, ${color}99)`,
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </EcoChartCard>
        </Col>

        {/* Recent Mentions */}
        <Col xs={24} lg={16}>
          <EcoChartCard
            title="Menciones Recientes"
            subtitle="Ultimas menciones procesadas"
          >
            <List
              dataSource={data.recentMentions}
              split={false}
              renderItem={(m) => (
                <List.Item
                  key={m.id}
                  style={{
                    padding: '10px 12px',
                    marginBottom: 8,
                    borderRadius: 10,
                    background: '#FAFBFD',
                    border: '1px solid #EEF2F6',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      width: '100%',
                    }}
                  >
                    <EcoSourceBadge source={m.pageType} size={28} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#0E1E2C',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.title || 'Sin titulo'}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 4,
                          fontSize: 12,
                          color: '#94A3B8',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>{m.domain}</span>
                        <span style={{ color: '#CBD5E1' }}>|</span>
                        <span>
                          {new Date(m.publishedAt).toLocaleDateString('es-PR')}
                        </span>
                        <EcoSentimentBadge
                          sentiment={m.nlpSentiment}
                          size="small"
                        />
                        {m.engagementScore > 0 && (
                          <span
                            style={{
                              fontSize: 11,
                              color: '#64748B',
                              fontWeight: 500,
                            }}
                          >
                            Eng: {m.engagementScore.toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </EcoChartCard>
        </Col>
      </Row>
    </div>
  );
}
