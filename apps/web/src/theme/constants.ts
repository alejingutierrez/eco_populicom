/**
 * Design system constants used outside Ant Design token system.
 * For sidebar gradient, custom CSS, and non-Ant components.
 */

/** Sidebar (custom CSS, not Ant tokens) */
export const SIDEBAR = {
  width: 220,
  collapsedWidth: 64,
  bgGradient: 'linear-gradient(180deg, #0E1E2C 0%, #162D3E 50%, #1A3548 100%)',
  textColor: 'rgba(255,255,255,0.45)',
  textActiveColor: '#FFFFFF',
  activeBg: 'rgba(10,126,164,0.2)',
  activeBorderColor: '#48B8D0',
  sectionLabelColor: 'rgba(255,255,255,0.2)',
  hoverBg: 'rgba(255,255,255,0.05)',
  dividerColor: 'rgba(255,255,255,0.08)',
} as const;

/** Logo colors */
export const LOGO = {
  iconGradient: 'linear-gradient(135deg, #0A7EA4, #48B8D0)',
  iconShadow: '0 2px 8px rgba(10,126,164,0.35)',
} as const;

/** User avatar gradient */
export const AVATAR = {
  gradient: 'linear-gradient(135deg, #0A7EA4, #2E8B6A)',
} as const;

/** Mar Caribe accent colors for direct use */
export const ACCENT = {
  ocean: '#0A7EA4',
  oceanLight: '#48B8D0',
  mangrove: '#2E8B6A',
  mangroveLight: '#7BC89C',
  amber: '#F5A623',
  amberLight: '#F9C96B',
  violet: '#8B5CF6',
  violetLight: '#A78BFA',
  coral: '#E07A5F',
  coralLight: '#F4A492',
} as const;

/** Surface colors for custom components */
export const SURFACE = {
  layout: '#F4F7FA',
  card: '#FFFFFF',
  spotlight: '#FAFBFD',
  border: '#E2E8F0',
  borderLight: '#EEF2F6',
} as const;

/** Text colors for custom components */
export const TEXT = {
  primary: '#0E1E2C',
  secondary: '#64748B',
  tertiary: '#94A3B8',
  quaternary: '#CBD5E1',
} as const;

/** Pertinence badge config */
export const PERTINENCE_CONFIG = {
  alta: { color: '#E86452', bg: '#FEF2F2', label: 'Alta' },
  media: { color: '#F5A623', bg: '#FFF8E6', label: 'Media' },
  baja: { color: '#64748B', bg: '#F1F5F9', label: 'Baja' },
} as const;
