'use client';

import { useQuery } from '@tanstack/react-query';
import { Spin, Typography, Card, Statistic, Tag, Table, Empty, Divider, Space } from 'antd';
import { useAgency } from '@/contexts/AgencyContext';
import { NarrativeStatusBadge } from './NarrativeStatusBadge';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

const { Title, Paragraph, Text } = Typography;

interface InitiatorFirst {
  author?: string | null;
  platform?: string | null;
  publishedAt?: string | null;
  url?: string | null;
  snippet?: string | null;
}
interface InitiatorInfluencer {
  author?: string | null;
  reach?: number | null;
  engagement?: number | null;
  publishedAt?: string | null;
  url?: string | null;
}

interface NarrativeDetailData {
  narrative: {
    id: string;
    name: string;
    slug: string;
    summary: string | null;
    keywords: string[];
    status: string;
    mentionCount: number;
    velocity24h: number;
    totalEngagement: number;
    totalReach: number;
    bornAt: string;
    lastMentionAt: string | null;
    initiatorFirst: InitiatorFirst | null;
    initiatorInfluencer: InitiatorInfluencer | null;
  };
  timeline: { day: string; mentions: number; engagement: number }[];
  topAuthors: { author: string; mentions: number; engagement: number; reach: number }[];
  platforms: { platform: string; mentions: number }[];
  edges: { otherId: string; edgeType: string; strength: number; otherName: string; otherSlug: string; otherStatus: string }[];
  recentMentions: { id: string; title: string; snippet: string | null; author: string | null; url: string | null; publishedAt: string; pageType: string | null; sentiment: string | null; engagement: number }[];
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es').format(n);
}

export function NarrativeDetail({ narrativeId }: { narrativeId: string }) {
  const { selectedAgency } = useAgency();
  const { data, isLoading, error } = useQuery<NarrativeDetailData>({
    queryKey: ['narrative-detail', narrativeId, selectedAgency],
    queryFn: () =>
      fetch(`/api/narrative/${narrativeId}?agency=${selectedAgency}`).then((r) => {
        if (!r.ok) throw new Error('Fetch failed');
        return r.json();
      }),
    enabled: !!narrativeId,
    staleTime: 60_000,
  });

  if (isLoading) return <div style={{ padding: 32, textAlign: 'center' }}><Spin /></div>;
  if (error || !data) return <Empty description="No se pudo cargar la narrativa" />;

  const { narrative, timeline, topAuthors, platforms, edges, recentMentions } = data;

  return (
    <div>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <NarrativeStatusBadge status={narrative.status} />
        <Title level={3} style={{ margin: 0 }}>{narrative.name}</Title>
        {narrative.summary && <Paragraph type="secondary" style={{ marginBottom: 4 }}>{narrative.summary}</Paragraph>}
        <Space wrap size={4} style={{ marginTop: 4 }}>
          {narrative.keywords.map((k) => (
            <Tag key={k}>{k}</Tag>
          ))}
        </Space>
      </Space>

      <Divider />

      <Space wrap size={16}>
        <Statistic title="Menciones" value={narrative.mentionCount} />
        <Statistic title="Vel. 24h" value={narrative.velocity24h} precision={1} />
        <Statistic title="Engagement" value={narrative.totalEngagement} />
        <Statistic title="Reach" value={narrative.totalReach} />
        <Statistic title="Nacida" value={fmtDate(narrative.bornAt)} />
      </Space>

      <Divider titlePlacement="start">Iniciadores</Divider>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Card size="small" title="Primera mención (cronológica)">
          {narrative.initiatorFirst ? (
            <>
              <div><Text strong>{narrative.initiatorFirst.author ?? '—'}</Text> {narrative.initiatorFirst.platform && <Tag>{narrative.initiatorFirst.platform}</Tag>}</div>
              <Text type="secondary" style={{ fontSize: 12 }}>{fmtDate(narrative.initiatorFirst.publishedAt)}</Text>
              {narrative.initiatorFirst.snippet && (
                <Paragraph style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>{narrative.initiatorFirst.snippet}</Paragraph>
              )}
              {narrative.initiatorFirst.url && (
                <a href={narrative.initiatorFirst.url} target="_blank" rel="noopener" style={{ fontSize: 12 }}>Ver fuente →</a>
              )}
            </>
          ) : <Empty description="Sin datos" image={null} />}
        </Card>
        <Card size="small" title="Voz más influyente (primeras 24h)">
          {narrative.initiatorInfluencer ? (
            <>
              <div><Text strong>{narrative.initiatorInfluencer.author ?? '—'}</Text></div>
              <Space size={16} style={{ marginTop: 4 }}>
                <span><Text type="secondary">Reach:</Text> {fmtNum(narrative.initiatorInfluencer.reach)}</span>
                <span><Text type="secondary">Eng:</Text> {fmtNum(narrative.initiatorInfluencer.engagement)}</span>
              </Space>
              {narrative.initiatorInfluencer.url && (
                <div style={{ marginTop: 4 }}>
                  <a href={narrative.initiatorInfluencer.url} target="_blank" rel="noopener" style={{ fontSize: 12 }}>Ver fuente →</a>
                </div>
              )}
            </>
          ) : <Empty description="Aún sin datos (requiere ≥24h)" image={null} />}
        </Card>
      </Space>

      {timeline.length > 0 && (
        <>
          <Divider titlePlacement="start">Timeline (90 días)</Divider>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="mentions" fill="#0A7EA4" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {topAuthors.length > 0 && (
        <>
          <Divider titlePlacement="start">Top voces</Divider>
          <Table
            size="small"
            dataSource={topAuthors}
            rowKey={(r) => r.author}
            pagination={false}
            columns={[
              { title: 'Autor', dataIndex: 'author', ellipsis: true },
              { title: 'Menc.', dataIndex: 'mentions', width: 70, align: 'right' as const },
              { title: 'Eng.', dataIndex: 'engagement', width: 90, align: 'right' as const, render: (v: number) => fmtNum(v) },
            ]}
          />
        </>
      )}

      {edges.length > 0 && (
        <>
          <Divider titlePlacement="start">Narrativas relacionadas</Divider>
          {edges.map((e) => (
            <div key={`${e.otherId}-${e.edgeType}`} style={{ marginBottom: 6 }}>
              <Tag color={e.edgeType === 'semantic' ? 'blue' : e.edgeType === 'author_overlap' ? 'purple' : 'volcano'}>
                {e.edgeType}
              </Tag>
              <Text style={{ marginLeft: 4 }}>{e.otherName}</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>({(e.strength * 100).toFixed(0)}%)</Text>
            </div>
          ))}
        </>
      )}

      {recentMentions.length > 0 && (
        <>
          <Divider titlePlacement="start">Menciones recientes</Divider>
          {recentMentions.map((m) => (
            <Card key={m.id} size="small" style={{ marginBottom: 8 }}>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text strong style={{ fontSize: 13 }}>{m.title ?? '(sin título)'}</Text>
                <Space size={8}>
                  {m.author && <Tag color="default">{m.author}</Tag>}
                  {m.pageType && <Tag>{m.pageType}</Tag>}
                  {m.sentiment && <Tag color={m.sentiment === 'positivo' ? 'green' : m.sentiment === 'negativo' ? 'red' : 'default'}>{m.sentiment}</Tag>}
                  <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(m.publishedAt)}</Text>
                </Space>
                {m.snippet && <Paragraph style={{ fontSize: 12, marginBottom: 0 }} ellipsis={{ rows: 2 }}>{m.snippet}</Paragraph>}
                {m.url && <a href={m.url} target="_blank" rel="noopener" style={{ fontSize: 11 }}>Ver →</a>}
              </Space>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
