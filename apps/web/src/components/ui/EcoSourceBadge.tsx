import {
  Facebook,
  Twitter,
  Instagram,
  Youtube,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { SOURCE_COLORS } from '@/theme/chart-theme';

const SOURCE_ICONS: Record<string, LucideIcon> = {
  facebook: Facebook,
  facebook_public: Facebook,
  twitter: Twitter,
  instagram: Instagram,
  instagram_public: Instagram,
  youtube: Youtube,
  news: Globe,
  blog: Globe,
  forum: Globe,
  review: Globe,
};

const SOURCE_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  facebook_public: 'Facebook',
  twitter: 'Twitter/X',
  instagram: 'Instagram',
  instagram_public: 'Instagram',
  youtube: 'YouTube',
  news: 'Noticias',
  blog: 'Blog',
  forum: 'Foro',
  review: 'Reseña',
};

interface EcoSourceBadgeProps {
  source: string;
  showLabel?: boolean;
  size?: number;
}

export function EcoSourceBadge({ source, showLabel = false, size = 20 }: EcoSourceBadgeProps) {
  const key = source.toLowerCase();
  const Icon = SOURCE_ICONS[key] ?? Globe;
  const color = SOURCE_COLORS[key] ?? '#94A3B8';
  const label = SOURCE_LABELS[key] ?? source;
  const iconSize = Math.round(size * 0.55);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.25,
          background: `${color}12`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={iconSize} color={color} />
      </span>
      {showLabel && (
        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>{label}</span>
      )}
    </span>
  );
}
