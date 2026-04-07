'use client';

import { Treemap, ResponsiveContainer } from 'recharts';
import { EcoChartCard } from '../data-display/EcoChartCard';

interface TopicData {
  slug: string;
  name: string;
  count: number;
  positivePct: number;
  neutralPct: number;
  negativePct: number;
  dominantSentiment: 'positivo' | 'negativo' | 'neutral' | 'mixed';
}

interface Props {
  data: TopicData[];
  onTopicClick?: (slug: string) => void;
  loading?: boolean;
}

const SENTIMENT_FILL: Record<string, string> = {
  positivo: '#52C47A',
  negativo: '#E86452',
  neutral: '#CBD5E1',
  mixed: '#F5A623',
};

interface TreemapNode {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  size: number;
  fill: string;
  slug: string;
  dominantSentiment: string;
}

function CustomContent(props: TreemapNode) {
  const { x, y, width, height, name, size, fill, slug, dominantSentiment } = props;

  if (width < 4 || height < 4) return null;

  const textColor = dominantSentiment === 'neutral' ? '#334155' : '#FFFFFF';
  const showLabel = width > 40 && height > 30;
  const showCount = width > 40 && height > 48;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        ry={6}
        fill={fill}
        stroke="#FFFFFF"
        strokeWidth={2}
        style={{ cursor: 'pointer' }}
        data-slug={slug}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (showCount ? 6 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fill={textColor}
          fontSize={11}
          fontWeight={600}
        >
          {width < 80 && name.length > 8 ? `${name.slice(0, 8)}...` : name}
        </text>
      )}
      {showCount && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill={textColor}
          fontSize={9}
          opacity={0.85}
        >
          {size}
        </text>
      )}
    </g>
  );
}

export function EcoTopicTreemap({ data, onTopicClick, loading = false }: Props) {
  const treemapData = data.map((topic) => ({
    name: topic.name,
    size: topic.count,
    fill: SENTIMENT_FILL[topic.dominantSentiment] ?? SENTIMENT_FILL.neutral,
    slug: topic.slug,
    dominantSentiment: topic.dominantSentiment,
  }));

  const handleClick = (_: unknown, entry: { slug?: string }) => {
    if (entry?.slug && onTopicClick) {
      onTopicClick(entry.slug);
    }
  };

  return (
    <EcoChartCard title="Topicos por Sentimiento" loading={loading}>
      <ResponsiveContainer width="100%" height={200}>
        <Treemap
          data={treemapData}
          dataKey="size"
          content={CustomContent as never}
          onClick={handleClick as never}
          isAnimationActive={false}
        />
      </ResponsiveContainer>
    </EcoChartCard>
  );
}
