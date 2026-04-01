'use client';

import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

interface SentimentData {
  timeline: Array<{ date: string; positivo: number; neutral: number; negativo: number }>;
  bySource: Array<{ source: string; positivo: number; neutral: number; negativo: number }>;
  emotions: Array<{ emotion: string; count: number }>;
  comparison: Array<{ label: string; bw: number; claude: number }>;
}

export default function SentimentPage() {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sentiment')
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Cargando...</div>;
  }
  if (!data) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">No hay datos</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">Análisis de Sentimiento</h1>

      {/* Sentiment over time */}
      <Card>
        <CardTitle>Sentimiento por Día</CardTitle>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '0.5rem' }} />
              <Area type="monotone" dataKey="positivo" stackId="1" stroke="#4ade80" fill="#4ade80" fillOpacity={0.6} />
              <Area type="monotone" dataKey="neutral" stackId="1" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.3} />
              <Area type="monotone" dataKey="negativo" stackId="1" stroke="#f87171" fill="#f87171" fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        {/* By source */}
        <Card>
          <CardTitle>Sentimiento por Fuente</CardTitle>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.bySource}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="source" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
                <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '0.5rem' }} />
                <Bar dataKey="positivo" fill="#4ade80" stackId="stack" />
                <Bar dataKey="neutral" fill="#94a3b8" stackId="stack" />
                <Bar dataKey="negativo" fill="#f87171" stackId="stack" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Emotions radar */}
        <Card>
          <CardTitle>Distribución de Emociones</CardTitle>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data.emotions} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis dataKey="emotion" tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} />
                <PolarRadiusAxis tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} />
                <Radar dataKey="count" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Brandwatch vs Claude comparison */}
      <Card>
        <CardTitle>Comparación: Brandwatch vs Claude Opus</CardTitle>
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.comparison} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} width={80} />
              <Tooltip contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '0.5rem' }} />
              <Bar dataKey="bw" name="Brandwatch" fill="#94a3b8" />
              <Bar dataKey="claude" name="Claude Opus" fill="var(--color-primary)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
