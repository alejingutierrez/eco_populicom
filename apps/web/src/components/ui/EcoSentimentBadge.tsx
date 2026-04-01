import { Tag } from 'antd';
import { SENTIMENT_BG_COLORS, SENTIMENT_TEXT_COLORS } from '@/theme/chart-theme';

type Sentiment = 'positivo' | 'negativo' | 'neutral' | 'positive' | 'negative';

const normalize = (s: string | null | undefined): 'positivo' | 'negativo' | 'neutral' => {
  if (!s) return 'neutral';
  const lower = s.toLowerCase();
  if (lower === 'positive' || lower === 'positivo') return 'positivo';
  if (lower === 'negative' || lower === 'negativo') return 'negativo';
  return 'neutral';
};

const LABELS: Record<string, string> = {
  positivo: 'Positivo',
  negativo: 'Negativo',
  neutral: 'Neutral',
};

interface EcoSentimentBadgeProps {
  sentiment: Sentiment | string | null | undefined;
  size?: 'small' | 'default';
}

export function EcoSentimentBadge({ sentiment, size = 'default' }: EcoSentimentBadgeProps) {
  const key = normalize(sentiment);
  const isSmall = size === 'small';

  return (
    <Tag
      bordered={false}
      style={{
        background: SENTIMENT_BG_COLORS[key],
        color: SENTIMENT_TEXT_COLORS[key],
        fontWeight: 600,
        fontSize: isSmall ? 11 : 12,
        padding: isSmall ? '1px 6px' : '2px 8px',
        borderRadius: 6,
        lineHeight: isSmall ? '18px' : '20px',
      }}
    >
      {LABELS[key]}
    </Tag>
  );
}
