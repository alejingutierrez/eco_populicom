'use client';

import { Drawer, Tag, Button, Space, Divider, Descriptions, Typography } from 'antd';
import { ExternalLink, CheckCircle, Archive, StickyNote } from 'lucide-react';
import { EcoSentimentBadge } from '@/components/ui/EcoSentimentBadge';
import { EcoSourceBadge } from '@/components/ui/EcoSourceBadge';
import { PERTINENCE_CONFIG } from '@/theme/constants';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const { Text, Paragraph } = Typography;

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

interface EcoMentionDrawerProps {
  open: boolean;
  mention: Mention | null;
  onClose: () => void;
}

export function EcoMentionDrawer({ open, mention, onClose }: EcoMentionDrawerProps) {
  if (!mention) return null;

  const pertConfig = mention.pertinence
    ? PERTINENCE_CONFIG[mention.pertinence as keyof typeof PERTINENCE_CONFIG]
    : null;

  const publishedDate = mention.published_at
    ? formatDistanceToNow(new Date(mention.published_at), { addSuffix: true, locale: es })
    : null;

  return (
    <Drawer
      title="Detalle de Mención"
      open={open}
      onClose={onClose}
      width={520}
      styles={{ body: { padding: '16px 24px' } }}
    >
      {/* Source + Date + Link */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <EcoSourceBadge source={mention.page_type ?? 'news'} showLabel />
          {publishedDate && <Text type="secondary" style={{ fontSize: 12 }}>{publishedDate}</Text>}
        </Space>
        {mention.url && (
          <Button
            type="link"
            size="small"
            href={mention.url}
            target="_blank"
            rel="noopener noreferrer"
            icon={<ExternalLink size={14} />}
          >
            Ver original
          </Button>
        )}
      </div>

      {/* Title */}
      {mention.title && (
        <div style={{ fontSize: 16, fontWeight: 600, color: '#0E1E2C', marginBottom: 8 }}>
          {mention.title}
        </div>
      )}

      {/* Full text */}
      <Paragraph style={{ fontSize: 14, color: '#64748B', marginBottom: 16 }}>
        {mention.full_text ?? 'Sin contenido disponible.'}
      </Paragraph>

      <Divider style={{ margin: '12px 0' }} />

      {/* Sentiment */}
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Sentimiento</Text>
        <Space>
          <EcoSentimentBadge sentiment={mention.sentiment} />
          {mention.sentiment_confidence != null && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Confianza: {Math.round(mention.sentiment_confidence * 100)}%
            </Text>
          )}
        </Space>
        {mention.bw_sentiment && (
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Brandwatch: {mention.bw_sentiment}
            </Text>
          </div>
        )}
      </div>

      {/* Emotions */}
      {mention.emotions && Object.keys(mention.emotions).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Emociones</Text>
          <Space wrap>
            {Object.entries(mention.emotions).map(([emotion, score]) => (
              <Tag key={emotion} color="blue" style={{ borderRadius: 6 }}>
                {emotion} {typeof score === 'number' ? `(${Math.round(score * 100)}%)` : ''}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {/* Topics */}
      {mention.topics && mention.topics.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Tópicos</Text>
          <Space wrap>
            {mention.topics.map((topic) => (
              <Tag key={topic.name} color="cyan" style={{ borderRadius: 6 }}>
                {topic.name}
                {topic.confidence != null ? ` (${Math.round(topic.confidence * 100)}%)` : ''}
              </Tag>
            ))}
          </Space>
        </div>
      )}

      {/* Municipality */}
      {mention.municipality_name && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Municipio</Text>
          <Text>
            {mention.municipality_name}
            {mention.region && <Text type="secondary"> — {mention.region}</Text>}
          </Text>
        </div>
      )}

      {/* Pertinence */}
      {pertConfig && (
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Pertinencia</Text>
          <Tag
            bordered={false}
            style={{
              background: pertConfig.bg,
              color: pertConfig.color,
              fontWeight: 600,
              borderRadius: 6,
            }}
          >
            {pertConfig.label}
          </Tag>
        </div>
      )}

      {/* Engagement */}
      <div style={{ marginBottom: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Engagement</Text>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="Likes">{mention.likes ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Shares">{mention.shares ?? 0}</Descriptions.Item>
          <Descriptions.Item label="Comments">{mention.comments ?? 0}</Descriptions.Item>
        </Descriptions>
      </div>

      <Divider style={{ margin: '12px 0' }} />

      {/* Actions */}
      <Space>
        <Button icon={<CheckCircle size={14} />}>Revisado</Button>
        <Button icon={<Archive size={14} />}>Archivar</Button>
        <Button icon={<StickyNote size={14} />}>Agregar nota</Button>
      </Space>
    </Drawer>
  );
}
