/**
 * Preview local del template del RESUMEN SEMANAL comparativo (viernes).
 * Datos mock: semana con menos volumen que la anterior, negatividad a la
 * baja, un tópico nuevo y uno que salió, indicadores con deltas mixtos.
 *
 * Uso: tsx scripts/preview-weekly-summary.ts
 *      → escribe a apps/web/public/emails/weekly-summary-preview.html
 */

import { renderWeeklySummaryHtml, type WeeklySummaryRenderData } from '../packages/shared/src/email/render-weekly-summary.ts';
import { formatMetric, formatDelta, formatVelocity } from '../packages/shared/src/format/metrics-display.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const totals = { negative: 187, neutral: 231, positive: 58, total: 476 };
const prevTotals = { negative: 258, neutral: 259, positive: 42, total: 559 };

const data: WeeklySummaryRenderData = {
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyShortName: 'DDEC',
  agencyKicker: 'DDEC · Departamento de Desarrollo Económico y Comercio',
  weekLabel: '27 jun – 3 jul 2026',
  prevWeekLabel: '20 – 26 jun 2026',
  updatedAtLabel: '4 jul, 6:00 a.m. AST',
  totals,
  prevTotals,
  totalDelta: formatDelta(totals.total, prevTotals.total, { kind: 'percent', decimals: 0 }),
  sentimentDelta: {
    negative: formatDelta(totals.negative, prevTotals.negative, { kind: 'percent', decimals: 0, invert: true }),
    neutral: formatDelta(totals.neutral, prevTotals.neutral, { kind: 'percent', decimals: 0 }),
    positive: formatDelta(totals.positive, prevTotals.positive, { kind: 'percent', decimals: 0 }),
  },
  metrics: {
    crisis: {
      display: formatMetric('crisis', 0.31),
      delta: formatDelta(31, 42, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }),
    },
    bhi: {
      display: formatMetric('bhi', 0.64),
      delta: formatDelta(1 + 0.64 * 9, 1 + 0.55 * 9, { kind: 'absolute', decimals: 1, suffix: '' }),
    },
    nss: {
      display: formatMetric('nss', -8.2),
      delta: formatDelta(-8.2, -14, { kind: 'absolute', decimals: 1 }),
    },
    polarization: {
      display: formatMetric('polarization', 39),
      delta: formatDelta(39, 46, { kind: 'absolute', decimals: 0, suffix: ' pts' }),
    },
    velocity: {
      display: formatVelocity(3.1, 3.6),
      hint: 'engagement por mención vs semana anterior',
    },
    engagementRate: {
      display: formatMetric('engagementRate', 2.9),
      delta: formatDelta(2.9, 2.4, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
    },
  },
  chartImageUrl: buildMockOverlayChartUrl(),
  weeklySummary:
    'La semana marcó el cierre del ciclo de controversia por el <strong>PS 1183</strong>: el volumen total bajó de <strong>559 a 476 menciones (−15%)</strong> y la negatividad retrocedió <strong>−28%</strong>, sin un evento de reemplazo que sostenga la presión. El espacio lo ocupó cobertura institucional sobre <strong>incentivos a pymes</strong>, amplificada por PR Newswire y la cuenta oficial de la agencia. La conversación queda en terreno neutral-informativo, con la positividad al alza (<strong>+38%</strong>) apoyada en el anuncio de inversión en la zona oeste.',
  highlights: [
    'La negatividad bajó de <strong>258 a 187 menciones (−28%)</strong>: el ciclo del <strong>PS 1183</strong> cerró sin vistas nuevas en el Senado y la prensa profesional (NotiCel, CPI) dejó de publicar seguimientos a mitad de semana.',
    '<strong>Incentivos Económicos</strong> pasó de 24 a <strong>67 menciones (+179%)</strong> tras la convocatoria de pymes del lunes; el 71% es cobertura neutral de medios regionales.',
    'El <strong>riesgo de crisis</strong> retrocedió de <strong>42% a 31% (−11 pts)</strong>, empujado por la caída de la severidad negativa y la ausencia de picos de volumen anómalos.',
    '<strong>Críticas / Controversias</strong> salió del top de la semana: tenía <strong>71 menciones</strong> la semana anterior y esta semana no registra volumen clasificado.',
  ],
  topicsCompare: [
    { topic: 'Desarrollo Empresarial', cur: 121, prev: 95, delta: formatDelta(121, 95, { kind: 'percent', decimals: 0 }) },
    { topic: 'Gestión del Secretario', cur: 98, prev: 117, delta: formatDelta(98, 117, { kind: 'percent', decimals: 0 }) },
    { topic: 'Permisos / Reforma', cur: 84, prev: 152, delta: formatDelta(84, 152, { kind: 'percent', decimals: 0 }) },
    { topic: 'Incentivos Económicos', cur: 67, prev: 24, delta: formatDelta(67, 24, { kind: 'percent', decimals: 0 }) },
    { topic: 'Legislación Económica', cur: 41, prev: 48, delta: formatDelta(41, 48, { kind: 'percent', decimals: 0 }) },
    { topic: 'Turismo y Promoción', cur: 28, prev: 0, delta: formatDelta(28, 0, { kind: 'percent', decimals: 0 }) },
    { topic: 'Inversión Extranjera', cur: 22, prev: 28, delta: formatDelta(22, 28, { kind: 'percent', decimals: 0 }) },
    { topic: 'Críticas / Controversias', cur: 0, prev: 71, delta: formatDelta(0, 71, { kind: 'percent', decimals: 0 }) },
  ],
  dashboardUrl: 'http://eco-alb-1881782703.us-east-1.elb.amazonaws.com/dashboard?agency=ddecpr',
};

function buildMockOverlayChartUrl(): string {
  const config = {
    type: 'line',
    data: {
      labels: ['vie 27', 'sáb 28', 'dom 29', 'lun 30', 'mar 1', 'mié 2', 'jue 3'],
      datasets: [
        { label: 'Esta semana', data: [61, 48, 44, 92, 78, 81, 72], borderColor: '#0A7EA4', backgroundColor: 'rgba(10,126,164,0.10)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#0A7EA4',
          pointBorderWidth: 1.5, tension: 0.3, fill: true },
        { label: 'Semana anterior', data: [65, 60, 71, 88, 95, 98, 82], borderColor: '#8A93A0', backgroundColor: 'rgba(138,147,160,0)',
          borderWidth: 2, borderDash: [6, 4], pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#8A93A0',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
      ],
    },
    options: {
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: { legend: { display: false }, title: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#EEF0F4', drawBorder: false },
          ticks: { font: { size: 10, family: 'Helvetica' }, color: '#8A93A0', padding: 6, maxTicksLimit: 5 } },
        x: { grid: { display: false, drawBorder: false },
          ticks: { font: { size: 11, family: 'Helvetica', weight: '500' }, color: '#4A5563', padding: 6 } },
      },
    },
  };
  return `https://quickchart.io/chart?v=4&w=540&h=240&bkg=white&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(config))}`;
}

const html = renderWeeklySummaryHtml(data);
const repoRoot = join(__dirname, '..');
const outPath = join(repoRoot, 'apps', 'web', 'public', 'emails', 'weekly-summary-preview.html');
writeFileSync(outPath, html, 'utf8');
console.log(`Preview escrito: ${outPath}`);
console.log(`HTML length: ${html.length} bytes`);
