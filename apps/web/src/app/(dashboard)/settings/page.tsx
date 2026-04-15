'use client';

import { Card, Descriptions, Tag, Row, Col, Typography, Skeleton } from 'antd';
import { useAgency } from '@/contexts/AgencyContext';

const { Title, Text } = Typography;

export default function SettingsPage() {
  const { agencies, selectedAgency, isLoading } = useAgency();
  const agency = agencies.find((a) => a.slug === selectedAgency);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Skeleton active paragraph={{ rows: 0 }} style={{ width: 200 }} />
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={12}>
            <Card title="Agencia" styles={{ header: { color: '#0E1E2C' } }}>
              <Skeleton active paragraph={{ rows: 5 }} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title="NLP" styles={{ header: { color: '#0E1E2C' } }}>
              <Skeleton active paragraph={{ rows: 4 }} />
            </Card>
          </Col>
        </Row>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Title level={4} style={{ color: '#0E1E2C', margin: 0 }}>
        Configuracion
      </Title>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card
            title="Agencia"
            styles={{ header: { color: '#0E1E2C' } }}
          >
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="Nombre">
                {agency?.name ?? '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Siglas">
                <Tag color="blue">{agency?.slug?.toUpperCase() ?? '—'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Brandwatch Project ID">
                <Text code>{agency?.brandwatchProjectId ?? '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Brandwatch Query IDs">
                {agency?.brandwatchQueryIds && agency.brandwatchQueryIds.length > 0
                  ? agency.brandwatchQueryIds.map((id) => (
                      <Text key={id} code style={{ marginRight: 4 }}>
                        {id}
                      </Text>
                    ))
                  : <Text code>—</Text>
                }
              </Descriptions.Item>
              <Descriptions.Item label="Polling">
                Cada 5 minutos
              </Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color="success">Activo</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="NLP"
            styles={{ header: { color: '#0E1E2C' } }}
          >
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="Modelo">
                Claude Opus (Bedrock)
              </Descriptions.Item>
              <Descriptions.Item label="Proveedor">
                <Tag color="purple">AWS Bedrock</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Sentimiento">
                3 niveles + 7 emociones
              </Descriptions.Item>
              <Descriptions.Item label="Topicos">
                Personalizados por agencia
              </Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color="success">Conectado</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col span={24}>
          <Card
            title="Plataforma"
            styles={{ header: { color: '#0E1E2C' } }}
          >
            <Descriptions column={1} colon={false} size="small">
              <Descriptions.Item label="Version">
                <Tag>v0.2.0</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Producto">
                ECO — Social Listening Platform
              </Descriptions.Item>
              <Descriptions.Item label="Organizacion">
                <Text style={{ color: '#64748B' }}>
                  Gobierno de Puerto Rico &middot; Populicom
                </Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
