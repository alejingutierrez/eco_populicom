/**
 * Recharts theme configuration for ECO design system.
 * Use CHART_COLORS for non-sentiment data series.
 * Use SENTIMENT_COLORS for sentiment-specific charts (universal convention).
 */

/** Ordered palette for non-sentiment chart data series */
export const CHART_COLORS = [
  '#0A7EA4', // Azul océano (primario)
  '#2E8B6A', // Verde manglar
  '#F5A623', // Ámbar sol
  '#8B5CF6', // Violeta
  '#48B8D0', // Azul cielo
  '#E07A5F', // Coral
  '#7BC89C', // Verde claro
  '#F9C96B', // Ámbar claro
] as const;

/** Sentiment colors — green/red convention, do not change */
export const SENTIMENT_COLORS = {
  positivo: '#52C47A',
  neutral: '#CBD5E1',
  negativo: '#E86452',
} as const;

/** Sentiment background colors for badges and highlights */
export const SENTIMENT_BG_COLORS = {
  positivo: '#ECFDF5',
  neutral: '#F1F5F9',
  negativo: '#FEF2F2',
} as const;

/** Sentiment text colors for badges */
export const SENTIMENT_TEXT_COLORS = {
  positivo: '#2E8B6A',
  neutral: '#64748B',
  negativo: '#E86452',
} as const;

/** Shared Recharts configuration */
export const CHART_THEME = {
  grid: {
    stroke: '#F0F4F8',
    strokeDasharray: 'none',
  },
  axis: {
    stroke: '#E2E8F0',
    fontSize: 11,
    fill: '#94A3B8',
    tickLine: false,
    axisLine: false,
  },
  tooltip: {
    contentStyle: {
      backgroundColor: '#FFFFFF',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      fontSize: 12,
      padding: '8px 12px',
    },
  },
  area: {
    gradientOpacityStart: 0.2,
    gradientOpacityEnd: 0.01,
  },
} as const;

/** Source platform color assignments */
export const SOURCE_COLORS: Record<string, string> = {
  facebook: '#0A7EA4',
  facebook_public: '#0A7EA4',
  'facebook public': '#0A7EA4',
  twitter: '#F5A623',
  instagram: '#8B5CF6',
  instagram_public: '#8B5CF6',
  'instagram public': '#8B5CF6',
  youtube: '#E07A5F',
  news: '#2E8B6A',
  'online news': '#2E8B6A',
  blog: '#48B8D0',
  blogs: '#48B8D0',
  forum: '#7BC89C',
  forums: '#7BC89C',
  review: '#F9C96B',
};
