import { gradeRecord, summarizeVariant } from '@eco/shared/src/advisor/eval/grade';
import { memoOf } from '@eco/shared/src/advisor/fake-llm';
import type { RunRecord } from '@eco/shared/src/advisor/eval/types';

const U = { inputNew: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 90, output: 20 };
const ctx = { manual: 'M-116 M-21 G-1 L-5', legal: 'LC-5', vedaActiva: false };

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  variant: 'c', caseId: 'e1:q1', episodeId: 'e1', rep: 0, status: 'done',
  memo: { ...memoOf(2, 0, ['C0-1', 'C0-2']), vetos: [{ asiento: 'legal', texto: 'V1/W2: publicidad en veda', estado: 'sin_resolver' }] },
  calls: [{ model: 'm', stopReason: 'end_turn', usage: U, ms: 5 }], costUsd: 0.5, unpricedCalls: 0, citations: { total: 0, invalid: 0 }, latencyMs: 1000,
  expected: { objeciones: ['C0-1', 'C0-2'], vetos: ['V1', 'W2'] }, alarms: null, ranges: [{ metrica: 'crisis_index', horizonte_h: 24, rango_min: 0.3, rango_max: 0.5 }], seenIds: ['M-48213'], ...over,
});

describe('gradeRecord', () => {
  test('formato ok cuando están todas las objeciones y los vetos citados por id', () => {
    const g = gradeRecord(rec(), ctx);
    expect(g.format).toMatchObject({ schemaOk: true, objeccionesFaltantes: [], vetosFaltantes: [], ok: true });
    expect(g.citations.invalid).toBe(0);
    expect(g.tokens).toEqual({ input: 100, output: 20, cacheRead: 90 });
    expect(g.turns).toBe(1);
  });

  test('objeción o veto ausentes rompen el formato; «V1» no se confunde con «V10»', () => {
    const memo = { ...memoOf(2, 0, ['C0-1']), vetos: [{ asiento: 'legal', texto: 'V10: otro', estado: 'resuelto' }] };
    const g = gradeRecord(rec({ memo }), ctx);
    expect(g.format.objeccionesFaltantes).toEqual(['C0-2']);
    expect(g.format.vetosFaltantes).toEqual(['V1', 'W2']);
    expect(g.format.ok).toBe(false);
  });

  test('un veto sin id (panel) se compara por su texto', () => {
    const memo = { ...memoOf(2, 0), vetos: [{ asiento: 'legal', texto: 'publicidad vedada', estado: 'sin_resolver' }] };
    expect(gradeRecord(rec({ memo, expected: { objeciones: [], vetos: ['publicidad vedada'] } }), ctx).format.vetosFaltantes).toEqual([]);
  });

  test('citas: una mención no consultada cuenta como inválida', () => {
    const memo = { ...memoOf(2, 0), recomendacion: { camino: 0, confianza_cualitativa: 'alta', porque: 'según M-48213 y M-99999' } };
    expect(gradeRecord(rec({ memo, expected: null }), ctx).citations).toMatchObject({ total: 2, invalid: 1, validRate: 0.5 });
  });

  test('línea roja en una recomendación se registra', () => {
    const memo = { ...memoOf(2, 0), recomendacion: { camino: 0, confianza_cualitativa: 'alta', porque: 'Borrar los comentarios críticos.' } };
    expect(gradeRecord(rec({ memo, expected: null }), ctx).redLines.map((h) => h.linea)).toEqual(['L-5']);
  });

  test('predicciones: cobertura y Brier del intervalo contra lo observado', () => {
    const g = gradeRecord(rec({ expected: null }), { ...ctx, observed: { 'crisis_index@24': 0.4 } });
    expect(g.ranges?.coverage).toBe(1);
    expect(g.intervalBrier).toBeCloseTo(0.04);
    expect(gradeRecord(rec({ expected: null }), ctx).ranges).toBeNull(); // sin observados no se califica
  });

  test('una corrida fallida no se califica y cuenta como no completada', () => {
    const g = gradeRecord(rec({ status: 'error', memo: null }), ctx);
    expect(g.completed).toBe(false);
    expect(g.format.ok).toBe(false);
  });
});

describe('summarizeVariant', () => {
  test('tasa de citas sobre el total, costo solo de corridas con precio (las fallidas también gastaron) y mediana de latencia', () => {
    const gs = [
      gradeRecord(rec({ latencyMs: 1000, costUsd: 1 }), ctx),
      gradeRecord(rec({ latencyMs: 3000, costUsd: null, unpricedCalls: 2 }), ctx),
      gradeRecord(rec({ status: 'error', memo: null }), ctx),
    ];
    const s = summarizeVariant('c', gs);
    expect(s).toMatchObject({ runs: 3, completed: 2, meanCostUsd: 0.75, unpricedRuns: 1, p50LatencyMs: 2000 });
    expect(s.formatOkRate).toBe(1);
  });
});
