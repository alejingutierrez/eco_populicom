// Las cuatro variantes de §13.2 sobre una MISMA hoja de hechos por caso.
//
// DECISIÓN DE DISEÑO: la ronda 0 (analista con herramientas) se hace una vez por caso, se guarda y todas
// las variantes parten de esa hoja. Lo que se compara es la ESTRUCTURA de la deliberación (un agente,
// un agente ×3 + síntesis, panel, consejo), no la suerte de qué datos consultó cada una; además
// ahorra el costo de repetir la ronda 0 cuatro veces. Límite: no mide el efecto de la ronda 0 misma.
//
//  (a)  un agente (Sonnet, medium) con el manual escribe él solo caminos, premortem y señales.
//  (a′) (a) tres veces independientes + una síntesis (DEEP) que agrupa y conserva el premortem.
//  (b)  panel: `runPanel` de la web, sin base de datos (pool falso) y con la ronda 0 precargada.
//  (c)  consejo: `runCouncil` de shared con un CouncilStore en memoria.

import { AdvisorBudgetError, structuredJson, type AdvisorContentBlock, type AdvisorLLM, type AdvisorRequest, type AdvisorResponse } from '../../packages/shared/src/advisor/llm';
import { buildFamilyBSystem } from '../../packages/shared/src/advisor/cache';
import { ADVISOR_CONSTITUTION } from '../../packages/shared/src/advisor/constitution';
import { MANUAL_TEXT } from '../../packages/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT } from '../../packages/shared/src/advisor/legal-rules';
import { checkCitations } from '../../packages/shared/src/advisor/citations';
import { runCouncil, type CouncilStore } from '../../packages/shared/src/advisor/council';
import {
  FACT_SHEET_SCHEMA, MEMO_CAMINOS_SCHEMA, MEMO_DA_SCHEMA, MEMO_HEAD_SCHEMA, POSITION_SCHEMA,
  validateMemo, validateMemoPart, validatePosition, type MemoPart,
} from '../../packages/shared/src/advisor/schemas';
import { runPanel, type PanelDeps } from '../../apps/web/src/lib/advisor/council';
import { MeteredLLM } from '../../packages/shared/src/advisor/eval/metered';
import { rangesFromPositions } from '../../packages/shared/src/advisor/eval/predictions';
import type { Case, RunRecord, VariantId } from '../../packages/shared/src/advisor/eval/types';

type Obj = Record<string, unknown>;

export interface CaseInputs {
  case: Case;
  /** Hoja de hechos de la ronda 0 (con `preferencia_usuario`). */
  factSheet: Obj;
  /** IDs M-/N- que consultó esa ronda 0. */
  seenIds: string[];
  agency: { slug: string; name: string };
  dateLabel: string;
  vedaActiva: boolean;
  guiaProbable?: string | null;
  riesgoPersonas?: boolean;
}

export interface VariantCtx {
  /** LLM base (real, simulado o con tope). Cada corrida lo envuelve para registrar sus propias llamadas. */
  llm: AdvisorLLM;
  models: { fast: string; main: string; deep: string };
  /** Pausa entre reintentos de transporte del consejo; los tests la ponen en 0. */
  retryBaseMs?: number;
}

const RANGE_LEVEL =
  'Los rangos de efectos_esperados son rangos al 80 %: el intervalo donde esperas, con 80 % de probabilidad, que caiga la métrica (crisis_index, nss, neg_velocity o polarization) a 24, 48 y 72 h.';

// ---- (a) y (a′): un agente ---------------------------------------------------------------------

function agentBrief(inp: CaseInputs, memos?: Obj[]): string {
  const pref = inp.case.question.preferenciaUsuario ?? (typeof inp.factSheet.preferencia_usuario === 'string' ? inp.factSheet.preferencia_usuario : null);
  return (
    'Eres un único agente asesor de comunicación de crisis. Escribe TÚ SOLO el memorando, con las secciones del esquema: ' +
    'exactamente dos caminos que difieran de fondo (caminos[0] y caminos[1]), un premortem propio (por cada camino, en objeciones_da, 2 o 3 formas de fracasar ' +
    'a las 72 h con id P0-1, P0-2, P1-1… y su estado resuelta, mitigada o aceptada), señales a 24, 48 y 72 h, una recomendación con confianza cualitativa, ' +
    'el disenso que tú mismo reconoces, los límites y, si la pregunta lo pide, borradores con las plantillas. Todo veto legal que veas va en vetos[]. ' +
    `Agencia: ${inp.agency.name}. Fecha: ${inp.dateLabel}.\nPregunta: ${inp.case.question.texto}\n` +
    `Preferencia del usuario: ${pref ?? 'ninguna'}\n\n${memos ? `Tres memorandos independientes del mismo caso (agrúpalos en dos caminos, conserva y reúne sus premortems, y recoge el desacuerdo entre ellos como disenso):\n${JSON.stringify(memos)}` : ''}`
  );
}

interface AgentOut {
  memo: Obj;
  position: Obj | null;
}

async function agentStructured(llm: AdvisorLLM, req: AdvisorRequest, validate: (x: unknown) => Obj | null, code: string): Promise<Obj> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.create(req);
    try {
      const ok = validate(structuredJson(res));
      if (ok) return ok;
    } catch {
      // salida truncada o no JSON: un reintento
    }
  }
  throw new Error(code);
}

/** Memorando en tres partes (como el panel) + una posición con rangos para calificar predicciones. */
async function writeMemo(llm: AdvisorLLM, model: string, system: AdvisorContentBlock[], inp: CaseInputs, memos?: Obj[]): Promise<AgentOut> {
  const user = agentBrief(inp, memos);
  const part = (schema: Obj, which: MemoPart) =>
    agentStructured(llm, { model, effort: 'medium', maxTokens: 12000, system, outputSchema: schema, messages: [{ role: 'user', content: user }] },
      (x) => (validateMemoPart(which, x) && (which !== 'caminos' || (x as { caminos: unknown[] }).caminos.length === 2) ? (x as Obj) : null), `memo_${which}_invalid`);
  const [head, caminos, da] = await Promise.all([
    part(MEMO_HEAD_SCHEMA as unknown as Obj, 'head'),
    part(MEMO_CAMINOS_SCHEMA as unknown as Obj, 'caminos'),
    part(MEMO_DA_SCHEMA as unknown as Obj, 'da'),
  ]);
  const memo = { ...head, ...caminos, ...da };
  if (!validateMemo(memo)) throw new Error('memo_invalid');
  // Los rangos no viven en el memorando (spec §8.6): se piden aparte, en el esquema de posición.
  let position: Obj | null = null;
  try {
    position = await agentStructured(llm, {
      model, effort: 'low', maxTokens: 3000, system, outputSchema: POSITION_SCHEMA as unknown as Obj,
      messages: [{ role: 'user', content: `${user}\n\nAhora resume en una posición el camino que recomiendas en tu memorando. ${RANGE_LEVEL} Responde solo con el JSON.` }],
    }, validatePosition, 'position_invalid');
  } catch {
    position = null; // sin rangos: la corrida se califica sin predicciones, no se descarta
  }
  return { memo, position };
}

function sheetSystem(inp: CaseInputs): AdvisorContentBlock[] {
  return buildFamilyBSystem({ constitution: ADVISOR_CONSTITUTION, manual: MANUAL_TEXT, factSheet: JSON.stringify(inp.factSheet) });
}

// ---- Registro uniforme ---------------------------------------------------------------------------

function baseRecord(variant: VariantId, inp: CaseInputs, rep: number, meter: MeteredLLM, t0: number): RunRecord {
  return {
    variant, caseId: inp.case.caseId, episodeId: inp.case.episode.id, rep, status: 'done', memo: null,
    calls: meter.calls, costUsd: meter.costUsd, unpricedCalls: meter.unpriced, citations: { total: 0, invalid: 0 },
    latencyMs: Date.now() - t0, expected: null, alarms: null, ranges: [], seenIds: inp.seenIds,
  };
}

function citationsOf(memo: Obj, seen: string[]) {
  const c = checkCitations(JSON.stringify(memo), { seenIds: new Set(seen), manual: MANUAL_TEXT, legal: LEGAL_RULES_TEXT });
  return { total: c.total, invalid: c.invalid };
}

function finish(rec: RunRecord, meter: MeteredLLM, t0: number, patch: Partial<RunRecord>): RunRecord {
  const out = { ...rec, ...patch, calls: meter.calls, costUsd: meter.costUsd, unpricedCalls: meter.unpriced, latencyMs: Date.now() - t0 };
  if (out.memo) out.citations = citationsOf(out.memo, out.seenIds);
  return out;
}

// ---- Ronda 0 precargada para el panel -----------------------------------------------------------

/**
 * El panel hace su propia ronda 0. Para usar la hoja compartida sin tocar su código, este LLM
 * responde la ronda 0 sin llamar al modelo: el analista «consulta» una herramienta (cuyo resultado trae los
 * IDs vistos, para la verificación de citas) y la hoja de hechos sale del caché. Todo lo demás pasa al LLM real.
 */
export function preloadedRound0(inner: AdvisorLLM, factSheet: Obj): AdvisorLLM {
  const zero = { inputNew: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };
  const reply = (content: AdvisorResponse['content'], stopReason: string): AdvisorResponse => ({ model: 'precargado', stopReason, content, usage: zero, ms: 0 });
  return {
    stream: (req, h) => inner.stream(req, h),
    create: async (req) => {
      if (req.outputSchema === (FACT_SHEET_SCHEMA as unknown)) return reply([{ type: 'text', text: JSON.stringify(factSheet) }], 'end_turn');
      if (req.tools) {
        const hadResult = req.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
        return hadResult
          ? reply([{ type: 'text', text: 'listo' }], 'end_turn')
          : reply([{ type: 'tool_use', id: 'precargado-1', name: 'situacion_actual', input: {} }], 'tool_use');
      }
      return inner.create(req);
    },
  };
}

/** Pool falso para runPanel: registra eventos y pasos en memoria, no hay base. */
export function memoryPool() {
  const events: Array<{ type: string; payload: unknown }> = [];
  const steps: Record<string, unknown> = {};
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO advisor_events/.test(sql)) events.push({ type: String(params[1]), payload: JSON.parse(String(params[2])) });
      else if (/jsonb_build_object/.test(sql)) steps[String(params[1])] = JSON.parse(String(params[2]));
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool: pool as unknown as PanelDeps['pool'], events, steps };
}

export function memoryStore(): { store: CouncilStore; events: Array<{ type: string; payload: unknown }>; steps: Record<string, unknown> } {
  const events: Array<{ type: string; payload: unknown }> = [];
  const steps: Record<string, unknown> = {};
  return {
    events, steps,
    store: {
      appendEvent: async (type, payload) => void events.push({ type, payload }),
      saveStep: async (k, v) => void (steps[k] = v),
      isCancelRequested: async () => false,
    },
  };
}

const positionsOf = (steps: Record<string, unknown>): Obj[] => Object.entries(steps).filter(([k]) => /^1\./.test(k) && k !== '1.done').map(([, v]) => v as Obj);

/** Lo que el memorando DEBE traer: las objeciones del DA (ids C{camino}-{n}) y los vetos del asiento legal. */
function expectedFrom(steps: Record<string, unknown>): { objeciones: string[]; vetos: string[] } {
  const objeciones: string[] = [];
  const prem = steps['3.abogado_diablo'] as { premortems?: Array<{ camino: number; objeciones: unknown[] }> } | undefined;
  for (const p of prem?.premortems ?? []) p.objeciones.forEach((_, k) => objeciones.push(`C${p.camino}-${k + 1}`));
  const vetos = new Set<string>();
  for (const p of positionsOf(steps)) for (const v of (p.vetos as Array<{ texto: string }> | undefined) ?? []) vetos.add(v.texto);
  const legal4 = steps['4.legal'] as { vetos?: Array<{ texto: string }> } | undefined;
  for (const v of legal4?.vetos ?? []) vetos.add(v.texto);
  return { objeciones, vetos: [...vetos] };
}

// ---- Ejecución -------------------------------------------------------------------------------------

export async function runVariant(variant: VariantId, inp: CaseInputs, rep: number, ctx: VariantCtx): Promise<RunRecord> {
  const t0 = Date.now();
  const meter = new MeteredLLM(ctx.llm);
  const rec = baseRecord(variant, inp, rep, meter, t0);
  try {
    switch (variant) {
      case 'a': {
        const out = await writeMemo(meter, ctx.models.main, sheetSystem(inp), inp);
        return finish(rec, meter, t0, { memo: out.memo, ranges: rangesFromPositions(out.position ? [out.position] : []) });
      }
      case 'a2': {
        const system = sheetSystem(inp);
        const samples = await Promise.all([0, 1, 2].map(() => writeMemo(meter, ctx.models.main, system, inp)));
        const synth = await writeMemo(meter, ctx.models.deep, system, inp, samples.map((s) => s.memo));
        const positions = [...samples.map((s) => s.position), synth.position].filter((p): p is Obj => !!p);
        return finish(rec, meter, t0, { memo: synth.memo, ranges: rangesFromPositions(positions) });
      }
      case 'b': {
        const { pool, steps } = memoryPool();
        const out = await runPanel({
          llm: preloadedRound0(meter, inp.factSheet),
          tools: { defs: [], run: async () => ({ ok: true, text: JSON.stringify({ ids: inp.seenIds }), resultTokens: 0 }) },
          pool, runId: `eval-${inp.case.caseId}-${rep}`.replace(/[^0-9a-zA-Z-]/g, '-'), models: ctx.models, dateLabel: inp.dateLabel, agency: inp.agency,
          signals: { guiaProbable: inp.guiaProbable ?? null, riesgoPersonas: inp.riesgoPersonas ?? false, vedaActiva: inp.vedaActiva },
          question: inp.case.question.texto, isCancelled: async () => false,
        });
        if (out.status !== 'done' || !out.memo) return finish(rec, meter, t0, { status: 'cancelled' });
        return finish(rec, meter, t0, { memo: out.memo, expected: expectedFrom(steps), ranges: rangesFromPositions(positionsOf(steps)) });
      }
      case 'c': {
        const { store, steps } = memoryStore();
        const out = await runCouncil({
          llm: meter, store, models: ctx.models, factSheet: inp.factSheet, seenIds: new Set(inp.seenIds),
          question: inp.case.question.texto, agency: inp.agency, dateLabel: inp.dateLabel, vedaActiva: inp.vedaActiva,
          seed: `${inp.case.caseId}|${rep}`, retryBaseMs: ctx.retryBaseMs ?? 1500,
        });
        if (out.status !== 'done' || !out.memo) return finish(rec, meter, t0, { status: 'cancelled' });
        return finish(rec, meter, t0, { memo: out.memo, expected: expectedFrom(steps), alarms: out.alarms as unknown as Obj, ranges: rangesFromPositions(positionsOf(steps)) });
      }
    }
  } catch (e) {
    // El tope del arnés corta TODA la ejecución: se propaga. Cualquier otro fallo queda en el registro.
    if (e instanceof AdvisorBudgetError) throw e;
    return finish(rec, meter, t0, { status: 'error', error: (e as Error).message ?? String(e), memo: null });
  }
}
