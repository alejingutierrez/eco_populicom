/**
 * Universo pertinente único (spec interpretación v1, sección 8).
 * Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/universe.test.ts
 *
 * Los números son los REALES de producción (fixtures de agregados): DDEC
 * 25–31 oct (647 = 456 neu + 56 neg + 135 pos, el correo del 1-nov) y DF
 * 26 oct–1 nov (362 = 166 neu + 195 neg + 1 pos, el correo del 2-nov).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNIVERSE_PERTINENCES,
  isInUniverse,
  pertinentUniverseSql,
  universeFilterSql,
} from './universe';
import {
  DDEC_CUR_GROUPS, DDEC_PREV_GROUPS, DF_CUR_GROUPS, DF_PREV_GROUPS, expandGroups,
} from './aggregations/fixtures/universe-groups-2026-10';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function sentimentTotals(rows: ReturnType<typeof expandGroups>, pred: (m: (typeof rows)[number]) => boolean) {
  const t = { negativo: 0, neutral: 0, positivo: 0, total: 0 };
  for (const m of rows) {
    if (!pred(m)) continue;
    t.total++;
    if (m.sentiment === 'negativo' || m.sentiment === 'neutral' || m.sentiment === 'positivo') t[m.sentiment]++;
  }
  return t;
}

// ---------- SQL ----------

test('pertinentUniverseSql: predicado único, sin OR, alias opcional', () => {
  assert.equal(
    pertinentUniverseSql(),
    "is_duplicate = false AND nlp_pertinence IN ('alta','media')",
  );
  assert.equal(pertinentUniverseSql('m'), pertinentUniverseSql('m.'));
  assert.equal(
    pertinentUniverseSql('m.'),
    "m.is_duplicate = false AND m.nlp_pertinence IN ('alta','media')",
  );
  // Insertable tras un AND sin paréntesis: nada de OR ni de IS NULL (P1).
  assert.doesNotMatch(pertinentUniverseSql(), /\bOR\b|IS NULL/i);
  assert.deepEqual([...UNIVERSE_PERTINENCES], ['alta', 'media']);
});

test('universeFilterSql sin opciones es el filtro HISTÓRICO (bandera apagada = idéntico a hoy)', () => {
  assert.equal(
    squash(universeFilterSql()),
    "AND is_duplicate = false AND (nlp_pertinence IS NULL OR nlp_pertinence <> 'baja')",
  );
  assert.equal(
    squash(universeFilterSql(undefined, 'm.')),
    "AND m.is_duplicate = false AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')",
  );
  // includeLowPertinence sin strict: solo duplicados (como el pertinentSql anterior).
  assert.equal(squash(universeFilterSql({ includeLowPertinence: true })), 'AND is_duplicate = false');
  assert.equal(squash(universeFilterSql({ strictUniverse: false })), squash(universeFilterSql()));
});

test('universeFilterSql estricto = predicado de v1; NULL nunca entra', () => {
  assert.equal(
    universeFilterSql({ strictUniverse: true }, 'm.'),
    `AND ${pertinentUniverseSql('m.')}`,
  );
  const withLow = universeFilterSql({ strictUniverse: true, includeLowPertinence: true });
  assert.match(withLow, /IN \('alta','media','baja'\)/);
  assert.doesNotMatch(withLow, /IS NULL/);
});

// ---------- predicado en memoria ----------

test('isInUniverse: tabla de verdad (alta/media sí; baja, NULL y duplicadas no)', () => {
  assert.equal(isInUniverse({ is_duplicate: false, nlp_pertinence: 'alta' }), true);
  assert.equal(isInUniverse({ is_duplicate: false, nlp_pertinence: 'media' }), true);
  assert.equal(isInUniverse({ is_duplicate: false, nlp_pertinence: 'baja' }), false);
  assert.equal(isInUniverse({ is_duplicate: false, nlp_pertinence: null }), false); // P1
  assert.equal(isInUniverse({ is_duplicate: false }), false);
  assert.equal(isInUniverse({ is_duplicate: true, nlp_pertinence: 'alta' }), false);
  // camelCase (Drizzle) y alias `pertinence` de las muestras.
  assert.equal(isInUniverse({ isDuplicate: false, nlpPertinence: 'media' }), true);
  assert.equal(isInUniverse({ isDuplicate: true, nlpPertinence: 'media' }), false);
  assert.equal(isInUniverse({ pertinence: 'alta' }), true);
  // Comparación exacta, como el SQL: sin normalizar mayúsculas.
  assert.equal(isInUniverse({ nlp_pertinence: 'Alta' }), false);
});

// ---------- números reales ----------

test('DDEC 25–31 oct: el predicado reproduce 647 / 456 neu / 56 neg / 135 pos', () => {
  const t = sentimentTotals(expandGroups(DDEC_CUR_GROUPS), isInUniverse);
  assert.deepEqual(t, { negativo: 56, neutral: 456, positivo: 135, total: 647 });
});

test('DDEC 18–24 oct (previa): 158 = 137 neu + 12 neg + 9 pos', () => {
  const t = sentimentTotals(expandGroups(DDEC_PREV_GROUPS), isInUniverse);
  assert.deepEqual(t, { negativo: 12, neutral: 137, positivo: 9, total: 158 });
});

test('DF 26 oct–1 nov: 362 / 166 neu / 195 neg / 1 pos', () => {
  const t = sentimentTotals(expandGroups(DF_CUR_GROUPS), isInUniverse);
  assert.deepEqual(t, { negativo: 195, neutral: 166, positivo: 1, total: 362 });
});

test('DF 19–25 oct (previa): 928 = 301 neu + 623 neg + 4 pos', () => {
  const t = sentimentTotals(expandGroups(DF_PREV_GROUPS), isInUniverse);
  assert.deepEqual(t, { negativo: 623, neutral: 301, positivo: 4, total: 928 });
});

test('duplicadas y pertinencia baja quedan fuera: DDEC tenía 153 baja y 87 duplicadas en la ventana', () => {
  const rows = expandGroups(DDEC_CUR_GROUPS);
  const nonDup = rows.filter((m) => !m.is_duplicate);
  assert.equal(nonDup.filter((m) => m.nlp_pertinence === 'baja').length, 153);
  assert.equal(rows.filter((m) => m.is_duplicate).length, 87);
  assert.equal(nonDup.length - 153, 647);
});

test('diferencia con el universo histórico: solo las filas con pertinencia NULL (0 en estas ventanas)', () => {
  const legacy = (m: { is_duplicate: boolean; nlp_pertinence: string | null }) =>
    !m.is_duplicate && (m.nlp_pertinence === null || m.nlp_pertinence !== 'baja');
  for (const groups of [DDEC_CUR_GROUPS, DDEC_PREV_GROUPS, DF_CUR_GROUPS, DF_PREV_GROUPS]) {
    const rows = expandGroups(groups);
    assert.equal(rows.filter((m) => !m.is_duplicate && m.nlp_pertinence === null).length, 0);
    assert.equal(rows.filter(legacy).length, rows.filter(isInUniverse).length);
  }
  // Con 5 menciones pendientes de NLP, el histórico las contaría y v1 no (P1).
  const pending = Array.from({ length: 5 }, () => ({ is_duplicate: false, nlp_pertinence: null as string | null }));
  assert.equal(pending.filter(legacy).length, 5);
  assert.equal(pending.filter(isInUniverse).length, 0);
});
