import { Globe, Facebook, Twitter, Instagram, Youtube } from 'lucide-react';

const sourceIcons: Record<string, React.ElementType> = {
  facebook_public: Facebook,
  facebook: Facebook,
  twitter: Twitter,
  instagram_public: Instagram,
  instagram: Instagram,
  youtube: Youtube,
  news: Globe,
};

interface SourceIconProps {
  pageType: string;
  className?: string;
}

export function SourceIcon({ pageType, className = 'h-4 w-4' }: SourceIconProps) {
  const Icon = sourceIcons[pageType] ?? Globe;
  return <Icon className={className} />;
}
