/**
 * Tests de la capa de formato. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/format/metrics-display.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMetric,
  formatVelocity,
  formatDelta,
  metricBand,
  toBhi10,
  crisisBand,
  bhiBand10,
  polarizationBand,
  nssBand,
  bandTone,
} from './metrics-display';

// ---- bandas ----------------------------------------------------------------

test('crisisBand: umbrales canónicos', () => {
  assert.equal(crisisBand(0.10), 'NORMAL');
  assert.equal(crisisBand(0.25), 'ELEVADO');
  assert.equal(crisisBand(0.40), 'ALERTA');
  assert.equal(crisisBand(0.59), 'ALERTA');
  assert.equal(crisisBand(0.60), 'CRISIS');
});

test('BHI: las dos escalas reconcilian (0.40/0.60/0.80 ≡ 4.6/6.4/8.2)', () => {
  assert.equal(toBhi10(0), 1);
  assert.equal(toBhi10(1), 10);
  assert.equal(bhiBand10(toBhi10(0.39)), 'CRÍTICO');
  assert.equal(bhiBand10(toBhi10(0.40)), 'DÉBIL');
  assert.equal(bhiBand10(toBhi10(0.60)), 'SANO');
  assert.equal(bhiBand10(toBhi10(0.80)), 'FUERTE');
  // metricBand('bhi') recibe el crudo 0–1 y convierte internamente
  assert.equal(metricBand('bhi', 0.62), 'SANO');
});

test('polarizationBand y nssBand', () => {
  assert.equal(polarizationBand(29), 'APÁTICA');
  assert.equal(polarizationBand(50), 'ALTA');
  assert.equal(polarizationBand(75), 'EXTREMA');
  assert.equal(nssBand(25), 'MUY POS');
  assert.equal(nssBand(10), 'POS');
  assert.equal(nssBand(0), 'NEUTRAL');
  assert.equal(nssBand(-10), 'NEG');
  assert.equal(nssBand(-47), 'MUY NEG');
});

// ---- formatMetric ----------------------------------------------------------

test('crisis: 0.59 → "Alerta" + "59%" (no más 0.59 crudo)', () => {
  const d = formatMetric('crisis', 0.59);
  assert.equal(d.word, 'Alerta');
  assert.equal(d.value, '59%');
  assert.equal(d.band, 'ALERTA');
  assert.equal(d.tone, 'neg');
  assert.equal(d.color, 'var(--neg)');
  assert.equal(d.raw, 0.59);
  assert.equal(d.short, 'Alerta · 59%');
});

test('bhi: 0.59 crudo → 6.31/10 → "Débil" (6.31 < 6.4)', () => {
  const d = formatMetric('bhi', 0.59);
  assert.equal(d.band, 'DÉBIL');
  assert.equal(d.word, 'Débil');
  assert.equal(d.value, '6.3 / 10');
});

test('bhi: el raw expuesto está en escala 1–10', () => {
  const d = formatMetric('bhi', 0.6);
  assert.equal(d.raw, toBhi10(0.6));
  assert.equal(d.value, '6.4 / 10');
  assert.equal(d.word, 'Sano');
});

test('nss: signo y banda', () => {
  const d = formatMetric('nss', -47);
  assert.equal(d.word, 'Muy negativo');
  assert.equal(d.value, '−47'); // menos tipográfico
  assert.equal(d.tone, 'neg');
  const pos = formatMetric('nss', 12.4);
  assert.equal(pos.value, '+12.4');
});

test('polarization: integer percent', () => {
  const d = formatMetric('polarization', 58.7);
  assert.equal(d.value, '59%');
  assert.equal(d.word, 'Alta');
});

test('engagementRate: % sin banda, guard null', () => {
  assert.equal(formatMetric('engagementRate', 2.37).value, '2.4%');
  assert.equal(formatMetric('engagementRate', null).value, null);
  assert.equal(formatMetric('engagementRate', null).word, '—');
});

test('valor null → display vacío', () => {
  const d = formatMetric('crisis', null);
  assert.equal(d.word, '—');
  assert.equal(d.band, null);
});

// ---- velocidad -------------------------------------------------------------

test('velocidad: sin aumento → Estable · +0%', () => {
  const d = formatVelocity(10, 10);
  assert.equal(d.word, 'Estable');
  assert.equal(d.value, '0%');
  assert.equal(d.band, 'ESTABLE');
});

test('velocidad: +18% → Acelerada', () => {
  const d = formatVelocity(11.8, 10);
  assert.equal(d.word, 'Acelerada');
  assert.equal(d.value, '+18%');
  assert.equal(d.band, 'ACELERADA');
  assert.equal(d.tone, 'accent');
});

test('velocidad: −20% → Desacelerada', () => {
  const d = formatVelocity(8, 10);
  assert.equal(d.word, 'Desacelerada');
  assert.equal(d.value, '−20%');
});

test('velocidad: sin período previo → Sin base', () => {
  assert.equal(formatVelocity(10, null).word, 'Sin base');
  assert.equal(formatVelocity(10, 0).word, 'Sin base');
  assert.equal(formatVelocity(null, 10).value, null);
});

// ---- delta -----------------------------------------------------------------

test('delta: distingue estable (0) de sin base (null)', () => {
  const estable = formatDelta(5, 5, { kind: 'absolute', decimals: 1 });
  assert.equal(estable.word, 'estable');
  assert.equal(estable.hasBaseline, true);
  assert.equal(estable.arrow, '·');

  const sinBase = formatDelta(5, null);
  assert.equal(sinBase.word, 'sin base');
  assert.equal(sinBase.hasBaseline, false);
  assert.equal(sinBase.arrow, '—');
  assert.equal(sinBase.value, null);
});

test('delta: NO produce "0% sube" (palabra desde el valor redondeado)', () => {
  // +0.4% redondea a 0 con 0 decimales → debe ser "estable", no "sube"
  const d = formatDelta(100.4, 100, { kind: 'percent', decimals: 0 });
  assert.equal(d.word, 'estable');
  assert.equal(d.value, '0%');
});

test('delta: invert para crisis (subir es malo)', () => {
  const up = formatDelta(0.5, 0.4, { kind: 'absolute', decimals: 2, invert: true });
  assert.equal(up.direction, 'up');
  assert.equal(up.tone, 'neg'); // subió la crisis → rojo
  assert.equal(up.value, '+0.1');

  const down = formatDelta(0.3, 0.4, { kind: 'absolute', decimals: 2, invert: true });
  assert.equal(down.tone, 'pos'); // bajó la crisis → verde
});

test('delta percent: crecimiento desde cero → "nuevo"', () => {
  const d = formatDelta(50, 0, { kind: 'percent' });
  assert.equal(d.value, 'nuevo');
  assert.equal(d.direction, 'up');
  const flat = formatDelta(0, 0, { kind: 'percent' });
  assert.equal(flat.word, 'estable');
});

test('bandTone mapea las 5 bandas NSS coherentemente', () => {
  assert.equal(bandTone('MUY NEG'), 'neg');
  assert.equal(bandTone('NEG'), 'warn');
  assert.equal(bandTone('NEUTRAL'), 'neutral');
  assert.equal(bandTone('POS'), 'pos');
  assert.equal(bandTone('MUY POS'), 'accent');
});
