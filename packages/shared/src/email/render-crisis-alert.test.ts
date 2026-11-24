/**
 * Correo de crisis (COR-02): reaviso con contexto de episodio y correo de cierre.
 *   node_modules/.bin/tsx --test packages/shared/src/email/render-crisis-alert.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crisisCloseReason,
  renderCrisisAlertHtml,
  renderCrisisCloseHtml,
  type CrisisAlertRenderData,
  type CrisisCloseRenderData,
} from './render-crisis-alert';
import { buildCrisisEditorialPrompt, type CrisisEditorialInputs } from '../prompts/crisis-editorial';

const BASE: CrisisAlertRenderData = {
  agencyName: 'Agencia de Prueba',
  agencyShortName: 'AP',
  detectedAtLabel: '19 nov · 2:05 p.m. AST',
  triggerDayLabel: '19 nov',
  band: 'ALERTA',
  metrics: { crisisRiskScore: 0.606, crisisRiskScore24hAgo: 0.524, crisisSeverity: 0.7, volumeVsAvg7Pct: 40 },
  volume: { totalMentions: 158, negativeCount: 71, negativeShare: 71 / 158, prevDayTotal: 131, prevDayNegative: 60 },
  topNegativeTopics: [],
  topNegativeMunicipalities: [],
  highlightedMentions: [],
  editorial: { headline: 'Titular de prueba', lede: 'Lede.', bodyParagraphsHtml: [], representativeVoices: [], drivers: [], closing: '' },
  dashboardUrl: 'https://citizenecho.com/overview?agency=ap&ver=crisis',
};

const EPISODE: NonNullable<CrisisAlertRenderData['episode']> = {
  alertNumber: 3,
  openedAtLabel: '17 nov, 1:42 p.m.',
  daysOpen: 3,
  previousAtLabel: '18 nov, 2:00 p.m.',
  previous: { dayLabel: '18 nov', score: 0.524, totalMentions: 131, negativeCount: 60 },
  current: { dayLabel: '19 nov', score: 0.606, totalMentions: 158, negativeCount: 71 },
  peak: { score: 0.606, dayLabel: '19 nov' },
};

test('el primer aviso no lleva bloque de episodio', () => {
  const html = renderCrisisAlertHtml(BASE);
  assert.ok(!html.includes('Episodio abierto'));
  assert.ok(!html.includes('Reaviso'));
  assert.ok(html.includes('Abrir la vista de crisis'));
  assert.ok(html.includes('ver=crisis'));
});

test('el reaviso dice desde cuándo está abierto y qué cambió', () => {
  const html = renderCrisisAlertHtml({ ...BASE, episode: EPISODE });
  assert.ok(html.includes('Episodio abierto · aviso n.º 3'));
  assert.ok(html.includes('17 nov, 1:42 p.m.'));
  assert.ok(html.includes('(3 días)'));
  // 52 % → 61 %: el cambio se calcula sobre lo que se muestra.
  assert.ok(html.includes('+9 pts'));
  assert.ok(html.includes('Esta es la lectura más alta del episodio.'));
  assert.ok(!html.includes('p.m..'));
  assert.ok(html.includes('Detección de crisis · Reaviso'));
});

test('si la lectura más alta fue otro día, el reaviso lo dice', () => {
  const html = renderCrisisAlertHtml({ ...BASE, episode: { ...EPISODE, peak: { score: 0.71, dayLabel: '18 nov' } } });
  assert.ok(html.includes('La lectura más alta del episodio fue 71% (18 nov).'));
});

const CLOSE: CrisisCloseRenderData = {
  agencyName: 'Agencia de Prueba',
  agencyShortName: 'AP',
  closedAtLabel: '21 nov · 8:05 a.m. AST',
  openedAtLabel: '17 nov, 1:42 p.m.',
  daysOpen: 4,
  alertsSent: 4,
  closedDay: { dayLabel: '20 nov', score: 0.28, severity: 0.41, totalMentions: 74, negativeCount: 17 },
  peak: { score: 0.64, dayLabel: '19 nov' },
  threshold: 0.4,
  severityMin: 0.5,
  firstHeadline: 'Titular <del> primer aviso',
  dashboardUrl: 'https://citizenecho.com/overview?agency=ap&ver=crisis',
};

test('el cierre explica por qué se cerró, cuánto duró y cuántos avisos tuvo', () => {
  const html = renderCrisisCloseHtml(CLOSE);
  assert.ok(html.includes('EPISODIO CERRADO'));
  assert.ok(html.includes('El 20 nov cerró con el riesgo de crisis en 28%, bajo el umbral de 40%.'));
  assert.ok(html.includes('4 días'));
  assert.ok(html.includes('4 avisos'));
  assert.ok(html.includes('64%'));
  // El titular guardado se escapa.
  assert.ok(html.includes('Titular &lt;del&gt; primer aviso'));
});

test('motivo del cierre: severidad bajo el mínimo y día sin lectura', () => {
  assert.equal(
    crisisCloseReason({ ...CLOSE, closedDay: { ...CLOSE.closedDay, score: 0.45, severity: 0.3 } }),
    'El 20 nov cerró con el riesgo de crisis en 45%, pero con la severidad en 30%, bajo el mínimo de 50% que exige la regla.',
  );
  assert.equal(
    crisisCloseReason({ ...CLOSE, closedDay: { ...CLOSE.closedDay, score: null, totalMentions: 6 } }),
    'El 20 nov no hubo conversación suficiente para calcular el índice (6 menciones).',
  );
});

const INPUTS: CrisisEditorialInputs = {
  agencyName: 'Agencia de Prueba', agencyShortName: 'AP', generatedAtLabel: '19 nov · 2:05 p.m. AST',
  triggerDay: '2026-11-19', band: 'ALERTA',
  crisisRiskScore: 0.606, crisisRiskScore24hAgo: 0.524, crisisSeverity: 0.7,
  volumeVsAvg7Pct: 40, volumeAnomalyZscore: 1.2,
  totalMentions: 158, negativeCount: 71, negativeShare: 71 / 158, prevDayTotal: 131, prevDayNegative: 60,
  topNegativeTopics: [], topNegativeMunicipalities: [], sampleMentions: [],
};

test('el prompt del primer aviso no cambia; el del reaviso lleva el contexto', () => {
  const first = buildCrisisEditorialPrompt(INPUTS);
  assert.ok(!first.includes('REAVISO'));
  assert.ok(first.includes('BANDA ACTUAL: ALERTA\n\nINDICADORES DE CRISIS'));
  const again = buildCrisisEditorialPrompt({
    ...INPUTS,
    episode: { alertNumber: 2, openedDay: '2026-11-18', daysOpen: 2, previousDay: '2026-11-18', previousScore: 0.524 },
  });
  assert.ok(again.includes('ESTE CORREO ES UN REAVISO (aviso n.º 2)'));
  assert.ok(again.includes('Crisis Score 52%. Ahora: 61% (subió 9 puntos)'));
});

test('aviso por un día ya cerrado: lo dice arriba y en la línea de detección', () => {
  const html = renderCrisisAlertHtml({ ...BASE, triggerDayClosed: true });
  assert.ok(html.includes('Este aviso es por el 19 nov, un día ya cerrado.'));
  assert.ok(html.includes('día detonante 19 nov (cerrado)'));
  assert.ok(!renderCrisisAlertHtml(BASE).includes('un día ya cerrado'));
});

test('el prompt de un día cerrado no habla del día en curso', () => {
  const p = buildCrisisEditorialPrompt({ ...INPUTS, triggerDayClosed: true });
  assert.ok(p.includes('un día ya CERRADO (completo), NO el día en curso'));
  assert.ok(!p.includes('el día EN CURSO (parcial)'));
  assert.ok(buildCrisisEditorialPrompt(INPUTS).includes('el día EN CURSO (parcial)'));
});
