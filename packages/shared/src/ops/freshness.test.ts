/**
 * Frescura por agencia (OPS-04). Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/ops/freshness.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agencyFreshness, awakeMinutesBetween, buildDataHealthMetricLines, freshnessWeightAt } from './freshness';

// Puerto Rico = UTC−4. 2026-11-18 es miércoles; 2026-11-21, sábado.
const pr = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-04:00`);

test('el peso depende de la hora y del día en Puerto Rico', () => {
  assert.equal(freshnessWeightAt(pr('2026-11-18', '07:59').getTime()), 0);
  assert.equal(freshnessWeightAt(pr('2026-11-18', '08:00').getTime()), 1);
  assert.equal(freshnessWeightAt(pr('2026-11-18', '21:59').getTime()), 1);
  assert.equal(freshnessWeightAt(pr('2026-11-18', '22:00').getTime()), 0);
  assert.equal(freshnessWeightAt(pr('2026-11-21', '12:00').getTime()), 0.5);
  assert.equal(freshnessWeightAt(pr('2026-11-22', '12:00').getTime()), 0.5);
});

test('la madrugada no cuenta: de 11 p.m. a 9 a.m. es una hora hábil', () => {
  assert.equal(awakeMinutesBetween(pr('2026-11-17', '23:00'), pr('2026-11-18', '09:00')), 60);
});

test('un día de semana cuenta entero y con minutos sueltos', () => {
  assert.equal(awakeMinutesBetween(pr('2026-11-18', '09:15'), pr('2026-11-18', '13:40')), 265);
});

test('el fin de semana cuenta la mitad', () => {
  assert.equal(awakeMinutesBetween(pr('2026-11-21', '10:00'), pr('2026-11-21', '16:00')), 180);
});

test('intervalo vacío o invertido vale cero; uno enorme se acota a 7 días', () => {
  assert.equal(awakeMinutesBetween(pr('2026-11-18', '10:00'), pr('2026-11-18', '10:00')), 0);
  assert.equal(awakeMinutesBetween(pr('2026-11-18', '11:00'), pr('2026-11-18', '10:00')), 0);
  // 7 días = 5 de semana (14 h) + 2 de fin de semana (7 h hábiles).
  assert.equal(awakeMinutesBetween(pr('2026-01-01', '00:00'), pr('2026-11-18', '00:00')), (5 * 14 + 2 * 7) * 60);
});

test('callada: más de 4 horas hábiles; el silencio nocturno no dispara', () => {
  const noche = agencyFreshness('ddecpr', pr('2026-11-17', '22:30'), pr('2026-11-18', '11:30'));
  assert.equal(noche.minutesSince, 780);
  assert.equal(noche.awakeMinutes, 210);
  assert.equal(noche.silent, false);
  const dia = agencyFreshness('df', pr('2026-11-18', '08:00'), pr('2026-11-18', '12:01'));
  assert.equal(dia.silent, true);
  // El incidente del 26-oct (lunes): sin menciones de 4:48 a.m. a 3:00 p.m.
  const incidente = agencyFreshness('ddecpr', pr('2026-10-26', '04:48'), pr('2026-10-26', '12:05'));
  assert.equal(incidente.silent, true);
});

test('las líneas EMF llevan el resumen y una línea por agencia', () => {
  const lines = buildDataHealthMetricLines({
    snapshotsComputed: 3,
    timestampMs: 1,
    agencies: [
      { slug: 'df', minutesSince: 12, awakeMinutes: 12, silent: false },
      { slug: 'ddecpr', minutesSince: 400, awakeMinutes: 300, silent: true },
    ],
  }).map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].SnapshotsCalculados, 3);
  assert.equal(lines[0].AgenciasCalladas, 1);
  assert.deepEqual(lines[0].calladas, ['ddecpr']);
  assert.deepEqual(lines[0]._aws.CloudWatchMetrics[0].Dimensions, [[]]);
  assert.equal(lines[2].Agencia, 'ddecpr');
  assert.equal(lines[2].MinutosHabilesSinMenciones, 300);
  assert.deepEqual(lines[2]._aws.CloudWatchMetrics[0].Dimensions, [['Agencia']]);
});
