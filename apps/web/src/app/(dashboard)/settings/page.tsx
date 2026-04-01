'use client';

import { Card, Descriptions, Tag, Row, Col, Typography } from 'antd';

const { Title, Text } = Typography;

export default function SettingsPage() {
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
                Autoridad de Acueductos y Alcantarillados
              </Descriptions.Item>
              <Descriptions.Item label="Siglas">
                <Tag color="blue">AAA</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Brandwatch Project ID">
                <Text code>1998403803</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Brandwatch Query ID">
                <Text code>2003911540</Text>
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
                10 fijos + subtopicos
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
                <Tag>v0.1.0</Tag>
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
