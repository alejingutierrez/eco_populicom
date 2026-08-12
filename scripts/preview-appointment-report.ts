/**
 * Preview local del template del correo de NOMBRAMIENTO.
 * Datos mock calcados del caso real que estrenó el correo (Norma E. Burgos
 * Andújar como Secretaria de la Gobernación, 10-ago-2026): salto fuerte de
 * volumen vs los días previos, recepción partida, y el último día parcial.
 *
 * Uso: tsx scripts/preview-appointment-report.ts
 *      → escribe a apps/web/public/emails/appointment-report-preview.html
 */

import { renderAppointmentReportHtml, type AppointmentRenderData } from '../packages/shared/src/email/render-appointment-report.ts';
import { formatMetric, formatDelta } from '../packages/shared/src/format/metrics-display.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const totals = { negative: 61, neutral: 63, positive: 19, total: 143 };
const baselineTotals = { negative: 38, neutral: 42, positive: 9, total: 89 };

const data: AppointmentRenderData = {
  agencyName: 'Secretaría de la Gobernación',
  agencyShortName: 'SGPR',
  agencyKicker: 'SGPR · Secretaría de la Gobernación',
  appointment: {
    personName: 'Norma E. Burgos Andújar',
    position: 'Secretaria de la Gobernación',
    predecessor: 'Francisco Domenech',
    announcedOnLabel: 'lunes 10 de agosto de 2026',
    // Ruta relativa: el preview se sirve desde /emails/, así que resuelve a
    // /appointments/placeholder.svg. En producción photo_url es una URL absoluta.
    photoUrl: '../appointments/placeholder.svg',
    notes: 'Designada por la gobernadora Jenniffer González Colón tras la salida de Francisco Domenech el 7 de agosto. Fue secretaria de Estado (1995–1999) y presidenta de la Junta de Planificación.',
  },
  windowLabel: '9 – 12 ago 2026',
  baselineLabel: '5 – 8 ago 2026',
  windowDays: 4,
  updatedAtLabel: '12 ago, 4:00 p.m. AST',
  totals,
  baselineTotals,
  totalDelta: formatDelta(totals.total, baselineTotals.total, { kind: 'percent', decimals: 0 }),
  sentimentDelta: {
    negative: formatDelta(totals.negative, baselineTotals.negative, { kind: 'percent', decimals: 0, invert: true }),
    neutral: formatDelta(totals.neutral, baselineTotals.neutral, { kind: 'percent', decimals: 0 }),
    positive: formatDelta(totals.positive, baselineTotals.positive, { kind: 'percent', decimals: 0 }),
  },
  metrics: {
    crisis: {
      display: formatMetric('crisis', 0.44),
      delta: formatDelta(44, 33, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }),
    },
    nss: {
      display: formatMetric('nss', -29.4),
      delta: formatDelta(-29.4, -32.6, { kind: 'absolute', decimals: 1 }),
    },
    bhi: {
      display: formatMetric('bhi', 0.48),
      delta: formatDelta(1 + 0.48 * 9, 1 + 0.52 * 9, { kind: 'absolute', decimals: 1, suffix: '' }),
    },
    polarization: {
      display: formatMetric('polarization', 57),
      delta: formatDelta(57, 41, { kind: 'absolute', decimals: 0, suffix: ' pts' }),
    },
  },
  chartImageUrl: buildMockChartUrl(),
  summary:
    'El nombramiento llegó con la conversación ya caliente por la salida del predecesor y se recibió partido: '
    + '<strong>143 menciones</strong> en cuatro días frente a <strong>89</strong> en los cuatro previos '
    + '(<strong>+61%</strong>), con el negativo (<strong>43%</strong>) por encima del positivo (<strong>13%</strong>). '
    + 'El volumen lo produce cobertura obligada de prensa profesional — <strong>El Nuevo Día</strong>, '
    + '<strong>Primera Hora</strong> y <strong>Telemundo</strong> publicaron la designación el mismo lunes — más una '
    + 'segunda ola de reacciones de figuras políticas que el martes duplicó el tráfico en redes. La discusión no gira '
    + 'sobre el cargo sino sobre la persona: su paso por la <strong>Junta de Planificación</strong> y la Secretaría de '
    + 'Estado en los noventa aparece en 38 de las menciones. La agencia entra en su semana con la polarización en '
    + '<strong>57</strong>, dieciséis puntos sobre el nivel previo al anuncio.',
  reception: [
    'El respaldo institucional viene de figuras del <strong>PNP</strong> que subrayan su experiencia de gabinete: '
    + '<strong>19 menciones</strong> positivas concentradas el <strong>10 de agosto</strong>, casi todas citando su '
    + 'paso por la Secretaría de Estado.',
    'El reparo más repetido no cuestiona su capacidad sino la rotación en el puesto: <strong>27 menciones</strong> '
    + 'negativas enmarcan la designación como la tercera pieza que se mueve en La Fortaleza este año.',
    'Su trayectoria de los noventa es el eje con más volumen cruzado — <strong>38 menciones</strong> la mencionan, '
    + 'repartidas entre lectura de continuidad institucional y señalamiento de regreso de cuadros antiguos.',
    'La salida de <strong>Francisco Domenech</strong> sigue produciendo conversación propia: <strong>31 menciones</strong> '
    + 'del periodo hablan de él y no de ella, sostenidas por <strong>NotiCel</strong> y columnas de opinión.',
  ],
  highlights: [
    'El volumen diario pasó de un promedio de <strong>22</strong> menciones en los cuatro días previos a '
    + '<strong>66</strong> el <strong>10 de agosto</strong>, el día del anuncio — un pico de 3x concentrado en prensa.',
    'El tópico <strong>Nombramientos</strong> pasó de <strong>4</strong> a <strong>71</strong> menciones y desplazó a '
    + '<strong>Controversias / Escrutinio</strong> del primer lugar por primera vez desde marzo.',
    'La <strong>polarización</strong> subió de <strong>41</strong> a <strong>57</strong>: hay respaldo y rechazo '
    + 'articulados a la vez, no una reacción de un solo signo.',
    'El <strong>riesgo de crisis</strong> subió 11 puntos hasta <strong>44%</strong>, movido por el volumen y no por '
    + 'una caída del sentimiento — el negativo creció <strong>+61%</strong>, igual que el total.',
  ],
  topics: [
    { topic: 'Nombramientos', total: 71, negShare: 38 },
    { topic: 'Controversias / Escrutinio', total: 29, negShare: 79 },
    { topic: 'Gestión y gobernanza', total: 18, negShare: 33 },
    { topic: 'Política partidista', total: 12, negShare: 58 },
    { topic: 'Relación con la Legislatura', total: 8, negShare: 25 },
    { topic: 'Imagen y liderazgo', total: 5, negShare: 20 },
  ],
  topMentions: [
    {
      sourceLabel: 'El Nuevo Día',
      title: null,
      snippet: 'Entre el apoyo y el repudio: líderes políticos reaccionan a la designación de Norma Burgos como secretaria de la Gobernación.',
      url: 'https://www.elnuevodia.com/',
      engagementLabel: '2,140 interacciones',
      publishedAtLabel: '10 ago',
      tone: 'negative',
    },
    {
      sourceLabel: 'Primera Hora',
      title: null,
      snippet: 'La gobernadora designa a Norma Burgos como secretaria de la Gobernación. Tendrá a su cargo la coordinación interagencial y el seguimiento a las prioridades de la Primera Ejecutiva.',
      url: 'https://www.primerahora.com/',
      engagementLabel: '1,487 interacciones',
      publishedAtLabel: '10 ago',
      tone: 'neutral',
    },
    {
      sourceLabel: 'Telemundo Puerto Rico',
      title: null,
      snippet: 'Burgos fue presidenta de la Junta de Planificación entre 1993 y 1999 y secretaria de Estado desde 1995.',
      url: 'https://www.telemundopr.com/',
      engagementLabel: '903 interacciones',
      publishedAtLabel: '10 ago',
      tone: 'positive',
    },
    {
      sourceLabel: 'NotiCel',
      title: null,
      snippet: 'La tercera silla que se mueve en La Fortaleza en lo que va de año reabre la pregunta por la estabilidad del gabinete.',
      url: 'https://www.noticel.com/',
      engagementLabel: '664 interacciones',
      publishedAtLabel: '11 ago',
      tone: 'negative',
    },
  ],
  dashboardUrl: 'https://citizenecho.com/overview?agency=sgpr',
};

/** Volumen diario por sentimiento; el último día va parcial a propósito. */
function buildMockChartUrl(): string {
  const config = {
    type: 'line',
    data: {
      labels: ['dom 9', 'lun 10', 'mar 11', 'mié 12'],
      datasets: [
        { label: 'Negativo', data: [5, 27, 24, 5], borderColor: '#C8462F', backgroundColor: 'rgba(200,70,47,0.10)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#C8462F',
          pointBorderWidth: 1.5, tension: 0.3, fill: true },
        { label: 'Neutral', data: [6, 29, 27, 1], borderColor: '#6B7280', backgroundColor: 'rgba(107,114,128,0.06)',
          borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#6B7280',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
        { label: 'Positivo', data: [2, 10, 7, 0], borderColor: '#1F8A47', backgroundColor: 'rgba(31,138,71,0)',
          borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#1F8A47',
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

const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'apps', 'web', 'public', 'emails');

// Dos variantes: con retrato y sin él (monograma de iniciales). La ficha tiene
// que verse bien en ambos estados, porque photo_url es opcional.
const withPhoto = renderAppointmentReportHtml(data);
writeFileSync(join(outDir, 'appointment-report-preview.html'), withPhoto, 'utf8');
console.log(`Preview (con foto):  appointment-report-preview.html · ${withPhoto.length} bytes`);

const noPhoto = renderAppointmentReportHtml({
  ...data,
  appointment: { ...data.appointment, photoUrl: null },
});
writeFileSync(join(outDir, 'appointment-report-preview-monograma.html'), noPhoto, 'utf8');
console.log(`Preview (monograma): appointment-report-preview-monograma.html · ${noPhoto.length} bytes`);
