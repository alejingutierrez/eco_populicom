'use client';

import { Tag } from 'antd';

export type NarrativeStatus =
  | 'emerging'
  | 'active'
  | 'peaking'
  | 'declining'
  | 'dormant'
  | 'revived';

const STATUS_CONFIG: Record<NarrativeStatus, { color: string; label: string }> = {
  emerging: { color: 'cyan', label: 'Emergente' },
  active: { color: 'green', label: 'Activa' },
  peaking: { color: 'orange', label: 'Pico' },
  declining: { color: 'gold', label: 'Decae' },
  dormant: { color: 'default', label: 'Dormida' },
  revived: { color: 'magenta', label: 'Revivida' },
};

export const STATUS_COLORS: Record<NarrativeStatus, string> = {
  emerging: '#13c2c2',   // cyan-6
  active: '#52c41a',     // green-6
  peaking: '#fa8c16',    // orange-6
  declining: '#faad14',  // gold-6
  dormant: '#8c8c8c',    // gray-7
  revived: '#eb2f96',    // magenta-6
};

export function NarrativeStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as NarrativeStatus] ?? { color: 'default', label: status };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
}
