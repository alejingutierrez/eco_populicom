// Orquestación del arnés: hojas de hechos por caso, ejecución con tope duro, calificación, paquete ciego,
// juez y decisión. Sin lectura de archivos aquí salvo `dirFactSheets`; el CLI (run.ts) pone el IO.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AdvisorBudgetError, type AdvisorLLM } from '../../packages/shared/src/advisor/llm';
import { MANUAL_TEXT } from '../../packages/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT } from '../../packages/shared/src/advisor/legal-rules';
import { MeteredLLM, type Caps, type PriceRow } from '../../packages/shared/src/advisor/eval/metered';
import { expandCases, maskCaseText } from '../../packages/shared/src/advisor/eval/episodes';
import { gradeRecord, summarizeVariant, type CodeGrade, type VariantSummary } from '../../packages/shared/src/advisor/eval/grade';
import type { ObservedMap } from '../../packages/shared/src/advisor/eval/predictions';
import {
  COMPARISONS, buildPairs, humanConsensus, interHumanKappa, judgePair, kappaBetween, makeBlindPacket, preferenceMargin, sheetTemplateCsv,
  type BlindKeyRow, type HumanVerdict, type Pair, type Winner,
} from '../../packages/shared/src/advisor/eval/pairwise';
import { renderMemoCanonical } from '../../packages/shared/src/advisor/eval/render';
import { decide, type DecisionResult } from '../../packages/shared/src/advisor/eval/decision';
import { VARIANT_IDS, type Case, type Episode, type RunRecord, type VariantId } from '../../packages/shared/src/advisor/eval/types';
import { runVariant, type CaseInputs, type VariantCtx } from './variants';

type Obj = Record<string, unknown>;

export interface FactSheetEntry {
  factSheet: Obj;
  seenIds: string[];
}
export type FactSheetProvider = (c: Case) => Promise<FactSheetEntry>;

export const caseFileName = (caseId: string) => `${caseId.replace(/[^0-9a-zA-Z-]+/g, '__')}.json`;

/** Hojas de hechos guardadas: `<dir>/<caseId>.json` con `{ factSheet, seenIds }`. Falta una → error claro. */
export function dirFactSheets(dir: string): FactSheetProvider {
  return async (c) => {
    const f = join(dir, caseFileName(c.caseId.replace(/~masked$/, '')));
    if (!existsSync(f)) throw new Error(`falta la hoja de hechos de ${c.caseId}: ${f}`);
    return JSON.parse(readFileSync(f, 'utf8')) as FactSheetEntry;
  };
}

/** Hoja mínima y válida para el modo --dry-run (no representa ningún caso real). */
export function dryRunFactSheets(): FactSheetProvider {
  return async (c) => ({
    factSheet: {
      pregunta_normalizada: c.question.texto, preferencia_usuario: c.question.preferenciaUsuario ?? null,
      sabido: [{ afirmacion: 'Hay conversación en redes sobre el caso', citas: ['M-48213'] }], no_claro: [], supuesto: [],
      caso_peor: { descripcion: 'escalada', citas: ['M-48213'] }, linea_base: { descripcion: 'sin acción', rango_indice_72h: null }, puntos_ciegos: ['WhatsApp'],
    },
    seenIds: ['M-48213', 'M-48214'],
  });
}

const MASKED = '~masked';

/** Casos de control con nombres sustituidos (spec §13.1): solo para episodios que lo piden. */
export function controlCases(cases: Case[]): Case[] {
  return cases
    .filter((c) => c.episode.control.nombresSustituidos)
    .map((c) => ({
      caseId: `${c.caseId}${MASKED}`, episode: c.episode,
      question: { ...c.question, texto: maskCaseText(c.question.texto, c.episode), preferenciaUsuario: c.question.preferenciaUsuario ? maskCaseText(c.question.preferenciaUsuario, c.episode) : undefined },
    }));
}

export function dateLabelOf(episode: Episode): string {
  return new Intl.DateTimeFormat('es-PR', { timeZone: 'America/Puerto_Rico', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(episode.asOf));
}

const AGENCY_NAME: Record<Episode['agencySlug'], string> = { ddecpr: 'DDEC', gobernadora: 'Oficina de la Gobernadora', df: 'Departamento de la Familia' };

export async function buildInputs(c: Case, facts: FactSheetProvider): Promise<CaseInputs> {
  const entry = await facts(c);
  let factSheet = entry.factSheet;
  if (c.caseId.endsWith(MASKED)) factSheet = JSON.parse(maskCaseText(JSON.stringify(factSheet), c.episode)) as Obj;
  return {
    case: c, factSheet, seenIds: entry.seenIds, agency: { slug: c.episode.agencySlug, name: AGENCY_NAME[c.episode.agencySlug] },
    dateLabel: dateLabelOf(c.episode), vedaActiva: !!c.episode.vedaActiva,
  };
}

export interface RunOptions {
  cases: Case[];
  variants: VariantId[];
  reps: number;
  llm: AdvisorLLM;
  models: VariantCtx['models'];
  facts: FactSheetProvider;
  caps: Caps | null;
  prices?: Record<string, PriceRow>;
  concurrency?: number;
  /** `variant|caseId|rep` ya hechos (para reanudar). */
  skip?: ReadonlySet<string>;
  onRecord?: (r: RunRecord) => void | Promise<void>;
  retryBaseMs?: number;
}

export const recordKey = (r: Pick<RunRecord, 'variant' | 'caseId' | 'rep'>) => `${r.variant}|${r.caseId}|${r.rep}`;

export interface RunSummary {
  records: RunRecord[];
  stoppedByCap: string | null;
  spentUsd: number;
  unpricedCalls: number;
  calls: number;
}

/**
 * Corre cada (caso × variante × repetición). El tope duro (USD y llamadas) vive en el LLM raíz: al
 * superarlo se aborta TODA la ejecución y lo ya hecho se conserva (onRecord escribe en cuanto termina cada corrida).
 */
export async function runEvaluation(o: RunOptions): Promise<RunSummary> {
  const root = new MeteredLLM(o.llm, o.caps, o.prices);
  const jobs: Array<{ c: Case; v: VariantId; rep: number }> = [];
  for (const c of o.cases) for (let rep = 0; rep < o.reps; rep++) for (const v of o.variants) {
    if (!o.skip?.has(recordKey({ variant: v, caseId: c.caseId, rep }))) jobs.push({ c, v, rep });
  }
  const records: RunRecord[] = [];
  const inputs = new Map<string, Promise<CaseInputs>>();
  let stoppedByCap: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !stoppedByCap) {
      const job = jobs[next++];
      try {
        if (!inputs.has(job.c.caseId)) inputs.set(job.c.caseId, buildInputs(job.c, o.facts));
        const inp = await inputs.get(job.c.caseId)!;
        const rec = await runVariant(job.v, inp, job.rep, { llm: root, models: o.models, retryBaseMs: o.retryBaseMs });
        records.push(rec);
        await o.onRecord?.(rec);
      } catch (e) {
        if (e instanceof AdvisorBudgetError) { stoppedByCap = e.message; return; }
        const rec: RunRecord = {
          variant: job.v, caseId: job.c.caseId, episodeId: job.c.episode.id, rep: job.rep, status: 'error', error: (e as Error).message, memo: null, calls: [],
          costUsd: null, unpricedCalls: 0, citations: { total: 0, invalid: 0 }, latencyMs: 0, expected: null, alarms: null, ranges: [], seenIds: [],
        };
        records.push(rec);
        await o.onRecord?.(rec);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 1) }, worker));
  return { records, stoppedByCap, spentUsd: +root.spentUsd.toFixed(6), unpricedCalls: root.unpriced, calls: root.calls.length };
}

// ---- Calificación ---------------------------------------------------------------------------------------

export function gradeAll(records: RunRecord[], episodes: Episode[], observedByCase: Record<string, ObservedMap> = {}): { grades: CodeGrade[]; summary: VariantSummary[] } {
  const veda = new Map(expandCases(episodes).map((c) => [c.caseId, !!c.episode.vedaActiva]));
  const grades = records.map((r) => gradeRecord(r, {
    manual: MANUAL_TEXT, legal: LEGAL_RULES_TEXT, vedaActiva: veda.get(r.caseId.replace(/~masked$/, '')) ?? false, observed: observedByCase[r.caseId.replace(/~masked$/, '')],
  }));
  return { grades, summary: VARIANT_IDS.filter((v) => grades.some((g) => g.variant === v)).map((v) => summarizeVariant(v, grades)) };
}

// ---- Paquete ciego -----------------------------------------------------------------------------------------

export interface PacketFiles {
  /** nombre de archivo → contenido */
  files: Record<string, string>;
  key: BlindKeyRow[];
  pairs: number;
}

export function buildPacket(records: RunRecord[], seed: string, episodes: Episode[] = []): PacketFiles {
  const pairs = COMPARISONS.flatMap((c) => buildPairs(records, c));
  const questions = new Map(expandCases(episodes).map((c) => [c.caseId, c.question.texto]));
  const { items, key } = makeBlindPacket(pairs, seed, questions);
  const files: Record<string, string> = {};
  items.forEach((it) => {
    files[`paquete/${it.pairId}.md`] =
      `# Par ${it.pairId}\n\nPregunta que se le hizo al asesor:\n\n> ${it.question || '(sin texto de la pregunta)'}\n\nCompare los dos memorandos y llene la fila en la hoja de calificación (A, B o empate en cada criterio).\n\n---\n\n# MEMORANDO A\n\n${it.A}\n\n---\n\n# MEMORANDO B\n\n${it.B}\n`;
  });
  files['hoja-de-calificacion.csv'] = sheetTemplateCsv(items.map((i) => i.pairId));
  // La clave NO se entrega a los consultores.
  files['CLAVE-no-entregar.json'] = JSON.stringify(key, null, 2);
  return { files, key, pairs: pairs.length };
}

// ---- Juez ---------------------------------------------------------------------------------------------------------

export interface JudgeRow {
  pairId: string;
  comparison: Pair['comparison'];
  episodeId: string;
  winner: Winner;
  flipped: boolean;
}

export async function judgeAll(
  records: RunRecord[], episodes: Episode[], d: { llm: AdvisorLLM; model: string; caps: Caps | null; prices?: Record<string, PriceRow> }, onRow?: (r: JudgeRow) => void | Promise<void>,
): Promise<{ rows: JudgeRow[]; stoppedByCap: string | null; spentUsd: number }> {
  const root = new MeteredLLM(d.llm, d.caps, d.prices);
  const questions = new Map(expandCases(episodes).map((c) => [c.caseId, c.question.texto]));
  const rows: JudgeRow[] = [];
  let stoppedByCap: string | null = null;
  for (const pair of COMPARISONS.flatMap((c) => buildPairs(records, c))) {
    try {
      const v = await judgePair({ llm: root, model: d.model }, questions.get(pair.caseId.replace(/~masked$/, '')) ?? '', renderMemoCanonical(pair.x.memo!), renderMemoCanonical(pair.y.memo!));
      const row = { pairId: pair.pairId, comparison: pair.comparison, episodeId: pair.episodeId, winner: v.winner, flipped: v.flipped };
      rows.push(row);
      await onRow?.(row);
    } catch (e) {
      if (e instanceof AdvisorBudgetError) { stoppedByCap = e.message; break; }
      throw e;
    }
  }
  return { rows, stoppedByCap, spentUsd: +root.spentUsd.toFixed(6) };
}

// ---- Decisión --------------------------------------------------------------------------------------------------------

export interface DecisionReport {
  decision: DecisionResult;
  margins: { c_vs_a2: ReturnType<typeof preferenceMargin>; b_vs_a: ReturnType<typeof preferenceMargin> };
  kappa: { interHuman: number | null; judgeVsHumans: number | null };
  judgeMargins: { c_vs_a2: ReturnType<typeof preferenceMargin>; b_vs_a: ReturnType<typeof preferenceMargin> } | null;
}

/**
 * Aplica la regla §13.3. La preferencia que decide es la de los CONSULTORES (hojas llenadas); el juez
 * solo se reporta y se compara contra ellos con kappa. Sin hojas de humanos, la decisión queda pendiente.
 */
export function decideFromResults(a: { summary: VariantSummary[]; verdicts: HumanVerdict[]; key: BlindKeyRow[]; judge?: JudgeRow[] }): DecisionReport {
  const byKey = new Map(a.key.map((k) => [k.pairId, k]));
  const margin = (cmp: string, source: Array<{ pairId: string; winners: Winner[] }>) =>
    preferenceMargin(source.filter((s) => byKey.get(s.pairId)?.comparison === cmp).map((s) => ({ pairId: s.pairId, episodeId: byKey.get(s.pairId)!.episodeId, winners: s.winners })));
  const humanByPair = new Map<string, Winner[]>();
  for (const v of a.verdicts) humanByPair.set(v.pairId, [...(humanByPair.get(v.pairId) ?? []), v.winner]);
  const humanItems = [...humanByPair].map(([pairId, winners]) => ({ pairId, winners }));
  const margins = { c_vs_a2: margin('c_vs_a2', humanItems), b_vs_a: margin('b_vs_a', humanItems) };

  const sv = (v: VariantId) => a.summary.find((s) => s.variant === v);
  const decision = decide({
    cVsA2: { points: margins.c_vs_a2.points, se: margins.c_vs_a2.se, n: margins.c_vs_a2.pairs },
    bVsA: { points: margins.b_vs_a.points, se: margins.b_vs_a.se, n: margins.b_vs_a.pairs },
    brier: { c: sv('c')?.brier ?? null, a2: sv('a2')?.brier ?? null },
    citeRate: { c: sv('c')?.citeValidRate ?? null, a2: sv('a2')?.citeValidRate ?? null },
  });

  let judgeMargins: DecisionReport['judgeMargins'] = null;
  let judgeVsHumans: number | null = null;
  if (a.judge?.length) {
    // El juez trabaja con el id interno; las hojas de los consultores, con el id público del paquete.
    const publicId = new Map(a.key.map((k) => [k.internalId, k.pairId]));
    const judged = a.judge.filter((j) => publicId.has(j.pairId)).map((j) => ({ pairId: publicId.get(j.pairId)!, winner: j.winner }));
    const items = judged.map((j) => ({ pairId: j.pairId, winners: [j.winner] }));
    judgeMargins = { c_vs_a2: margin('c_vs_a2', items), b_vs_a: margin('b_vs_a', items) };
    const k = kappaBetween(new Map(judged.map((j) => [j.pairId, j.winner] as const)), humanConsensus(a.verdicts));
    judgeVsHumans = Number.isNaN(k.kappa) ? null : k.kappa;
  }
  const ih = interHumanKappa(a.verdicts);
  return { decision, margins, kappa: { interHuman: Number.isNaN(ih.kappa) ? null : ih.kappa, judgeVsHumans }, judgeMargins };
}
