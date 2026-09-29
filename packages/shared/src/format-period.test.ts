/**
 * Tests de las fechas que entran a los prompts. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/format-period.test.ts
 *
 * El día de la semana lo calculamos nosotros y el modelo solo lo copia: el
 * 28-sep-2026 el diario llamó "miércoles" al pico del jueves y el editorial
 * de crisis llamó "sábado" a un lunes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPromptDay, formatPromptDayOfInstant } from './format-period';

test('formatPromptDay trae el día de la semana correcto', () => {
  assert.equal(formatPromptDay('2026-09-24'), 'jueves 24 sep 2026');
  assert.equal(formatPromptDay('2026-09-27'), 'domingo 27 sep 2026');
  assert.equal(formatPromptDay('2026-09-28'), 'lunes 28 sep 2026');
});

test('formatPromptDayOfInstant usa el día en hora de Puerto Rico, no en UTC', () => {
  // 10:30 p.m. AST del miércoles 23 = 02:30Z del jueves 24.
  assert.equal(formatPromptDayOfInstant('2026-09-24T02:30:00.000Z'), 'miércoles 23 sep 2026');
  assert.equal(formatPromptDayOfInstant('2026-09-24T16:52:33.000Z'), 'jueves 24 sep 2026');
  // Cruce de año.
  assert.equal(formatPromptDayOfInstant(new Date('2027-01-01T03:00:00Z')), 'jueves 31 dic 2026');
});
