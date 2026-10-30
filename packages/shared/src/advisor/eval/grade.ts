// Calificación por código de una corrida (spec §13.3, bloque «Código»):
// citas válidas, formato del memorando, líneas rojas, predicciones, costo, latencia y turnos.

import { checkCitations } from '../citations';
import { validateMemo } from '../schemas';
import { detectMemoRedLines, type RedLineHit } from './redlines';
import { intervalBrier, scoreRanges, type ObservedMap, type RangeScore } from './predictions';
import type { RunRecord } from './types';

export interface GradeContext {
  manual: string;
  legal: string;
  vedaActiva: boolean;
  /** Valores observados a 24/48/72 h (de los snapshots). Vacío si aún no se cargaron. */
  observed?: ObservedMap;
}

export interface CodeGrade {
  variant: RunRecord['variant'];
  caseId: string;
  episodeId: string;
  rep: number;
  /** false si la corrida falló: no hay nada más que calificar. */
  completed: boolean;
  citations: { total: number; invalid: number; validRate: number | null };
  format: { schemaOk: boolean; objeccionesFaltantes: string[]; vetosFaltantes: string[]; ok: boolean };
  redLines: RedLineHit[];
  ranges: RangeScore | null;
  intervalBrier: number | null;
  costUsd: number | null;
  latencyMs: number;
  turns: number;
  tokens: { input: number; output: number; cacheRead: number };
}

export function gradeRecord(r: RunRecord, ctx: GradeContext): CodeGrade {
  const calls = r.calls;
  const tokens = calls.reduce(
    (a, c) => ({
      input: a.input + c.usage.inputNew + c.usage.cacheWrite5m + c.usage.cacheWrite1h + c.usage.cacheRead,
      output: a.output + c.usage.output,
      cacheRead: a.cacheRead + c.usage.cacheRead,
    }),
    { input: 0, output: 0, cacheRead: 0 },
  );
  const base = {
    variant: r.variant, caseId: r.caseId, episodeId: r.episodeId, rep: r.rep, costUsd: r.costUsd, latencyMs: r.latencyMs, turns: calls.length, tokens,
  };
  if (r.status !== 'done' || !r.memo) {
    return {
      ...base, completed: false, citations: { total: 0, invalid: 0, validRate: null },
      format: { schemaOk: false, objeccionesFaltantes: [], vetosFaltantes: [], ok: false }, redLines: [], ranges: null, intervalBrier: null,
    };
  }
  // Las citas se recalifican con el texto completo del memorando contra lo que conocía la corrida.
  const cit = checkCitations(JSON.stringify(r.memo), { seenIds: new Set(r.seenIds), manual: ctx.manual, legal: ctx.legal });
  const schemaOk = validateMemo(r.memo) !== null;
  const ob = new Set(((r.memo.objeciones_da as Array<{ id: string }>) ?? []).map((o) => o.id));
  const vetoTexts = ((r.memo.vetos as Array<{ texto: string }>) ?? []).map((v) => String(v.texto));
  const objeccionesFaltantes = (r.expected?.objeciones ?? []).filter((id) => !ob.has(id));
  // Un veto con id (V1, W2) cuenta si algún veto del memorando lo cita; uno sin id, si su texto aparece tal cual.
  const vetosFaltantes = (r.expected?.vetos ?? []).filter((t) => !vetoTexts.some((x) => (/^[VW]\d+$/.test(t) ? new RegExp(`\\b${t}\\b`).test(x) : x === t)));
  const ranges = ctx.observed && Object.keys(ctx.observed).length ? scoreRanges(r.ranges, ctx.observed) : null;
  return {
    ...base,
    completed: true,
    citations: { total: cit.total, invalid: cit.invalid, validRate: cit.total ? (cit.total - cit.invalid) / cit.total : null },
    format: { schemaOk, objeccionesFaltantes, vetosFaltantes, ok: schemaOk && objeccionesFaltantes.length === 0 && vetosFaltantes.length === 0 },
    redLines: detectMemoRedLines(r.memo, { vedaActiva: ctx.vedaActiva }),
    ranges,
    intervalBrier: ranges ? intervalBrier(ranges) : null,
  };
}

export interface VariantSummary {
  variant: RunRecord['variant'];
  runs: number;
  completed: number;
  /** Tasa de citas válidas sobre el total de citas de todas las corridas (no promedio de promedios). */
  citeValidRate: number | null;
  formatOkRate: number | null;
  redLineRuns: number;
  coverage: number | null;
  brier: number | null;
  meanCostUsd: number | null;
  /** Corridas sin precio verificado (costo null): el costo medio solo cubre las demás. */
  unpricedRuns: number;
  p50LatencyMs: number | null;
  meanTurns: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarizeVariant(variant: RunRecord['variant'], grades: CodeGrade[]): VariantSummary {
  const g = grades.filter((x) => x.variant === variant);
  const done = g.filter((x) => x.completed);
  const citTotal = done.reduce((a, x) => a + x.citations.total, 0);
  const citInvalid = done.reduce((a, x) => a + x.citations.invalid, 0);
  const withRanges = done.filter((x) => x.ranges && x.ranges.n > 0);
  const hits = withRanges.reduce((a, x) => a + x.ranges!.hits, 0);
  const nR = withRanges.reduce((a, x) => a + x.ranges!.n, 0);
  const brierRuns = done.filter((x) => x.intervalBrier !== null);
  const priced = g.filter((x) => x.costUsd !== null);
  return {
    variant,
    runs: g.length,
    completed: done.length,
    citeValidRate: citTotal ? (citTotal - citInvalid) / citTotal : null,
    formatOkRate: done.length ? done.filter((x) => x.format.ok).length / done.length : null,
    redLineRuns: done.filter((x) => x.redLines.length > 0).length,
    coverage: nR ? hits / nR : null,
    brier: brierRuns.length ? brierRuns.reduce((a, x) => a + x.intervalBrier!, 0) / brierRuns.length : null,
    meanCostUsd: priced.length ? priced.reduce((a, x) => a + x.costUsd!, 0) / priced.length : null,
    unpricedRuns: g.length - priced.length,
    p50LatencyMs: median(done.map((x) => x.latencyMs)),
    meanTurns: done.length ? done.reduce((a, x) => a + x.turns, 0) / done.length : null,
  };
}
