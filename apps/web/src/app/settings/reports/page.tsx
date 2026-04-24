'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
  Switch,
  Table,
  Tag,
  Typography,
  Divider,
} from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, SendOutlined, SaveOutlined, InfoCircleOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;
const { Title, Text } = Typography;

interface Agency { id: string; slug: string; name: string; }
interface ReportConfig {
  agencyId: string;
  isActive: boolean;
  sendHourLocal: number;
  timezone: string;
  templateKey: string;
  recipients: string[];
  fromEmail: string;
  fromName: string;
  updatedAt?: string;
}
interface HistoryEntry {
  id: string;
  sentAt: string;
  recipients: string[];
  fromEmail: string;
  templateKey: string;
  trigger: string;
  status: string;
  messageId: string | null;
  error: string | null;
  stats: { negative: number; neutral: number; positive: number; total: number } | null;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, '0')}:00`,
}));

const TIMEZONE_OPTIONS = [
  { value: 'America/Bogota', label: 'Bogotá · Colombia (UTC-5, sin DST)' },
  { value: 'America/Puerto_Rico', label: 'San Juan · Puerto Rico (UTC-4, sin DST)' },
  { value: 'America/New_York', label: 'New York (UTC-5/-4 con DST)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6/-5 con DST)' },
  { value: 'America/Lima', label: 'Lima · Perú (UTC-5, sin DST)' },
  { value: 'America/Santiago', label: 'Santiago · Chile' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires · Argentina (UTC-3)' },
  { value: 'UTC', label: 'UTC' },
];

const TEMPLATE_OPTIONS = [
  { value: 'weekly-sentiment-summary', label: 'Resumen semanal de sentimiento (últimos 7 días)' },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ReportsSettingsPage() {
  const { message } = App.useApp();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [selectedAgencySlug, setSelectedAgencySlug] = useState<string>('ddecpr');
  const [config, setConfig] = useState<ReportConfig | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  // Fetch agencies once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/agencies');
        const data = await res.json();
        if (Array.isArray(data.agencies)) {
          setAgencies(data.agencies);
          const ddec = (data.agencies as Agency[]).find((a) => a.slug === 'ddecpr');
          if (ddec) setSelectedAgencySlug(ddec.slug);
        }
      } catch (err) {
        console.error('load agencies failed', err);
      }
    })();
  }, []);

  const loadConfigAndHistory = useCallback(async (agencySlug: string) => {
    setLoading(true);
    try {
      const [cfgRes, histRes] = await Promise.all([
        fetch(`/api/reports/config?agencySlug=${encodeURIComponent(agencySlug)}`),
        fetch(`/api/reports/history?agencySlug=${encodeURIComponent(agencySlug)}&limit=14`),
      ]);
      const cfgData = await cfgRes.json();
      const histData = await histRes.json();
      if (!cfgRes.ok) throw new Error(cfgData.error ?? 'error loading config');
      setConfig(cfgData.config ?? null);
      setHistory(histData.history ?? []);
    } catch (err: any) {
      message.error(`No se pudo cargar la configuración: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => { loadConfigAndHistory(selectedAgencySlug); }, [selectedAgencySlug, loadConfigAndHistory]);

  const handleSave = useCallback(async (values: ReportConfig) => {
    setSaving(true);
    try {
      const res = await fetch('/api/reports/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencySlug: selectedAgencySlug, ...values }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? data.details.join(' · ') : (data.error ?? 'error');
        throw new Error(detail);
      }
      setConfig(data.config);
      message.success('Configuración guardada');
    } catch (err: any) {
      message.error(`No se pudo guardar: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }, [selectedAgencySlug, message]);

  const handleSendTest = useCallback(async () => {
    if (!config || !config.recipients.length) {
      message.warning('Añade al menos un destinatario antes de enviar una prueba');
      return;
    }
    setSendingTest(true);
    try {
      const res = await fetch('/api/reports/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencySlug: selectedAgencySlug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'error');
      const r = data.result;
      if (r?.status === 'sent') {
        message.success(`Enviado (messageId: ${r.messageId?.slice(0, 16)}…)`);
      } else if (r?.status === 'no_data') {
        message.warning('No hay menciones en los últimos 7 días para generar el reporte');
      } else {
        message.info(`Resultado: ${r?.status ?? 'desconocido'}`);
      }
      // refrescar histórico
      loadConfigAndHistory(selectedAgencySlug);
    } catch (err: any) {
      message.error(`Envío de prueba falló: ${err?.message ?? err}`);
    } finally {
      setSendingTest(false);
    }
  }, [config, selectedAgencySlug, message, loadConfigAndHistory]);

  return (
    <Layout style={{ minHeight: '100vh', background: '#F4F7FA' }}>
      <Header style={{ background: '#FFFFFF', borderBottom: '1px solid #EEF2F6', padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/dashboard" style={{ color: '#64748B', textDecoration: 'none', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeftOutlined /> Panel
        </Link>
        <Title level={4} style={{ margin: 0, color: '#0E1E2C' }}>Configuración · Reportes por correo</Title>
      </Header>
      <Content style={{ padding: '28px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="Solo administradores pueden editar esta configuración"
            description="La Lambda eco-weekly-report corre cada hora y envía únicamente a las agencias cuya hora local (según timezone) coincide con la hora configurada."
          />

          <Card title="Agencia" size="small">
            <Select
              style={{ width: '100%', maxWidth: 460 }}
              value={selectedAgencySlug}
              onChange={setSelectedAgencySlug}
              options={agencies.map((a) => ({ value: a.slug, label: `${a.name} (${a.slug})` }))}
              loading={!agencies.length}
              placeholder="Selecciona una agencia"
            />
          </Card>

          <ConfigForm
            key={selectedAgencySlug + (config?.updatedAt ?? 'new')}
            initial={config}
            loading={loading}
            onSave={handleSave}
            onSendTest={handleSendTest}
            saving={saving}
            sendingTest={sendingTest}
          />

          <Card title="Histórico de envíos (últimos 14)" size="small">
            <HistoryTable rows={history} />
          </Card>
        </Space>
      </Content>
    </Layout>
  );
}

// =========================================================
// Configuración — form
// =========================================================

function ConfigForm({
  initial, loading, onSave, onSendTest, saving, sendingTest,
}: {
  initial: ReportConfig | null;
  loading: boolean;
  saving: boolean;
  sendingTest: boolean;
  onSave: (values: ReportConfig) => void;
  onSendTest: () => void;
}) {
  const [form] = Form.useForm<ReportConfig>();
  const defaults: ReportConfig = useMemo(() => (initial ?? {
    agencyId: '',
    isActive: true,
    sendHourLocal: 16,
    timezone: 'America/Bogota',
    templateKey: 'weekly-sentiment-summary',
    recipients: [],
    fromEmail: 'agutierrez@populicom.com',
    fromName: 'Populicom Radar',
  }), [initial]);

  useEffect(() => { form.setFieldsValue(defaults); }, [defaults, form]);

  return (
    <Card
      title="Configuración del envío"
      size="small"
      extra={initial?.updatedAt ? (
        <Text type="secondary" style={{ fontSize: 12 }}>Última actualización: {new Date(initial.updatedAt).toLocaleString('es-CO')}</Text>
      ) : null}
    >
      <Form<ReportConfig>
        form={form}
        layout="vertical"
        disabled={loading}
        initialValues={defaults}
        onFinish={onSave}
        requiredMark={false}
      >
        <Form.Item label="Estado" name="isActive" valuePropName="checked">
          <Switch checkedChildren="Activo" unCheckedChildren="Inactivo" />
        </Form.Item>

        <Space size={16} style={{ width: '100%', display: 'flex' }}>
          <Form.Item label="Hora local de envío" name="sendHourLocal" style={{ flex: 1 }} rules={[{ required: true, message: 'Selecciona una hora' }]}>
            <Select options={HOUR_OPTIONS} placeholder="16:00" />
          </Form.Item>
          <Form.Item label="Zona horaria" name="timezone" style={{ flex: 2 }} rules={[{ required: true }]}>
            <Select options={TIMEZONE_OPTIONS} />
          </Form.Item>
        </Space>

        <Form.Item label="Template del correo" name="templateKey" rules={[{ required: true }]}>
          <Select options={TEMPLATE_OPTIONS} />
        </Form.Item>

        <Divider plain>Destinatarios y remitente</Divider>

        <Form.Item
          label="Destinatarios (hasta 20 correos)"
          name="recipients"
          rules={[
            { required: true, message: 'Añade al menos un destinatario' },
            {
              validator: (_, value: string[]) => {
                if (!value?.length) return Promise.reject(new Error('Añade al menos un destinatario'));
                if (value.length > 20) return Promise.reject(new Error('Máximo 20 destinatarios'));
                for (const e of value) {
                  if (!EMAIL_REGEX.test(e)) return Promise.reject(new Error(`Correo inválido: ${e}`));
                }
                return Promise.resolve();
              },
            },
          ]}
          extra="Presiona Enter después de cada correo para agregarlo."
        >
          <Select
            mode="tags"
            tokenSeparators={[',', ';', ' ']}
            placeholder="usuario@dominio.com"
            open={false}
            suffixIcon={null}
          />
        </Form.Item>

        <Space size={16} style={{ width: '100%', display: 'flex' }}>
          <Form.Item label="Nombre del remitente" name="fromName" style={{ flex: 1 }}>
            <Input placeholder="Populicom Radar" />
          </Form.Item>
          <Form.Item label="Correo del remitente" name="fromEmail" style={{ flex: 1 }} rules={[{ type: 'email', message: 'Correo inválido' }]}>
            <Input placeholder="radar@populicom.com" />
          </Form.Item>
        </Space>

        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Remitentes verificados en SES"
          description="El correo del remitente debe estar verificado en AWS SES. Hoy hay verificado: agutierrez@populicom.com. Para usar otro, primero hay que verificarlo desde la consola de AWS."
        />

        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>Guardar cambios</Button>
          <Button icon={<SendOutlined />} onClick={onSendTest} loading={sendingTest} disabled={saving}>Enviar prueba ahora</Button>
        </Space>
      </Form>
    </Card>
  );
}

// =========================================================
// Histórico
// =========================================================

function HistoryTable({ rows }: { rows: HistoryEntry[] }) {
  return (
    <Table<HistoryEntry>
      dataSource={rows}
      rowKey="id"
      size="small"
      pagination={false}
      locale={{ emptyText: 'Sin envíos registrados' }}
      columns={[
        {
          title: 'Fecha',
          dataIndex: 'sentAt',
          width: 170,
          render: (v: string) => new Date(v).toLocaleString('es-CO'),
        },
        {
          title: 'Estado',
          dataIndex: 'status',
          width: 130,
          render: (s: string) => <StatusTag status={s} />,
        },
        {
          title: 'Trigger',
          dataIndex: 'trigger',
          width: 100,
          render: (t: string) => <Tag color="default">{t}</Tag>,
        },
        {
          title: 'Destinatarios',
          dataIndex: 'recipients',
          render: (r: string[]) => r.length ? r.join(', ') : <Text type="secondary">—</Text>,
        },
        {
          title: 'Menciones',
          dataIndex: 'stats',
          width: 140,
          render: (s: HistoryEntry['stats']) => s ? (
            <Space size={4}>
              <Badge color="#E86452" /><Text>{s.negative}</Text>
              <Badge color="#94A3B8" /><Text>{s.neutral}</Text>
              <Badge color="#52C47A" /><Text>{s.positive}</Text>
            </Space>
          ) : <Text type="secondary">—</Text>,
        },
        {
          title: 'Error',
          dataIndex: 'error',
          render: (e: string | null) => e ? <Text type="danger" style={{ fontSize: 11 }}>{e.slice(0, 80)}</Text> : null,
        },
      ]}
    />
  );
}

function StatusTag({ status }: { status: string }) {
  switch (status) {
    case 'sent': return <Tag color="success" icon={<CheckCircleOutlined />}>enviado</Tag>;
    case 'failed': return <Tag color="error" icon={<CloseCircleOutlined />}>falló</Tag>;
    case 'no_data': return <Tag color="warning">sin datos</Tag>;
    case 'no_recipients': return <Tag color="warning">sin destinatarios</Tag>;
    case 'skipped': return <Tag color="default">omitido</Tag>;
    default: return <Tag>{status}</Tag>;
  }
}
