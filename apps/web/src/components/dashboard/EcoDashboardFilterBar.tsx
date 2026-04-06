'use client';

import { Select } from 'antd';
import { EcoPeriodSelector } from '../ui/EcoPeriodSelector';

export interface DashboardFilters {
  period: string;
  customRange: [string, string] | null;
  sentiment: string | null;
  source: string | null;
  topic: string | null;
  pertinence: string | null;
  municipality: string | null;
  compare: boolean;
}

export interface FilterOptions {
  sources: string[];
  topics: { slug: string; name: string }[];
  municipalitiesByRegion: Record<string, { slug: string; name: string }[]>;
}

interface Props {
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
  filterOptions: FilterOptions;
  loading?: boolean;
}

const periodOptions = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
];

const sentimentOptions = [
  { label: 'Positivo', value: 'positive' },
  { label: 'Neutral', value: 'neutral' },
  { label: 'Negativo', value: 'negative' },
];

const pertinenceOptions = [
  { label: 'Alta', value: 'alta' },
  { label: 'Media', value: 'media' },
  { label: 'Baja', value: 'baja' },
];

export function EcoDashboardFilterBar({ filters, onChange, filterOptions, loading }: Props) {
  const update = (partial: Partial<DashboardFilters>) => {
    onChange({ ...filters, ...partial });
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        background: '#fff',
        borderRadius: 10,
        padding: '8px 14px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      {/* Period selector */}
      <EcoPeriodSelector
        options={periodOptions}
        value={filters.period}
        onChange={(value) => update({ period: value })}
        showCustom
        customRange={filters.customRange}
        onCustomRange={(dates) => update({ customRange: dates })}
      />

      {/* Vertical divider */}
      <div
        style={{
          width: 1,
          height: 24,
          background: '#E2E8F0',
          flexShrink: 0,
        }}
      />

      {/* Sentimiento */}
      <Select
        allowClear
        placeholder="Sentimiento"
        size="small"
        style={{ minWidth: 120 }}
        value={filters.sentiment}
        onChange={(value) => update({ sentiment: value ?? null })}
        options={sentimentOptions}
        loading={loading}
      />

      {/* Fuente */}
      <Select
        allowClear
        placeholder="Fuente"
        size="small"
        style={{ minWidth: 120 }}
        value={filters.source}
        onChange={(value) => update({ source: value ?? null })}
        options={filterOptions.sources.map((s) => ({ label: s, value: s }))}
        loading={loading}
      />

      {/* Topico */}
      <Select
        allowClear
        placeholder="Topico"
        size="small"
        style={{ minWidth: 120 }}
        value={filters.topic}
        onChange={(value) => update({ topic: value ?? null })}
        options={filterOptions.topics.map((t) => ({ label: t.name, value: t.slug }))}
        loading={loading}
      />

      {/* Pertinencia */}
      <Select
        allowClear
        placeholder="Pertinencia"
        size="small"
        style={{ minWidth: 120 }}
        value={filters.pertinence}
        onChange={(value) => update({ pertinence: value ?? null })}
        options={pertinenceOptions}
        loading={loading}
      />

      {/* Geografia */}
      <Select
        allowClear
        placeholder="Geografia"
        size="small"
        style={{ minWidth: 120 }}
        value={filters.municipality}
        onChange={(value) => update({ municipality: value ?? null })}
        loading={loading}
      >
        {Object.entries(filterOptions.municipalitiesByRegion).map(([region, municipalities]) => (
          <Select.OptGroup key={region} label={region}>
            {municipalities.map((m) => (
              <Select.Option key={m.slug} value={m.slug}>
                {m.name}
              </Select.Option>
            ))}
          </Select.OptGroup>
        ))}
      </Select>

      {/* Spacer to push compare toggle right */}
      <div style={{ flex: 1 }} />

      {/* Compare toggle */}
      <button
        type="button"
        onClick={() => update({ compare: !filters.compare })}
        style={{
          flexShrink: 0,
          padding: '2px 10px',
          borderRadius: 12,
          fontSize: 12,
          lineHeight: '20px',
          fontWeight: 500,
          cursor: 'pointer',
          border: filters.compare ? '1px solid #0A7EA4' : '1px solid #CBD5E1',
          background: filters.compare ? '#0A7EA4' : 'transparent',
          color: filters.compare ? '#fff' : '#64748B',
          transition: 'all 0.15s ease',
        }}
      >
        {filters.compare ? 'vs anterior' : 'Comparar'}
      </button>
    </div>
  );
}
