/**
 * Pruebas unitarias del motor, sin LLM: hechos, deltas con base mínima,
 * muestras anotadas, marcadores, lint y red de seguridad. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/composer/composer-units.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFactPackage, factsBlock, factDelta, resolvePrevTotals } from './facts';
import { buildLintContext, codeLint, fillDraft, fillPlaceholders, lintDraft } from './lint';
import { safetyNet, deterministicHeadline } from './safety-net';
import { annotateOne, annotateSamples, deriveSampleKind, sampleLine } from './samples';
import { findVetoed } from './vetoed';
import { FIXTURE_CONTEXT, FIXTURE_RAW, fixtureInput } from './test-fixtures';
import type { CodeDefect, Draft } from './types';

// ------------------------------------------------------------------ hechos

test('hechos: totales, día, posición, pico y serie', () => {
  const pkg = buildFactPackage(fixtureInput());
  const f = pkg.facts;
  assert.equal(f.week_total.value, 699);
  assert.equal(f.day_total.value, 64);
  assert.equal(f.day_total.label, 'menciones del domingo 1 de noviembre');
  assert.equal(f.prev_day_total.value, 28);
  assert.equal(f.day_delta_abs.display, '+36');
  assert.equal(f.day_rank.value, 6);
  assert.equal(f.day_rank.display, 'posición 6 de 7 por volumen');
  assert.equal(f.peak_total.value, 167);
  assert.match(f.peak_total.label, /miércoles 28 de octubre/);
  assert.equal(f['series_2026-10-27'].value, 155);
  assert.equal(f['series_2026-10-27_neg'].value, 12);
  assert.equal(f.week_neg_pct.display, '8 %');
  assert.equal(pkg.dayLabel, 'domingo 1 de noviembre');
  assert.equal(pkg.windowDays, 7);
});

test('hechos: composición de comentarios semana y previa', () => {
  const f = buildFactPackage(fixtureInput()).facts;
  assert.equal(f.comment_share_week.value, 83);
  assert.equal(f.comment_share_week.display, '83 %');
  assert.equal(f.comment_share_prev_week.value, 18);
  assert.equal(f.comments_week.value, 535);
});

test('deltas con base mínima: sin porcentaje si la base previa es < 30', () => {
  assert.deepEqual(factDelta(14, 58), { abs: 44, pct: null });
  assert.deepEqual(factDelta(30, 45), { abs: 15, pct: 50 });
  assert.deepEqual(factDelta(null, 45), { abs: null, pct: null });
  assert.deepEqual(factDelta(0, 5), { abs: 5, pct: null });
  const f = buildFactPackage(fixtureInput()).facts;
  // Negativas: base previa 14 → solo diferencia absoluta (nada de «+314 %»).
  assert.equal(f.week_neg_delta_pct, undefined);
  assert.equal(f.week_neg_delta_abs.display, '+44');
  // Positivas: base 12 → sin %, como el «+1050 %» del correo del 1-nov.
  assert.equal(f.week_pos_delta_pct, undefined);
  // Neutrales y total: base ≥ 30 → porcentaje.
  assert.equal(f.week_neu_delta_pct.value, 254);
  assert.equal(f.week_total_delta_pct.value, 316);
  // Día: base del día previo 28 < 30 → sin %.
  assert.equal(f.day_delta_pct, undefined);
});

test('totales previos estimados desde la variación cuando el caller no los trae', () => {
  const inp = fixtureInput();
  delete inp.prevTotals;
  inp.deltaVsPrev = { negative: 314.2857142857143, neutral: 253.5211267605634, positive: 1050 };
  inp.totals = { negative: 58, neutral: 502, positive: 138, total: 698 };
  const r = resolvePrevTotals(inp);
  assert.equal(r.source, 'estimated_from_delta');
  assert.deepEqual(r.prev, { negative: 14, neutral: 142, positive: 12, total: 168 });
  inp.deltaVsPrev = { negative: -100, neutral: 1, positive: 1 };
  assert.equal(resolvePrevTotals(inp).prev, null);
});

test('bloque de hechos con marcadores', () => {
  const b = factsBlock(buildFactPackage(fixtureInput()).facts);
  assert.match(b, /^- \{\{week_total\}\} = 699 {2}\(menciones pertinentes de los 7 días\)$/m);
});

// ------------------------------------------------------------------ muestras

test('tipo de mención: comentario FB, IG con #, nota de prensa, explícito', () => {
  assert.equal(deriveSampleKind({ id: 'x', createdAt: '', text: '', url: 'https://fb.com/1/posts/2#channels_comment' }), 'comment');
  assert.equal(deriveSampleKind({ id: 'x', createdAt: '', text: '', bwGuid: 'DfM60k#1799', pubType: 'INSTAGRAM_GRAPH_BUSINESS' }), 'comment');
  assert.equal(deriveSampleKind({ id: 'x', createdAt: '', text: '', pageType: 'news' }), 'article');
  assert.equal(deriveSampleKind({ id: 'x', createdAt: '', text: '', mentionKind: 'agency_post' }), 'agency_post');
  assert.equal(deriveSampleKind({ id: 'x', createdAt: '', text: '', author: 'desarrollopr' }, ['DesarrolloPR']), 'agency_post');
  assert.equal(deriveSampleKind({ id: 'x', createdAt: '', text: '', pageType: 'twitter' }), 'social_post');
});

test('comentario anotado: padre, fecha, días transcurridos y reacción tardía', () => {
  const a = annotateOne(FIXTURE_RAW.today[0], 'today', FIXTURE_CONTEXT.c1);
  assert.equal(a.isComment, true);
  assert.equal(a.dayLabel, 'domingo 1 de noviembre');
  assert.equal(a.parent?.dayLabel, 'lunes 26 de octubre');
  assert.equal(a.parent?.ageDays, 6);
  assert.equal(a.lateReaction, true);
  assert.match(a.text, /^¿Dónde queda la panadería\?/);
  const line = sampleLine({ ...a, sid: 'D1' });
  assert.match(line, /PUBLICACIÓN ORIGINAL de Departamento de Desarrollo Económico y Comercio del lunes 26 de octubre \(el comentario llegó 6 días después\) \| REACCIÓN TARDÍA/);
  assert.match(line, /\n {4}publicación: En el Mes de la Manufactura/);
});

test('día de escritura en hora PR, no UTC', () => {
  // 02:30 UTC del 1-nov = 22:30 del sábado 31-oct en PR.
  const a = annotateOne({ id: 'x', createdAt: '2026-11-01T02:30:00.000Z', text: 't', pageType: 'news' }, 'today');
  assert.equal(a.dayYmd, '2026-10-31');
  assert.equal(a.dayLabel, 'sábado 31 de octubre');
});

test('comentario sin padre: fecha desconocida, no es noticia del día', () => {
  const a = annotateOne({ id: 'x', createdAt: '2026-11-01T14:00:00.000Z', text: 'Bravo', url: 'https://fb.com/p#channels_comment' }, 'today');
  assert.equal(a.parent, null);
  assert.equal(a.lateReaction, false);
  assert.match(sampleLine({ ...a, sid: 'D9' }), /FECHA DESCONOCIDA/);
});

test('tope por hilo: 3 muestras por publicación original y «+N comentarios más»', () => {
  const set = annotateSamples(FIXTURE_RAW, FIXTURE_CONTEXT);
  const comments = set.today.filter((s) => s.isComment);
  assert.equal(comments.length, 3);
  assert.equal(set.droppedByThreadCap.today, 2);
  assert.equal(comments[2].moreInThread, 2);
  assert.equal(comments[0].moreInThread, undefined);
  assert.deepEqual(set.today.map((s) => s.sid), ['D1', 'D2', 'D3', 'D4']);
  assert.match(sampleLine(comments[2]), /\+2 comentarios más sobre esta publicación/);
  // Sin tope: todas.
  assert.equal(annotateSamples(FIXTURE_RAW, FIXTURE_CONTEXT, { maxPerThread: 0 }).today.length, 6);
});

// ------------------------------------------------------------------ marcadores y lint

test('marcadores: válidos se rellenan, inválidos se reportan', () => {
  const f = buildFactPackage(fixtureInput()).facts;
  const p: CodeDefect[] = [];
  assert.equal(fillPlaceholders('Hubo {{day_total}} menciones', f, 'párrafo', p), 'Hubo 64 menciones');
  assert.equal(fillPlaceholders('Hubo {{nope}} menciones', f, 'párrafo', p), 'Hubo  menciones');
  assert.equal(p.length, 1);
  assert.equal(p[0].type, 'marcador_invalido');
  assert.equal(fillPlaceholders('{{nope}}', f, 'x', [], true), '{{nope}}');
});

test('vetados: insensible a mayúsculas y por palabra completa', () => {
  assert.deepEqual(findVetoed('El Senado APRIETA a la secretaria'), ['aprieta']);
  assert.deepEqual(findVetoed('Fortaleza se   deslinda de Roig'), ['se deslinda']);
  assert.deepEqual(findVetoed('Bajo la lupa'), ['bajo la lupa']);
  assert.deepEqual(findVetoed('Al frente del Departamento sigue la secretaria'), []);
  assert.deepEqual(findVetoed('disparates y sobrevivencia'), []);
});

test('lint: cifras sin fuente, permitidas y lista blanca de nombres', () => {
  const inp = fixtureInput();
  const pkg = buildFactPackage(inp);
  const ctx = buildLintContext(pkg, inp.samples);
  const types = (t: string) => codeLint(t, 'x', ctx).map((d) => `${d.type}:${d.quote}`);
  assert.deepEqual(types('Hubo 64 menciones el domingo 1 de noviembre de 2026.'), []);
  assert.deepEqual(types('El pico fue el miércoles 28, con 167 menciones en 7 días.'), []);
  assert.deepEqual(types('Las negativas subieron +44 y el 83 % fueron comentarios.'), []);
  assert.deepEqual(types('En Contacto 787 Tv habló de la Ley 60.'), []);
  assert.deepEqual(types('Al menos 41 usuarios preguntaron.'), ['cifra_sin_fuente:41']);
  assert.deepEqual(types('Seis días después llegaron 3.5 veces más.'), ['cifra_sin_fuente:3.5']);
  assert.deepEqual(types('El Senado aprieta.'), ['tono_dramatico:aprieta']);
  assert.deepEqual(types('Quedó {{x}} así.'), ['marcador_invalido:{{x}}']);
});

test('lint del borrador: titular largo es aviso blando', () => {
  const inp = fixtureInput();
  const pkg = buildFactPackage(inp);
  const ctx = buildLintContext(pkg, inp.samples);
  const d: Draft = {
    headline: 'Uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciséis diecisiete',
    paragraph: 'Texto limpio.', highlights: [],
  };
  const probs = lintDraft(d, ctx);
  assert.equal(probs.length, 1);
  assert.equal(probs[0].type, 'titular_largo');
  assert.equal(probs[0].severity, 'soft');
});

// ------------------------------------------------------------------ red de seguridad

test('red de seguridad: quita frases e ítems con defectos y reemplaza el titular', () => {
  const inp = fixtureInput();
  const pkg = buildFactPackage(inp);
  const ctx = buildLintContext(pkg, inp.samples);
  const raw: Draft = {
    headline: 'El Senado aprieta a la agencia',
    paragraph: 'Hubo {{day_total}} menciones. Al menos 41 usuarios preguntaron por la panadería. La agencia publicó un mensaje.',
    highlights: ['Varios usuarios preguntaron dónde queda la panadería.', 'Una ola que dispara las críticas.'],
    insights: { negative: ['Un abogado advirtió lagunas en la reforma.'], neutral: ['Quedan {{inexistente}} dudas.'], positive: [] },
  };
  const { filled } = fillDraft(raw, pkg.facts, { keepInvalid: true });
  const { draft, log } = safetyNet(filled, pkg, ctx);
  assert.equal(draft.paragraph, 'Hubo 64 menciones. La agencia publicó un mensaje.');
  assert.deepEqual(draft.highlights, ['Varios usuarios preguntaron dónde queda la panadería.']);
  assert.deepEqual(draft.insights?.neutral, []);
  assert.deepEqual(draft.insights?.negative, ['Un abogado advirtió lagunas en la reforma.']);
  assert.equal(draft.headline, 'Domingo 1 de noviembre: 64 menciones, 4 negativas y 6 positivas');
  assert.equal(draft.headline, deterministicHeadline(pkg));
  assert.deepEqual(log.map((l) => l.action).sort(), ['frase_removida', 'item_removido', 'item_removido', 'titular_reemplazado']);
  // Lo que queda pasa el lint sin residuos duros.
  assert.deepEqual(lintDraft(draft, ctx).filter((p) => p.severity === 'hard'), []);
});

test('red de seguridad: párrafo vacío se reemplaza por uno determinista', () => {
  const inp = fixtureInput();
  const pkg = buildFactPackage(inp);
  const ctx = buildLintContext(pkg, inp.samples);
  const { draft, log } = safetyNet({ headline: 'Usuarios preguntaron por la panadería del lunes 26', paragraph: 'Hubo 999 menciones.', highlights: [] }, pkg, ctx);
  assert.match(draft.paragraph, /^El domingo 1 de noviembre hubo 64 menciones pertinentes/);
  assert.equal(draft.headline, 'Usuarios preguntaron por la panadería del lunes 26');
  assert.ok(log.some((l) => l.action === 'parrafo_reemplazado'));
});

test('red de seguridad: texto limpio no cambia', () => {
  const inp = fixtureInput();
  const pkg = buildFactPackage(inp);
  const ctx = buildLintContext(pkg, inp.samples);
  const d: Draft = { headline: 'Comentarios tardíos a la publicación del lunes 26 dominaron el domingo', paragraph: 'Hubo 64 menciones. El pico fue el miércoles 28.', highlights: ['Un usuario preguntó la dirección.'] };
  const { draft, log } = safetyNet(d, pkg, ctx);
  assert.deepEqual(draft, d);
  assert.deepEqual(log, []);
});
