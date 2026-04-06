'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Row, Col, Skeleton } from 'antd';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import {
  MessageSquare,
  Activity,
  Heart,
  Shield,
} from 'lucide-react';

import { EcoDashboardFilterBar } from '@/components/dashboard/EcoDashboardFilterBar';
import type { DashboardFilters, FilterOptions } from '@/components/dashboard/EcoDashboardFilterBar';
import { EcoHeroKPI } from '@/components/dashboard/EcoHeroKPI';
import { EcoMetricsTimeline } from '@/components/dashboard/EcoMetricsTimeline';
import { EcoTopicTreemap } from '@/components/dashboard/EcoTopicTreemap';
import { EcoAnomalyGauge } from '@/components/dashboard/EcoAnomalyGauge';
import { EcoStatCard } from '@/components/data-display/EcoStatCard';
import { EcoChartCard } from '@/components/data-display/EcoChartCard';
import { EcoMentionDrawer } from '@/components/data-display/EcoMentionDrawer';
import { EcoSentimentBadge } from '@/components/ui/EcoSentimentBadge';
import { EcoSourceBadge } from '@/components/ui/EcoSourceBadge';
import {
  SENTIMENT_COLORS,
  CHART_THEME,
  CHART_COLORS,
  SOURCE_COLORS,
} from '@/theme/chart-theme';
import { PERTINENCE_CONFIG } from '@/theme/constants';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MetricsCurrent {
  nss: number | null;
  brandHealthIndex: number | null;
  reputationMomentum: number | null;
  engagementRate: number | null;
  amplificationRate: number | null;
  engagementVelocity: number | null;
  crisisRiskScore: number | null;
  volumeAnomalyZscore: number | null;
  totalMentions: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  highPertinenceCount?: number;
  totalReach: number;
  nss7d: number | null;
  nss30d: number | null;
}

interface DashboardData {
  metrics: {
    current: MetricsCurrent | null;
    previous: MetricsCurrent | null;
    timeline: Array<Record<string, unknown>>;
    sparklines: { mentions: number[]; nss: number[] };
  };
  topics: Array<{
    slug: string;
    name: string;
    count: number;
    positivePct: number;
    neutralPct: number;
    negativePct: number;
    dominantSentiment: 'positivo' | 'negativo' | 'neutral' | 'mixed';
  }>;
  sentimentBreakdown: Array<{ name: string; value: number; color: string }>;
  topSources: Array<{ source: string; count: number }>;
  recentMentions: Array<{
    id: string;
    title: string | null;
    snippet: string | null;
    domain: string | null;
    pageType: string;
    contentSourceName: string | null;
    nlpSentiment: string | null;
    nlpPertinence: string | null;
    nlpEmotions: string[] | null;
    nlpSummary: string | null;
    engagementScore: number;
    likes: number;
    comments: number;
    shares: number;
    reachEstimate: number;
    publishedAt: string;
    url: string | null;
    author: string | null;
  }>;
  filterOptions: FilterOptions;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TIMELINE_METRICS = [
  { key: 'nss', label: 'NSS', color: '#0A7EA4' },
  { key: 'brandHealthIndex', label: 'BHI', color: '#2E8B6A', yAxisId: 'right' as const },
  { key: 'totalMentions', label: 'Menciones', color: '#64748B' },
  { key: 'crisisRiskScore', label: 'Crisis', color: '#E86452', yAxisId: 'right' as const },
  { key: 'engagementRate', label: 'Eng. Rate', color: '#38BDF8', yAxisId: 'right' as const },
  { key: 'amplificationRate', label: 'Amplificacion', color: '#FB923C', yAxisId: 'right' as const },
  { key: 'engagementVelocity', label: 'Velocity', color: '#A78BFA' },
];

const SENTIMENT_LABELS: Record<string, string> = {
  positivo: 'Positivo',
  neutral: 'Neutral',
  negativo: 'Negativo',
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function computeDelta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null;
  return Math.round((current - previous) * 10) / 10;
}

function crisisLabel(score: number | null): string {
  if (score == null) return '';
  if (score < 0.5) return 'Normal';
  if (score < 1.0) return 'Elevado';
  if (score < 2.0) return 'Alerta';
  return 'Crisis';
}

function crisisColor(score: number | null): string {
  if (score == null) return '#94A3B8';
  if (score < 0.5) return '#52C47A';
  if (score < 1.0) return '#F5A623';
  if (score < 2.0) return '#E86452';
  return '#DC2626';
}

/* ------------------------------------------------------------------ */
/*  Default filter state                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_FILTERS: DashboardFilters = {
  period: '30d',
  customRange: null,
  sentiment: null,
  source: null,
  topic: null,
  pertinence: null,
  municipality: null,
  compare: false,
};

const EMPTY_FILTER_OPTIONS: FilterOptions = {
  sources: [],
  topics: [],
  municipalitiesByRegion: {},
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [selectedMention, setSelectedMention] = useState<DashboardData['recentMentions'][0] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Build query string from filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('period', filters.period);
    if (filters.customRange) {
      params.set('startDate', filters.customRange[0]);
      params.set('endDate', filters.customRange[1]);
    }
    if (filters.sentiment) params.set('sentiment', filters.sentiment);
    if (filters.source) params.set('source', filters.source);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.pertinence) params.set('pertinence', filters.pertinence);
    if (filters.municipality) params.set('municipality', filters.municipality);
    if (filters.compare) params.set('compare', 'true');
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard', queryString],
    queryFn: () => fetch(`/api/dashboard?${queryString}`).then((r) => r.json()),
  });

  const metrics = data?.metrics?.current;
  const previous = data?.metrics?.previous;
  const filterOptions = data?.filterOptions ?? EMPTY_FILTER_OPTIONS;
  const sentimentTotal = data?.sentimentBreakdown?.reduce((a, s) => a + s.value, 0) ?? 0;
  const maxSourceCount = data?.topSources?.length
    ? Math.max(...data.topSources.map((s) => s.count))
    : 1;

  const handleTopicClick = (slug: string) => {
    setFilters((prev) => ({ ...prev, topic: slug }));
  };

  const handleMentionClick = (mention: DashboardData['recentMentions'][0]) => {
    setSelectedMention(mention);
    setDrawerOpen(true);
  };

  // Map mention to drawer format (drawer uses snake_case)
  const drawerMention = selectedMention
    ? {
        id: selectedMention.id,
        title: selectedMention.title,
        full_text: selectedMention.snippet,
        page_type: selectedMention.pageType,
        domain: selectedMention.domain,
        url: selectedMention.url,
        published_at: selectedMention.publishedAt,
        sentiment: selectedMention.nlpSentiment,
        pertinence: selectedMention.nlpPertinence,
        engagement: selectedMention.engagementScore,
        likes: selectedMention.likes,
        shares: selectedMention.shares,
        comments: selectedMention.comments,
        impressions: selectedMention.reachEstimate,
      }
    : null;

  /* ---- Render ---- */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ─── Filter Bar ─── */}
      <EcoDashboardFilterBar
        filters={filters}
        onChange={setFilters}
        filterOptions={filterOptions}
        loading={isLoading}
      />

      {/* ─── 4 Hero KPIs ─── */}
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={6}>
          <EcoHeroKPI
            title="Total Menciones"
            value={metrics ? formatNumber(metrics.totalMentions) : '—'}
            icon={<MessageSquare size={18} color="#64748B" />}
            accent="#64748B"
            delta={computeDelta(metrics?.totalMentions ?? null, previous?.totalMentions ?? null)}
            tooltip="Numero total de menciones detectadas en el periodo seleccionado"
            sparklineData={data?.metrics?.sparklines?.mentions}
            loading={isLoading}
            valueColor="#0E1E2C"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <EcoHeroKPI
            title="Net Sentiment Score"
            value={metrics?.nss != null ? `${metrics.nss > 0 ? '+' : ''}${metrics.nss.toFixed(1)}` : '—'}
            icon={<Activity size={18} color="#0A7EA4" />}
            accent="#0A7EA4"
            delta={computeDelta(metrics?.nss ?? null, previous?.nss ?? null)}
            tooltip="Sentimiento neto: (positivos - negativos) / total x 100. Rango -100 a +100"
            sparklineData={data?.metrics?.sparklines?.nss}
            loading={isLoading}
          >
            {metrics?.nss7d != null && metrics?.nss30d != null && (
              <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4 }}>
                7d: {metrics.nss7d.toFixed(1)} | 30d: {metrics.nss30d.toFixed(1)}
              </div>
            )}
          </EcoHeroKPI>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <EcoHeroKPI
            title="Brand Health Index"
            value={metrics?.brandHealthIndex != null ? metrics.brandHealthIndex.toFixed(2) : '—'}
            icon={<Heart size={18} color="#2E8B6A" />}
            accent="#2E8B6A"
            delta={computeDelta(metrics?.brandHealthIndex ?? null, previous?.brandHealthIndex ?? null)}
            tooltip="Indice compuesto: NSS (40%) + engagement (25%) + alcance (20%) + pertinencia (15%). Rango 0 a 1"
            loading={isLoading}
          >
            {metrics?.brandHealthIndex != null && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 4, background: '#F0F4F8', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(metrics.brandHealthIndex * 100).toFixed(0)}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #2E8B6A, #52C47A)',
                      borderRadius: 2,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#94A3B8', marginTop: 2 }}>
                  <span>0</span>
                  <span>0.5</span>
                  <span>1.0</span>
                </div>
              </div>
            )}
          </EcoHeroKPI>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <EcoHeroKPI
            title="Crisis Risk"
            value={metrics?.crisisRiskScore != null ? metrics.crisisRiskScore.toFixed(1) : '—'}
            icon={<Shield size={18} color={crisisColor(metrics?.crisisRiskScore ?? null)} />}
            accent={crisisColor(metrics?.crisisRiskScore ?? null)}
            tooltip="Detector multi-factor. <0.5 normal, 0.5-1.0 elevado, 1.0-2.0 alerta, >2.0 crisis"
            loading={isLoading}
            deltaLabel={crisisLabel(metrics?.crisisRiskScore ?? null)}
          >
            {metrics?.crisisRiskScore != null && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 6, background: 'linear-gradient(90deg, #52C47A 25%, #F5A623 50%, #E86452 75%, #DC2626 100%)', borderRadius: 3, position: 'relative' }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: `${Math.min((metrics.crisisRiskScore / 3) * 100, 100)}%`,
                      top: -3,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: '#fff',
                      border: `2px solid ${crisisColor(metrics.crisisRiskScore)}`,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      transform: 'translateX(-50%)',
                    }}
                  />
                </div>
              </div>
            )}
          </EcoHeroKPI>
        </Col>
      </Row>

      {/* ─── 4 Compact KPIs ─── */}
      <Row gutter={[10, 10]}>
        <Col xs={12} lg={6}>
          <EcoStatCard
            title="Rep. Momentum"
            value={metrics?.reputationMomentum != null ? `${metrics.reputationMomentum > 0 ? '+' : ''}${metrics.reputationMomentum.toFixed(1)}` : '—'}
            icon={<Activity size={14} color="#8B5CF6" />}
            accentColor="violet"
            valueColor={
              metrics?.reputationMomentum != null
                ? metrics.reputationMomentum > 0 ? '#52C47A' : metrics.reputationMomentum < 0 ? '#E86452' : '#94A3B8'
                : '#94A3B8'
            }
            trend={
              metrics?.reputationMomentum != null
                ? {
                    value: 0,
                    direction: metrics.reputationMomentum > 1 ? 'up' : metrics.reputationMomentum < -1 ? 'down' : 'flat',
                  }
                : undefined
            }
          />
        </Col>
        <Col xs={12} lg={6}>
          <EcoStatCard
            title="Eng. Rate"
            value={metrics?.engagementRate != null ? `${metrics.engagementRate.toFixed(2)}%` : '—'}
            icon={<Heart size={14} color="#38BDF8" />}
            accentColor="sky"
            trend={
              previous?.engagementRate != null && metrics?.engagementRate != null
                ? {
                    value: Math.abs(Number((metrics.engagementRate - previous.engagementRate).toFixed(2))),
                    direction: metrics.engagementRate > previous.engagementRate ? 'up' : metrics.engagementRate < previous.engagementRate ? 'down' : 'flat',
                  }
                : undefined
            }
          />
        </Col>
        <Col xs={12} lg={6}>
          <EcoStatCard
            title="Amplificacion"
            value={metrics?.amplificationRate != null ? `${metrics.amplificationRate.toFixed(1)}%` : '—'}
            icon={<MessageSquare size={14} color="#FB923C" />}
            accentColor="orange"
            trend={
              previous?.amplificationRate != null && metrics?.amplificationRate != null
                ? {
                    value: Math.abs(Number((metrics.amplificationRate - previous.amplificationRate).toFixed(1))),
                    direction: metrics.amplificationRate > previous.amplificationRate ? 'up' : metrics.amplificationRate < previous.amplificationRate ? 'down' : 'flat',
                  }
                : undefined
            }
          />
        </Col>
        <Col xs={12} lg={6}>
          <EcoStatCard
            title="Eng. Velocity"
            value={metrics?.engagementVelocity != null ? `${metrics.engagementVelocity > 0 ? '+' : ''}${metrics.engagementVelocity.toFixed(1)}%` : '—'}
            icon={<Activity size={14} color="#A78BFA" />}
            accentColor="violet"
            valueColor={
              metrics?.engagementVelocity != null
                ? metrics.engagementVelocity > 0 ? '#52C47A' : metrics.engagementVelocity < 0 ? '#E86452' : '#94A3B8'
                : '#94A3B8'
            }
          />
        </Col>
      </Row>

      {/* ─── Charts Row 1: Timeline + Treemap ─── */}
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={14}>
          <EcoMetricsTimeline
            data={data?.metrics?.timeline ?? []}
            availableMetrics={TIMELINE_METRICS}
            defaultActive={['nss', 'brandHealthIndex']}
            loading={isLoading}
          />
        </Col>
        <Col xs={24} lg={10}>
          <EcoTopicTreemap
            data={data?.topics ?? []}
            onTopicClick={handleTopicClick}
            loading={isLoading}
          />
        </Col>
      </Row>

      {/* ─── Charts Row 2: Sentiment + Sources + Anomaly ─── */}
      <Row gutter={[12, 12]}>
        {/* Sentiment Donut */}
        <Col xs={24} md={8}>
          <EcoChartCard title="Sentimiento" loading={isLoading}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 100, height: 100, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data?.sentimentBreakdown ?? []}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={46}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {(data?.sentimentBreakdown ?? []).map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={SENTIMENT_COLORS[entry.name as keyof typeof SENTIMENT_COLORS] ?? '#CBD5E1'}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 11, lineHeight: 2.4 }}>
                {(data?.sentimentBreakdown ?? []).map((s) => {
                  const pct = sentimentTotal > 0 ? Math.round((s.value / sentimentTotal) * 100) : 0;
                  return (
                    <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: SENTIMENT_COLORS[s.name as keyof typeof SENTIMENT_COLORS] ?? '#CBD5E1',
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ color: '#64748B' }}>
                        {SENTIMENT_LABELS[s.name] ?? s.name} <strong>{pct}%</strong>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </EcoChartCard>
        </Col>

        {/* Top Sources */}
        <Col xs={24} md={8}>
          <EcoChartCard title="Top Fuentes" loading={isLoading}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(data?.topSources ?? []).slice(0, 5).map((src, idx) => {
                const color =
                  SOURCE_COLORS[src.source.toLowerCase()] ??
                  CHART_COLORS[idx % CHART_COLORS.length];
                const pct = maxSourceCount > 0 ? (src.count / maxSourceCount) * 100 : 0;
                return (
                  <div key={src.source} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <EcoSourceBadge source={src.source} size={16} />
                    <span style={{ width: 55, fontSize: 10, color: '#64748B', flexShrink: 0 }}>
                      {src.source}
                    </span>
                    <div style={{ flex: 1, height: 6, background: '#F0F4F8', borderRadius: 3, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: color,
                          borderRadius: 3,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B', width: 28, textAlign: 'right' }}>
                      {src.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </EcoChartCard>
        </Col>

        {/* Volume Anomaly */}
        <Col xs={24} md={8}>
          <EcoChartCard title="Anomalia de Volumen" loading={isLoading}>
            <EcoAnomalyGauge zScore={metrics?.volumeAnomalyZscore ?? null} />
          </EcoChartCard>
        </Col>
      </Row>

      {/* ─── Recent Mentions ─── */}
      <EcoChartCard
        title="Menciones Recientes"
        extra={
          <a href="/mentions" style={{ fontSize: 11, color: '#0A7EA4', textDecoration: 'none' }}>
            Ver todas →
          </a>
        }
        loading={isLoading}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(data?.recentMentions ?? []).map((m, idx) => {
            const pertConfig = m.nlpPertinence
              ? PERTINENCE_CONFIG[m.nlpPertinence as keyof typeof PERTINENCE_CONFIG]
              : null;

            return (
              <div
                key={m.id}
                onClick={() => handleMentionClick(m)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr 70px 55px 50px 70px',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 6px',
                  borderRadius: 8,
                  background: idx % 2 === 0 ? '#FAFBFD' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 10,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F0F4F8')}
                onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? '#FAFBFD' : 'transparent')}
              >
                <EcoSourceBadge source={m.contentSourceName ?? m.pageType} size={20} />
                <span
                  style={{
                    color: '#0E1E2C',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.title || m.snippet || 'Sin titulo'}
                </span>
                <EcoSentimentBadge sentiment={m.nlpSentiment ?? 'neutral'} size="small" />
                {pertConfig ? (
                  <span
                    style={{
                      color: pertConfig.color,
                      fontWeight: 600,
                      textAlign: 'center',
                      fontSize: 9,
                    }}
                  >
                    {pertConfig.label}
                  </span>
                ) : (
                  <span />
                )}
                <span style={{ color: '#64748B', textAlign: 'right' }}>
                  {m.engagementScore > 0 ? formatNumber(Math.round(m.engagementScore)) : '—'}
                </span>
                <span style={{ color: '#94A3B8', textAlign: 'right' }}>
                  {formatDistanceToNow(new Date(m.publishedAt), { addSuffix: true, locale: es })}
                </span>
              </div>
            );
          })}
        </div>
      </EcoChartCard>

      {/* ─── Mention Drawer ─── */}
      <EcoMentionDrawer
        open={drawerOpen}
        mention={drawerMention}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedMention(null);
        }}
      />
    </div>
  );
}
