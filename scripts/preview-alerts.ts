/**
 * Preview local del template de ALERTA simple en sus dos variantes:
 *  - alerta de regla por mención (eco-alerts): sentimiento negativo + mención
 *  - alerta de umbral de métrica (eco-metrics-calculator): Crisis Score
 *
 * Uso: tsx scripts/preview-alerts.ts
 *      → escribe apps/web/public/emails/alert-rule-preview.html
 *      →         apps/web/public/emails/metric-alert-preview.html
 */

import { renderSimpleAlertHtml } from '../packages/shared/src/email/render-simple-alert.ts';
import { formatMetric } from '../packages/shared/src/format/metrics-display.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'apps', 'web', 'public', 'emails');
const MOCK_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1004" height="440"><rect width="100%" height="100%" fill="#D5D8DC"/><text x="50%" y="50%" font-family="Helvetica" font-size="32" fill="#5A616B" text-anchor="middle">Imagen adjunta de la mención</text></svg>',
)}`;

// ------------------------------------------------------------
// Variante 1 — alerta de regla por mención (negative_sentiment)
// ------------------------------------------------------------

const ruleAlertHtml = renderSimpleAlertHtml({
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyShortName: 'DDEC',
  ruleName: 'Mención negativa de pertinencia alta',
  detectedAtLabel: '7 jul, 9:42 a.m. AST',
  leadHtml:
    'Usuario reporta que el portal de trámites en línea rechaza la documentación de renovación de incentivos por tercera vez consecutiva, sin canal de soporte que responda.',
  facts: [
    { label: 'Sentimiento', value: 'Negativo', tone: 'neg', swatch: true },
    { label: 'Tópicos', value: 'Permisos / Reforma, Incentivos Económicos' },
    { label: 'Emociones', value: 'frustración · enojo' },
  ],
  mention: {
    sourceLabel: 'X / Twitter',
    title: null,
    snippet:
      'Tercera vez que el portal del DDEC me bota los documentos de renovación. Llamé al número de ayuda y nadie contesta. ¿Alguien más con este problema? #incentivos',
    url: 'https://x.com/example/status/123',
    publishedAtLabel: '7 jul, 9:38 a.m. AST',
    // En producción: la imagen adjunta del post (resolved_image_url).
    imageUrl: MOCK_IMAGE,
  },
  dashboardUrl: 'https://citizenecho.com/dashboard?agency=ddecpr',
});

const rulePath = join(outDir, 'alert-rule-preview.html');
writeFileSync(rulePath, ruleAlertHtml, 'utf8');
console.log(`Preview escrito: ${rulePath}`);

// ------------------------------------------------------------
// Variante 2 — alerta de umbral de métrica (Crisis Score ≥ 40%)
// ------------------------------------------------------------

const crisisVal = formatMetric('crisis', 0.47).value ?? '—';
const crisisThr = formatMetric('crisis', 0.40).value ?? '—';

const metricAlertHtml = renderSimpleAlertHtml({
  agencyName: 'Departamento de Desarrollo Económico y Comercio',
  agencyShortName: 'DDEC',
  ruleName: 'Crisis Score sobre umbral',
  variant: 'metric',
  detectedAtLabel: '7 jul, 6:10 a.m. AST',
  leadHtml:
    `La métrica <strong>Crisis Score</strong> alcanzó <strong>${crisisVal}</strong> en la evaluación diaria del 7 jul, cruzando el umbral configurado (≥ ${crisisThr}).`,
  gauge: {
    valueLabel: crisisVal,
    caption: `Crisis Score · umbral ≥ ${crisisThr}`,
    fraction: 0.47,
    thresholdFraction: 0.40,
    scaleStart: '0%',
    scaleEnd: '100%',
    thresholdLabel: `umbral ${crisisThr}`,
  },
  facts: [
    { label: 'Métrica', value: 'Crisis Score' },
    { label: 'Valor actual', value: crisisVal, tone: 'warn', mono: true },
    { label: 'Umbral configurado', value: `≥ ${crisisThr}`, mono: true },
    { label: 'Día evaluado', value: '7 jul', mono: true },
  ],
  dashboardUrl: 'https://citizenecho.com/dashboard?agency=ddecpr',
});

const metricPath = join(outDir, 'metric-alert-preview.html');
writeFileSync(metricPath, metricAlertHtml, 'utf8');
console.log(`Preview escrito: ${metricPath}`);
