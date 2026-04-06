'use client';

import { DatePicker } from 'antd';
import dayjs from 'dayjs';

interface PeriodOption {
  label: string;
  value: string;
}

interface EcoPeriodSelectorProps {
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
  showCustom?: boolean;
  customRange?: [string, string] | null;
  onCustomRange?: (dates: [string, string] | null) => void;
}

export function EcoPeriodSelector({
  options,
  value,
  onChange,
  showCustom,
  customRange,
  onCustomRange,
}: EcoPeriodSelectorProps) {
  return (
    <div className="eco-period-selector" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`eco-period-option${opt.value === value ? ' active' : ''}`}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
      {showCustom && (
        <button
          className={`eco-period-option${value === 'custom' ? ' active' : ''}`}
          onClick={() => onChange('custom')}
          type="button"
        >
          Custom
        </button>
      )}
      {showCustom && value === 'custom' && (
        <DatePicker.RangePicker
          size="small"
          value={
            customRange
              ? [dayjs(customRange[0]), dayjs(customRange[1])]
              : null
          }
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              onCustomRange?.([
                dates[0].format('YYYY-MM-DD'),
                dates[1].format('YYYY-MM-DD'),
              ]);
            } else {
              onCustomRange?.(null);
            }
          }}
          style={{ marginLeft: 4 }}
        />
      )}
    </div>
  );
}
