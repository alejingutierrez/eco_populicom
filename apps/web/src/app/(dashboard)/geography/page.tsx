'use client';

import { useEffect, useMemo, useState } from 'react';
import { Row, Col, Collapse, Card, Typography } from 'antd';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { EcoChartCard } from '@/components/data-display/EcoChartCard';
import { CHART_COLORS, CHART_THEME } from '@/theme/chart-theme';

const { Title, Text } = Typography;

interface MunicipalityData {
  slug: string;
  name: string;
  region: string;
  count: number;
  topSentiment: string;
}

export default function GeographyPage() {
  const [municipalities, setMunicipalities] = useState<MunicipalityData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/geography')
      .then((r) => r.json())
      .then((d) => setMunicipalities(d.municipalities ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const top10 = useMemo(
    () =>
      [...municipalities]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    [municipalities],
  );

  const byRegion = useMemo(() => {
    const grouped: Record<string, MunicipalityData[]> = {};
    for (const m of municipalities) {
      (grouped[m.region] ??= []).push(m);
    }
    return grouped;
  }, [municipalities]);

  const collapseItems = useMemo(
    () =>
      Object.entries(byRegion).map(([region, munis]) => {
        const total = munis.reduce((s, m) => s + m.count, 0);
        return {
          key: region,
          label: `${region} (${total} menciones)`,
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {munis.map((m) => (
                <div
                  key={m.slug}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text type="secondary">{m.name}</Text>
                  <Text strong>{m.count}</Text>
                </div>
              ))}
            </div>
          ),
        };
      }),
    [byRegion],
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Geografia</Title>
        <EcoChartCard title="Top Municipios por Menciones" loading>
          <div />
        </EcoChartCard>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>Geografia</Title>
        <Text type="secondary">Distribucion de menciones por municipio de Puerto Rico</Text>
      </div>

      <EcoChartCard title="Top Municipios por Menciones">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={top10} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid
              stroke={CHART_THEME.grid.stroke}
              strokeDasharray={CHART_THEME.grid.strokeDasharray}
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fontSize: CHART_THEME.axis.fontSize, fill: CHART_THEME.axis.fill }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={100}
              tick={{ fontSize: CHART_THEME.axis.fontSize, fill: CHART_THEME.axis.fill }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip contentStyle={CHART_THEME.tooltip.contentStyle} />
            <Bar dataKey="count" name="Menciones" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </EcoChartCard>

      <Card>
        <Title level={5} style={{ marginTop: 0 }}>Municipios por Region</Title>
        <Collapse items={collapseItems} />
      </Card>
    </div>
  );
}
