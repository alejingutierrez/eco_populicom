/**
 * Preview local del template del REPORTE DIARIO.
 * Genera un HTML con datos mock que cubren los casos típicos:
 * - Volumen mediano-alto (no edge cases)
 * - Mix de sentimientos (60% neg, 35% neu, 5% pos)
 * - Insights de IA llenos (3 por sentimiento)
 * - Resumen del día con HTML inline
 * - Indicadores numéricos con delta vs 7 días previos
 *
 * Uso: tsx scripts/preview-daily-report.ts
 *      → escribe a apps/web/public/emails/daily-report-preview.html
 */

import { renderDailyReportHtml, type DailyReportRenderData } from '../packages/shared/src/email/render-daily-report.ts';
import { formatMetric, formatDelta, formatVelocity } from '../packages/shared/src/format/metrics-display.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const data: DailyReportRenderData = {
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyShortName: 'DDEC',
  agencyKicker: 'DDEC · Departamento de Desarrollo Económico y Comercio',
  periodLabel: '29 abr – 5 may 2026',
  updatedAtLabel: '6 may, 6:00 a.m. AST',
  totals: { negative: 258, neutral: 259, positive: 42, total: 559 },
  deltaVsPrev: { negative: 18, neutral: -6, positive: 12 },
  dailySeries: [
    { date: '2026-04-28', dayLabel: 'mar 28', negative: 28, neutral: 32, positive: 5 },
    { date: '2026-04-29', dayLabel: 'mié 29', negative: 35, neutral: 33, positive: 7 },
    { date: '2026-04-30', dayLabel: 'jue 30', negative: 32, neutral: 38, positive: 6 },
    { date: '2026-05-01', dayLabel: 'vie 1',  negative: 38, neutral: 36, positive: 5 },
    { date: '2026-05-02', dayLabel: 'sáb 2',  negative: 30, neutral: 35, positive: 6 },
    { date: '2026-05-03', dayLabel: 'dom 3',  negative: 38, neutral: 41, positive: 7 },
    { date: '2026-05-04', dayLabel: 'lun 4',  negative: 57, neutral: 44, positive: 6 },
  ],
  topicsTable: [
    { topic: 'Permisos / Reforma', subtopics: 'Solicitudes pendientes · Demoras', total: 152, negative: 109, neutral: 39, positive: 4 },
    { topic: 'Gestión del Secretario', subtopics: 'Anuncios · Reuniones', total: 117, negative: 38, neutral: 71, positive: 8 },
    { topic: 'Desarrollo Empresarial', subtopics: 'Apoyo a pymes', total: 95, negative: 24, neutral: 56, positive: 15 },
    { topic: 'Críticas / Controversias', subtopics: 'Quejas públicas', total: 71, negative: 65, neutral: 5, positive: 1 },
    { topic: 'Legislación Económica', subtopics: 'Proyectos · Aprobaciones', total: 48, negative: 9, neutral: 33, positive: 6 },
    { topic: 'Inversión Extranjera', subtopics: 'Anuncios', total: 28, negative: 2, neutral: 22, positive: 4 },
    { topic: 'Incentivos Económicos', subtopics: 'Pymes · Convocatorias', total: 24, negative: 4, neutral: 18, positive: 2 },
    { topic: 'Otros tópicos (3)', subtopics: '', total: 17, negative: 5, neutral: 11, positive: 1, isOther: true },
    { topic: 'Sin clasificar', subtopics: 'En proceso de clasificación', total: 7, negative: 2, neutral: 4, positive: 1, isUnclassified: true },
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
    label: 'Resumen del día · 4 may',
    headline: 'Los reclamos por permisos empujan el lunes al día más negativo de la semana',
    highlights: [
      'Permisos / Reforma sumó <strong>37</strong> menciones el lunes, casi todas quejas por solicitudes detenidas desde marzo.',
      'La cobertura informativa sobre la gestión del Secretario amortiguó el tono: <strong>28</strong> menciones neutrales en prensa.',
      'El hilo con más alcance vino de X/Twitter y fue replicado por dos cuentas de medios regionales.',
    ],
    paragraph: 'La jornada cerró con <strong>107 menciones</strong>, el volumen más alto de la semana (15% sobre el día anterior). El 53% tuvo carga negativa, empujada por <strong>Permisos / Reforma</strong> (37 menciones) y <strong>Críticas / Controversias</strong> (18). En el lado neutral, la <strong>gestión del Secretario</strong> sumó 28 menciones de cobertura informativa. La conversación se concentró en cuentas de prensa y hilos de X/Twitter.',
  },
  // Deltas de sentimiento formateados igual que el lambda (% vs período previo).
  deltaDisplay: {
    negative: formatDelta(258, 219, { kind: 'percent', decimals: 0 }),
    neutral: formatDelta(259, 275, { kind: 'percent', decimals: 0 }),
    positive: formatDelta(42, 30, { kind: 'percent', decimals: 0 }),
  },
  // Indicadores compuestos NUMÉRICOS — mismos valores crudos que produce
  // calculateMetrics (crisis 0–1, bhi 0–1, nss −100..100) formateados por la
  // capa única + delta vs los 7 días previos con la semántica del dashboard.
  metrics: {
    crisis: {
      display: formatMetric('crisis', 0.36),
      delta: formatDelta(36, 42, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }),
    },
    bhi: {
      display: formatMetric('bhi', 0.59),
      delta: formatDelta(1 + 0.59 * 9, 1 + 0.55 * 9, { kind: 'absolute', decimals: 1, suffix: '' }),
    },
    nss: {
      display: formatMetric('nss', -14),
      delta: formatDelta(-14, -9.5, { kind: 'absolute', decimals: 1 }),
    },
    polarization: {
      display: formatMetric('polarization', 46),
      delta: formatDelta(46, 41, { kind: 'absolute', decimals: 0, suffix: ' pts' }),
    },
    velocity: {
      display: formatVelocity(3.8, 3.2),
      hint: 'engagement por mención vs período previo',
    },
    engagementRate: {
      display: formatMetric('engagementRate', 2.4),
      delta: formatDelta(2.4, 2.1, { kind: 'absolute', decimals: 1, suffix: ' pts' }),
    },
  },
  overviewUrl: 'https://citizenecho.com/overview?agency=ddecpr',
};


// Foto de la nota del día: en producción es el og:image de una noticia. Aquí
// un marcador SVG, para ver el espacio con foto y sin foto.
const MOCK_HERO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1072" height="560"><rect width="100%" height="100%" fill="#D5D8DC"/><text x="50%" y="50%" font-family="Helvetica" font-size="36" fill="#5A616B" text-anchor="middle">Foto de la nota del día</text></svg>',
)}`;

const repoRoot = join(__dirname, '..');
const variants: Array<{ file: string; data: DailyReportRenderData }> = [
  { file: 'daily-report-preview.html', data: { ...data, heroImage: { url: MOCK_HERO, caption: 'Foto: ElNuevoDia.com · 4 may' } } },
  { file: 'daily-report-preview-sin-foto.html', data },
];
for (const v of variants) {
  const html = renderDailyReportHtml(v.data);
  const outPath = join(repoRoot, 'apps', 'web', 'public', 'emails', v.file);
  writeFileSync(outPath, html, 'utf8');
  console.log(`Preview escrito: ${outPath} (${html.length} bytes)`);
}
