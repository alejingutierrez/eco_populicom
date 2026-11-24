/**
 * Reglas por mención (COR-04). Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/alerts/rule-eval.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inCooldown,
  keywordList,
  mentionRuleCooldownHours,
  negativeShareParams,
  negativeShareTriggered,
  validateMentionRuleConfig,
  volumeSpikeParams,
} from './rule-eval';

test('cooldown: el de la regla si es válido, si no el del tipo', () => {
  assert.equal(mentionRuleCooldownHours({ type: 'keyword' }), 1);
  assert.equal(mentionRuleCooldownHours({ type: 'volume_spike' }), 6);
  assert.equal(mentionRuleCooldownHours({ type: 'negative_sentiment', cooldownHours: 24 }), 24);
  assert.equal(mentionRuleCooldownHours({ type: 'keyword', cooldownHours: 0 }), 1);
  assert.equal(mentionRuleCooldownHours({ type: 'keyword', cooldown_hours: 3 }), 3);
});

test('en cooldown hasta que pasan las horas', () => {
  const now = new Date('2026-11-24T18:00:00Z');
  assert.equal(inCooldown(null, now, 6), false);
  assert.equal(inCooldown(new Date('2026-11-24T13:00:00Z'), now, 6), true);
  assert.equal(inCooldown(new Date('2026-11-24T12:00:00Z'), now, 6), false);
});

test('pico de volumen mal formado no dispara', () => {
  // Así guardaba «Crear alerta» desde un detalle antes de COR-04.
  assert.equal(volumeSpikeParams({ type: 'volume_spike', threshold: { volumeMinutes: 60, minMentions: 5 } }), null);
  assert.deepEqual(volumeSpikeParams({ type: 'volume_spike', threshold: 40, window_minutes: 120 }), { threshold: 40, windowMinutes: 120 });
  assert.deepEqual(volumeSpikeParams({ type: 'volume_spike', threshold: 40 }), { threshold: 40, windowMinutes: 60 });
});

test('proporción negativa: pide muestra mínima y respeta el umbral', () => {
  assert.equal(negativeShareTriggered(9, 9, 50), false);
  assert.equal(negativeShareTriggered(10, 5, 50), true);
  assert.equal(negativeShareTriggered(40, 19, 50), false);
  assert.deepEqual(negativeShareParams({ type: 'negative_sentiment' }), { thresholdPct: 50, windowHours: 24 });
  assert.deepEqual(negativeShareParams({ threshold_pct: 30, window_hours: 6 }), { thresholdPct: 30, windowHours: 6 });
});

test('palabras clave: limpia, baja a minúsculas y descarta las de una letra', () => {
  assert.deepEqual(keywordList({ keywords: [' Permisos ', 'a', 7, 'LUMA'] }), ['permisos', 'luma']);
});

test('validación al guardar', () => {
  assert.deepEqual(validateMentionRuleConfig({ type: 'keyword', keywords: ['permisos'] }), { ok: true });
  assert.equal(validateMentionRuleConfig({ type: 'keyword', keywords: [] }).ok, false);
  assert.equal(validateMentionRuleConfig({ type: 'keyword', keywords: ['x y'], sentiment: 'malo' }).ok, false);
  assert.deepEqual(validateMentionRuleConfig({ type: 'volume_spike', threshold: 40, window_minutes: 60 }), { ok: true });
  assert.equal(validateMentionRuleConfig({ type: 'volume_spike', threshold: { minMentions: 5 } }).ok, false);
  assert.equal(validateMentionRuleConfig({ type: 'volume_spike', threshold: 40 }).ok, false);
  assert.deepEqual(validateMentionRuleConfig({ type: 'negative_sentiment', threshold_pct: 40, window_hours: 12 }), { ok: true });
  assert.equal(validateMentionRuleConfig({ type: 'negative_sentiment' }).ok, false);
  assert.equal(validateMentionRuleConfig({ type: 'negative_sentiment', threshold_pct: 40, window_hours: 12, cooldownHours: 500 }).ok, false);
});
