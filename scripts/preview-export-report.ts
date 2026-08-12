/**
 * Preview local del REPORTE ANALÍTICO EXPORTABLE (el PDF del botón "Exportar").
 *
 * Renderiza el documento completo con datos mock realistas, sin base de datos y
 * sin Bedrock, para poder iterar el DISEÑO: tipografía, paginación de impresión,
 * gráficas SVG, control de saltos y degradación en escala de grises.
 *
 * Uso: tsx scripts/preview-export-report.ts
 *      → apps/web/public/report-preview/index.html          (todo lleno)
 *      → apps/web/public/report-preview/sin-ia.html          (fallan las 9 llamadas)
 *      → apps/web/public/report-preview/vacio.html           (período sin menciones)
 *
 * Los tres casos importan: el reporte tiene que verse bien cuando la IA responde,
 * cuando NO responde (el documento sigue siendo válido con sus datos y tablas), y
 * cuando el período no tiene menciones.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderDocumentHead, renderCover, renderToc, renderExecutiveSummary,
  renderIndicators, renderTrend, renderSentiment, renderTopics,
  renderActors, renderGeography, renderRisk, renderMentions,
  renderSynthesis, renderAnnex, renderDocumentFoot,
  type MetricSeries,
} from '../packages/shared/src/report/render-print-report.ts';
import type { ReportContext } from '../packages/shared/src/prompts/full-report.ts';
import { formatDayLabel } from '../packages/shared/src/format-period.ts';
import type { WindowMetrics } from '../packages/shared/src/metrics.ts';
import type { ReportDetail } from '../packages/shared/src/aggregations/report-detail.ts';
import type { SentimentReport } from '../packages/shared/src/aggregations/sentiment-report.ts';

// ============================================================
// Mock: serie diaria de 14 días con un pico marcado
// ============================================================

const DAILY: Array<{ date: string; negative: number; neutral: number; positive: number }> = [
  { date: '2026-07-29', negative: 22, neutral: 31, positive: 4 },
  { date: '2026-07-30', negative: 27, neutral: 28, positive: 6 },
  { date: '2026-07-31', negative: 19, neutral: 25, positive: 3 },
  { date: '2026-08-01', negative: 12, neutral: 18, positive: 2 },
  { date: '2026-08-02', negative: 9, neutral: 14, positive: 1 },
  { date: '2026-08-03', negative: 31, neutral: 34, positive: 5 },
  { date: '2026-08-04', negative: 88, neutral: 46, positive: 7 },
  { date: '2026-08-05', negative: 64, neutral: 39, positive: 9 },
  { date: '2026-08-06', negative: 41, neutral: 36, positive: 4 },
  { date: '2026-08-07', negative: 38, neutral: 30, positive: 11 },
  { date: '2026-08-08', negative: 26, neutral: 27, positive: 3 },
  { date: '2026-08-09', negative: 11, neutral: 16, positive: 2 },
  { date: '2026-08-10', negative: 14, neutral: 19, positive: 1 },
  { date: '2026-08-11', negative: 35, neutral: 33, positive: 6 },
];

const dailySeries = DAILY.map((d) => ({ ...d, dayLabel: formatDayLabel(d.date) }));
const sum = (k: 'negative' | 'neutral' | 'positive'): number => DAILY.reduce((a, b) => a + b[k], 0);

const report: SentimentReport = {
  periodStart: '2026-07-29',
  periodEnd: '2026-08-11',
  totals: { negative: sum('negative'), neutral: sum('neutral'), positive: sum('positive'), total: sum('negative') + sum('neutral') + sum('positive') },
  prevTotals: { negative: 291, neutral: 340, positive: 71, total: 702 },
  deltaVsPrev: { negative: 40.2, neutral: -3.8, positive: -9.9 },
  dailySeries,
  topicsTable: [
    { topic: 'Permisos / Reforma', subtopics: 'ventanilla única · endoso · JP', total: 168, secondaryCount: 44, negative: 121, neutral: 43, positive: 4 },
    { topic: 'Inversión y empleo', subtopics: 'manufactura · incentivos · zonas', total: 141, secondaryCount: 31, negative: 38, neutral: 84, positive: 19 },
    { topic: 'Energía', subtopics: 'LUMA · Genera · apagones', total: 97, secondaryCount: 52, negative: 71, neutral: 24, positive: 2 },
    { topic: 'Turismo', subtopics: 'temporada · cruceros', total: 63, secondaryCount: 18, negative: 14, neutral: 39, positive: 10 },
    { topic: 'Críticas / Controversias', subtopics: 'señalamientos · auditoría', total: 58, secondaryCount: 27, negative: 51, neutral: 7, positive: 0 },
    { topic: 'Comercio local', subtopics: 'pymes · financiamiento', total: 41, secondaryCount: 12, negative: 11, neutral: 24, positive: 6 },
    { topic: 'Infraestructura', subtopics: 'puertos · carreteras', total: 29, secondaryCount: 9, negative: 12, neutral: 16, positive: 1 },
    { topic: 'Otros tópicos (4)', subtopics: '', total: 44, secondaryCount: 15, negative: 17, neutral: 25, positive: 2, isOther: true },
    { topic: 'Sin clasificar', subtopics: 'En proceso de clasificación', total: 96, secondaryCount: 0, negative: 32, neutral: 58, positive: 6, isUnclassified: true },
  ],
};

const detail: ReportDetail = {
  channels: [
    { key: 'twitter', label: 'X / Twitter', total: 268, negative: 171, neutral: 84, positive: 13, engagement: 41230, reach: 1_842_000 },
    { key: 'news', label: 'Noticias', total: 224, negative: 108, neutral: 104, positive: 12, engagement: 18740, reach: 4_120_000 },
    { key: 'facebook', label: 'Facebook', total: 141, negative: 62, neutral: 63, positive: 16, engagement: 52910, reach: 986_000 },
    { key: 'instagram', label: 'Instagram', total: 62, negative: 15, neutral: 34, positive: 13, engagement: 31480, reach: 412_000 },
    { key: 'blog', label: 'Blogs', total: 26, negative: 11, neutral: 13, positive: 2, engagement: 940, reach: 88_000 },
    { key: 'youtube', label: 'YouTube', total: 16, negative: 4, neutral: 10, positive: 2, engagement: 6120, reach: 210_000 },
  ],
  authors: [
    { author: 'NotiCel', channel: 'Noticias', total: 34, negative: 21, positive: 1, engagement: 4820 },
    { author: 'El Nuevo Día', channel: 'Noticias', total: 31, negative: 14, positive: 4, engagement: 6110 },
    { author: 'Centro de Periodismo Investigativo', channel: 'Noticias', total: 22, negative: 19, positive: 0, engagement: 3940 },
    { author: '@ciudadano_pr', channel: 'X / Twitter', total: 19, negative: 18, positive: 0, engagement: 8420 },
    { author: 'Metro Puerto Rico', channel: 'Noticias', total: 17, negative: 8, positive: 2, engagement: 2210 },
    { author: '@desarrollopr', channel: 'X / Twitter', total: 15, negative: 0, positive: 9, engagement: 1180 },
    { author: 'Wapa TV', channel: 'Noticias', total: 13, negative: 6, positive: 1, engagement: 1940 },
    { author: '@energia_boricua', channel: 'X / Twitter', total: 12, negative: 12, positive: 0, engagement: 5310 },
  ],
  domains: [
    { domain: 'noticel.com', total: 34, negative: 21, engagement: 4820 },
    { domain: 'elnuevodia.com', total: 31, negative: 14, engagement: 6110 },
    { domain: 'periodismoinvestigativo.com', total: 22, negative: 19, engagement: 3940 },
    { domain: 'metro.pr', total: 17, negative: 8, engagement: 2210 },
    { domain: 'wapa.tv', total: 13, negative: 6, engagement: 1940 },
    { domain: 'primerahora.com', total: 11, negative: 5, engagement: 1320 },
    { domain: 'elvocero.com', total: 9, negative: 4, engagement: 880 },
  ],
  emotions: [
    { emotion: 'Frustración', count: 214, share: 33.9 },
    { emotion: 'Enojo', count: 168, share: 26.6 },
    { emotion: 'Preocupación', count: 121, share: 19.2 },
    { emotion: 'Confusión', count: 64, share: 10.1 },
    { emotion: 'Esperanza', count: 38, share: 6.0 },
    { emotion: 'Aprobación', count: 19, share: 3.0 },
    { emotion: 'Alegría', count: 8, share: 1.3 },
  ],
  emotionsTagged: 632,
  municipalities: [
    { name: 'San Juan', region: 'Metro', total: 96, negative: 61, neutral: 31, positive: 4 },
    { name: 'Bayamón', region: 'Metro', total: 41, negative: 24, neutral: 15, positive: 2 },
    { name: 'Ponce', region: 'Sur', total: 34, negative: 19, neutral: 14, positive: 1 },
    { name: 'Caguas', region: 'Este', total: 28, negative: 12, neutral: 14, positive: 2 },
    { name: 'Mayagüez', region: 'Oeste', total: 24, negative: 14, neutral: 9, positive: 1 },
    { name: 'Arecibo', region: 'Norte', total: 19, negative: 8, neutral: 10, positive: 1 },
    { name: 'Carolina', region: 'Metro', total: 17, negative: 9, neutral: 7, positive: 1 },
    { name: 'Guaynabo', region: 'Metro', total: 14, negative: 6, neutral: 7, positive: 1 },
    { name: 'Humacao', region: 'Este', total: 11, negative: 6, neutral: 5, positive: 0 },
    { name: 'Aguadilla', region: 'Oeste', total: 9, negative: 4, neutral: 5, positive: 0 },
  ],
  regions: [
    { region: 'Metro', total: 168, negative: 100, neutral: 60, positive: 8, municipalities: 4 },
    { region: 'Sur', total: 48, negative: 26, neutral: 20, positive: 2, municipalities: 3 },
    { region: 'Este', total: 39, negative: 18, neutral: 19, positive: 2, municipalities: 2 },
    { region: 'Oeste', total: 33, negative: 18, neutral: 14, positive: 1, municipalities: 2 },
    { region: 'Norte', total: 27, negative: 12, neutral: 14, positive: 1, municipalities: 2 },
  ],
  subtopics: [
    { topic: 'Permisos / Reforma', subtopic: 'ventanilla única', total: 71, negative: 54, neutral: 16, positive: 1 },
    { topic: 'Energía', subtopic: 'apagones', total: 58, negative: 47, neutral: 11, positive: 0 },
    { topic: 'Permisos / Reforma', subtopic: 'endoso', total: 49, negative: 36, neutral: 12, positive: 1 },
    { topic: 'Inversión y empleo', subtopic: 'manufactura avanzada', total: 47, negative: 9, neutral: 30, positive: 8 },
    { topic: 'Críticas / Controversias', subtopic: 'señalamientos', total: 38, negative: 34, neutral: 4, positive: 0 },
    { topic: 'Inversión y empleo', subtopic: 'incentivos', total: 36, negative: 12, neutral: 21, positive: 3 },
    { topic: 'Turismo', subtopic: 'temporada alta', total: 31, negative: 6, neutral: 20, positive: 5 },
    { topic: 'Permisos / Reforma', subtopic: 'Junta de Planificación', total: 28, negative: 22, neutral: 6, positive: 0 },
    { topic: 'Comercio local', subtopic: 'financiamiento pymes', total: 24, negative: 6, neutral: 14, positive: 4 },
    { topic: 'Energía', subtopic: 'LUMA', total: 22, negative: 17, neutral: 5, positive: 0 },
  ],
  topByEngagement: [
    { id: '1', title: 'Empresarios denuncian que la ventanilla única de permisos duplicó los tiempos de endoso en tres meses', snippet: null, author: 'NotiCel', domain: 'noticel.com', channel: 'Noticias', url: 'https://www.noticel.com/economia/permisos-ventanilla-unica-endosos', sentiment: 'negative', pertinence: 'alta', engagement: 8420, reach: 412_000, date: '2026-08-04', topic: 'Permisos / Reforma', emotions: ['frustración', 'enojo'] },
    { id: '2', title: 'Anuncian planta de manufactura avanzada en Aguadilla con 340 empleos directos', snippet: null, author: '@desarrollopr', domain: 'x.com', channel: 'X / Twitter', url: 'https://x.com/desarrollopr/status/1', sentiment: 'positive', pertinence: 'alta', engagement: 6110, reach: 288_000, date: '2026-08-07', topic: 'Inversión y empleo', emotions: ['esperanza'] },
    { id: '3', title: 'Tercer apagón general del mes deja sin servicio a 84 municipios durante la madrugada', snippet: null, author: '@energia_boricua', domain: 'x.com', channel: 'X / Twitter', url: 'https://x.com/energia_boricua/status/2', sentiment: 'negative', pertinence: 'alta', engagement: 5310, reach: 194_000, date: '2026-08-04', topic: 'Energía', emotions: ['enojo'] },
    { id: '4', title: 'Junta de Planificación objeta formalmente el reglamento de la reforma de permisos', snippet: null, author: 'Centro de Periodismo Investigativo', domain: 'periodismoinvestigativo.com', channel: 'Noticias', url: 'https://periodismoinvestigativo.com/2026/08/junta-objeta-reglamento', sentiment: 'negative', pertinence: 'alta', engagement: 3940, reach: 121_000, date: '2026-08-05', topic: 'Permisos / Reforma', emotions: ['preocupación'] },
    { id: '5', title: 'Temporada alta de cruceros cierra con 1.2 millones de visitantes, récord para el puerto de San Juan', snippet: null, author: 'El Nuevo Día', domain: 'elnuevodia.com', channel: 'Noticias', url: 'https://www.elnuevodia.com/negocios/turismo/cruceros-record', sentiment: 'positive', pertinence: 'media', engagement: 2210, reach: 640_000, date: '2026-08-08', topic: 'Turismo', emotions: ['aprobación'] },
    { id: '6', title: 'Comerciantes de Ponce reportan pérdidas por retrasos en el sistema de endosos municipales', snippet: null, author: 'Metro Puerto Rico', domain: 'metro.pr', channel: 'Noticias', url: 'https://www.metro.pr/pr/economia/2026/08/06/ponce-endosos', sentiment: 'negative', pertinence: 'alta', engagement: 1940, reach: 98_000, date: '2026-08-06', topic: 'Permisos / Reforma', emotions: ['frustración'] },
    { id: '7', title: 'Agencia publica el calendario de talleres de financiamiento para pymes del segundo semestre', snippet: null, author: '@desarrollopr', domain: 'x.com', channel: 'X / Twitter', url: 'https://x.com/desarrollopr/status/3', sentiment: 'neutral', pertinence: 'media', engagement: 1180, reach: 42_000, date: '2026-08-09', topic: 'Comercio local', emotions: [] },
    { id: '8', title: 'Análisis: por qué la reforma de permisos no ha reducido el tiempo de tramitación', snippet: null, author: 'Wapa TV', domain: 'wapa.tv', channel: 'Noticias', url: 'https://www.wapa.tv/noticias/economia/analisis-reforma-permisos', sentiment: 'negative', pertinence: 'alta', engagement: 940, reach: 210_000, date: '2026-08-11', topic: 'Permisos / Reforma', emotions: ['confusión'] },
  ],
  topNegative: [
    { id: '1', title: 'Empresarios denuncian que la ventanilla única de permisos duplicó los tiempos de endoso en tres meses', snippet: null, author: 'NotiCel', domain: 'noticel.com', channel: 'Noticias', url: 'https://www.noticel.com/economia/permisos-ventanilla-unica-endosos', sentiment: 'negative', pertinence: 'alta', engagement: 8420, reach: 412_000, date: '2026-08-04', topic: 'Permisos / Reforma', emotions: ['frustración', 'enojo'] },
    { id: '3', title: 'Tercer apagón general del mes deja sin servicio a 84 municipios durante la madrugada', snippet: null, author: '@energia_boricua', domain: 'x.com', channel: 'X / Twitter', url: 'https://x.com/energia_boricua/status/2', sentiment: 'negative', pertinence: 'alta', engagement: 5310, reach: 194_000, date: '2026-08-04', topic: 'Energía', emotions: ['enojo'] },
    { id: '4', title: 'Junta de Planificación objeta formalmente el reglamento de la reforma de permisos', snippet: null, author: 'Centro de Periodismo Investigativo', domain: 'periodismoinvestigativo.com', channel: 'Noticias', url: 'https://periodismoinvestigativo.com/2026/08/junta-objeta-reglamento', sentiment: 'negative', pertinence: 'alta', engagement: 3940, reach: 121_000, date: '2026-08-05', topic: 'Permisos / Reforma', emotions: ['preocupación'] },
    { id: '6', title: 'Comerciantes de Ponce reportan pérdidas por retrasos en el sistema de endosos municipales', snippet: null, author: 'Metro Puerto Rico', domain: 'metro.pr', channel: 'Noticias', url: 'https://www.metro.pr/pr/economia/2026/08/06/ponce-endosos', sentiment: 'negative', pertinence: 'alta', engagement: 1940, reach: 98_000, date: '2026-08-06', topic: 'Permisos / Reforma', emotions: ['frustración'] },
  ],
  byHour: [3, 2, 1, 0, 1, 4, 12, 28, 51, 68, 74, 62, 47, 55, 71, 66, 58, 44, 38, 31, 24, 18, 11, 6],
  byDow: [58, 121, 138, 112, 96, 104, 46],
  peaks: [
    { date: '2026-08-04', dayLabel: formatDayLabel('2026-08-04'), total: 141, negative: 88, zScore: 2.41 },
    { date: '2026-08-05', dayLabel: formatDayLabel('2026-08-05'), total: 112, negative: 64, zScore: 1.52 },
    { date: '2026-08-06', dayLabel: formatDayLabel('2026-08-06'), total: 81, negative: 41, zScore: 0.58 },
  ],
  unclassified: 96,
  withoutSentiment: 41,
  totals: { reach: 7_658_000, engagement: 151_420, mentions: 737 },
};

const metrics: WindowMetrics = {
  nss: -38.4, brandHealthIndex: 0.41, reputationMomentum: -0.12, engagementRate: 2.8,
  amplificationRate: 1.4, engagementVelocity: 0.31, crisisRiskScore: 0.58,
  volumeAnomalyZscore: 1.42, nss7d: -35.1, nss30d: -22.7, polarizationIndex: 64,
  crisisSeverity: 0.61, crisisVelocity: 0.34, crisisRelevance: 0.72, crisisConfidence: 0.88,
  totals: { total: report.totals.total, positive: report.totals.positive, neutral: report.totals.neutral, negative: report.totals.negative },
  totalReach: 7_658_000, totalEngagementScore: 151_420, engagementPerMention: 205.4,
};

const prevMetrics: WindowMetrics = {
  ...metrics,
  nss: -24.1, brandHealthIndex: 0.52, crisisRiskScore: 0.34, polarizationIndex: 51,
  engagementRate: 3.4, amplificationRate: 1.7, volumeAnomalyZscore: 0.21,
  crisisSeverity: 0.38, crisisVelocity: 0.19, crisisRelevance: 0.61, crisisConfidence: 0.9,
  totals: { total: 702, positive: 71, neutral: 340, negative: 291 },
  engagementPerMention: 241.8,
};

const ctx: ReportContext = {
  agencyName: 'Departamento de Desarrollo Económico y Comercio (DDEC)',
  agencyShortName: 'DDEC',
  periodStart: '2026-07-29', periodEnd: '2026-08-11',
  prevPeriodStart: '2026-07-15', prevPeriodEnd: '2026-07-28',
  days: 14, periodLabel: '29 jul – 11 ago 2026',
  customRange: false, periodKey: '14D',
  report, detail, metrics, prevMetrics,
};

const series: MetricSeries = {
  nss: [-21, -25, -19, -14, -11, -29, -52, -47, -41, -36, -31, -22, -26, -38],
  bhi: [5.4, 5.2, 5.5, 5.8, 6.0, 4.9, 3.6, 3.9, 4.2, 4.5, 4.8, 5.3, 5.1, 4.7],
  crisis: [0.31, 0.34, 0.29, 0.24, 0.21, 0.39, 0.72, 0.68, 0.61, 0.55, 0.48, 0.37, 0.41, 0.58],
  polarization: [48, 51, 47, 44, 42, 55, 71, 68, 66, 62, 58, 52, 55, 64],
  engagement: [3.5, 3.3, 3.6, 3.8, 3.9, 3.2, 2.4, 2.5, 2.6, 2.9, 3.0, 3.3, 3.1, 2.8],
  volume: dailySeries.map((d) => d.negative + d.neutral + d.positive),
};

// ============================================================
// Mock de las salidas de IA
// ============================================================

const aiExec = {
  headline: 'La reforma de permisos concentra <strong>121 de las 447 menciones negativas</strong> del período y su negatividad es estructural: se reparte en 12 de 14 días, cuatro subtópicos y prensa profesional, no en un episodio aislado.',
  paragraphs: [
    'El período está ordenado por un solo mecanismo institucional: la implantación del reglamento de la ventanilla única. La objeción formal de la Junta de Planificación del 5 de agosto convierte una queja de trámite en una controversia entre dos cuerpos del Estado, y a partir de ahí la conversación deja de ser de comerciantes sueltos y pasa a prensa investigativa. El pico del 4 de agosto (141 menciones, 88 negativas, z=2.41) coincide con la denuncia empresarial que <strong>NotiCel</strong> amplifica a 8,420 interacciones.',
    'Los actores que sostienen la negatividad son medios profesionales, no cuentas anónimas. NotiCel, El Nuevo Día y el Centro de Periodismo Investigativo acumulan 87 menciones con 54 negativas entre los tres, y su lenguaje reproduce el vocabulario técnico del reglamento. Eso da a la controversia vocación de duración: 224 menciones del período salen del canal Noticias, con el alcance agregado más alto (4.1 M) aunque no el mayor engagement.',
    'Contra el período anterior el volumen sube 28 % pero las negativas suben <strong>40.2 %</strong>: la conversación creció y además empeoró su composición. El NSS pasa de −24.1 a −38.4 y la polarización de 51 a 64, mientras el positivo cae 9.9 %. El único contrapeso del período es el anuncio de manufactura en Aguadilla (6,110 interacciones, 340 empleos), y depende de un canal institucional (@desarrollopr) más que de movilización orgánica.',
    'La asimetría más útil está entre Permisos / Reforma y Energía: los dos son negativos, pero Permisos reparte su negatividad entre 121 menciones y cuatro subtópicos con prensa formal detrás, mientras Energía concentra 47 de sus 71 negativas en el subtópico "apagones" y en dos días. Son dos negatividades de naturaleza distinta que no deberían leerse con el mismo criterio.',
  ],
  keyFindings: [
    { label: 'Negatividad estructural', finding: 'La objeción de la Junta de Planificación institucionaliza una queja de trámite y le da continuidad a través de prensa investigativa.', evidence: '121 negativas · 12 de 14 días · Permisos / Reforma' },
    { label: 'Cambio de composición', finding: 'El volumen crece, pero la proporción negativa crece más rápido: el deterioro es de composición, no sólo de tamaño.', evidence: '+28 % volumen vs +40.2 % negativas' },
    { label: 'Prensa, no ruido', finding: 'La conversación negativa la producen medios profesionales, lo que la vuelve más duradera y verificable que una ola de cuentas anónimas.', evidence: '87 menciones · NotiCel, END, CPI' },
    { label: 'Positivo dependiente', finding: 'El único contrapeso del período sale de un canal institucional propio y no de reacción ciudadana.', evidence: '@desarrollopr · 6,110 interacciones · 4 ago' },
  ],
  limitations: [
    '96 de 737 menciones del período (13 %) no tienen tópico asignado, así que la agenda temática describe el 87 % clasificado.',
    'Las etiquetas de municipio suman 293 sobre 737 menciones: la lectura geográfica se apoya en el 40 % que trae marca territorial.',
  ],
};

const aiMetrics = {
  readings: [
    { metric: 'volume' as const, reading: 'El volumen crece 28 % contra el período anterior, pero las negativas crecen 40.2 %: la conversación no sólo se hizo más grande, se hizo proporcionalmente más adversa. Ese diferencial de 12 puntos es el dato del período.', driver: 'El pico del 4 de agosto aporta 141 menciones, 16 % del total del período.' },
    { metric: 'nss' as const, reading: 'Un NSS de −38.4 en la banda Negativo es el peor valor de las últimas cuatro ventanas para esta agencia, y está a 14 puntos del período anterior. La caída es continua desde el 3 de agosto, no un salto puntual.', driver: 'Permisos / Reforma aporta 121 de las 447 negativas del período.' },
    { metric: 'bhi' as const, reading: 'El índice cae de 5.6 a 4.7 sobre 10 y se mantiene en banda Normal por poco margen. Lo que lo sostiene es el alcance agregado de prensa (7.7 M), no el sentimiento, que tira en contra.', driver: 'El canal Noticias aporta 4.1 M de alcance con 108 negativas.' },
    { metric: 'crisis' as const, reading: 'En 0.58 el índice entra a banda Alerta por primera vez en el trimestre. Los componentes explican de dónde sale: la severidad y la relevancia cargan el índice, no la velocidad.', driver: 'Severidad 0.61 y relevancia 0.72 frente a velocidad 0.34.' },
    { metric: 'polarization' as const, reading: 'Sube de 51 a 64 y entra en banda Extrema. El período tiene menos zona intermedia: el neutral cae 3.8 % mientras las negativas suben 40.2 %, así que la conversación se está ordenando en dos polos.', driver: 'El neutral pasa de 340 a 327 menciones mientras el negativo pasa de 291 a 447.' },
    { metric: 'engagement' as const, reading: 'La tasa baja de 3.4 % a 2.8 % con más menciones negativas: la conversación es más adversa pero menos participativa, un patrón de cobertura mediática más que de movilización.', driver: 'Facebook concentra 52,910 interacciones con solo 141 menciones.' },
  ],
};

const aiTrend = {
  shape: 'Conversación baja y estable que se rompe el 3 de agosto y sostiene ocho días de negatividad elevada',
  paragraphs: [
    'La ventana tiene dos regímenes claros. Del 29 de julio al 2 de agosto el volumen cae a mínimos de fin de semana (24 menciones el día 2) con composición estable. Del 3 al 11 de agosto la conversación se triplica y la proporción negativa pasa de 41 % a 62 %. El corte no es gradual: entre el 3 y el 4 de agosto el negativo salta de 31 a 88 menciones.',
    'La negatividad no se mueve con el volumen, se mueve por delante. El 5 de agosto el volumen baja 21 % respecto al 4 pero la proporción negativa sigue subiendo, lo que descarta que el pico sea un artefacto de ruido: hay material negativo nuevo entrando cada día.',
    'La distribución horaria confirma que el actor es institucional. El 68 % del volumen cae entre las 8:00 y las 17:00 AST, con máximos a las 10h (74) y 14h (71), y los días de semana concentran 571 de 675 menciones frente a 104 en fin de semana. Es ritmo de prensa y oficinas, no de ciudadanía en horario libre.',
  ],
  peakNotes: [
    { date: '2026-08-04', note: 'Concentra la denuncia empresarial sobre los tiempos de endoso (NotiCel, 8,420 interacciones) y el tercer apagón general del mes, dos mecanismos distintos que coinciden en fecha.' },
    { date: '2026-08-05', note: 'La objeción formal de la Junta de Planificación, cubierta por el Centro de Periodismo Investigativo, traslada la controversia al plano institucional.' },
    { date: '2026-08-06', note: 'Réplica regional del asunto de permisos con comerciantes de Ponce; el material es de menor alcance pero extiende el tema fuera del área metro.' },
  ],
};

const aiSentiment = {
  paragraphs: [
    'El movimiento del período es de proporción, no de tamaño. Las negativas suben 40.2 % mientras el total apenas crece, así que la conversación no se expandió: se reordenó. El negativo pasa de 41 % a 55 % del período y el neutral, que es la zona donde vive la comunicación informativa de la agencia, cede 13 puntos.',
    'La caída del positivo (−9.9 %, hasta 68 menciones) es el dato que más limita la lectura. Un período con 447 negativas y 68 positivas no ofrece contrapeso interno: cualquier mejora de indicador vendría de que baje el negativo, no de que suba el positivo.',
  ],
  negativeComposition: 'Tres tópicos producen 243 de las 447 negativas: Permisos / Reforma (121), Energía (71) y Críticas / Controversias (51). Por canal se concentra en X / Twitter (171) y Noticias (108), pero el peso institucional está en Noticias: 87 de esas negativas salen de NotiCel, El Nuevo Día y el Centro de Periodismo Investigativo, tres medios con continuidad editorial.',
  positiveComposition: 'Las 68 positivas se reparten entre Inversión y empleo (19), Turismo (10) y Comercio local (6), y dependen de dos eventos: el anuncio de Aguadilla y el cierre de temporada de cruceros. Fuera de esos dos, el período casi no produce positivo espontáneo — 15 de las positivas salen de la cuenta institucional @desarrollopr, es decir de comunicación propia y no de reacción externa.',
  emotionalProfile: 'Frustración (214 etiquetas, 33.9 %) y enojo (168, 26.6 %) dominan sobre preocupación (121). Esa jerarquía es coherente con un problema de trámite y no con una alarma: la frustración aparece cuando el reclamo es por un proceso que no avanza. La confusión (64) es el dato menos esperado y se concentra en menciones sobre el reglamento, lo que sugiere que parte del material negativo es sobre falta de claridad más que sobre desacuerdo.',
};

const aiTopics = {
  overview: 'La agenda está concentrada: los tres primeros tópicos acumulan 406 de las 737 menciones, y los dos primeros tienen volumen casi idéntico (168 y 141) con composición opuesta. Permisos / Reforma es 72 % negativo y Inversión y empleo es 60 % neutral: la agencia tiene simultáneamente un asunto que la desgasta y uno que la sostiene, con el mismo peso de conversación. La asimetría relevante es que el negativo tiene prensa investigativa detrás y el neutral depende de comunicación institucional.',
  topics: [
    { topic: 'Permisos / Reforma', analysis: 'Arquitectura institucional completa: la <strong>Junta de Planificación</strong> objeta formalmente, el Centro de Periodismo Investigativo y NotiCel dan cobertura, y los comerciantes usan el vocabulario técnico del reglamento (ventanilla única 71, endoso 49, JP 28). No es opinión espontánea; son 121 negativas repartidas en 12 días y cuatro subtópicos.', pattern: 'estructural', actor: 'prensa profesional e instituciones' },
    { topic: 'Inversión y empleo', analysis: 'El tópico se sostiene en 84 menciones neutrales de cobertura factual sobre el anuncio de Aguadilla y el calendario de incentivos. Sus 38 negativas se concentran en cuestionamientos individuales al claim de "manufactura avanzada" (47 menciones en el subtópico), no en oposición organizada.', pattern: 'coyuntural', actor: 'cuentas institucionales y prensa económica' },
    { topic: 'Energía', analysis: 'Es la negatividad más intensa del período (73 % negativo) y la más concentrada: 47 de sus 71 negativas están en el subtópico apagones y en los días 4 y 5 de agosto. Con 52 menciones secundarias es también el tópico que más se cuela en conversaciones de otros temas, lo que lo vuelve un multiplicador del malestar general.', pattern: 'coyuntural', actor: 'ciudadanía en X / Twitter' },
    { topic: 'Turismo', analysis: 'Único tópico con saldo neto favorable: 39 neutrales y 10 positivas contra 14 negativas, empujado por el récord de 1.2 millones de visitantes que El Nuevo Día publica el 8 de agosto con 640,000 de alcance. Es cobertura de resultado, no de política.', pattern: 'coyuntural', actor: 'prensa económica' },
    { topic: 'Críticas / Controversias', analysis: 'Con 51 negativas sobre 58 menciones es el tópico proporcionalmente más adverso, pero su volumen absoluto es bajo y 34 de sus menciones están en el subtópico señalamientos. Funciona como caja de resonancia de los otros tópicos más que como asunto propio.', pattern: 'mixto', actor: 'prensa investigativa' },
    { topic: 'Comercio local', analysis: 'Perfil mayoritariamente informativo (24 neutrales de 41) alrededor del calendario de talleres de financiamiento para pymes. Sus 11 negativas están vinculadas al asunto de endosos municipales de Ponce, así que es negatividad importada de Permisos y no propia.', pattern: 'coyuntural', actor: 'cuentas institucionales' },
    { topic: 'Infraestructura', analysis: 'Con 29 menciones el volumen no alcanza para leer un patrón: 12 negativas repartidas entre puertos y carreteras sin concentración de día, autor ni subtópico. Se reporta por completitud de la agenda.', pattern: 'indeterminado', actor: 'prensa local dispersa' },
  ],
};

const aiActors = {
  paragraphs: [
    'La conversación la producen medios profesionales. Los tres primeros autores del período (NotiCel 34, El Nuevo Día 31, Centro de Periodismo Investigativo 22) suman 87 menciones —12 % del total— con 54 negativas, y su peso no está en el volumen sino en que fijan el marco que después reproducen las cuentas individuales. El primer autor no institucional aparece en cuarto lugar con 19 menciones.',
    'La cuenta propia de la agencia (@desarrollopr, 15 menciones, 9 positivas, 0 negativas) tiene presencia pero no capacidad de fijar agenda: su alcance agregado es de 42,000 frente a los 412,000 de una sola nota de NotiCel. La agencia comunica y otros reaccionan; en el asunto de permisos, otros hablan y la agencia casi no aparece.',
    'Las cuentas de activismo temático son un fenómeno distinto y medible: @ciudadano_pr (19 menciones, 18 negativas) y @energia_boricua (12, todas negativas) producen 30 menciones con 13,730 interacciones combinadas — más engagement por mención que cualquier medio del período.',
  ],
  narrativeControl: 'La ordena la prensa. Las 224 menciones del canal Noticias concentran el mayor alcance del período (4.1 M de 7.7 M) y contienen la objeción institucional que estructura el tema dominante. La agencia aparece en 15 menciones propias, todas positivas o neutrales, sin presencia en las conversaciones donde se define el asunto de permisos.',
  channelReading: 'Las tres distribuciones divergen y ahí está el análisis. El volumen está en X / Twitter (268), el engagement en Facebook (52,910 con solo 141 menciones — 375 interacciones por mención frente a 154 de Twitter) y el alcance en Noticias (4.1 M). La negatividad sigue al volumen (171 en Twitter) pero no al engagement: Facebook, el canal con más participación real, es el menos adverso de los tres grandes con 44 % negativo.',
};

const aiGeo = {
  paragraphs: [
    'La conversación tiene domicilio metropolitano y sesgo negativo territorial. La región Metro concentra 168 de las 293 etiquetas de municipio (57 %) con 100 negativas, y San Juan sola aporta 96 menciones con 61 negativas — el 64 % de su volumen. Fuera del área metro la negatividad baja: Sur 54 %, Este 46 %, Norte 44 %.',
    'La concentración es coherente con un asunto de política pública tramitado en oficinas centrales, no con un problema de servicio distribuido. La excepción es Ponce (34 menciones, 19 negativas), donde el tema de endosos municipales aparece con vocabulario propio: es la única señal de que el asunto de permisos se está replicando fuera de San Juan.',
  ],
  concentration: 'Concentración metropolitana con réplica en Ponce. Metro reúne 57 % de las etiquetas geográficas en cuatro municipios. Advertencia de cobertura: solo 293 de 737 menciones (40 %) traen municipio detectado, así que la lectura territorial describe esa minoría y no el período completo.',
};

const aiRisk = {
  assessment: 'Riesgo en banda Alerta (0.58) cargado por severidad y relevancia más que por velocidad: el período se profundiza más de lo que se acelera.',
  paragraphs: [
    'De los cuatro componentes, relevancia (0.72) y severidad (0.61) son los que empujan el índice; la velocidad se queda en 0.34, consistente con un volumen que crece menos que la adversidad. Eso describe un riesgo de INTENSIDAD y no de extensión: el material negativo es altamente pertinente y amplificado, pero se multiplica menos en cantidad que en intensidad. La confianza de 0.88 indica que la lectura se apoya en material efectivamente clasificado por el NLP.',
    'El material que sostiene el riesgo son cuatro menciones que acumulan 19,610 interacciones, todas de pertinencia alta y tres de ellas sobre Permisos / Reforma. La nota de NotiCel del 4 de agosto sola aporta 8,420 interacciones y 412,000 de alcance. Una concentración así significa que el índice está gobernado por unas pocas piezas de mucho peso, no por un descontento repartido.',
    'El elemento que diferencia este período de anteriores con índice similar es la presencia de un objetor institucional. La objeción de la Junta de Planificación es un hecho verificable y con expediente, así que su vigencia no depende del ciclo noticioso: es material que puede reactivarse en cualquier momento posterior sin que medie un evento nuevo.',
  ],
  signals: [
    { signal: 'Cuatro menciones concentran el 13 % del engagement del período', evidence: '19,610 de 151,420 interacciones · pertinencia alta', weight: 'alta' },
    { signal: 'Objeción formal de un cuerpo del Estado sobre el tópico dominante', evidence: 'Junta de Planificación · 5 ago · CPI, 121,000 de alcance', weight: 'alta' },
    { signal: 'La polarización entra en banda Extrema por primera vez en el trimestre', evidence: '64 vs 51 el período anterior', weight: 'media' },
    { signal: 'Negatividad de Energía se cuela en conversaciones de otros tópicos', evidence: '52 menciones secundarias sobre 97 principales', weight: 'media' },
    { signal: 'El z-score de volumen del 4 de agosto excede 2 desviaciones', evidence: 'z=2.41 · 141 menciones · 88 negativas', weight: 'baja' },
  ],
};

const aiSynth = {
  paragraphs: [
    'Cruzando los planos, el período describe una agencia con dos conversaciones de tamaño equivalente y naturaleza opuesta, y con capacidad de intervención desigual en cada una. Permisos / Reforma (168 menciones, 72 % negativo) vive en prensa profesional, área metropolitana y horario laboral, con un objetor institucional. Inversión y empleo (141, 60 % neutral) vive en cobertura factual de anuncios propios. La primera la definen terceros; la segunda depende de que la agencia siga produciendo hechos anunciables.',
    'La articulación menos visible es entre canal y adversidad. El canal con más participación real —Facebook, 375 interacciones por mención— es el menos negativo de los tres grandes (44 %), mientras el canal que fija el marco —Noticias— tiene el mayor alcance y una negatividad de 48 %. Es decir: donde la gente efectivamente conversa el tono es menos adverso que donde se establece la narrativa. El riesgo del período no está en la reacción del público sino en el registro documental que la prensa está construyendo.',
    'Geografía y tópico tampoco coinciden del todo. San Juan concentra el volumen, pero la única señal de propagación del asunto de permisos aparece en Ponce con vocabulario municipal propio. Un tema que hasta ahora es metropolitano y de política central tiene su primer indicio de traducción a escala local.',
  ],
  watchItems: [
    { item: 'La proporción de menciones de Permisos / Reforma que provienen de prensa profesional frente a cuentas individuales', rationale: 'Hoy 87 de 121 negativas salen de tres medios; si esa proporción baja mientras el volumen se mantiene, el asunto habría pasado de controversia formal a malestar difundido.' },
    { item: 'La evolución del subtópico de endosos municipales fuera del área metropolitana', rationale: 'Ponce aporta 34 menciones con vocabulario propio: es el único indicio de que el tema se replica territorialmente.' },
    { item: 'La distancia entre severidad y velocidad en el índice de crisis', rationale: 'Severidad 0.61 con velocidad 0.34 describe intensidad sin expansión; que la velocidad se acerque a la severidad indicaría un cambio de régimen.' },
    { item: 'El origen de las menciones positivas: comunicación propia frente a reacción externa', rationale: '15 de las 68 positivas salen de la cuenta institucional, así que el saldo favorable del período no es orgánico.' },
  ],
};

// ============================================================
// Ensamblado
// ============================================================

const META = { generatedLabel: '12 ago, 9:14 a.m. AST' };
const ANNEX_META = {
  generatedLabel: META.generatedLabel,
  model: 'us.anthropic.claude-opus-4-6-v1',
  aiSectionsOk: 9,
  aiSectionsTotal: 9,
};

type AiSet = {
  exec: typeof aiExec | null;
  metrics: typeof aiMetrics | null;
  trend: typeof aiTrend | null;
  sentiment: typeof aiSentiment | null;
  topics: typeof aiTopics | null;
  actors: typeof aiActors | null;
  geo: typeof aiGeo | null;
  risk: typeof aiRisk | null;
  synth: typeof aiSynth | null;
};

function build(context: ReportContext, ai: AiSet, annexMeta: typeof ANNEX_META, statusLabel: string, metricSeries: MetricSeries = series): string {
  return [
    renderDocumentHead({
      agencyName: context.agencyName,
      agencyShortName: context.agencyShortName,
      periodLabel: context.periodLabel,
      generatedLabel: META.generatedLabel,
    }),
    renderCover(context, META),
    renderToc(),
    renderExecutiveSummary(context, ai.exec),
    renderIndicators(context, ai.metrics, metricSeries),
    renderTrend(context, ai.trend),
    renderSentiment(context, ai.sentiment),
    renderTopics(context, ai.topics),
    renderActors(context, ai.actors),
    renderGeography(context, ai.geo),
    renderRisk(context, ai.risk),
    renderMentions(context),
    renderSynthesis(context, ai.synth),
    renderAnnex(context, annexMeta),
    // autoPrint: false en el preview — no queremos que el diálogo de impresión
    // salte cada vez que se recarga la página durante la iteración de diseño.
    renderDocumentFoot({ autoPrint: false, statusLabel }),
  ].join('\n');
}

const FULL: AiSet = {
  exec: aiExec, metrics: aiMetrics, trend: aiTrend, sentiment: aiSentiment,
  topics: aiTopics, actors: aiActors, geo: aiGeo, risk: aiRisk, synth: aiSynth,
};
const NONE: AiSet = {
  exec: null, metrics: null, trend: null, sentiment: null,
  topics: null, actors: null, geo: null, risk: null, synth: null,
};

// Caso vacío: mismo contexto, todo a cero.
const emptyCtx: ReportContext = {
  ...ctx,
  report: {
    ...report,
    totals: { negative: 0, neutral: 0, positive: 0, total: 0 },
    prevTotals: { negative: 0, neutral: 0, positive: 0, total: 0 },
    deltaVsPrev: { negative: 0, neutral: 0, positive: 0 },
    dailySeries: dailySeries.map((d) => ({ ...d, negative: 0, neutral: 0, positive: 0 })),
    topicsTable: [],
  },
  detail: {
    ...detail,
    channels: [], authors: [], domains: [], emotions: [], emotionsTagged: 0,
    municipalities: [], regions: [], subtopics: [],
    topByEngagement: [], topNegative: [],
    byHour: Array(24).fill(0), byDow: Array(7).fill(0), peaks: [],
    unclassified: 0, withoutSentiment: 0,
    totals: { reach: 0, engagement: 0, mentions: 0 },
  },
  metrics: {
    ...metrics,
    nss: null, brandHealthIndex: null, crisisRiskScore: null, polarizationIndex: null,
    engagementRate: null, amplificationRate: null, volumeAnomalyZscore: null,
    crisisSeverity: null, crisisVelocity: null, crisisRelevance: null, crisisConfidence: null,
    totals: { total: 0, positive: 0, neutral: 0, negative: 0 },
    totalReach: 0, totalEngagementScore: 0, engagementPerMention: null,
  },
};

// Ruta derivada de import.meta.url, NO de import.meta.dirname (que tsx deja
// undefined y hacía que el preview se escribiera fuera del worktree) ni del cwd
// (que el harness resetea al monorepo principal).
const HERE = dirname(fileURLToPath(import.meta.url));
// Serie vacía para el caso "período sin menciones": si se reusara `series`, el
// preview mostraría sparklines con datos junto a KPIs en "—", que es justo la
// incoherencia que el caso vacío existe para detectar.
const emptySeries: MetricSeries = {
  nss: [], bhi: [], crisis: [], polarization: [], engagement: [], volume: [],
};

const OUT_DIR = join(HERE, '..', 'apps', 'web', 'public', 'report-preview');
mkdirSync(OUT_DIR, { recursive: true });

// Período largo (365 días): verifica que la gráfica y la tabla de la sección de
// evolución se agrupen — sin agrupar serían 365 columnas y 365 filas de tabla.
const longDays = 365;
const longSeries = Array.from({ length: longDays }, (_, i) => {
  const d = new Date(Date.UTC(2025, 7, 12) + i * 86400000).toISOString().slice(0, 10);
  // Onda anual + ruido determinista (nada de Math.random: el preview tiene que
  // salir idéntico en cada corrida para poder comparar cambios de diseño).
  const wave = Math.sin((i / longDays) * Math.PI * 4);
  const base = 30 + Math.round(wave * 18) + ((i * 7919) % 11);
  return {
    date: d,
    dayLabel: formatDayLabel(d),
    negative: Math.max(0, Math.round(base * 0.55)),
    neutral: Math.max(0, Math.round(base * 0.38)),
    positive: Math.max(0, Math.round(base * 0.07)),
  };
});
const longTotals = (k: 'negative' | 'neutral' | 'positive'): number =>
  longSeries.reduce((a, b) => a + b[k], 0);
const longCtx: ReportContext = {
  ...ctx,
  periodStart: longSeries[0].date,
  periodEnd: longSeries[longSeries.length - 1].date,
  days: longDays,
  periodKey: '1A',
  periodLabel: '12 ago 2025 – 11 ago 2026',
  report: {
    ...report,
    dailySeries: longSeries,
    totals: {
      negative: longTotals('negative'), neutral: longTotals('neutral'),
      positive: longTotals('positive'),
      total: longTotals('negative') + longTotals('neutral') + longTotals('positive'),
    },
  },
};

const cases: Array<[string, string]> = [
  ['index.html', build(ctx, FULL, ANNEX_META, 'Reporte completo · preview con datos mock')],
  ['periodo-largo.html', build(longCtx, FULL, ANNEX_META, 'Preview · período de 365 días (agrupado por semana)')],
  ['sin-ia.html', build(ctx, NONE, { ...ANNEX_META, aiSectionsOk: 0 }, 'Preview · las 9 llamadas de IA fallaron')],
  ['vacio.html', build(emptyCtx, NONE, { ...ANNEX_META, aiSectionsOk: 0, aiSectionsTotal: 0 }, 'Preview · período sin menciones', emptySeries)],
];

for (const [file, html] of cases) {
  const path = join(OUT_DIR, file);
  writeFileSync(path, html, 'utf8');
  console.log(`[eco] ${file.padEnd(14)} → ${path} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
}
