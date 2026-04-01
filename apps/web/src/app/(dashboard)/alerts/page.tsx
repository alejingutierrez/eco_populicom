'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Switch, Button, Tag, Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Plus } from 'lucide-react';
import { EcoSentimentBadge } from '@/components/ui/EcoSentimentBadge';

const { Title } = Typography;

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  config: { type: string };
  notifyEmails: string[];
  createdAt: string;
}

interface AlertHistoryItem {
  id: string;
  ruleName: string;
  triggeredAt: string;
  sentiment: string;
  mentionCount: number;
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      fetch('/api/alerts').then((r) => r.json()),
      fetch('/api/alerts/history').then((r) => r.json()),
    ])
      .then(([rulesData, historyData]) => {
        setRules(rulesData.rules ?? []);
        setHistory(historyData.history ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const toggleRule = useCallback(async (id: string, currentActive: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(id));
    try {
      await fetch(`/api/alerts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, isActive: !currentActive } : r)),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const rulesColumns: ColumnsType<AlertRule> = [
    {
      title: 'Nombre',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Descripcion',
      dataIndex: 'description',
      key: 'description',
      render: (text: string | null) => text ?? '--',
    },
    {
      title: 'Estado',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (isActive: boolean, record: AlertRule) => (
        <Switch
          checked={isActive}
          loading={togglingIds.has(record.id)}
          onChange={() => toggleRule(record.id, isActive)}
          checkedChildren="Activa"
          unCheckedChildren="Inactiva"
        />
      ),
    },
    {
      title: 'Emails',
      dataIndex: 'notifyEmails',
      key: 'notifyEmails',
      render: (emails: string[]) => (
        <Space size={[0, 4]} wrap>
          {emails.map((email) => (
            <Tag key={email}>{email}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Creada',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleDateString('es-PR'),
    },
  ];

  const historyColumns: ColumnsType<AlertHistoryItem> = [
    {
      title: 'Regla',
      dataIndex: 'ruleName',
      key: 'ruleName',
    },
    {
      title: 'Fecha',
      dataIndex: 'triggeredAt',
      key: 'triggeredAt',
      render: (date: string) => new Date(date).toLocaleString('es-PR'),
    },
    {
      title: 'Sentimiento',
      dataIndex: 'sentiment',
      key: 'sentiment',
      render: (sentiment: string) => <EcoSentimentBadge sentiment={sentiment} size="small" />,
    },
    {
      title: 'Menciones',
      dataIndex: 'mentionCount',
      key: 'mentionCount',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>Alertas</Title>
        <Button type="primary" icon={<Plus size={16} />}>
          Nueva Regla
        </Button>
      </div>

      <Card>
        <Title level={5} style={{ marginTop: 0 }}>Reglas de Alertas</Title>
        <Table<AlertRule>
          columns={rulesColumns}
          dataSource={rules}
          rowKey="id"
          loading={loading}
          pagination={false}
          locale={{ emptyText: 'No hay reglas configuradas' }}
        />
      </Card>

      <Card>
        <Title level={5} style={{ marginTop: 0 }}>Historial</Title>
        <Table<AlertHistoryItem>
          columns={historyColumns}
          dataSource={history}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: 'No se han disparado alertas' }}
        />
      </Card>
    </div>
  );
}
