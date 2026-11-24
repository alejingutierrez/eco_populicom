/**
 * Decisión del episodio de crisis (COR-02). Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/crisis/episode.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crisisEpisodeDays, crisisEpisodePeak, decideCrisisEpisode, scorePointsDelta, shouldAlertForClosedDay, type ClosedDayCatchUpInput, type CrisisEpisodeDecisionInput } from './episode';

const BASE: CrisisEpisodeDecisionInput = {
  above: true,
  open: null,
  hoursSinceLastAlert: null,
  cooldownHours: 12,
  today: '2026-11-20',
  localHour: 14,
  lastClosedDayAbove: false,
};

test('sobre el umbral y sin episodio: primer aviso', () => {
  assert.deepEqual(decideCrisisEpisode(BASE), { action: 'alert', kind: 'first' });
});

test('sobre el umbral con episodio abierto y cooldown cumplido: reaviso', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, open: { lastAlertDay: '2026-11-19' }, hoursSinceLastAlert: 13 }),
    { action: 'alert', kind: 'followup' },
  );
});

test('el cooldown frena el primer aviso y el reaviso', () => {
  assert.deepEqual(decideCrisisEpisode({ ...BASE, hoursSinceLastAlert: 3 }), { action: 'none', reason: 'cooldown' });
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, open: { lastAlertDay: '2026-11-20' }, hoursSinceLastAlert: 11.9 }),
    { action: 'none', reason: 'cooldown' },
  );
});

test('bajo el umbral y sin episodio: nada', () => {
  assert.deepEqual(decideCrisisEpisode({ ...BASE, above: false }), { action: 'none', reason: 'below-threshold' });
});

test('no se cierra el mismo día del último aviso aunque el día parcial baje', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: false, open: { lastAlertDay: '2026-11-20' }, hoursSinceLastAlert: 5 }),
    { action: 'none', reason: 'close-same-day' },
  );
});

test('no se cierra de madrugada: el día de ayer aún recibe menciones tardías', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: false, open: { lastAlertDay: '2026-11-19' }, localHour: 0 }),
    { action: 'none', reason: 'close-too-early' },
  );
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: false, open: { lastAlertDay: '2026-11-19' }, localHour: 7 }),
    { action: 'none', reason: 'close-too-early' },
  );
});

test('si ayer cerró sobre el umbral el episodio sigue abierto', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: false, open: { lastAlertDay: '2026-11-19' }, localHour: 9, lastClosedDayAbove: true }),
    { action: 'none', reason: 'closed-day-above' },
  );
});

test('cierre: ayer terminó bajo el umbral, hoy sigue abajo y ya son las 8', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: false, open: { lastAlertDay: '2026-11-19' }, localHour: 8, lastClosedDayAbove: false }),
    { action: 'close' },
  );
});

test('cierre también cuando ayer no tuvo datos', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: false, open: { lastAlertDay: '2026-11-18' }, localHour: 10, lastClosedDayAbove: null }),
    { action: 'close' },
  );
});

test('si vuelve a cruzar tras un día bajo, es reaviso y no cierre', () => {
  assert.deepEqual(
    decideCrisisEpisode({ ...BASE, above: true, open: { lastAlertDay: '2026-11-18' }, hoursSinceLastAlert: 40, lastClosedDayAbove: false }),
    { action: 'alert', kind: 'followup' },
  );
});

test('días del episodio cuentan ambos extremos y cruzan de mes', () => {
  assert.equal(crisisEpisodeDays('2026-11-20', '2026-11-20'), 1);
  assert.equal(crisisEpisodeDays('2026-11-18', '2026-11-20'), 3);
  assert.equal(crisisEpisodeDays('2026-11-29', '2026-12-02'), 4);
});

test('el pico solo cambia cuando la lectura nueva es mayor', () => {
  assert.deepEqual(crisisEpisodePeak(null, { score: 0.5, day: '2026-11-18' }), { score: 0.5, day: '2026-11-18' });
  assert.deepEqual(crisisEpisodePeak({ score: 0.6, day: '2026-11-18' }, { score: 0.5, day: '2026-11-19' }), { score: 0.6, day: '2026-11-18' });
  assert.deepEqual(crisisEpisodePeak({ score: 0.6, day: '2026-11-18' }, { score: 0.61, day: '2026-11-19' }), { score: 0.61, day: '2026-11-19' });
});

test('el cambio en puntos se calcula sobre lo que se muestra', () => {
  // 0.524 → 52 %, 0.606 → 61 %: el lector ve 9 puntos, no 8.
  assert.equal(scorePointsDelta(0.606, 0.524), 9);
  assert.equal(scorePointsDelta(0.30, 0.52), -22);
});

// DF, 1-nov-2026 a las 8:05 a.m.: el 31-oct cerró en 41 % (en curso nunca pasó
// de 38 %), sin aviso ese día; el último aviso fue el 22-oct.
const CATCH_UP: ClosedDayCatchUpInput = {
  todayAbove: false,
  yesterdayAbove: true,
  alertSentForYesterday: false,
  hoursSinceLastAlert: 236,
  cooldownHours: 12,
  localHour: 8,
};

test('día cerrado sobre el umbral y sin aviso: se avisa a la mañana siguiente', () => {
  assert.equal(shouldAlertForClosedDay(CATCH_UP), true);
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, hoursSinceLastAlert: null }), true);
});

test('no se avisa de madrugada: ayer todavía recibe menciones', () => {
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, localHour: 0 }), false);
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, localHour: 7 }), false);
});

test('no se repite un día que ya tuvo aviso ni se salta el cooldown', () => {
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, alertSentForYesterday: true }), false);
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, hoursSinceLastAlert: 9 }), false);
});

test('si hoy ya cruza el umbral manda el aviso de hoy; si ayer no cruzó, nada', () => {
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, todayAbove: true }), false);
  assert.equal(shouldAlertForClosedDay({ ...CATCH_UP, yesterdayAbove: false }), false);
});
