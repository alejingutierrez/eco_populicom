'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import {
  App,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Layout,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Tooltip,
  Divider,
} from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, WarningOutlined, ReloadOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

interface ImportDetail {
  id: string;
  agencyId: string;
  sourceType: 'excel' | 'url';
  sourceUrl: string | null;
  s3Key: string | null;
  status: 'pending' | 'parsing' | 'preview_ready' | 'committing' | 'completed' | 'failed';
  totalRows: number | null;
  rowsNew: number | null;
  rowsDuplicate: number | null;
  rowsUpdate: number | null;
  rowsError: number | null;
  rowsProcessed: number | null;
  errorMessage: string | null;
  defaultTimezone: string;
  createdAt: string;
  committedAt: string | null;
  completedAt: string | null;
}

interface PreviewRow {
  rowIndex: number;
  status: 'new' | 'duplicate' | 'update' | 'error';
  urlCanonical?: string;
  errorMessage?: string;
  conflictMentionId?: string;
  fieldsToFill?: string[];
  mention?: {
    url: string;
    title?: string;
    snippet?: string;
    author?: string;
    publishedAt: string;
    pageType: string;
    likes?: number;
    comments?: number;
    shares?: number;
    bwSentiment?: string;
  };
}

const STATUS_TAG_COLOR: Record<string, string> = {
  new: 'green',
  duplicate: 'default',
  update: 'orange',
  error: 'red',
};

export default function ImportDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const importId = String(params?.id ?? '');
  const { message, modal } = App.useApp();
  // Embed mode — ver page.tsx hermano y AGENTS.md → "dónde vive cada pantalla"
  const isEmbedded = searchParams?.get('embed') === '1';
  const embedSuffix = isEmbedded ? '?embed=1' : '';

  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [tab, setTab] = useState<'new' | 'duplicate' | 'update' | 'error'>('new');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!importId) return;
    try {
      const res = await fetch(`/api/admin/mentions/import/${importId}`);
      if (res.ok) {
        const data: ImportDetail = await res.json();
        setDetail(data);
      }
    } catch {
      /* ignore */
    }
  }, [importId]);

  const fetchPreview = useCallback(async (statusFilter: typeof tab) => {
    if (!importId) return;
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/admin/mentions/import/${importId}/preview?status=${statusFilter}&limit=200&offset=0`);
      const data = await res.json();
      setPreviewRows(Array.isArray(data.rows) ? data.rows : []);
      setPreviewTotal(Number(data.total ?? 0));
    } catch {
      setPreviewRows([]);
      setPreviewTotal(0);
    } finally {
      setPreviewLoading(false);
    }
  }, [importId]);

  // Initial + polling
  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if (!detail) return;
    const pollingStatuses = new Set(['pending', 'parsing', 'committing']);
    if (!pollingStatuses.has(detail.status)) return;
    const interval = setInterval(fetchDetail, detail.status === 'committing' ? 5000 : 3000);
    return () => clearInterval(interval);
  }, [detail, fetchDetail]);

  // Carga preview cuando llega a preview_ready o completed
  useEffect(() => {
    if (!detail) return;
    if (detail.status === 'preview_ready' || detail.status === 'committing' || detail.status === 'completed') {
      fetchPreview(tab);
    }
  }, [detail?.status, tab, fetchPreview, detail]);

  const handleCommit = async () => {
    if (!detail) return;
    const newCount = detail.rowsNew ?? 0;
    const updateCount = detail.rowsUpdate ?? 0;
    const estimatedCost = (newCount * 0.05).toFixed(2);

    modal.confirm({
      title: 'Confirmar import',
      content: (
        <Space direction="vertical">
          <Text>Se procesarán <b>{newCount}</b> nuevas y <b>{updateCount}</b> updates.</Text>
          <Text type="secondary">Costo NLP estimado: ~${estimatedCost} USD (Claude Opus).</Text>
          <Text type="warning">El procesamiento es async; el progreso se actualizará en esta misma página.</Text>
        </Space>
      ),
      okText: 'Confirmar',
      cancelText: 'Cancelar',
      onOk: async () => {
        setCommitting(true);
        try {
          const res = await fetch(`/api/admin/mentions/import/${importId}/commit`, { method: 'POST' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error ?? `HTTP ${res.status}`);
          }
          message.success('Commit despachado a la cola de procesamiento');
          fetchDetail();
        } catch (err) {
          message.error(`Commit falló: ${(err as Error).message}`);
        } finally {
          setCommitting(false);
        }
      },
    });
  };

  const summary = useMemo(() => {
    if (!detail) return null;
    return (
      <Row gutter={16}>
        <Col span={4}><Statistic title="Total" value={detail.totalRows ?? 0} /></Col>
        <Col span={4}><Statistic title="Nuevas" value={detail.rowsNew ?? 0} valueStyle={{ color: '#52c41a' }} /></Col>
        <Col span={4}><Statistic title="Duplicadas" value={detail.rowsDuplicate ?? 0} valueStyle={{ color: '#8c8c8c' }} /></Col>
        <Col span={4}><Statistic title="Para actualizar" value={detail.rowsUpdate ?? 0} valueStyle={{ color: '#fa8c16' }} /></Col>
        <Col span={4}><Statistic title="Errores" value={detail.rowsError ?? 0} valueStyle={{ color: '#cf1322' }} /></Col>
        <Col span={4}><Statistic title="Procesadas" value={detail.rowsProcessed ?? 0} /></Col>
      </Row>
    );
  }, [detail]);

  const progress = useMemo(() => {
    if (!detail) return null;
    if (detail.status !== 'committing' && detail.status !== 'completed') return null;
    const total = (detail.rowsNew ?? 0) + (detail.rowsUpdate ?? 0);
    const done = detail.rowsProcessed ?? 0;
    const pct = total === 0 ? 100 : Math.min(100, Math.round((done / total) * 100));
    return <Progress percent={pct} status={detail.status === 'completed' ? 'success' : 'active'} />;
  }, [detail]);

  if (!importId) return <div>ID inválido</div>;

  return (
    <Layout style={{ minHeight: isEmbedded ? 'auto' : '100vh', background: isEmbedded ? 'transparent' : '#fff' }}>
      {!isEmbedded && (
        <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <Link href={`/admin/mentions/import${embedSuffix}`}>
              <Button icon={<ArrowLeftOutlined />} type="text">Volver</Button>
            </Link>
            <Divider type="vertical" />
            <Title level={4} style={{ margin: 0 }}>Import {importId.slice(0, 8)}…</Title>
            {detail?.status && (
              <Badge status={detail.status === 'failed' ? 'error' : detail.status === 'completed' ? 'success' : 'processing'} text={detail.status} />
            )}
          </Space>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchDetail}>Refrescar</Button>
          </Space>
        </Header>
      )}

      <Content style={{ padding: isEmbedded ? '8px 4px 4px 4px' : 24, maxWidth: isEmbedded ? '100%' : 1280, width: '100%', margin: '0 auto' }}>
        {isEmbedded && (
          <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Link href={`/admin/mentions/import${embedSuffix}`}>
                <Button icon={<ArrowLeftOutlined />} type="text" size="small">Volver al listado</Button>
              </Link>
              <Title level={5} style={{ margin: 0 }}>Import {importId.slice(0, 8)}…</Title>
              {detail?.status && (
                <Badge status={detail.status === 'failed' ? 'error' : detail.status === 'completed' ? 'success' : 'processing'} text={detail.status} />
              )}
            </Space>
            <Button icon={<ReloadOutlined />} onClick={fetchDetail} size="small">Refrescar</Button>
          </Space>
        )}
        {detail?.status === 'failed' && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="Import falló"
            description={detail.errorMessage ?? 'Sin detalle'}
          />
        )}

        {(detail?.status === 'pending' || detail?.status === 'parsing') && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Procesando preview"
            description="La lambda está parseando el archivo y chequeando duplicados. Espera unos segundos."
          />
        )}

        {detail?.status === 'preview_ready' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Preview listo. Revisa los conteos y confirma."
            description="Las nuevas y updates se procesarán por la pipeline NLP (Claude Opus). Las duplicadas se ignoran."
            action={
              <Button type="primary" loading={committing} icon={<CheckCircleOutlined />} onClick={handleCommit}>
                Confirmar import
              </Button>
            }
          />
        )}

        {detail?.status === 'committing' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Procesando…"
            description="Las menciones se están insertando. Esta página se refresca automáticamente."
          />
        )}

        {detail?.status === 'completed' && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message="Import completado"
            description={
              <Space direction="vertical">
                <Text>Todas las menciones fueron procesadas.</Text>
                {/* En embed: navega el frame padre (no el iframe) para que el
                   dashboard reemplace toda la pantalla y no se vea anidado. */}
                <a
                  href={`/dashboard?sourceImportId=${importId}`}
                  target={isEmbedded ? '_top' : undefined}
                  style={{ textDecoration: 'none' }}
                >
                  <Button type="link" icon={<CheckCircleOutlined />} style={{ padding: 0 }}>
                    Ver las menciones importadas en el dashboard
                  </Button>
                </a>
              </Space>
            }
          />
        )}

        <Card style={{ marginBottom: 16 }}>
          {summary}
          {progress && <div style={{ marginTop: 16 }}>{progress}</div>}
        </Card>

        <Card>
          <Tabs
            activeKey={tab}
            onChange={(k) => setTab(k as typeof tab)}
            items={[
              {
                key: 'new',
                label: <Space>Nuevas <Tag color="green">{detail?.rowsNew ?? 0}</Tag></Space>,
              },
              {
                key: 'update',
                label: <Space>Para actualizar <Tag color="orange">{detail?.rowsUpdate ?? 0}</Tag></Space>,
              },
              {
                key: 'duplicate',
                label: <Space>Duplicadas <Tag>{detail?.rowsDuplicate ?? 0}</Tag></Space>,
              },
              {
                key: 'error',
                label: <Space><WarningOutlined />Errores <Tag color="red">{detail?.rowsError ?? 0}</Tag></Space>,
              },
            ]}
          />
          <Table
            dataSource={previewRows}
            rowKey="rowIndex"
            size="small"
            loading={previewLoading}
            pagination={{ pageSize: 20, total: previewTotal }}
            columns={previewColumns(tab)}
            locale={{ emptyText: `Sin filas en '${tab}'` }}
          />
        </Card>

        <Paragraph type="secondary" style={{ marginTop: 16 }}>
          <b>Cómo funciona el dedup</b>: la URL se canonicaliza (twitter.com→x.com, sin
          parámetros de tracking, etc.) y se busca en <code>mentions.url_canonical</code> dentro de
          la agencia. Si existe y todos los campos están llenos → <Tag>duplicate</Tag>.
          Si existe pero le falta algo → <Tag color="orange">update</Tag> (rellena solo los NULL).
          Si no existe → <Tag color="green">new</Tag>.
        </Paragraph>
      </Content>
    </Layout>
  );
}

function previewColumns(tab: 'new' | 'duplicate' | 'update' | 'error') {
  if (tab === 'error') {
    return [
      { title: '#', dataIndex: 'rowIndex', width: 60 },
      { title: 'Error', dataIndex: 'errorMessage' },
    ];
  }
  return [
    { title: '#', dataIndex: 'rowIndex', width: 60 },
    {
      title: 'Estado',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <Tag color={STATUS_TAG_COLOR[v]}>{v}</Tag>,
    },
    {
      title: 'Título',
      render: (_: unknown, r: PreviewRow) => (
        <Tooltip title={r.mention?.snippet}>
          <span>{r.mention?.title ?? r.mention?.snippet?.slice(0, 80) ?? '—'}</span>
        </Tooltip>
      ),
    },
    {
      title: 'Autor',
      dataIndex: ['mention', 'author'],
      width: 140,
    },
    {
      title: 'Fecha',
      dataIndex: ['mention', 'publishedAt'],
      width: 180,
      render: (v: string) => v ? new Date(v).toLocaleString('es-PR') : '—',
    },
    {
      title: 'Plataforma',
      dataIndex: ['mention', 'pageType'],
      width: 100,
      render: (v: string) => v ? <Tag>{v}</Tag> : null,
    },
    {
      title: 'URL canónica',
      dataIndex: 'urlCanonical',
      ellipsis: true,
      render: (v: string) => v ? <code style={{ fontSize: 11 }}>{v}</code> : '—',
    },
    tab === 'update'
      ? {
          title: 'Campos a llenar',
          dataIndex: 'fieldsToFill',
          render: (v?: string[]) => v?.map((f) => <Tag key={f} color="blue">{f}</Tag>),
        }
      : { title: 'Engagement', width: 140, render: (_: unknown, r: PreviewRow) => r.mention ? `${r.mention.likes ?? 0}❤ ${r.mention.comments ?? 0}💬 ${r.mention.shares ?? 0}↗` : '—' },
  ];
}
