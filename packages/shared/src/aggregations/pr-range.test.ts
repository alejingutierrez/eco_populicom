/**
 * Días y rangos en hora de Puerto Rico.
 *   node_modules/.bin/tsx --test packages/shared/src/aggregations/pr-range.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PR_TIMEZONE, daysBetweenYmd, prDayOf, prDaySql, prDayStartUtc, prDayTextSql, prDaysBetween,
  prRangeUtc, prWindowRangeSql, prWindowSql,
} from './pr-range';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

test('prDayOf: el día cambia a las 04:00Z (medianoche AST), no a las 00:00Z', () => {
  assert.equal(PR_TIMEZONE, 'America/Puerto_Rico');
  assert.equal(prDayOf(new Date('2026-11-01T03:59:59Z')), '2026-10-31');
  assert.equal(prDayOf(new Date('2026-11-01T04:00:00Z')), '2026-11-01');
  assert.equal(prDayOf('2026-10-31T23:21:33.000Z'), '2026-10-31'); // viene de una muestra real
  // Sin DST: en julio el corte es el mismo.
  assert.equal(prDayOf(new Date('2026-07-15T03:59:59Z')), '2026-07-14');
  assert.equal(prDayOf(new Date('2026-07-15T04:00:00Z')), '2026-07-15');
  assert.throws(() => prDayOf('no es una fecha'));
});

test('prDayStartUtc / prRangeUtc: bordes en UTC del rango de días PR', () => {
  assert.equal(prDayStartUtc('2026-10-25').toISOString(), '2026-10-25T04:00:00.000Z');
  const r = prRangeUtc('2026-10-25', '2026-10-31');
  assert.equal(r.fromIso, '2026-10-25T04:00:00.000Z');
  assert.equal(r.toExclusiveIso, '2026-11-01T04:00:00.000Z');
  // Un día solo = 24 h exactas.
  const one = prRangeUtc('2026-10-31', '2026-10-31');
  assert.equal(one.toExclusive.getTime() - one.from.getTime(), 86400000);
  assert.throws(() => prRangeUtc('2026-10-31', '2026-10-25'));
  assert.throws(() => prDayStartUtc('31/10/2026'));
});

test('el defecto UTC: una muestra de las 22:00 PR del 31-oct queda fuera con el corte UTC y dentro con el día PR', () => {
  // 2026-11-01T02:00Z = 22:00 AST del 31 de octubre.
  const sample = new Date('2026-11-01T02:00:00Z');
  const range = prRangeUtc('2026-10-25', '2026-10-31');
  const inPrRange = sample >= range.from && sample < range.toExclusive;
  // Regla anterior de los lambdas: published_at < ($3::date + 1 día) en UTC.
  const utcEnd = new Date('2026-11-01T00:00:00Z');
  const inLegacyUtc = sample >= new Date('2026-10-25T00:00:00Z') && sample < utcEnd;
  assert.equal(prDayOf(sample), '2026-10-31');
  assert.equal(inPrRange, true);
  assert.equal(inLegacyUtc, false);
  // Y al revés: las 00:30Z del 25-oct (20:30 AST del 24) entraban de más.
  const early = new Date('2026-10-25T00:30:00Z');
  assert.equal(prDayOf(early), '2026-10-24');
  assert.equal(early >= range.from, false);
  assert.equal(early >= new Date('2026-10-25T00:00:00Z'), true);
});

test('prDaysBetween: cuenta cambios de día PR, no múltiplos de 24 h', () => {
  // Post de FB del DDEC 26-oct 09:52 AST (13:52Z) → comentario 31-oct 19:04 AST.
  assert.equal(prDaysBetween('2026-10-26T13:52:00Z', '2026-10-31T23:04:10Z'), 5);
  // 20 minutos pero cruza la medianoche PR.
  assert.equal(prDaysBetween('2026-10-27T03:50:00Z', '2026-10-27T04:10:00Z'), 1);
  // 23 h 59 min dentro del mismo día PR.
  assert.equal(prDaysBetween('2026-10-27T04:00:00Z', '2026-10-28T03:59:00Z'), 0);
  assert.equal(daysBetweenYmd('2026-10-31', '2026-10-25'), -6);
  assert.equal(daysBetweenYmd('2026-02-28', '2026-03-01'), 1);
});

test('fragmentos SQL: día PR, alias normalizado y parámetros configurables', () => {
  assert.equal(prDaySql('m'), "(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date");
  assert.equal(prDaySql(), "(published_at AT TIME ZONE 'America/Puerto_Rico')::date");
  assert.equal(prDayTextSql('m.'), "to_char(m.published_at AT TIME ZONE 'America/Puerto_Rico', 'YYYY-MM-DD')");
  assert.equal(
    squash(prWindowSql('m.')),
    "AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date >= ($2::date) AND (m.published_at AT TIME ZONE 'America/Puerto_Rico')::date <= ($3::date)",
  );
  assert.match(prWindowSql('', '$4', '$5'), /\(\$4::date\)[\s\S]*\(\$5::date\)/);
  // La versión por rango compara la columna cruda (usa el índice) contra medianoches PR.
  const range = squash(prWindowRangeSql('m'));
  assert.match(range, /m\.published_at >= \(\(\$2::date\)::timestamp AT TIME ZONE 'America\/Puerto_Rico'\)/);
  assert.match(range, /m\.published_at < \(\(\(\$3::date\) \+ 1\)::timestamp AT TIME ZONE 'America\/Puerto_Rico'\)/);
});
