'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  App,
  Alert,
  Badge,
  Button,
  Card,
  Form,
  Input,
  Layout,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  Divider,
  Tooltip,
} from 'antd';
import type { UploadProps } from 'antd';
import { ArrowLeftOutlined, InboxOutlined, LinkOutlined, UploadOutlined, ReloadOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface Agency { slug: string; name: string; }
interface ImportRow {
  id: string;
  agencyId: string;
  sourceType: 'excel' | 'url';
  s3Key?: string | null;
  sourceUrl?: string | null;
  status: string;
  totalRows: number | null;
  rowsNew: number | null;
  rowsDuplicate: number | null;
  rowsUpdate: number | null;
  rowsError: number | null;
  rowsProcessed: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const TIMEZONE_OPTIONS = [
  { value: 'America/Puerto_Rico', label: 'San Juan · Puerto Rico (AST, UTC-4)' },
  { value: 'America/New_York', label: 'New York (UTC-5/-4 con DST)' },
  { value: 'America/Bogota', label: 'Bogotá · Colombia (UTC-5)' },
  { value: 'UTC', label: 'UTC' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: 'default',
  parsing: 'processing',
  preview_ready: 'warning',
  committing: 'processing',
  completed: 'success',
  failed: 'error',
};

export default function ImportMentionsPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agencySlug, setAgencySlug] = useState<string>('');
  const [timezone, setTimezone] = useState<string>('America/Puerto_Rico');
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [urlValue, setUrlValue] = useState<string>('');
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [fileSubmitting, setFileSubmitting] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  // Agencias activas
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agencies');
        const data = await res.json();
        const list: Agency[] = Array.isArray(data) ? data : [];
        setAgencies(list);
        if (list.length > 0 && !agencySlug) setAgencySlug(list[0].slug);
      } catch (err) {
        message.error('No se pudo cargar agencias');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadImports = useCallback(async () => {
    setLoadingList(true);
    try {
      const url = agencySlug
        ? `/api/admin/mentions/import?limit=20&agencySlug=${agencySlug}`
        : '/api/admin/mentions/import?limit=20';
      const res = await fetch(url);
      const data = await res.json();
      setImports(Array.isArray(data.imports) ? data.imports : []);
    } catch {
      message.error('No se pudo cargar imports recientes');
    } finally {
      setLoadingList(false);
    }
  }, [agencySlug, message]);

  useEffect(() => {
    if (agencySlug) loadImports();
  }, [agencySlug, loadImports]);

  // Upload Excel
  const uploadProps: UploadProps = useMemo(() => ({
    name: 'file',
    multiple: false,
    accept: '.xlsx,.xls,.csv',
    showUploadList: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      if (!agencySlug) {
        message.warning('Selecciona agencia primero');
        onError?.(new Error('agency required'));
        return;
      }
      if (!(file instanceof File)) {
        onError?.(new Error('file must be File'));
        return;
      }
      setFileSubmitting(true);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('agencySlug', agencySlug);
        form.append('defaultTimezone', timezone);
        const res = await fetch('/api/admin/mentions/import/file', { method: 'POST', body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        message.success('Upload encolado — procesando preview…');
        onSuccess?.(data);
        router.push(`/admin/mentions/import/${data.importId}`);
      } catch (err) {
        const e = err as Error;
        message.error(`Upload falló: ${e.message}`);
        onError?.(e);
      } finally {
        setFileSubmitting(false);
      }
    },
  }), [agencySlug, timezone, message, router]);

  const handleUrlSubmit = async () => {
    if (!agencySlug) {
      message.warning('Selecciona agencia primero');
      return;
    }
    if (!urlValue.trim()) {
      message.warning('Pega una URL');
      return;
    }
    setUrlSubmitting(true);
    try {
      const res = await fetch('/api/admin/mentions/import/url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: urlValue.trim(), agencySlug, defaultTimezone: timezone }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      message.success('URL encolada — procesando preview…');
      setUrlValue('');
      router.push(`/admin/mentions/import/${data.importId}`);
    } catch (err) {
      message.error(`Submit falló: ${(err as Error).message}`);
    } finally {
      setUrlSubmitting(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#fff' }}>
      <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Link href="/dashboard">
            <Button icon={<ArrowLeftOutlined />} type="text">Volver al dashboard</Button>
          </Link>
          <Divider type="vertical" />
          <Title level={4} style={{ margin: 0 }}>Importar menciones</Title>
        </Space>
      </Header>

      <Content style={{ padding: 24, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <Card style={{ marginBottom: 24 }}>
          <Form layout="vertical">
            <Space size="large" wrap>
              <Form.Item label="Agencia" required style={{ minWidth: 240 }}>
                <Select
                  value={agencySlug}
                  onChange={setAgencySlug}
                  options={agencies.map((a) => ({ value: a.slug, label: a.name }))}
                  placeholder="Selecciona agencia"
                  style={{ width: 240 }}
                />
              </Form.Item>
              <Form.Item
                label={
                  <Tooltip title="TZ usada para parsear DATE+TIME del Excel cuando vienen sin offset.">
                    Zona horaria default
                  </Tooltip>
                }
                style={{ minWidth: 320 }}
              >
                <Select
                  value={timezone}
                  onChange={setTimezone}
                  options={TIMEZONE_OPTIONS}
                  style={{ width: 320 }}
                />
              </Form.Item>
            </Space>
          </Form>
        </Card>

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card title={<Space><UploadOutlined />Subir Excel</Space>} extra={<Text type="secondary">Máx 500 filas, 20 MB</Text>}>
            <Dragger {...uploadProps} disabled={!agencySlug || fileSubmitting}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">Arrastra o haz click para subir un archivo .xlsx</p>
              <p className="ant-upload-hint">
                Formato esperado: export de BunkerDB/Brandwatch (columnas DATE, TIME, TITLE, URL, SOURCE_TYPE, LIKE_COUNT, etc.).
                Las menciones que ya existan por URL canónica se marcarán como duplicadas o se actualizarán (no se duplican).
              </p>
            </Dragger>
          </Card>

          <Card title={<Space><LinkOutlined />Importar desde URL</Space>}>
            <Form layout="vertical" onFinish={handleUrlSubmit}>
              <Form.Item
                label="URL de la mención (X/Twitter, web de prensa, FB, IG, YouTube, TikTok, Reddit)"
                required
              >
                <Input
                  size="large"
                  placeholder="https://x.com/usuario/status/..."
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  disabled={urlSubmitting}
                  onPressEnter={handleUrlSubmit}
                />
              </Form.Item>
              <Button
                type="primary"
                onClick={handleUrlSubmit}
                loading={urlSubmitting}
                disabled={!agencySlug || !urlValue.trim()}
              >
                Scrapear y revisar
              </Button>
            </Form>
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 16 }}
              message="Limitaciones por plataforma"
              description={
                <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                  <li><b>Twitter/X:</b> trae texto + autor + fecha. <b>No expone</b> likes / retweets — quedan en 0.</li>
                  <li><b>Web de prensa:</b> usa Open Graph + JSON-LD. Cobertura típica: título, autor, fecha, snippet.</li>
                  <li><b>FB / Instagram:</b> sin métricas — el admin debe rellenar engagement manualmente en el preview.</li>
                  <li><b>Reddit:</b> trae upvotes y num_comments del post via JSON API.</li>
                  <li><b>YouTube / TikTok:</b> trae título + autor; fecha y métricas <b>quedan vacías</b>.</li>
                </ul>
              }
            />
          </Card>

          <Card
            title="Importaciones recientes"
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={loadImports} loading={loadingList}>
                Refrescar
              </Button>
            }
          >
            <Table
              dataSource={imports}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 10 }}
              columns={[
                {
                  title: 'Creado',
                  dataIndex: 'createdAt',
                  render: (v: string) => new Date(v).toLocaleString('es-PR'),
                  width: 180,
                },
                {
                  title: 'Origen',
                  dataIndex: 'sourceType',
                  render: (v: string, row: ImportRow) => (
                    <Tooltip title={row.sourceUrl ?? row.s3Key}>
                      <Tag>{v === 'excel' ? 'Excel' : 'URL'}</Tag>
                    </Tooltip>
                  ),
                  width: 100,
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  render: (v: string) => <Badge status={(STATUS_COLORS[v] ?? 'default') as 'default' | 'success' | 'error' | 'warning' | 'processing'} text={v} />,
                  width: 140,
                },
                {
                  title: 'Total',
                  dataIndex: 'totalRows',
                  width: 80,
                  render: (v: number | null) => v ?? '—',
                },
                {
                  title: 'Nuevas',
                  dataIndex: 'rowsNew',
                  width: 80,
                  render: (v: number | null) => v ?? 0,
                },
                {
                  title: 'Dup',
                  dataIndex: 'rowsDuplicate',
                  width: 70,
                  render: (v: number | null) => v ?? 0,
                },
                {
                  title: 'Update',
                  dataIndex: 'rowsUpdate',
                  width: 80,
                  render: (v: number | null) => v ?? 0,
                },
                {
                  title: 'Procesadas',
                  dataIndex: 'rowsProcessed',
                  width: 110,
                  render: (v: number | null, row: ImportRow) => {
                    const total = (row.rowsNew ?? 0) + (row.rowsUpdate ?? 0);
                    if (!total) return v ?? 0;
                    return `${v ?? 0} / ${total}`;
                  },
                },
                {
                  title: '',
                  width: 100,
                  render: (_: unknown, row: ImportRow) => (
                    <Link href={`/admin/mentions/import/${row.id}`}>
                      <Button size="small">Ver</Button>
                    </Link>
                  ),
                },
              ]}
              locale={{ emptyText: 'Sin imports recientes para esta agencia' }}
            />
          </Card>
        </Space>

        <Paragraph type="secondary" style={{ marginTop: 24 }}>
          Las menciones importadas pasan por la misma pipeline NLP que las de Brandwatch:
          Claude Opus asigna sentimiento + emociones + pertinencia + tópicos + municipios, y se generan embeddings
          para &quot;menciones similares&quot;. La diferencia: aparecen marcadas con <Tag>manual_excel</Tag> o <Tag>manual_url</Tag> en el campo <code>ingestion_source</code>.
        </Paragraph>
      </Content>
    </Layout>
  );
}
