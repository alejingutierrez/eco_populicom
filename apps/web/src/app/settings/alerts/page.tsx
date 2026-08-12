'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  App,
  Alert,
  Button,
  Card,
  Form,
  InputNumber,
  Layout,
  Select,
  Slider,
  Space,
  Switch,
  Typography,
  Divider,
  Tag,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined, InfoCircleOutlined, BellOutlined, ThunderboltOutlined } from '@ant-design/icons';

const { Header, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

interface Agency { id: string; slug: string; name: string; }
interface CrisisConfig {
  id?: string;
  name?: string;
  isActive: boolean;
  crisisMin: number;
  severityMin: number;
  cooldownHours: number;
  notifyEmails: string[];
  updatedAt?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_CONFIG: CrisisConfig = {
  isActive: true,
  crisisMin: 0.40,
  severityMin: 0.50,
  cooldownHours: 12,
  notifyEmails: [],
};

export default function AlertsCrisisSettingsPage() {
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const isEmbedded = searchParams?.get('embed') === '1';

  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [selectedAgencySlug, setSelectedAgencySlug] = useState<string>('ddecpr');
  const [config, setConfig] = useState<CrisisConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const loadConfig = useCallback(async (agencySlug: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/alerts/crisis-config?agencySlug=${encodeURIComponent(agencySlug)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'error loading config');
      setConfig(data.config ?? { ...DEFAULT_CONFIG, ...data.defaults });
    } catch (err: any) {
      message.error(`No se pudo cargar la configuración: ${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => { loadConfig(selectedAgencySlug); }, [selectedAgencySlug, loadConfig]);

  const handleSave = useCallback(async (values: CrisisConfig) => {
    setSaving(true);
    try {
      const res = await fetch('/api/alerts/crisis-config', {
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
      message.success('Configuración guardada — la próxima evaluación (cada 10 min) usa estos valores');
    } catch (err: any) {
      message.error(`No se pudo guardar: ${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }, [selectedAgencySlug, message]);

  const layoutBg = isEmbedded ? 'transparent' : '#F4F7FA';
  const contentPadding = isEmbedded ? '12px 4px 4px 4px' : '28px';
  const contentMaxWidth = isEmbedded ? '100%' : 960;

  return (
    <Layout style={{ minHeight: isEmbedded ? 'auto' : '100vh', background: layoutBg }}>
      {!isEmbedded && (
        <Header style={{ background: '#FFFFFF', borderBottom: '1px solid #EEF2F6', padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <Link href="/dashboard" style={{ color: '#64748B', textDecoration: 'none', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeftOutlined /> Panel
          </Link>
          <Title level={4} style={{ margin: 0, color: '#0E1E2C' }}>Configuración · Alertas de crisis</Title>
        </Header>
      )}
      <Content style={{ padding: contentPadding, maxWidth: contentMaxWidth, margin: '0 auto', width: '100%' }}>
        <Space direction="vertical" size={isEmbedded ? 16 : 24} style={{ width: '100%' }}>
          {!isEmbedded && (
            <Alert
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message="Disparo automático de alertas editoriales de crisis"
              description="El sistema evalúa el Crisis Risk Score cada 10 min. Cuando cruza el umbral configurado, genera un editorial AI y lo envía por correo a los destinatarios listados. El cooldown evita repetir el mismo aviso mientras dure el episodio."
            />
          )}

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
            saving={saving}
            onSave={handleSave}
          />
        </Space>
      </Content>
    </Layout>
  );
}

// ============================================================
// Form component
// ============================================================

function ConfigForm({
  initial,
  loading,
  saving,
  onSave,
}: {
  initial: CrisisConfig | null;
  loading: boolean;
  saving: boolean;
  onSave: (values: CrisisConfig) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CrisisConfig>();
  const [emailInput, setEmailInput] = useState<string>('');

  const initialValues = useMemo<CrisisConfig>(() => initial ?? DEFAULT_CONFIG, [initial]);

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [initialValues, form]);

  const handleAddEmail = () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    if (!EMAIL_REGEX.test(trimmed)) {
      message.error('Email inválido');
      return;
    }
    const current: string[] = form.getFieldValue('notifyEmails') ?? [];
    if (current.includes(trimmed)) {
      setEmailInput('');
      return;
    }
    if (current.length >= 20) {
      message.error('Máximo 20 destinatarios');
      return;
    }
    form.setFieldsValue({ notifyEmails: [...current, trimmed] });
    setEmailInput('');
  };

  const handleRemoveEmail = (email: string) => {
    const current: string[] = form.getFieldValue('notifyEmails') ?? [];
    form.setFieldsValue({ notifyEmails: current.filter((e) => e !== email) });
  };

  return (
    <Form<CrisisConfig>
      form={form}
      layout="vertical"
      initialValues={initialValues}
      onFinish={onSave}
      disabled={loading || saving}
    >
      <Card
        title={
          <Space>
            <BellOutlined />
            <span>Disparador automático</span>
          </Space>
        }
        size="small"
        extra={
          <Form.Item name="isActive" valuePropName="checked" style={{ margin: 0 }}>
            <Switch checkedChildren="Activo" unCheckedChildren="Inactivo" />
          </Form.Item>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16, fontSize: 13 }}>
          Cuando esté <Text strong>activo</Text>, el sistema envía un correo editorial a los destinatarios cada vez que el Crisis Risk Score
          cruce los umbrales — siempre respetando el cooldown.
        </Paragraph>

        <Form.Item
          label={
            <Space>
              <ThunderboltOutlined />
              <span>Crisis Score mínimo</span>
              <Text type="secondary" style={{ fontWeight: 400 }}>
                (escala 0–1, sugerido 0.40)
              </Text>
            </Space>
          }
          name="crisisMin"
          rules={[{ required: true, type: 'number', min: 0, max: 1 }]}
        >
          <CrisisSlider />
        </Form.Item>

        <Form.Item
          label={
            <Space>
              <span>Severidad mínima</span>
              <Text type="secondary" style={{ fontWeight: 400 }}>
                (concentración negativa 0–1, sugerido 0.50)
              </Text>
            </Space>
          }
          name="severityMin"
          rules={[{ required: true, type: 'number', min: 0, max: 1 }]}
        >
          <CrisisSlider />
        </Form.Item>

        <Form.Item
          label="Cooldown (horas)"
          name="cooldownHours"
          rules={[{ required: true, type: 'integer', min: 1, max: 168 }]}
          extra="Tras un disparo, no se reenviará otra alerta durante este intervalo aunque el score siga elevado. Mínimo 1, máximo 168 (7 días)."
        >
          <InputNumber min={1} max={168} step={1} style={{ width: 120 }} addonAfter="horas" />
        </Form.Item>
      </Card>

      <Card title="Destinatarios" size="small" style={{ marginTop: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
          Estos correos reciben la alerta editorial. Pueden ser distintos a los del reporte semanal.
        </Paragraph>

        <Form.Item name="notifyEmails" hidden>
          <input type="hidden" />
        </Form.Item>

        <Form.Item shouldUpdate>
          {() => {
            const emails: string[] = form.getFieldValue('notifyEmails') ?? [];
            return (
              <div style={{ marginBottom: 10 }}>
                {emails.length === 0 ? (
                  <Text type="secondary" italic>Sin destinatarios. Añade al menos uno.</Text>
                ) : (
                  <Space wrap size={[8, 8]}>
                    {emails.map((email) => (
                      <Tag
                        key={email}
                        closable
                        onClose={(e) => { e.preventDefault(); handleRemoveEmail(email); }}
                        style={{ padding: '4px 8px', fontSize: 12 }}
                      >
                        {email}
                      </Tag>
                    ))}
                  </Space>
                )}
              </div>
            );
          }}
        </Form.Item>

        <Space.Compact style={{ width: '100%', maxWidth: 460 }}>
          <input
            type="email"
            placeholder="correo@ejemplo.com"
            value={emailInput}
            onChange={(ev) => setEmailInput(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                handleAddEmail();
              }
            }}
            style={{
              flex: 1,
              padding: '4px 11px',
              fontSize: 14,
              border: '1px solid #d9d9d9',
              borderRight: 'none',
              borderRadius: '6px 0 0 6px',
              outline: 'none',
              height: 32,
            }}
          />
          <Button onClick={handleAddEmail}>Añadir</Button>
        </Space.Compact>
      </Card>

      <Divider />

      <Space>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
          Guardar configuración
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Los cambios aplican desde el siguiente ciclo de evaluación (≤ 10 min).
        </Text>
      </Space>
    </Form>
  );
}

// ============================================================
// Slider visual para los umbrales 0–1 — etiquetas semánticas a los costados.
// ============================================================

function CrisisSlider({ value, onChange }: { value?: number; onChange?: (v: number) => void }) {
  return (
    <div>
      <Slider
        min={0}
        max={1}
        step={0.05}
        value={value ?? 0}
        onChange={onChange}
        marks={{
          0: 'sin crisis',
          0.25: 'elevado',
          0.40: 'alerta',
          0.60: 'crisis',
          1: '',
        }}
        tooltip={{ formatter: (v) => (v ?? 0).toFixed(2) }}
      />
    </div>
  );
}
