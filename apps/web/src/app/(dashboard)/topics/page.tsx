'use client';

import { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Skeleton, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EcoSentimentBadge } from '@/components/ui/EcoSentimentBadge';

const { Title } = Typography;

interface SubtopicData {
  slug: string;
  name: string;
  count: number;
}

interface TopicData {
  slug: string;
  name: string;
  count: number;
  topSentiment: string;
  subtopics: SubtopicData[];
}

const columns: ColumnsType<TopicData> = [
  {
    title: 'Nombre',
    dataIndex: 'name',
    key: 'name',
  },
  {
    title: 'Menciones',
    dataIndex: 'count',
    key: 'count',
    sorter: (a, b) => a.count - b.count,
    defaultSortOrder: 'descend',
  },
  {
    title: 'Sentimiento Principal',
    dataIndex: 'topSentiment',
    key: 'topSentiment',
    render: (sentiment: string) => <EcoSentimentBadge sentiment={sentiment} size="small" />,
  },
];

const subtopicColumns: ColumnsType<SubtopicData> = [
  {
    title: 'Subtopico',
    dataIndex: 'name',
    key: 'name',
  },
  {
    title: 'Menciones',
    dataIndex: 'count',
    key: 'count',
    sorter: (a, b) => a.count - b.count,
    defaultSortOrder: 'descend',
  },
];

export default function TopicsPage() {
  const [topics, setTopics] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/topics')
      .then((r) => r.json())
      .then((d) => setTopics(d.topics ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active title={{ width: 200 }} paragraph={false} />
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Col xs={24} sm={12} md={8} key={i}>
              <Card>
                <Skeleton active paragraph={{ rows: 2 }} title={false} />
              </Card>
            </Col>
          ))}
        </Row>
        <Card style={{ marginTop: 24 }}>
          <Skeleton active paragraph={{ rows: 6 }} title={{ width: 300 }} />
        </Card>
      </div>
    );
  }

  const maxCount = Math.max(...topics.map((t) => t.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Title level={4} style={{ margin: 0 }}>Topicos</Title>

      <Row gutter={[16, 16]}>
        {topics.map((t) => {
          const size = Math.max(0.4, t.count / maxCount);
          return (
            <Col xs={24} sm={12} md={8} key={t.slug}>
              <Card
                hoverable
                style={{ opacity: 0.5 + size * 0.5 }}
                styles={{ body: { padding: 16 } }}
              >
                <div style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{t.count}</div>
                <div style={{ marginTop: 4 }}>
                  <EcoSentimentBadge sentiment={t.topSentiment} size="small" />
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card>
        <Title level={5} style={{ marginTop: 0 }}>Detalle por Topico y Subtopico</Title>
        <Table<TopicData>
          columns={columns}
          dataSource={topics}
          rowKey="slug"
          pagination={false}
          expandable={{
            expandedRowRender: (record) => (
              <Table<SubtopicData>
                columns={subtopicColumns}
                dataSource={record.subtopics}
                rowKey="slug"
                pagination={false}
                size="small"
              />
            ),
            rowExpandable: (record) => record.subtopics.length > 0,
          }}
        />
      </Card>
    </div>
  );
}
