'use client';

import { useEffect, useState } from 'react';
import { Card, CardTitle, CardValue } from '@/components/ui/card';
import { SentimentBadge } from '@/components/sentiment-badge';
import { SourceIcon } from '@/components/source-icon';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from 'recharts';

interface DashboardData {
  kpis: { totalMentions: number; negativePct: number; avgEngagement: number; totalReach: number };
  timeline: Array<{ date: string; count: number }>;
  sentimentBreakdown: Array<{ name: string; value: number; color: string }>;
  topSources: Array<{ source: string; count: number }>;
  recentMentions: Array<{
    id: string; title: string; domain: string; pageType: string;
    nlpSentiment: string; publishedAt: string; engagementScore: number;
  }>;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positivo: '#4ade80',
  neutral: '#94a3b8',
  negativo: '#f87171',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Cargando dashboard...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No hay datos disponibles. Esperando ingestion de menciones.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          AAA — Autoridad de Acueductos y Alcantarillados
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardTitle>Total Menciones</CardTitle>
          <CardValue>{data.kpis.totalMentions.toLocaleString()}</CardValue>
        </Card>
        <Card>
          <CardTitle>Menciones Negativas</CardTitle>
          <CardValue className="text-negative">{data.kpis.negativePct}%</CardValue>
        </Card>
        <Card>
          <CardTitle>Engagement Promedio</CardTitle>
          <CardValue>{data.kpis.avgEngagement.toFixed(1)}</CardValue>
        </Card>
        <Card>
          <CardTitle>Alcance Total</CardTitle>
          <CardValue>{formatNumber(data.kpis.totalReach)}</CardValue>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Timeline */}
        <Card className="col-span-2">
          <CardTitle>Menciones por Día</CardTitle>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.timeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '0.5rem' }}
                  labelStyle={{ color: 'var(--color-foreground)' }}
                />
                <Line type="monotone" dataKey="count" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Sentiment Donut */}
        <Card>
          <CardTitle>Sentimiento</CardTitle>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.sentimentBreakdown}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.sentimentBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 text-xs text-muted-foreground">
              {data.sentimentBreakdown.map((s) => (
                <span key={s.name} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name} ({s.value})
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Top Sources */}
        <Card>
          <CardTitle>Top Fuentes</CardTitle>
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topSources} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <YAxis type="category" dataKey="source" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} width={100} />
                <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '0.5rem' }} />
                <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Recent Mentions */}
        <Card className="col-span-2">
          <CardTitle>Menciones Recientes</CardTitle>
          <div className="mt-3 space-y-3">
            {data.recentMentions.map((m) => (
              <div key={m.id} className="flex items-start gap-3 rounded-md border border-border/50 p-3">
                <SourceIcon pageType={m.pageType} className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {m.title || 'Sin título'}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{m.domain}</span>
                    <span>·</span>
                    <span>{new Date(m.publishedAt).toLocaleDateString('es-PR')}</span>
                    <SentimentBadge sentiment={m.nlpSentiment} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
