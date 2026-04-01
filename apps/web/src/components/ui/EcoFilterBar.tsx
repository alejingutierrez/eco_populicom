'use client';

import { Select, Input, Space } from 'antd';
import { Search, Filter } from 'lucide-react';

interface FilterOption {
  value: string;
  label: string;
}

interface EcoFilterBarProps {
  sentimentOptions?: FilterOption[];
  sourceOptions?: FilterOption[];
  pertinenceOptions?: FilterOption[];
  onSentimentChange?: (value: string) => void;
  onSourceChange?: (value: string) => void;
  onPertinenceChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  sentimentValue?: string;
  sourceValue?: string;
  pertinenceValue?: string;
  searchValue?: string;
}

const DEFAULT_SENTIMENT: FilterOption[] = [
  { value: '', label: 'Todos los sentimientos' },
  { value: 'positivo', label: 'Positivo' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negativo', label: 'Negativo' },
];

const DEFAULT_SOURCE: FilterOption[] = [
  { value: '', label: 'Todas las fuentes' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'news', label: 'Noticias' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
];

const DEFAULT_PERTINENCE: FilterOption[] = [
  { value: '', label: 'Toda la pertinencia' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Media' },
  { value: 'baja', label: 'Baja' },
];

export function EcoFilterBar({
  sentimentOptions = DEFAULT_SENTIMENT,
  sourceOptions = DEFAULT_SOURCE,
  pertinenceOptions = DEFAULT_PERTINENCE,
  onSentimentChange,
  onSourceChange,
  onPertinenceChange,
  onSearch,
  sentimentValue = '',
  sourceValue = '',
  pertinenceValue = '',
  searchValue,
}: EcoFilterBarProps) {
  return (
    <Space wrap size={10} style={{ marginBottom: 16 }}>
      <Select
        value={sentimentValue}
        onChange={onSentimentChange}
        options={sentimentOptions}
        style={{ minWidth: 180 }}
        suffixIcon={<Filter size={14} color="#94A3B8" />}
      />
      <Select
        value={sourceValue}
        onChange={onSourceChange}
        options={sourceOptions}
        style={{ minWidth: 160 }}
      />
      <Select
        value={pertinenceValue}
        onChange={onPertinenceChange}
        options={pertinenceOptions}
        style={{ minWidth: 160 }}
      />
      <Input.Search
        placeholder="Buscar menciones..."
        allowClear
        onSearch={onSearch}
        onChange={(e) => !e.target.value && onSearch?.('')}
        defaultValue={searchValue}
        style={{ width: 260 }}
        prefix={<Search size={14} color="#94A3B8" />}
      />
    </Space>
  );
}
