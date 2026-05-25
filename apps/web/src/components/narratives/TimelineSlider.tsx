'use client';

import { Slider } from 'antd';
import { useMemo } from 'react';

interface TimelineSliderProps {
  /** ISO date string del inicio del rango total disponible. */
  minDate: string;
  /** ISO date string del fin del rango total. */
  maxDate: string;
  value: [string, string];
  onChange: (range: [string, string]) => void;
}

function toEpoch(iso: string): number {
  return new Date(iso).getTime();
}
function fromEpoch(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function TimelineSlider({ minDate, maxDate, value, onChange }: TimelineSliderProps) {
  const min = toEpoch(minDate);
  const max = toEpoch(maxDate);

  const marks = useMemo(() => {
    const out: Record<number, string> = {};
    const totalDays = Math.max(1, (max - min) / 86_400_000);
    const stepMonths = totalDays > 365 ? 3 : totalDays > 90 ? 1 : 0; // 3-month or 1-month marks
    if (stepMonths === 0) {
      // Sub-90-day: just show start/end labels
      out[min] = fromEpoch(min);
      out[max] = fromEpoch(max);
      return out;
    }
    const start = new Date(min);
    start.setDate(1);
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor.getTime() <= max) {
      out[cursor.getTime()] = cursor.toLocaleDateString('es', { month: 'short', year: '2-digit' });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + stepMonths, 1);
    }
    return out;
  }, [min, max]);

  return (
    <Slider
      range={{ draggableTrack: true }}
      min={min}
      max={max}
      step={86_400_000} // 1 día
      marks={marks}
      value={[toEpoch(value[0]), toEpoch(value[1])]}
      onChange={(v: number[]) => {
        const [a, b] = v;
        onChange([fromEpoch(a), fromEpoch(b)]);
      }}
      tooltip={{ formatter: (ms?: number) => fromEpoch(ms ?? 0) }}
    />
  );
}
