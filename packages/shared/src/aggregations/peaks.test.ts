/**
 * Días que la tendencia del Overview rotula. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/aggregations/peaks.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAnnotatedPeaks } from './report-detail';

const day = (date: string, total: number, negative = 0) => ({ date, negative, neutral: total - negative, positive: 0 });

// DDEC, 22–28 sep 2026: el FEI amplía la pesquisa el jueves 24.
const DDEC = [
  day('2026-09-22', 10, 1), day('2026-09-23', 13), day('2026-09-24', 75, 22), day('2026-09-25', 32, 6),
  day('2026-09-26', 11, 2), day('2026-09-27', 2, 1), day('2026-09-28', 22, 5),
];

test('rotula solo el día que se sale de la ventana', () => {
  const peaks = selectAnnotatedPeaks(DDEC);
  assert.deepEqual(peaks.map((p) => p.date), ['2026-09-24']);
  assert.equal(peaks[0].total, 75);
  assert.equal(peaks[0].negative, 22);
});

test('una semana plana no tiene picos que rotular', () => {
  const flat = ['01', '02', '03', '04', '05', '06', '07'].map((d, i) => day(`2026-09-${d}`, 20 + (i % 3)));
  assert.deepEqual(selectAnnotatedPeaks(flat), []);
});

test('un pico con poco volumen no se rotula', () => {
  const tiny = [day('2026-09-01', 0), day('2026-09-02', 1), day('2026-09-03', 0), day('2026-09-04', 8), day('2026-09-05', 0), day('2026-09-06', 1)];
  assert.deepEqual(selectAnnotatedPeaks(tiny), []);
});

test('devuelve como mucho dos, en orden cronológico', () => {
  const two = [day('2026-09-01', 5), day('2026-09-02', 90), day('2026-09-03', 5), day('2026-09-04', 5), day('2026-09-05', 80), day('2026-09-06', 5), day('2026-09-07', 5), day('2026-09-08', 5), day('2026-09-09', 5), day('2026-09-10', 5), day('2026-09-11', 70)];
  const peaks = selectAnnotatedPeaks(two);
  assert.equal(peaks.length, 2);
  assert.deepEqual(peaks.map((p) => p.date), ['2026-09-02', '2026-09-05']);
});

test('ventanas de más de 31 días no se rotulan', () => {
  const long = Array.from({ length: 40 }, (_, i) => day(`2026-08-${String((i % 28) + 1).padStart(2, '0')}`, i === 10 ? 200 : 5));
  assert.deepEqual(selectAnnotatedPeaks(long), []);
});
