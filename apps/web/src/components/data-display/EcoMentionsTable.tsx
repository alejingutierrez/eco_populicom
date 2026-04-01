'use client';

import { useState } from 'react';
import { Table, Skeleton } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EcoSentimentBadge } from '@/components/ui/EcoSentimentBadge';
import { EcoSourceBadge } from '@/components/ui/EcoSourceBadge';
import { EcoMentionDrawer } from './EcoMentionDrawer';
import { PERTINENCE_CONFIG } from '@/theme/constants';
import { Tag } from 'antd';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Mention {
  id: string;
  title?: string | null;
  full_text?: string | null;
  page_type?: string | null;
  domain?: string | null;
  url?: string | null;
  published_at?: string | null;
  sentiment?: string | null;
  sentiment_confidence?: number | null;
  bw_sentiment?: string | null;
  emotions?: Record<string, number> | null;
  topics?: { name: string; confidence?: number }[];
  municipality_name?: string | null;
  region?: string | null;
  pertinence?: string | null;
  engagement?: number | null;
  impressions?: number | null;
  likes?: number | null;
  shares?: number | null;
  comments?: number | null;
}

interface EcoMentionsTableProps {
  data: Mention[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
}

export function EcoMentionsTable({
  data,
  loading = false,
  total,
  page = 1,
  pageSize = 20,
  onPageChange,
}: EcoMentionsTableProps) {
  const [drawerMention, setDrawerMention] = useState<Mention | null>(null);

  const columns: ColumnsType<Mention> = [
    {
      title: 'Fuente',
      dataIndex: 'page_type',
      key: 'source',
      width: 70,
      render: (source: string) => <EcoSourceBadge source={source ?? 'news'} />,
      filters: [
        { text: 'Facebook', value: 'facebook' },
        { text: 'Twitter/X', value: 'twitter' },
        { text: 'Noticias', value: 'news' },
        { text: 'Instagram', value: 'instagram' },
        { text: 'YouTube', value: 'youtube' },
      ],
      onFilter: (value, record) =>
        (record.page_type ?? '').toLowerCase().includes(String(value).toLowerCase()),
    },
    {
      title: 'Mención',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (_: unknown, record: Mention) => (
        <div>
          <div
            style={{
              fontWeight: 500,
              color: '#0E1E2C',
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {record.title ?? record.full_text?.slice(0, 80) ?? '—'}
          </div>
          {record.domain && (
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{record.domain}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Sentimiento',
      dataIndex: 'sentiment',
      key: 'sentiment',
      width: 110,
      render: (sentiment: string) => <EcoSentimentBadge sentiment={sentiment} size="small" />,
      filters: [
        { text: 'Positivo', value: 'positivo' },
        { text: 'Neutral', value: 'neutral' },
        { text: 'Negativo', value: 'negativo' },
      ],
      onFilter: (value, record) => record.sentiment === value,
      sorter: (a, b) => {
        const order = { negativo: 0, neutral: 1, positivo: 2 };
        return (
          (order[a.sentiment as keyof typeof order] ?? 1) -
          (order[b.sentiment as keyof typeof order] ?? 1)
        );
      },
    },
    {
      title: 'Pertinencia',
      dataIndex: 'pertinence',
      key: 'pertinence',
      width: 100,
      render: (pertinence: string) => {
        const config =
          PERTINENCE_CONFIG[pertinence as keyof typeof PERTINENCE_CONFIG];
        if (!config) return '—';
        return (
          <Tag
            bordered={false}
            style={{
              background: config.bg,
              color: config.color,
              fontWeight: 600,
              borderRadius: 6,
              fontSize: 11,
            }}
          >
            {config.label}
          </Tag>
        );
      },
      filters: [
        { text: 'Alta', value: 'alta' },
        { text: 'Media', value: 'media' },
        { text: 'Baja', value: 'baja' },
      ],
      onFilter: (value, record) => record.pertinence === value,
    },
    {
      title: 'Engagement',
      dataIndex: 'engagement',
      key: 'engagement',
      width: 100,
      align: 'right',
      sorter: (a, b) => (a.engagement ?? 0) - (b.engagement ?? 0),
      render: (val: number | null) => (
        <span style={{ fontWeight: 600, color: '#0E1E2C' }}>
          {val != null ? val.toLocaleString() : '—'}
        </span>
      ),
    },
    {
      title: 'Fecha',
      dataIndex: 'published_at',
      key: 'date',
      width: 120,
      sorter: (a, b) =>
        new Date(a.published_at ?? 0).getTime() - new Date(b.published_at ?? 0).getTime(),
      defaultSortOrder: 'descend',
      render: (date: string | null) => {
        if (!date) return '—';
        return (
          <span style={{ fontSize: 12, color: '#64748B' }}>
            {formatDistanceToNow(new Date(date), { addSuffix: true, locale: es })}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="middle"
        onRow={(record) => ({
          onClick: () => setDrawerMention(record),
          style: { cursor: 'pointer' },
        })}
        pagination={
          total != null
            ? {
                current: page,
                pageSize,
                total,
                onChange: onPageChange,
                showSizeChanger: false,
                showTotal: (total) => `${total} menciones`,
              }
            : { pageSize, showSizeChanger: false }
        }
      />

      <EcoMentionDrawer
        open={drawerMention !== null}
        mention={drawerMention}
        onClose={() => setDrawerMention(null)}
      />
    </>
  );
}
