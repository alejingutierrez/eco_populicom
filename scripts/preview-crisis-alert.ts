/**
 * Preview local del template de alerta de crisis.
 *
 * Genera un HTML con datos mock que cubren los casos típicos:
 * - Banda ALERTA (score=0.55, severidad=0.65, velocidad=0.51)
 * - 3 tópicos negativos con shares variados (100%, 80%, 75%) para verificar
 *   que la barra horizontal escala bien tanto en saturación total como en
 *   shares parciales
 * - 1 municipio (San Juan) para ver el caso "lista corta" después del
 *   rediseño que stackea verticalmente — no debe quedar visualmente raro
 * - Hero image opcional (foto de prensa típica del periodo) + thumbnails
 *   en la sección de Enlaces
 * - 3 voces representativas con tonos distintos (neg/neu/pos) para
 *   validar el color de la línea izquierda del pull-quote
 *
 * Uso: tsx scripts/preview-crisis-alert.ts
 *      → escribe a apps/web/public/emails/crisis-alert-preview.html
 *      → abrir en http://localhost:3000/emails/crisis-alert-preview.html
 */

import { renderCrisisAlertHtml, type CrisisAlertRenderData } from '../packages/shared/src/email/render-crisis-alert.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const data: CrisisAlertRenderData = {
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyShortName: 'DDEC',
  detectedAtLabel: '18 may · 1:42 p.m. AST',
  triggerDayLabel: '18 may',
  band: 'ALERTA',

  metrics: {
    crisisRiskScore: 0.557,
    crisisRiskScore24hAgo: 0.24,
    crisisSeverity: 0.654,
    crisisVelocity: 0.511,
    crisisRelevance: 0.382,
    volumeAnomalyZscore: 1.53,
  },

  volume: {
    totalMentions: 131,
    negativeCount: 60,
    negativeShare: 0.458,
    prevDayTotal: 43,
    prevDayNegative: 16,
  },

  topNegativeTopics: [
    { topic: 'Críticas / Controversias', total: 16, negative: 16, negativeShare: 1.0 },
    { topic: 'Gestión del Secretario', total: 5, negative: 4, negativeShare: 0.80 },
    { topic: 'Permisos / Reforma', total: 4, negative: 3, negativeShare: 0.75 },
  ],

  topNegativeMunicipalities: [
    { municipality: 'San Juan', total: 7, negative: 7 },
  ],

  highlightedMentions: [
    {
      sourceLabel: 'Twitter',
      snippet: 'Los permisos del DDEC siguen tardando meses. ¿Cuántas empresas más tienen que cerrar antes de que actúen?',
      url: 'https://twitter.com/x/status/1',
      publishedAtLabel: '18 may, 11:42 a.m.',
      imageUrl: 'https://picsum.photos/seed/twitter-permisos/200/200',
    },
    {
      sourceLabel: 'ElNuevoDia.com',
      snippet: 'Empresarios denuncian demoras en la oficina de permisos y exigen respuestas al Secretario sobre las solicitudes pendientes.',
      url: 'https://elnuevodia.com/x',
      publishedAtLabel: '18 may, 9:15 a.m.',
      imageUrl: 'https://picsum.photos/seed/end-permisos/600/400',
    },
    {
      sourceLabel: 'Facebook',
      snippet: 'Llevo 8 meses esperando la aprobación de mi negocio. El DDEC no contesta los correos ni el teléfono.',
      url: 'https://facebook.com/x/posts/1',
      publishedAtLabel: '17 may, 8:30 p.m.',
      imageUrl: null,
    },
    {
      sourceLabel: 'PrimeraHora.com',
      snippet: 'El DDEC reporta avances en la reforma de permisos, pero el sector privado mantiene su escepticismo.',
      url: 'https://primerahora.com/x',
      publishedAtLabel: '17 may, 2:00 p.m.',
      imageUrl: 'https://picsum.photos/seed/primera-permisos/600/400',
    },
  ],

  scoreTrendImageUrl: buildMockTrendUrl(),

  heroImageUrl: 'https://picsum.photos/seed/ddec-crisis-hero/1200/630',
  heroImageCaption: 'Foto: portada · ElNuevoDia.com · 18 may',

  editorial: {
    headline: 'DDEC en banda ALERTA tras pico de quejas sobre permisos y crítica al Secretario',
    lede: 'Se observan señales elevadas en Críticas / Controversias: el volumen subió de 43 a 131 menciones (Δ +205%) con 46% negativas, concentradas en San Juan.',
    bodyParagraphsHtml: [
      'El 18 de mayo el flujo de menciones triplicó al día previo (<strong>131 vs 43</strong>), con un Crisis Score que pasó de <strong>0.24 a 0.557</strong>. La banda actual es <strong>ALERTA</strong>, impulsada por una severidad de 0.65 y un z-score de volumen de +1.5σ contra el baseline de 30 días.',
      'La conversación se concentra en <strong>Críticas / Controversias</strong>, donde el 100% de las 16 menciones del tópico son negativas. La queja predominante es la <strong>demora en los permisos</strong>: empresarios y ciudadanos describen esperas de meses, llamadas sin respuesta y reclamos sobre la reforma anunciada por el Secretario.',
      'La concentración geográfica es total en <strong>San Juan</strong> (7/7 menciones negativas, 100%). Medios tradicionales como ElNuevoDia.com y PrimeraHora.com replicaron las críticas, lo que amplificó el volumen en redes en las horas posteriores. El día previo el indicador estaba en banda NORMAL.',
    ],
    representativeVoices: [
      {
        quote: 'Los permisos del DDEC siguen tardando meses; cada semana cierra otra empresa antes de obtener respuesta.',
        attribution: 'Twitter · 18 may',
        tone: 'negative',
      },
      {
        quote: 'Llevo ocho meses esperando aprobación y la oficina no contesta correos ni el teléfono.',
        attribution: 'Comentario en Facebook · 17 may',
        tone: 'negative',
      },
      {
        quote: 'El DDEC reporta avances en la reforma, pero el sector privado mantiene escepticismo.',
        attribution: 'PrimeraHora.com · 17 may',
        tone: 'neutral',
      },
    ],
    drivers: [
      {
        label: 'Concentración negativa total',
        description: 'El tópico Críticas / Controversias registra 16 de 16 menciones negativas (100% del tópico).',
      },
      {
        label: 'Salto de volumen',
        description: 'El volumen pasó de 43 a 131 menciones en 24 horas (+205%), con z-score de +1.5σ.',
      },
      {
        label: 'Cobertura en medios',
        description: 'ElNuevoDia.com y PrimeraHora.com replicaron la queja, amplificando el alcance en redes.',
      },
    ],
    closing: 'El indicador cruza umbral por primera vez en mayo. La concentración geográfica y el volumen anómalo se ubican en el cuartil superior del histórico de 30 días.',
  },

  dashboardUrl: 'https://app.populicom.com/dashboard?agency=ddecpr',
};

const html = renderCrisisAlertHtml(data);
const outPath = join(process.cwd(), 'apps/web/public/emails/crisis-alert-preview.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`Written: ${outPath}`);
console.log(`Preview: http://localhost:3000/emails/crisis-alert-preview.html`);

// ------------------------------------------------------------
// Mock para el chart de evolución del Crisis Score (14 días)
// Pico el 28-abr (0.77), valle, segundo pico el 18-may (0.557)
// ------------------------------------------------------------

function buildMockTrendUrl(): string {
  const labels = ['5 may', '6 may', '7 may', '8 may', '9 may', '10 may', '11 may',
                  '12 may', '13 may', '14 may', '15 may', '16 may', '17 may', '18 may'];
  const data = [0.29, 0.28, 0.28, 0.18, 0.12, 0.17, 0.18, 0.24, 0.24, 0.19, 0.20, 0.33, 0.24, 0.557];
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Crisis Score',
          data,
          borderColor: '#C8462F',
          backgroundColor: 'rgba(200,70,47,0.10)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#FFFFFF',
          pointBorderColor: '#C8462F',
          pointBorderWidth: 1.5,
          tension: 0.3,
          fill: true,
        },
        {
          label: 'Umbral 0.40',
          data: data.map(() => 0.40),
          borderColor: '#8A93A0',
          borderWidth: 1,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: { legend: { display: false }, title: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 1, grid: { color: '#EEF0F4', drawBorder: false },
          ticks: { font: { size: 10 }, color: '#8A93A0', padding: 6, maxTicksLimit: 5 } },
        x: { grid: { display: false, drawBorder: false },
          ticks: { font: { size: 11 }, color: '#4A5563', padding: 6 } },
      },
    },
  };
  return `https://quickchart.io/chart?v=4&w=540&h=200&bkg=white&devicePixelRatio=2&c=${encodeURIComponent(JSON.stringify(config))}`;
}
