'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Layout,
  Typography,
  Select,
  Space,
  Card,
  Drawer,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Alert,
} from 'antd';
import { BranchesOutlined, ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useAgency } from '@/contexts/AgencyContext';
import {
  NarrativeGraph,
  type GraphNode,
  type GraphEdge,
} from '@/components/narratives/NarrativeGraph';
import { TimelineSlider } from '@/components/narratives/TimelineSlider';
import { NarrativeDetail } from '@/components/narratives/NarrativeDetail';
import { NarrativeStatusBadge } from '@/components/narratives/NarrativeStatusBadge';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

interface NarrativeListItem {
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
  peakedAt: string | null;
  initiatorFirst: Record<string, unknown> | null;
  initiatorInfluencer: Record<string, unknown> | null;
}

interface NarrativesResponse {
  narratives: NarrativeListItem[];
  meta: { total: number; period: string; statusFilter: string[] | null };
}

interface EdgesResponse {
  edges: GraphEdge[];
  meta: { total: number };
}

const STATUS_OPTIONS = [
  { value: 'emerging', label: 'Emergente' },
  { value: 'active', label: 'Activa' },
  { value: 'peaking', label: 'Pico' },
  { value: 'declining', label: 'Decae' },
  { value: 'revived', label: 'Revivida' },
  { value: 'dormant', label: 'Dormida' },
];

export default function NarrativesPage() {
  const { selectedAgency, isLoading: isAgencyLoading } = useAgency();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<[string, string] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ width: 800, height: 500 });

  // Query narrativas
  const narrativesQuery = useQuery<NarrativesResponse>({
    queryKey: ['narratives', selectedAgency, statusFilter.join(',')],
    queryFn: () => {
      const params = new URLSearchParams({ agency: selectedAgency, limit: '500' });
      if (statusFilter.length > 0) params.set('status', statusFilter.join(','));
      return fetch(`/api/narrative?${params}`).then((r) => r.json());
    },
    enabled: !!selectedAgency && !isAgencyLoading,
    staleTime: 60_000,
  });

  // Query edges
  const edgesQuery = useQuery<EdgesResponse>({
    queryKey: ['narrative-edges', selectedAgency],
    queryFn: () => fetch(`/api/narrative/edges?agency=${selectedAgency}&minStrength=0.15`).then((r) => r.json()),
    enabled: !!selectedAgency && !isAgencyLoading,
    staleTime: 60_000,
  });

  // Inicializar el rango de tiempo cuando llegan datos
  useEffect(() => {
    if (!narrativesQuery.data?.narratives.length || timeRange) return;
    const dates = narrativesQuery.data.narratives
      .map((n) => n.bornAt)
      .filter(Boolean)
      .sort();
    if (dates.length > 0) {
      const min = dates[0].slice(0, 10);
      const max = (dates[dates.length - 1] ?? new Date().toISOString()).slice(0, 10);
      setTimeRange([min, max]);
    }
  }, [narrativesQuery.data, timeRange]);

  // Responsive: medir contenedor
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      setGraphSize({ width: el.clientWidth, height: Math.max(400, el.clientHeight) });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Filtrado por timeRange
  const filteredData = useMemo(() => {
    const narratives = narrativesQuery.data?.narratives ?? [];
    const edges = edgesQuery.data?.edges ?? [];
    if (!timeRange) return { nodes: narratives, edges };
    const [from, to] = timeRange;
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to + 'T23:59:59').getTime();
    const visible = narratives.filter((n) => {
      const t = new Date(n.bornAt).getTime();
      return t >= fromMs && t <= toMs;
    });
    const visibleIds = new Set(visible.map((n) => n.id));
    const visibleEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
    return { nodes: visible, edges: visibleEdges };
  }, [narrativesQuery.data, edgesQuery.data, timeRange]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedId(node.id);
    setDrawerOpen(true);
  }, []);

  const allDates = useMemo(() => {
    const dates = (narrativesQuery.data?.narratives ?? [])
      .map((n) => n.bornAt?.slice(0, 10))
      .filter(Boolean) as string[];
    if (dates.length === 0) return null;
    dates.sort();
    return { min: dates[0], max: dates[dates.length - 1] };
  }, [narrativesQuery.data]);

  const nodes: GraphNode[] = filteredData.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    status: n.status,
    mentionCount: n.mentionCount,
    velocity24h: n.velocity24h,
  }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: 'white', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <Space size={12}>
          <Link href="/overview"><a><BranchesOutlined style={{ fontSize: 20, color: '#0A7EA4' }} /></a></Link>
          <Title level={4} style={{ margin: 0 }}>Narrativas</Title>
          <Tooltip title="Clusters emergentes de menciones, complementarios a tópicos. Cada narrativa nace de un grupo denso de menciones similares y tiene su propio ciclo de vida.">
            <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
          </Tooltip>
        </Space>
        <Space>
          <Select
            mode="multiple"
            placeholder="Filtrar por estado"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
            style={{ minWidth: 240 }}
            allowClear
            maxTagCount="responsive"
          />
          <Tooltip title="Recargar datos">
            <ReloadOutlined
              style={{ cursor: 'pointer', fontSize: 18, color: '#0A7EA4' }}
              onClick={() => {
                narrativesQuery.refetch();
                edgesQuery.refetch();
              }}
            />
          </Tooltip>
        </Space>
      </Header>

      <Content style={{ padding: 24 }}>
        {narrativesQuery.isLoading || edgesQuery.isLoading ? (
          <Card><div style={{ textAlign: 'center', padding: 64 }}><Spin tip="Cargando narrativas..." /></div></Card>
        ) : narrativesQuery.error ? (
          <Alert type="error" message="Error cargando narrativas" description={String(narrativesQuery.error)} />
        ) : (narrativesQuery.data?.narratives.length ?? 0) === 0 ? (
          <Card>
            <Empty
              description={
                <Space direction="vertical">
                  <Text>Aún no hay narrativas para esta agencia.</Text>
                  <Paragraph type="secondary" style={{ maxWidth: 480, textAlign: 'center' }}>
                    Las narrativas se generan automáticamente cada hora a partir de menciones con embedding. Si acabas de habilitar la feature, espera 1-2 corridas del cron.
                  </Paragraph>
                </Space>
              }
            />
          </Card>
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small">
              <Space size={20} wrap>
                <Text><strong>{filteredData.nodes.length}</strong> narrativas visibles</Text>
                <Text type="secondary">·</Text>
                <Text><strong>{filteredData.edges.length}</strong> conexiones</Text>
                <Text type="secondary">·</Text>
                {STATUS_OPTIONS.map((s) => {
                  const count = filteredData.nodes.filter((n) => n.status === s.value).length;
                  if (count === 0) return null;
                  return (
                    <Space size={4} key={s.value}>
                      <NarrativeStatusBadge status={s.value} />
                      <Text>{count}</Text>
                    </Space>
                  );
                })}
              </Space>
            </Card>

            <div
              ref={containerRef}
              style={{
                width: '100%',
                height: 'calc(100vh - 320px)',
                minHeight: 460,
                background: '#fafafa',
                borderRadius: 8,
                border: '1px solid #f0f0f0',
                overflow: 'hidden',
              }}
            >
              <NarrativeGraph
                nodes={nodes}
                edges={filteredData.edges}
                width={graphSize.width}
                height={graphSize.height}
                onNodeClick={handleNodeClick}
                selectedId={selectedId}
              />
            </div>

            {allDates && timeRange && (
              <Card size="small">
                <Text strong style={{ marginRight: 12 }}>Periodo:</Text>
                <Text type="secondary" style={{ marginRight: 12 }}>{timeRange[0]} → {timeRange[1]}</Text>
                <div style={{ marginTop: 8 }}>
                  <TimelineSlider
                    minDate={allDates.min}
                    maxDate={allDates.max}
                    value={timeRange}
                    onChange={setTimeRange}
                  />
                </div>
              </Card>
            )}
          </Space>
        )}
      </Content>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={520}
        placement="right"
        destroyOnClose
        title={
          selectedId && narrativesQuery.data ? (
            (() => {
              const n = narrativesQuery.data.narratives.find((x) => x.id === selectedId);
              return n ? <span><Tag>{n.slug}</Tag></span> : null;
            })()
          ) : null
        }
      >
        {selectedId && <NarrativeDetail narrativeId={selectedId} />}
      </Drawer>
    </Layout>
  );
}
