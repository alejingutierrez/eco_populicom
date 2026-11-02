/**
 * Composición del volumen y variaciones con base mínima.
 *   node_modules/.bin/tsx --test packages/shared/src/aggregations/composition.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_DELTA_BASE, commentMentionSql, commentShare, computeCommentShare, dayPosition,
  isCommentMention, minBaseDelta,
} from './composition';
import { isInUniverse } from '../universe';
import {
  DDEC_CUR_GROUPS, DDEC_DAILY_SERIES, DDEC_PREV_GROUPS, DF_CUR_GROUPS, DF_PREV_GROUPS, expandGroups,
} from './fixtures/universe-groups-2026-10';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function shareOf(groups: Parameters<typeof expandGroups>[0]) {
  const universe = expandGroups(groups).filter(isInUniverse);
  const comments = universe.filter((m) => isCommentMention({ url: m.url, bw_guid: m.bw_guid, page_type: m.page_type })).length;
  return computeCommentShare(comments, universe.length);
}

// ---------- minBaseDelta ----------

test('minBaseDelta: base previa < 30 → solo diferencia absoluta (evita «+1400 %»)', () => {
  // DDEC 25–31 oct vs 18–24: positivas 9 → 135, negativas 12 → 56.
  const pos = minBaseDelta(9, 135);
  assert.equal(pos.abs, 126);
  assert.equal(pos.pct, null);
  const neg = minBaseDelta(12, 56);
  assert.equal(neg.abs, 44);
  assert.equal(neg.pct, null);
});

test('minBaseDelta: base previa ≥ 30 → porcentaje (neutrales DDEC +232.8 %, total +309.5 %)', () => {
  const neu = minBaseDelta(137, 456);
  assert.equal(neu.abs, 319);
  assert.ok(Math.abs(neu.pct! - 232.84671532846716) < 1e-9);
  const total = minBaseDelta(158, 647);
  assert.ok(Math.abs(total.pct! - 309.49367088607596) < 1e-9);
  // DF: bajó. Signo preservado.
  const df = minBaseDelta(928, 362);
  assert.equal(df.abs, -566);
  assert.ok(Math.abs(df.pct! - -60.991379310344826) < 1e-9);
});

test('minBaseDelta: frontera exacta en minBase y valor por defecto 30', () => {
  assert.equal(MIN_DELTA_BASE, 30);
  assert.equal(minBaseDelta(29, 58).pct, null);
  assert.equal(minBaseDelta(30, 60).pct, 100);
  assert.equal(minBaseDelta(10, 20, 10).pct, 100);
  assert.equal(minBaseDelta(9, 20, 10).pct, null);
  assert.equal(minBaseDelta(30, 60).minBase, 30);
});

test('minBaseDelta: base 0 nunca da porcentaje, ni con minBase 0', () => {
  assert.equal(minBaseDelta(0, 50).pct, null);
  assert.equal(minBaseDelta(0, 50, 0).pct, null);
  assert.equal(minBaseDelta(0, 0).abs, 0);
});

// ---------- comentarios ----------

test('isCommentMention: #channels_comment de Facebook y guid de IG con #', () => {
  assert.equal(isCommentMention({ url: 'https://www.facebook.com/1553736176780709#channels_comment_1637286711310390', page_type: 'facebook' }), true);
  assert.equal(isCommentMention({ url: 'https://www.instagram.com/p/X/', bw_guid: '1790#1780', page_type: 'instagram' }), true);
  assert.equal(isCommentMention({ url: 'https://www.instagram.com/p/X/', bwGuid: '1790#1780', pageType: 'instagram_public' }), true);
  // La publicación original de IG no trae # en el guid.
  assert.equal(isCommentMention({ url: 'https://www.instagram.com/p/X/', bw_guid: '1790', page_type: 'instagram' }), false);
  // Un # en el guid de otra plataforma no es comentario de IG.
  assert.equal(isCommentMention({ url: 'https://x.com/a', bw_guid: 'a#b', page_type: 'twitter' }), false);
  assert.equal(isCommentMention({ url: 'https://elnuevodia.com/n', page_type: 'news' }), false);
  assert.equal(isCommentMention({}), false);
});

test('commentMentionSql: ambas condiciones y alias normalizado', () => {
  const sql = squash(commentMentionSql('m'));
  assert.equal(sql, squash(commentMentionSql('m.')));
  assert.match(sql, /strpos\(COALESCE\(m\.url, ''\), '#channels_comment'\) > 0/);
  assert.match(sql, /m\.page_type ILIKE '%instagram%'/);
  assert.match(sql, /strpos\(COALESCE\(m\.bw_guid, ''\), '#'\) > 0/);
});

test('commentShare real: DDEC 25–31 oct = 536 de 647 (82.8 %), la previa 27 de 158', () => {
  const cur = shareOf(DDEC_CUR_GROUPS);
  assert.equal(cur.total, 647);
  assert.equal(cur.comments, 536);
  assert.ok(Math.abs(cur.pct - 82.84389489953632) < 1e-9);
  const prev = shareOf(DDEC_PREV_GROUPS);
  assert.deepEqual([prev.comments, prev.total], [27, 158]);
});

test('commentShare real: DF casi no tiene comentarios (0 de 362; previa 2 de 928)', () => {
  assert.deepEqual([shareOf(DF_CUR_GROUPS).comments, shareOf(DF_CUR_GROUPS).total], [0, 362]);
  assert.deepEqual([shareOf(DF_PREV_GROUPS).comments, shareOf(DF_PREV_GROUPS).total], [2, 928]);
});

test('computeCommentShare: ventana vacía = 0 %, sin NaN', () => {
  assert.deepEqual(computeCommentShare(0, 0), { comments: 0, total: 0, pct: 0 });
});

test('commentShare(client, …): una query con universo ESTRICTO, día PR y parámetros de la ventana', async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rows: [{ total: 647, comments: 536 }] as any[] };
    },
  };
  const r = await commentShare(client, 'agency-1', { startYmd: '2026-10-25', endYmd: '2026-10-31' });
  assert.equal(r.comments, 536);
  assert.equal(r.total, 647);
  assert.equal(calls.length, 1);
  const sql = squash(calls[0].sql);
  assert.match(sql, /m\.is_duplicate = false AND m\.nlp_pertinence IN \('alta','media'\)/);
  assert.doesNotMatch(sql, /IS NULL OR/);
  assert.match(sql, /AT TIME ZONE 'America\/Puerto_Rico'\)::date >= \(\$2::date\)/);
  assert.deepEqual(calls[0].params, ['agency-1', '2026-10-25', '2026-10-31']);
});

// ---------- posición del día ----------

test('dayPosition: DDEC 31 oct fue el penúltimo día en volumen (6 de 7); el pico fue el 28', () => {
  const p = dayPosition(DDEC_DAILY_SERIES, '2026-10-31')!;
  assert.equal(p.total, 28);
  assert.equal(p.rank, 6); // solo el 25-oct (13) tuvo menos
  assert.equal(p.of, 7);
  assert.deepEqual(p.peak, { date: '2026-10-28', total: 167 });
  // vs el día previo (30 oct: 36 menciones, base ≥ 30 → hay porcentaje).
  assert.equal(p.vsPreviousDay!.prev, 36);
  assert.equal(p.vsPreviousDay!.abs, -8);
  assert.ok(Math.abs(p.vsPreviousDay!.pct! - (-8 / 36) * 100) < 1e-9);
});

test('dayPosition: primer día sin comparación; día fuera de la serie = null; base chica sin %', () => {
  const first = dayPosition(DDEC_DAILY_SERIES, '2026-10-25')!;
  assert.equal(first.vsPreviousDay, null);
  assert.equal(dayPosition(DDEC_DAILY_SERIES, '2026-11-15'), null);
  // 25 oct (13) → 26 oct (100): la base de 13 < 30 → solo diferencia absoluta.
  const d26 = dayPosition(DDEC_DAILY_SERIES, '2026-10-26')!;
  assert.equal(d26.vsPreviousDay!.pct, null);
  assert.equal(d26.vsPreviousDay!.abs, 87);
});
