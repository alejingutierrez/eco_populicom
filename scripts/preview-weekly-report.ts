/**
 * Preview local del template del reporte semanal.
 * Genera un HTML con datos mock que cubren los casos típicos:
 * - Volumen mediano-alto (no edge cases)
 * - Mix de sentimientos (60% neg, 35% neu, 5% pos)
 * - Insights de IA llenos (3 por sentimiento)
 * - Resumen del día con HTML inline
 *
 * Uso: tsx scripts/preview-weekly-report.ts
 *      → escribe a apps/web/public/emails/weekly-report-preview.html
 */

import { renderWeeklyReportHtml, type WeeklyReportRenderData } from '../packages/shared/src/email/render-weekly-report.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const data: WeeklyReportRenderData = {
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyKicker: 'DDEC · Departamento de Desarrollo Económico y Comercio',
  periodLabel: '29 abr – 5 may 2026',
  updatedAtLabel: '6 may, 6:00 a.m. AST',
  totals: { negative: 412, neutral: 234, positive: 38, total: 684 },
  deltaVsPrev: { negative: 18, neutral: -6, positive: 12 },
  chartImageUrl: buildMockChartUrl(),
  dailySeries: [
    { date: '2026-04-29', dayLabel: 'mié 29', negative: 42, neutral: 28, positive: 4 },
    { date: '2026-04-30', dayLabel: 'jue 30', negative: 51, neutral: 32, positive: 6 },
    { date: '2026-05-01', dayLabel: 'vie 1',  negative: 58, neutral: 35, positive: 5 },
    { date: '2026-05-02', dayLabel: 'sáb 2',  negative: 47, neutral: 30, positive: 7 },
    { date: '2026-05-03', dayLabel: 'dom 3',  negative: 53, neutral: 33, positive: 4 },
    { date: '2026-05-04', dayLabel: 'lun 4',  negative: 76, neutral: 38, positive: 6 },
    { date: '2026-05-05', dayLabel: 'mar 5',  negative: 85, neutral: 38, positive: 6 },
  ],
  topicsTable: [
    { topic: 'Incentivos económicos', subtopics: 'Solicitudes pendientes · Demoras', total: 162, negative: 138, neutral: 22, positive: 2 },
    { topic: 'Permisos y licencias', subtopics: 'Procesos · Tiempos', total: 121, negative: 94, neutral: 25, positive: 2 },
    { topic: 'Atención al ciudadano', subtopics: 'Llamadas · Citas', total: 88, negative: 67, neutral: 19, positive: 2 },
    { topic: 'Programas de empleo', subtopics: 'Convocatorias · Cobertura', total: 76, negative: 31, neutral: 38, positive: 7 },
    { topic: 'Trámites en línea', subtopics: 'Portal · Errores', total: 64, negative: 52, neutral: 11, positive: 1 },
    { topic: 'Comunicación institucional', subtopics: 'Avisos oficiales', total: 58, negative: 9, neutral: 47, positive: 2 },
    { topic: 'Inversión y desarrollo', subtopics: 'Proyectos · Anuncios', total: 41, negative: 12, neutral: 22, positive: 7 },
    { topic: 'Eventos y ferias', subtopics: '', total: 28, negative: 4, neutral: 18, positive: 6 },
  ],
  insights: {
    negative: [
      'Reclamos por demoras en <strong>incentivos económicos</strong> concentran 138 menciones (84% negativas), con 22% más volumen que la semana previa; los usuarios citan trámites pendientes desde marzo.',
      'Quejas sobre <strong>permisos y licencias</strong> (94 menciones negativas) señalan que el portal en línea bota errores al subir documentación, especialmente en formularios de renovación.',
      'En <strong>atención al ciudadano</strong>, 67 menciones reportan llamadas no contestadas y citas reasignadas sin previo aviso — la fuente con más volumen es Twitter/X.',
    ],
    neutral: [
      'Consultas informativas sobre <strong>convocatorias de programas de empleo</strong> alcanzan 38 menciones; predominan preguntas sobre fechas y requisitos, sin carga emocional.',
      'Medios y cuentas oficiales reportan <strong>comunicados institucionales</strong> de DDEC sobre inversiones programadas para mayo (47 menciones, sentimiento neutro dominante).',
      'Preguntas recurrentes sobre <strong>uso del portal de trámites en línea</strong> (11 neutrales) apuntan a confusión con el flujo de validación de identidad.',
    ],
    positive: [
      'Reconocimiento al programa <strong>"Empleo Joven 2026"</strong> con 7 menciones positivas; usuarios destacan agilidad en la primera ronda de entrevistas.',
      'Valoraciones positivas sobre <strong>anuncio de inversión en zona oeste</strong> (7 menciones) — usuarios mencionan expectativa de empleos directos.',
      'Mención destacada de la página oficial agradeciendo la <strong>extensión de plazo</strong> para incentivos a pymes (2 menciones con engagement alto).',
    ],
  },
  dailySummary: {
    label: 'Cierre del 5 may',
    paragraph: 'La jornada cerró con <strong>129 menciones</strong>, el volumen más alto de la semana (12% sobre el día anterior). El 66% tuvo carga negativa, empujada por <strong>incentivos económicos</strong> (54 menciones) y <strong>permisos</strong> (28). En el lado positivo, el anuncio de inversión en la zona oeste sumó 4 menciones con engagement notable. La conversación se concentró en las cuentas de prensa y en hilos de X/Twitter, con menor presencia en Facebook que la semana previa.',
  },
};

function buildMockChartUrl(): string {
  const config = {
    type: 'line',
    data: {
      labels: ['mié 29','jue 30','vie 1','sáb 2','dom 3','lun 4','mar 5'],
      datasets: [
        { label: 'Negativo', data: [42, 51, 58, 47, 53, 76, 85],
          borderColor: '#C8462F', backgroundColor: 'rgba(200,70,47,0.10)',
          borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#C8462F',
          pointBorderWidth: 1.5, tension: 0.3, fill: true },
        { label: 'Neutral', data: [28, 32, 35, 30, 33, 38, 38],
          borderColor: '#6B7280', backgroundColor: 'rgba(107,114,128,0.06)',
          borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#6B7280',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
        { label: 'Positivo', data: [4, 6, 5, 7, 4, 6, 6],
          borderColor: '#1F8A47', backgroundColor: 'rgba(31,138,71,0)',
          borderWidth: 2, pointRadius: 2.5, pointBackgroundColor: '#FFFFFF', pointBorderColor: '#1F8A47',
          pointBorderWidth: 1.5, tension: 0.3, fill: false },
      ],
    },
    options: {
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: { display: false },
        title: { display: false },
      },
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

const html = renderWeeklyReportHtml(data);
const repoRoot = join(__dirname, '..');
const outPath = join(repoRoot, 'apps', 'web', 'public', 'emails', 'weekly-report-preview.html');
writeFileSync(outPath, html, 'utf8');
console.log(`Preview escrito: ${outPath}`);
console.log(`HTML length: ${html.length} bytes`);
