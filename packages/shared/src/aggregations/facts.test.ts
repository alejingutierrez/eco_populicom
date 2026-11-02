/**
 * Paquete de hechos: particiones que suman el universo, banderas del universo
 * y SQL emitido.
 *   node_modules/.bin/tsx --test packages/shared/src/aggregations/facts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_MUNICIPALITY, buildUniverseFacts, checkFactsConsistency, foldMunicipalityRows,
  loadUniverseCoverage, type UniverseFacts,
} from './facts';
import { buildSentimentReport } from './sentiment-report';
import { buildReportDetail, type ChannelRow } from './report-detail';
import { loadAggregatesForWindow } from '../metrics';
import { sourceKey, sourceLabel } from '../sources';
import { isInUniverse } from '../universe';
import {
  DDEC_CUR_GROUPS, DDEC_DAILY_SERIES, DDEC_LEGACY_TOP_SOURCES, DDEC_MUNICIPALITY_ROWS,
  DDEC_TOPICS_TABLE, expandGroups,
} from './fixtures/universe-groups-2026-10';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cliente de prueba: registra cada query y responde con `rows` (vacío por defecto). */
function recordingClient(respond?: (sql: string, params: unknown[]) => any[] | undefined) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rows: respond?.(sql, params) ?? [] };
    },
  };
}

/** Fuentes del universo por canal, calculadas con las MISMAS reglas de sources.ts. */
function sourcesFromFixture(): ChannelRow[] {
  const byKey = new Map<string, ChannelRow>();
  for (const m of expandGroups(DDEC_CUR_GROUPS).filter(isInUniverse)) {
    const key = sourceKey(m.page_type);
    const row = byKey.get(key) ?? { key, label: sourceLabel(key), total: 0, negative: 0, neutral: 0, positive: 0, engagement: 0, reach: 0 };
    row.total++;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total);
}

function ddecFacts(overrides: Partial<UniverseFacts> = {}) {
  return {
    coverage: { inUniverse: 647, low: 153, pending: 0, duplicates: 87 },
    totals: { negative: 56, neutral: 456, positive: 135, total: 647 },
    dailySeries: DDEC_DAILY_SERIES,
    topics: DDEC_TOPICS_TABLE,
    sources: sourcesFromFixture(),
    municipalities: foldMunicipalityRows(DDEC_MUNICIPALITY_ROWS),
    ...overrides,
  };
}

// ---------- particiones = universo (DDEC 25–31 oct) ----------

test('DDEC 25–31 oct: fuentes, municipios, tópicos y serie diaria suman EL MISMO 647', () => {
  const f = ddecFacts();
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assert.equal(sum(f.sources.map((s) => s.total)), 647);
  assert.equal(sum(f.municipalities.map((m) => m.total)), 647);
  assert.equal(sum(f.topics.map((t) => t.total)), 647);
  assert.equal(sum(f.dailySeries.map((d) => d.negative + d.neutral + d.positive)), 647);
  assert.deepEqual(checkFactsConsistency(f), []);
});

test('fuentes del universo por canal (los cinco canales del correo del 1-nov)', () => {
  const byLabel = Object.fromEntries(sourcesFromFixture().map((s) => [s.label, s.total]));
  assert.deepEqual(byLabel, { Facebook: 412, Instagram: 199, Noticias: 27, linkedin: 8, Blogs: 1 });
});

test('el agregado anterior de fuentes (sin filtro) sumaba 795 y checkFactsConsistency lo detecta', () => {
  const legacySum = DDEC_LEGACY_TOP_SOURCES.reduce((s, x) => s + x.mentions, 0);
  assert.equal(legacySum, 795);
  const legacySources = DDEC_LEGACY_TOP_SOURCES.map((x) => ({
    key: x.source, label: x.source, total: x.mentions, negative: 0, neutral: 0, positive: 0, engagement: 0, reach: 0,
  }));
  const issues = checkFactsConsistency(ddecFacts({ sources: legacySources }));
  assert.deepEqual(issues, [{ what: 'sum(sources.total)', expected: 647, actual: 795 }]);
});

test('checkFactsConsistency: señala cada partición que no suma (serie, tópicos, municipios, totales)', () => {
  const issues = checkFactsConsistency(ddecFacts({
    totals: { negative: 56, neutral: 456, positive: 134, total: 646 }, // una mención sin sentimiento
    topics: DDEC_TOPICS_TABLE.slice(0, -1),
  }));
  assert.deepEqual(issues.map((i) => i.what).sort(), ['sum(topics.total)', 'totals.total (neg+neu+pos)'].sort());
});

// ---------- municipios ----------

test('foldMunicipalityRows: partición con «Sin municipio» al final y regiones saneadas', () => {
  const folded = foldMunicipalityRows(DDEC_MUNICIPALITY_ROWS);
  const last = folded[folded.length - 1];
  assert.equal(last.name, NO_MUNICIPALITY);
  assert.equal(last.isUnassigned, true);
  assert.equal(last.total, 447);
  assert.equal(folded[0].name, 'San Juan');
  assert.equal(folded[0].total, 126);
  // Las filas asignadas vienen ordenadas por volumen descendente.
  const assigned = folded.filter((m) => !m.isUnassigned);
  for (let i = 1; i < assigned.length; i++) assert.ok(assigned[i - 1].total >= assigned[i].total);
  // Sentimientos plegados: negativo+neutral+positivo = total en cada fila.
  for (const m of folded) assert.equal(m.negative + m.neutral + m.positive, m.total);
});

test('foldMunicipalityRows: varias filas del mismo municipio se acumulan; sentimiento desconocido no suma', () => {
  const folded = foldMunicipalityRows([
    { name: 'Aibonito', region: 'Centro', s: 'negativo', c: 3 },
    { name: 'Aibonito', region: 'Centro', s: 'neutral', c: 14 },
    { name: 'Aibonito', region: 'Centro', s: null, c: 1 },
    { name: null, region: null, s: 'positivo', c: 2 },
  ]);
  assert.deepEqual(folded[0], { name: 'Aibonito', region: 'Centro', total: 18, negative: 3, neutral: 14, positive: 0 });
  assert.equal(folded[1].name, NO_MUNICIPALITY);
});

// ---------- SQL y banderas ----------

test('buildUniverseFacts: TODA query usa el universo estricto y el día PR; ninguna el filtro histórico', async () => {
  const client = recordingClient();
  const w = { startYmd: '2026-10-25', endYmd: '2026-10-31', prevStartYmd: '2026-10-18', prevEndYmd: '2026-10-24' };
  const f = await buildUniverseFacts(client, 'agency-1', w);

  assert.ok(client.calls.length >= 9, `se esperaban ≥ 9 queries, hubo ${client.calls.length}`);
  for (const { sql } of client.calls) {
    const s = squash(sql);
    assert.match(s, /is_duplicate = false AND (m\.)?nlp_pertinence IN \('alta','media'\)/, s.slice(0, 120));
    assert.doesNotMatch(s, /nlp_pertinence IS NULL OR/);
    assert.doesNotMatch(s, /published_at >= \(\$2::date\)/); // día UTC: prohibido
    assert.match(s, /AT TIME ZONE 'America\/Puerto_Rico'/);
  }
  // Vacío no rompe nada: ceros, sin NaN.
  assert.equal(f.totals.total, 0);
  assert.equal(f.commentShare.pct, 0);
  assert.equal(f.deltas.total.pct, null);
  assert.deepEqual(f.municipalities, []);
  assert.equal(f.authors.restMentions, 0);
});

test('buildUniverseFacts con los números reales de DDEC: variaciones con base mínima y composición', async () => {
  const curWindow = (params: unknown[]) => params[1] === '2026-10-25';
  const client = recordingClient((sql, params) => {
    const s = squash(sql);
    if (s.includes('FILTER (WHERE m.is_duplicate = true)')) {
      return [{ in_universe: 647, low: 153, pending: 0, duplicates: 87 }];
    }
    if (s.includes("strpos(COALESCE(m.url, ''), '#channels_comment')")) {
      return curWindow(params) ? [{ total: 647, comments: 536 }] : [{ total: 158, comments: 27 }];
    }
    // loadTotals: SELECT COALESCE(nlp_sentiment, bw_sentiment) AS s, COUNT(*) … GROUP BY 1
    if (s.startsWith('SELECT COALESCE(nlp_sentiment, bw_sentiment) AS s') && s.endsWith('GROUP BY 1')) {
      return curWindow(params)
        ? [{ s: 'negativo', c: 56 }, { s: 'neutral', c: 456 }, { s: 'positivo', c: 135 }]
        : [{ s: 'negativo', c: 12 }, { s: 'neutral', c: 137 }, { s: 'positivo', c: 9 }];
    }
    return undefined;
  });
  const f = await buildUniverseFacts(client, 'agency-1', {
    startYmd: '2026-10-25', endYmd: '2026-10-31', prevStartYmd: '2026-10-18', prevEndYmd: '2026-10-24',
  });
  assert.deepEqual(f.coverage, { inUniverse: 647, low: 153, pending: 0, duplicates: 87 });
  assert.deepEqual(f.totals, { negative: 56, neutral: 456, positive: 135, total: 647 });
  assert.deepEqual(f.prevTotals, { negative: 12, neutral: 137, positive: 9, total: 158 });
  // Negativas (base 12) y positivas (base 9): solo diferencia absoluta; neutrales y total (base ≥ 30): porcentaje.
  assert.deepEqual([f.deltas.negative.abs, f.deltas.negative.pct], [44, null]);
  assert.deepEqual([f.deltas.positive.abs, f.deltas.positive.pct], [126, null]);
  assert.ok(Math.abs(f.deltas.neutral.pct! - 232.84671532846716) < 1e-9);
  assert.ok(Math.abs(f.deltas.total.pct! - 309.49367088607596) < 1e-9);
  // Composición: 536 de 647 son comentarios (82.8 %); la semana previa, 27 de 158 (17.1 %).
  assert.deepEqual([f.commentShare.comments, f.commentShare.total], [536, 647]);
  assert.ok(Math.abs(f.commentShare.pct - 82.84389489953632) < 1e-9);
  assert.deepEqual([f.prevCommentShare.comments, f.prevCommentShare.total], [27, 158]);
  assert.ok(Math.abs(f.prevCommentShare.pct - 17.088607594936708) < 1e-9);
});

test('loadUniverseCoverage: cuenta por separado baja, pendientes (P1) y duplicadas', async () => {
  const client = recordingClient(() => [{ in_universe: '647', low: '153', pending: '4', duplicates: '87' }]);
  const c = await loadUniverseCoverage(client, 'agency-1', '2026-10-25', '2026-10-31');
  assert.deepEqual(c, { inUniverse: 647, low: 153, pending: 4, duplicates: 87 });
  const s = squash(client.calls[0].sql);
  assert.match(s, /m\.nlp_pertinence IS NULL\)::int AS pending/);
  assert.match(s, /m\.nlp_pertinence = 'baja'\)::int AS low/);
  assert.deepEqual(client.calls[0].params, ['agency-1', '2026-10-25', '2026-10-31']);
});

test('bandera apagada: buildSentimentReport, buildReportDetail y loadAggregatesForWindow siguen con el filtro HISTÓRICO', async () => {
  const legacy = /is_duplicate = false AND \(\w*\.?nlp_pertinence IS NULL OR \w*\.?nlp_pertinence <> 'baja'\)/;

  const c1 = recordingClient();
  await buildSentimentReport(c1, 'a', '2026-10-25', '2026-10-31', '2026-10-18', '2026-10-24');
  assert.ok(c1.calls.length >= 4);
  for (const { sql } of c1.calls) {
    assert.match(squash(sql), legacy);
    assert.doesNotMatch(sql, /IN \('alta','media'\)/);
  }

  const c2 = recordingClient();
  await buildReportDetail(c2, 'a', '2026-10-25', '2026-10-31', []);
  assert.ok(c2.calls.length >= 10);
  for (const { sql } of c2.calls.filter((c) => /FROM mentions/.test(c.sql))) {
    assert.match(squash(sql), legacy);
    assert.doesNotMatch(sql, /IN \('alta','media'\)/);
  }

  const zeros = Object.fromEntries([
    'total_mentions', 'positive_count', 'neutral_count', 'negative_count', 'high_pertinence_count',
    'relevant_mentions_count', 'relevant_negative_count', 'total_likes', 'total_comments', 'total_shares',
    'total_reach', 'total_impact', 'total_engagement_score',
  ].map((k) => [k, 0]));
  const c3 = recordingClient(() => [zeros]);
  await loadAggregatesForWindow(c3, 'a', '2026-10-25', '2026-10-31');
  assert.match(squash(c3.calls[0].sql), legacy);
});

test('bandera encendida: las mismas funciones pasan al universo ESTRICTO sin cambiar firma de resultado', async () => {
  const strict = /is_duplicate = false AND (m\.)?nlp_pertinence IN \('alta','media'\)/;
  const opts = { strictUniverse: true };

  const c1 = recordingClient();
  await buildSentimentReport(c1, 'a', '2026-10-25', '2026-10-31', '2026-10-18', '2026-10-24', opts);
  for (const { sql } of c1.calls) {
    assert.match(squash(sql), strict);
    assert.doesNotMatch(sql, /IS NULL OR/);
  }

  const c2 = recordingClient();
  await buildReportDetail(c2, 'a', '2026-10-25', '2026-10-31', [], opts);
  for (const { sql } of c2.calls.filter((c) => /FROM mentions/.test(c.sql))) {
    assert.match(squash(sql), strict);
  }

  const zeros = Object.fromEntries([
    'total_mentions', 'positive_count', 'neutral_count', 'negative_count', 'high_pertinence_count',
    'relevant_mentions_count', 'relevant_negative_count', 'total_likes', 'total_comments', 'total_shares',
    'total_reach', 'total_impact', 'total_engagement_score',
  ].map((k) => [k, 0]));
  const c3 = recordingClient(() => [zeros]);
  await loadAggregatesForWindow(c3, 'a', '2026-10-25', '2026-10-31', opts);
  assert.match(squash(c3.calls[0].sql), strict);
});

test('buildSentimentReport: totales y deltas no cambian de forma con la bandera (solo el SQL)', async () => {
  const rows = (sql: string) => {
    if (/GROUP BY 1\s*$/.test(squash(sql)) || squash(sql).endsWith('GROUP BY 1')) {
      return [{ s: 'negativo', c: 56 }, { s: 'neutral', c: 456 }, { s: 'positivo', c: 135 }];
    }
    return [];
  };
  const a = await buildSentimentReport(recordingClient(rows), 'a', '2026-10-25', '2026-10-31', '2026-10-18', '2026-10-24');
  const b = await buildSentimentReport(recordingClient(rows), 'a', '2026-10-25', '2026-10-31', '2026-10-18', '2026-10-24', { strictUniverse: true });
  assert.deepEqual(a, b);
  assert.deepEqual(a.totals, { negative: 56, neutral: 456, positive: 135, total: 647 });
});
