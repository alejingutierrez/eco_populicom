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
 * Desde COR-02 (nov 2026) escribe los TRES correos del episodio:
 *   crisis-alert-preview.html    primer aviso
 *   crisis-reaviso-preview.html  reaviso, con el bloque «Episodio abierto»
 *   crisis-cierre-preview.html   cierre del episodio
 *
 * Uso: tsx scripts/preview-crisis-alert.ts
 *      → escribe en apps/web/public/emails/
 *      → abrir en http://localhost:3000/emails/crisis-alert-preview.html
 */

import {
  renderCrisisAlertHtml,
  renderCrisisCloseHtml,
  type CrisisAlertRenderData,
  type CrisisCloseRenderData,
} from '../packages/shared/src/email/render-crisis-alert.ts';
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
    volumeVsAvg7Pct: 132,
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

  // Mock de 14 días: pico el 28-abr, valle, segundo pico el 18-may (56%).
  scoreTrend: ['5 may', '6 may', '7 may', '8 may', '9 may', '10 may', '11 may',
    '12 may', '13 may', '14 may', '15 may', '16 may', '17 may', '18 may']
    .map((label, i) => ({ label, score: [29, 28, 28, 18, 12, 17, 18, 24, 24, 19, 20, 33, 24, 56][i] })),
  scoreThreshold: 40,

  heroImageUrl: 'https://picsum.photos/seed/ddec-crisis-hero/1200/630',
  heroImageCaption: 'Foto: portada · ElNuevoDia.com · 18 may',

  editorial: {
    headline: 'DDEC en banda ALERTA tras pico de quejas sobre permisos y crítica al Secretario',
    lede: 'Se observan señales elevadas en Críticas / Controversias: el volumen subió de 43 a 131 menciones (Δ +205%) con 46% negativas, concentradas en San Juan.',
    bodyParagraphsHtml: [
      'El 18 de mayo el flujo de menciones triplicó al día previo (<strong>131 vs 43</strong>), con un Crisis Score que pasó de <strong>24% a 56%</strong>. La banda actual es <strong>ALERTA</strong>, impulsada por una concentración negativa de 65% y un volumen muy por encima de lo usual de los últimos 30 días.',
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
        description: 'El volumen pasó de 43 a 131 menciones en 24 horas (+205%), muy por encima de lo usual del mes.',
      },
      {
        label: 'Cobertura en medios',
        description: 'ElNuevoDia.com y PrimeraHora.com replicaron la queja, amplificando el alcance en redes.',
      },
    ],
    closing: 'El indicador cruza umbral por primera vez en mayo. La concentración geográfica y el volumen anómalo se ubican en el cuartil superior del histórico de 30 días.',
  },

  dashboardUrl: 'https://citizenecho.com/overview?agency=ddecpr&ver=crisis',
};

// __dirname (no cwd): el preview debe aterrizar en el repo del script aunque
// se invoque con tsx desde el monorepo principal.
const outDir = join(__dirname, '..', 'apps/web/public/emails');

// Reaviso: mismo episodio, al día siguiente. El índice subió y el titular
// cuenta qué cambió, no que «empieza» una crisis.
const followup: CrisisAlertRenderData = {
  ...data,
  detectedAtLabel: '19 may · 2:05 p.m. AST',
  triggerDayLabel: '19 may',
  band: 'CRISIS',
  metrics: { crisisRiskScore: 0.612, crisisRiskScore24hAgo: 0.557, crisisSeverity: 0.702, volumeVsAvg7Pct: 164 },
  volume: { totalMentions: 158, negativeCount: 71, negativeShare: 71 / 158, prevDayTotal: 187, prevDayNegative: 66 },
  editorial: {
    ...data.editorial,
    headline: 'La queja por los permisos sigue creciendo y ya la recoge la Legislatura',
    lede: 'El episodio abierto ayer no cede: hoy suma 158 menciones antes de las 2 de la tarde y la proporción negativa subió de 35% a 45%.',
  },
  scoreTrend: [...(data.scoreTrend ?? []).slice(1), { label: '19 may', score: 61 }],
  episode: {
    alertNumber: 2,
    openedAtLabel: '18 may, 1:42 p.m.',
    daysOpen: 2,
    previousAtLabel: '18 may, 1:42 p.m.',
    previous: { dayLabel: '18 may', score: data.metrics.crisisRiskScore, totalMentions: data.volume.totalMentions, negativeCount: data.volume.negativeCount },
    current: { dayLabel: '19 may', score: 0.612, totalMentions: 158, negativeCount: 71 },
    peak: { score: 0.612, dayLabel: '19 may' },
  },
};

// Cierre: el 21 terminó bajo el umbral; sale el 22 a las 8 de la mañana.
const close: CrisisCloseRenderData = {
  agencyName: data.agencyName,
  agencyShortName: data.agencyShortName,
  closedAtLabel: '22 may · 8:05 a.m. AST',
  openedAtLabel: '18 may, 1:42 p.m.',
  daysOpen: 4,
  alertsSent: 4,
  closedDay: { dayLabel: '21 may', score: 0.28, severity: 0.41, totalMentions: 74, negativeCount: 17 },
  peak: { score: 0.64, dayLabel: '19 may' },
  threshold: 0.4,
  severityMin: 0.5,
  firstHeadline: data.editorial.headline,
  scoreTrend: [...(data.scoreTrend ?? []).slice(3), { label: '19 may', score: 64 }, { label: '20 may', score: 47 }, { label: '21 may', score: 28 }],
  dashboardUrl: data.dashboardUrl,
};

const outputs: Array<[string, string]> = [
  ['crisis-alert-preview.html', renderCrisisAlertHtml(data)],
  ['crisis-reaviso-preview.html', renderCrisisAlertHtml(followup)],
  ['crisis-cierre-preview.html', renderCrisisCloseHtml(close)],
];
for (const [name, html] of outputs) {
  const outPath = join(outDir, name);
  writeFileSync(outPath, html, 'utf-8');
  console.log(`Written: ${outPath}`);
  console.log(`Preview: http://localhost:3000/emails/${name}`);
}
