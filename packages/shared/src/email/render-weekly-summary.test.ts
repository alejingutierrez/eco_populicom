/**
 * Render del correo semanal: el camino legacy no cambia (WP-7) y los rótulos
 * de la interpretación v1 solo aparecen con `interpretation`. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/email/render-weekly-summary.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildWeeklyMethodologyNote, renderWeeklySummaryHtml, weeklyPreheader, type WeeklySummaryRenderData } from './render-weekly-summary';
import { formatDelta, formatMetric } from '../format/metrics-display';
import { findVetoed } from '../composer/vetoed';

const totals = { negative: 58, neutral: 502, positive: 139, total: 699 };
const prevTotals = { negative: 48, neutral: 478, positive: 9, total: 535 };

const BASE: WeeklySummaryRenderData = {
  agencyName: 'Agencia de Prueba',
  agencyShortName: 'AP',
  agencyKicker: 'AP · Agencia de Prueba',
  weekLabel: '23 – 29 oct 2026',
  prevWeekLabel: '16 – 22 oct 2026',
  updatedAtLabel: '30 oct, 3:00 p.m. AST',
  totals,
  prevTotals,
  totalDelta: formatDelta(totals.total, prevTotals.total, { kind: 'percent', decimals: 0 }),
  sentimentDelta: {
    negative: formatDelta(totals.negative, prevTotals.negative, { kind: 'percent', decimals: 0, invert: true }),
    neutral: formatDelta(totals.neutral, prevTotals.neutral, { kind: 'percent', decimals: 0 }),
    positive: formatDelta(totals.positive, prevTotals.positive, { kind: 'percent', decimals: 0 }),
  },
  metrics: {
    crisis: { display: formatMetric('crisis', 0.12), delta: formatDelta(12, 15, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }) },
    bhi: { display: formatMetric('bhi', 0.6), delta: formatDelta(6.4, 6.1, { kind: 'absolute', decimals: 1, suffix: '' }) },
    nss: { display: formatMetric('nss', 11.5), delta: formatDelta(11.5, 9, { kind: 'absolute', decimals: 1 }) },
    polarization: { display: formatMetric('polarization', 21), delta: formatDelta(21, 25, { kind: 'absolute', decimals: 0, suffix: ' pts' }) },
  },
  dailyCompare: [
    { label: 'vie 23', cur: 100, prev: 80 },
    { label: 'sáb 24', cur: 60, prev: 70 },
    { label: 'dom 25', cur: 50, prev: 40 },
    { label: 'lun 26', cur: 150, prev: 90 },
    { label: 'mar 27', cur: 120, prev: 85 },
    { label: 'mié 28', cur: 119, prev: 90 },
    { label: 'jue 29', cur: 100, prev: 80 },
  ],
  weeklyHeadline: 'La agencia presentó su programa de pymes y usuarios preguntaron por los requisitos',
  weeklySummary: 'La semana tuvo <strong>699 menciones</strong>.',
  highlights: ['Un usuario preguntó por la fecha límite.'],
  topicsCompare: [
    { topic: 'Desarrollo Empresarial', cur: 400, prev: 300, delta: formatDelta(400, 300, { kind: 'percent', decimals: 0 }), negShare: 5 },
    { topic: 'Manufactura', cur: 12, prev: 0, delta: formatDelta(12, 0, { kind: 'percent', decimals: 0 }), negShare: 25 },
  ],
  goneTopics: [{ topic: 'Turismo', prev: 9 }],
  topMentions: [
    { sourceLabel: 'Facebook', title: null, snippet: 'Excelente iniciativa.', url: 'https://example.com/p/1', engagementLabel: '40 interacciones', publishedAtLabel: '26 oct', tone: 'positive' },
  ],
  dashboardUrl: 'https://citizenecho.com/overview?agency=ap',
};

/**
 * Huella del HTML legacy calculada con el render de la rama ANTES de WP-7
 * (134adf3, igual que main f3cf934 en este archivo) sobre este mismo fixture.
 * Si cambia, el correo legacy cambió: un cambio intencional del diseño debe
 * actualizar la huella en el mismo PR.
 */
const LEGACY_SHA256 = 'dd254f9b4368101debcd22e84b6db47cf9b3b729d5d4b663f28a9465612b7ef5';

test('legacy: sin interpretation el HTML es el de antes de WP-7 (huella)', () => {
  const html = renderWeeklySummaryHtml(BASE);
  assert.equal(createHash('sha256').update(html).digest('hex'), LEGACY_SHA256);
});

test('legacy: sin interpretation no hay chip, ni nota, ni insights, ni rótulos de ventana', () => {
  const html = renderWeeklySummaryHtml(BASE);
  assert.ok(html.includes('01 · La semana en un vistazo</div>'));
  assert.ok(html.includes('04 · Qué cambió</div>'));
  assert.ok(!html.includes('comentarios de usuarios en publicaciones de redes de la agencia'));
  assert.ok(!html.includes('Cómo se lee este correo'));
  assert.ok(!html.includes('· Insights'));
});

test('interpretation: rótulos de ventana, viñetas de la semana, chip, insights y nota', () => {
  const note = buildWeeklyMethodologyNote({ weekLabel: BASE.weekLabel, prevWeekLabel: BASE.prevWeekLabel, minDeltaBase: 30 });
  const html = renderWeeklySummaryHtml({
    ...BASE,
    highlights: ['Las menciones subieron de 535 a 699 contra la semana anterior.'],
    interpretation: {
      windowLabel: BASE.weekLabel,
      prevWindowLabel: BASE.prevWeekLabel,
      weekHighlights: ['La agencia publicó el programa el lunes 26.', 'Un usuario preguntó por los requisitos.'],
      insights: { negative: ['Un usuario criticó la demora.'], neutral: [], positive: ['Varios usuarios felicitaron el programa.'] },
      composition: { weekPct: 82.8, prevWeekPct: 40.2 },
      methodologyNote: note,
    },
  });
  assert.ok(html.includes('01 · La semana en un vistazo · 23 – 29 oct 2026'));
  assert.ok(html.includes('La agencia publicó el programa el lunes 26.'));
  assert.ok(html.includes('83% de las menciones de la semana son comentarios de usuarios en publicaciones de redes de la agencia · semana anterior: 40%'));
  assert.ok(html.includes('04 · Qué cambió · contra 16 – 22 oct 2026'));
  assert.ok(html.includes('05 · Insights · 23 – 29 oct 2026'));
  assert.ok(html.includes('Varios usuarios felicitaron el programa.'));
  assert.ok(html.includes('06 · Tópicos'));
  assert.ok(html.includes('Cómo se lee este correo'));
  assert.ok(html.includes('16 – 22 oct 2026'));
  // La nota no trae cifras propias salvo la base mínima.
  assert.deepEqual((note.match(/\d+/g) ?? []).filter((n) => !['23', '29', '16', '22', '2026', '30', '2'].includes(n)), []);
  assert.deepEqual(findVetoed(note), []);
});

test('interpretation: sin comentarios ni insights no hay chip ni sección de insights', () => {
  const html = renderWeeklySummaryHtml({
    ...BASE,
    interpretation: { windowLabel: BASE.weekLabel, prevWindowLabel: BASE.prevWeekLabel, composition: null, insights: { negative: [], neutral: [], positive: [] } },
  });
  assert.ok(!html.includes('comentarios de usuarios en publicaciones de redes de la agencia'));
  assert.ok(!html.includes('· Insights'));
  assert.ok(html.includes('05 · Tópicos'));
});

test('preheader: con base mínima el delta absoluto entra igual', () => {
  const p = weeklyPreheader({
    ...BASE,
    totalDelta: formatDelta(40, 12, { kind: 'absolute', decimals: 0 }),
  });
  assert.ok(p.startsWith('699 menciones vs 535 (+28)'));
});
