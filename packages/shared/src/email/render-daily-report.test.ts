/**
 * Render del correo diario: el camino legacy no cambia (WP-6) y los rótulos
 * de la interpretación v1 solo aparecen con `interpretation`. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/email/render-daily-report.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildDailyMethodologyNote, dailyPreheader, renderDailyReportHtml, type DailyReportRenderData } from './render-daily-report';
import { formatDelta, formatMetric } from '../format/metrics-display';
import { findVetoed } from '../composer/vetoed';

const BASE: DailyReportRenderData = {
  agencyName: 'Agencia de Prueba',
  agencyShortName: 'AP',
  agencyKicker: 'AP · Agencia de Prueba',
  periodLabel: '26 oct – 1 nov 2026',
  updatedAtLabel: '2 nov, 6:00 a.m. AST',
  totals: { negative: 58, neutral: 502, positive: 139, total: 699 },
  deltaVsPrev: { negative: 20, neutral: 5, positive: 1400 },
  deltaDisplay: {
    negative: formatDelta(58, 48, { kind: 'percent', decimals: 0 }),
    neutral: formatDelta(502, 478, { kind: 'percent', decimals: 0 }),
    positive: formatDelta(139, 9, { kind: 'percent', decimals: 0 }),
  },
  dailySeries: [
    { date: '2026-10-26', dayLabel: 'lun 26', negative: 3, neutral: 60, positive: 37 },
    { date: '2026-10-27', dayLabel: 'mar 27', negative: 12, neutral: 104, positive: 39 },
    { date: '2026-10-28', dayLabel: 'mié 28', negative: 15, neutral: 130, positive: 22 },
    { date: '2026-10-29', dayLabel: 'jue 29', negative: 10, neutral: 80, positive: 15 },
    { date: '2026-10-30', dayLabel: 'vie 30', negative: 10, neutral: 60, positive: 10 },
    { date: '2026-10-31', dayLabel: 'sáb 31', negative: 4, neutral: 14, positive: 10 },
    { date: '2026-11-01', dayLabel: 'dom 1', negative: 4, neutral: 54, positive: 6 },
  ],
  topicsTable: [
    { topic: 'Desarrollo Empresarial', subtopics: 'Pymes', total: 400, secondaryCount: 3, negative: 20, neutral: 300, positive: 80 },
    { topic: 'Manufactura', subtopics: '', total: 200, secondaryCount: 0, negative: 30, neutral: 150, positive: 20 },
    { topic: 'Sin clasificar', subtopics: 'En proceso', total: 99, secondaryCount: 0, negative: 8, neutral: 52, positive: 39, isUnclassified: true },
  ],
  insights: { negative: ['Un usuario criticó la demora de un trámite.'], neutral: [], positive: ['Varios usuarios felicitaron a una panadería.'] },
  dailySummary: {
    label: 'Resumen del día · 1 nov',
    headline: 'Comentarios a una publicación del lunes 26 dominaron el domingo',
    paragraph: 'El domingo hubo <strong>64 menciones</strong>.',
    highlights: ['Un usuario preguntó por la dirección.'],
  },
  metrics: {
    crisis: { display: formatMetric('crisis', 0.12), delta: formatDelta(12, 15, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }) },
    bhi: { display: formatMetric('bhi', 0.6) },
    nss: { display: formatMetric('nss', 11.5), delta: formatDelta(11.5, 9, { kind: 'absolute', decimals: 1 }) },
  },
  overviewUrl: 'https://citizenecho.com/overview?agency=ap',
};

/**
 * Huella del HTML legacy calculada con el render de `main` ANTES de WP-6
 * (f3cf934) sobre este mismo fixture. Si cambia, el correo legacy cambió: un
 * cambio intencional del diseño debe actualizar la huella en el mismo PR.
 */
const LEGACY_SHA256 = 'e849025ddba710a9d36dee72523c4d95912a80e19738a722ac66aaa355a14447';

test('legacy: sin interpretation el HTML es el de antes de WP-6 (huella)', () => {
  const html = renderDailyReportHtml(BASE);
  assert.equal(createHash('sha256').update(html).digest('hex'), LEGACY_SHA256);
});

test('legacy: sin interpretation no hay chip, ni nota, ni rótulo de ventana', () => {
  const html = renderDailyReportHtml(BASE);
  assert.ok(html.includes('03 · Insights</div>'));
  assert.ok(!html.includes('03 · Insights · '));
  assert.ok(!html.includes('comentarios de usuarios en publicaciones de redes de la agencia'));
  assert.ok(!html.includes('Cómo se lee este correo'));
});

test('interpretation: rótulo «últimos 7 días», chip con la semana previa y nota de metodología', () => {
  const note = buildDailyMethodologyNote({ periodLabel: BASE.periodLabel, dayLabel: 'domingo 1 de noviembre', minDeltaBase: 30 });
  const html = renderDailyReportHtml({
    ...BASE,
    interpretation: { insightsWindowLabel: 'últimos 7 días', composition: { weekPct: 82.8, prevWeekPct: 40.2 }, methodologyNote: note },
  });
  assert.ok(html.includes('03 · Insights · últimos 7 días'));
  assert.ok(html.includes('83% de las menciones son comentarios de usuarios en publicaciones de redes de la agencia · 7 días previos: 40%'));
  assert.ok(html.includes('Cómo se lee este correo'));
  assert.ok(html.includes('reacción tardía'));
  assert.ok(html.includes('30 menciones'));
});

test('interpretation: chip sin semana previa y sin composición', () => {
  const sinPrev = renderDailyReportHtml({ ...BASE, interpretation: { composition: { weekPct: 10, prevWeekPct: null } } });
  assert.ok(sinPrev.includes('10% de las menciones son comentarios'));
  assert.ok(!sinPrev.includes('7 días previos:'));
  const sinChip = renderDailyReportHtml({ ...BASE, interpretation: { composition: null } });
  assert.ok(!sinChip.includes('de las menciones son comentarios'));
});

test('preheader con deltas de base mínima: sin porcentaje cuando la base previa es chica', () => {
  // El lambda (agentic) pasa deltas absolutos cuando la base previa < 30.
  const withMinBase: DailyReportRenderData = {
    ...BASE,
    totals: { ...BASE.totals, negative: 20 },
    deltaDisplay: { ...BASE.deltaDisplay!, negative: formatDelta(20, 6, { kind: 'absolute', decimals: 0 }) },
  };
  const pre = dailyPreheader(withMinBase);
  assert.match(pre, /negativo 20 \(\+14\)/);
  assert.ok(!/negativo 20 \([^)]*%/.test(pre));
});

test('nota de metodología: sin vetados ni cifras salvo la base mínima', () => {
  const note = buildDailyMethodologyNote({ periodLabel: '26 oct – 1 nov 2026', dayLabel: 'domingo 1 de noviembre', minDeltaBase: 30 });
  assert.ok(note.includes('26 oct – 1 nov 2026'));
  assert.ok(note.includes('domingo 1 de noviembre'));
  assert.ok(note.includes('Instagram'));
  assert.deepEqual(findVetoed(note), []);
  // Las únicas cifras: la ventana, los «2 días» de la reacción tardía, los 7 días y la base mínima.
  const digits = note.replace('26 oct – 1 nov 2026', '').replace('domingo 1 de noviembre', '').match(/\d+/g) ?? [];
  assert.deepEqual([...new Set(digits)].sort(), ['2', '30', '7']);
});
