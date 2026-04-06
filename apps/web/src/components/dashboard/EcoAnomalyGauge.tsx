'use client';

import { Skeleton } from 'antd';

interface Props {
  zScore: number | null;
  loading?: boolean;
}

function getColor(z: number): string {
  const abs = Math.abs(z);
  if (abs < 1) return '#52C47A';
  if (abs < 2) return '#F5A623';
  return '#E86452';
}

function getInterpretation(z: number): string {
  const abs = Math.abs(z);
  if (abs < 1) return 'Volumen dentro del rango normal';
  if (abs < 2) return z > 0 ? 'Volumen inusualmente alto' : 'Volumen inusualmente bajo';
  return 'Anomalia de volumen detectada';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function EcoAnomalyGauge({ zScore, loading = false }: Props) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 8 }}>
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      </div>
    );
  }

  if (zScore === null) {
    return (
      <div style={{ textAlign: 'center', padding: 8 }}>
        <div style={{ fontSize: 14, color: '#94A3B8', paddingTop: 24, paddingBottom: 24 }}>
          Sin datos
        </div>
      </div>
    );
  }

  const color = getColor(zScore);
  const interpretation = getInterpretation(zScore);
  const positionPct = clamp(((zScore + 3) / 6) * 100, 0, 100);

  return (
    <div style={{ textAlign: 'center', padding: 8 }}>
      {/* Z-score display */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color,
          lineHeight: 1.2,
        }}
      >
        {Math.abs(zScore).toFixed(1)}{'\u03C3'}
      </div>

      {/* Interpretation */}
      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2, marginBottom: 12 }}>
        {interpretation}
      </div>

      {/* Gauge bar */}
      <div style={{ position: 'relative', width: '100%', height: 8, marginBottom: 4 }}>
        {/* Background gradient bar */}
        <div
          style={{
            width: '100%',
            height: 8,
            borderRadius: 4,
            background:
              'linear-gradient(to right, ' +
              '#E86452 0%, ' +
              '#F5A623 16.7%, ' +
              '#52C47A 33.3%, ' +
              '#52C47A 66.7%, ' +
              '#F5A623 83.3%, ' +
              '#E86452 100%)',
            opacity: 0.35,
          }}
        />
        {/* Position indicator */}
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: `${positionPct}%`,
            transform: 'translateX(-50%)',
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: '#FFFFFF',
            border: `2px solid ${color}`,
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          }}
        />
      </div>

      {/* Scale labels */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 8,
          color: '#94A3B8',
        }}
      >
        <span>{'-2\u03C3'}</span>
        <span>0</span>
        <span>{'+2\u03C3'}</span>
      </div>
    </div>
  );
}
