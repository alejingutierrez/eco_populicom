import { cn } from '@/lib/utils';

interface SentimentBadgeProps {
  sentiment: string | null;
  className?: string;
}

const sentimentStyles: Record<string, string> = {
  positivo: 'bg-positive/15 text-positive',
  negativo: 'bg-negative/15 text-negative',
  neutral: 'bg-neutral-sentiment/15 text-neutral-sentiment',
  positive: 'bg-positive/15 text-positive',
  negative: 'bg-negative/15 text-negative',
};

export function SentimentBadge({ sentiment, className }: SentimentBadgeProps) {
  const label = sentiment ?? 'neutral';
  const style = sentimentStyles[label] ?? sentimentStyles.neutral;

  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', style, className)}>
      {label}
    </span>
  );
}
