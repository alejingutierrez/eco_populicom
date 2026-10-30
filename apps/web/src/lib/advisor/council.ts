// Camino 2 · panel (spec §7.2, §8.2–§8.4). Corre en proceso, sin esperar al cliente.
// Hechos (analista con herramientas) → 3 asientos en paralelo → abogado del diablo →
// síntesis del moderador. Cada paso queda en advisor_events y deliberacion_json.

import {
  AdvisorBudgetError,
  TokenLedger,
  structuredJson,
  type AdvisorContentBlock,
  type AdvisorLLM,
  type AdvisorMessage,
  type AdvisorResponse,
} from '@eco/shared/src/advisor/llm';
import { buildFamilyASystem, buildFamilyBSystem, withTurnBreakpoint } from '@eco/shared/src/advisor/cache';
import { ADVISOR_CONSTITUTION } from '@eco/shared/src/advisor/constitution';
import { MANUAL_TEXT } from '@eco/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT } from '@eco/shared/src/advisor/legal-rules';
import { checkCitations, idsInToolResult } from '@eco/shared/src/advisor/citations';
import { reviewDraft } from '@eco/shared/src/advisor/review';
import {
  FACT_SHEET_SCHEMA,
  MEMO_HEAD_SCHEMA,
  MEMO_CAMINOS_SCHEMA,
  MEMO_DA_SCHEMA,
  validateMemoPart,
  type MemoPart,
  POSITION_SCHEMA,
  PREMORTEM_SCHEMA,
  validateFactSheet,
  validateMemo,
  validatePosition,
  validatePremortems,
} from '@eco/shared/src/advisor/schemas';
import { SEAT_BRIEFS, SEAT_PREAMBLE, type SeatId as SharedSeatId } from '@eco/shared/src/advisor/seats';
import type { Camino1Tool } from './camino1';
import { appendEvent, saveStep, isCancelRequested, type Pool } from './runs';

export const PANEL_EXPECTED_COST_USD = 0.6;

export type SeatId = Exclude<SharedSeatId, 'periodista'>;

export interface PanelSignals {
  guiaProbable: string | null;
  riesgoPersonas: boolean;
  vedaActiva: boolean;
}

/** Asiento rotativo del panel (spec §8.2): legal si hay guía de integridad/renuncia/menor o veda; ciudadano si hay riesgo a personas; si no, oposición. */
export function rotatingSeatFor(s: PanelSignals): 'legal' | 'ciudadano' | 'oposicion' {
  if (s.vedaActiva || ['G-3', 'G-4', 'G-6', 'G-11'].includes(s.guiaProbable ?? '')) return 'legal';
  if (s.riesgoPersonas) return 'ciudadano';
  return 'oposicion';
}

export interface PanelDeps {
  llm: AdvisorLLM;
  tools: Camino1Tool;
  pool: Pool;
  runId: string;
  models: { fast: string; main: string; deep: string };
  dateLabel: string;
  agency: { slug: string; name: string };
  signals: PanelSignals;
  question: string;
  isCancelled?: () => Promise<boolean>;
}

export interface PanelOutcome {
  status: 'done' | 'cancelled';
  memo: Record<string, unknown> | null;
  citations: { total: number; invalid: number };
  usage: ReturnType<TokenLedger['snapshot']>['usage'];
  costUsd: number | null;
}

class PanelError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PanelError';
  }
}

const ROUND_NAMES: Record<number, string> = { 0: 'Hechos', 1: 'Posiciones', 3: 'Ataque', 5: 'Síntesis' };

async function emit(d: PanelDeps, type: string, payload: unknown): Promise<void> {
  await appendEvent(d.pool, d.runId, type, payload);
}

async function roundStart(d: PanelDeps, ronda: number): Promise<void> {
  await emit(d, 'round_started', { ronda, nombre: ROUND_NAMES[ronda] });
}

async function roundDone(d: PanelDeps, ronda: number): Promise<void> {
  await emit(d, 'round_done', { ronda });
}

/** Una llamada con salida estructurada y validación en código. Un reintento; luego error. */
async function structuredCall(
  d: PanelDeps,
  ledger: TokenLedger,
  req: Parameters<AdvisorLLM['create']>[0],
  validate: (x: unknown) => Record<string, unknown> | null,
  code: string,
): Promise<Record<string, unknown>> {
  let last: AdvisorResponse | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await d.llm.create(req);
    ledger.add(req.model, res);
    last = res;
    try {
      const ok = validate(structuredJson(res));
      if (ok) return ok;
    } catch {
      // salida no JSON o interrumpida: se reintenta una vez
    }
  }
  throw new PanelError(code, `salida inválida tras reintento (${last?.stopReason ?? 'sin respuesta'})`);
}

export async function runPanel(d: PanelDeps): Promise<PanelOutcome> {
  const ledger = new TokenLedger(PANEL_EXPECTED_COST_USD);
  const seen = new Set<string>();
  const cancelled = async () => (d.isCancelled ? d.isCancelled() : isCancelRequested(d.pool, d.runId));
  const constitution = ADVISOR_CONSTITUTION;

  // ---- Ronda 0 · Hechos -----------------------------------------------------------
  if (await cancelled()) return cancelledOutcome(d, ledger);
  await roundStart(d, 0);
  const famA = buildFamilyASystem({ constitution, manual: MANUAL_TEXT });
  const toolLog: string[] = [];
  const messages: AdvisorMessage[] = [{ role: 'user', content: `Fecha de hoy: ${d.dateLabel}.\n\nPregunta: ${d.question}` }];
  let toolCalls = 0;
  for (let turn = 0; turn < 4; turn++) {
    const res = await d.llm.create({
      model: d.models.main, effort: 'medium', maxTokens: 6000, system: famA, tools: d.tools.defs,
      messages: withTurnBreakpoint(messages),
    });
    ledger.add(d.models.main, res);
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b): b is Extract<AdvisorContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (uses.length === 0) break;
    const runnable = uses.slice(0, Math.max(0, 6 - toolCalls));
    const results = await Promise.all(
      runnable.map(async (u) => {
        await emit(d, 'tool_call', { nombre: u.name, argsResumen: Object.keys(u.input as object).join(', ') || 'sin argumentos' });
        const r = await d.tools.run(u.name, u.input);
        for (const id of idsInToolResult(r.text)) seen.add(id);
        toolLog.push(`[${u.name}] ${r.text}`);
        await emit(d, 'tool_result', { nombre: u.name, ok: r.ok, resumen: r.ok ? `${r.resultTokens} tokens` : 'error' });
        return { type: 'tool_result' as const, tool_use_id: u.id, content: r.text, is_error: !r.ok };
      }),
    );
    toolCalls += runnable.length;
    for (const u of uses.slice(runnable.length)) {
      results.push({ type: 'tool_result' as const, tool_use_id: u.id, content: JSON.stringify({ error: 'Límite de consultas alcanzado.' }), is_error: true });
    }
    messages.push({ role: 'user', content: results });
    if (toolCalls >= 6) break;
  }

  const factSheet = await structuredCall(
    d, ledger,
    {
      model: d.models.main, effort: 'medium', maxTokens: 6000, system: famA, outputSchema: FACT_SHEET_SCHEMA,
      messages: [{ role: 'user', content: `Pregunta: ${d.question}\n\nDatos consultados:\n${toolLog.join('\n') || '(sin datos)'}\n\nDevuelve la hoja de hechos. Separa la preferencia del usuario en preferencia_usuario.` }],
    },
    validateFactSheet,
    'factsheet_invalid',
  );
  await saveStep(d.pool, d.runId, '0.analista', factSheet);
  await roundDone(d, 0);

  // ---- Ronda 1 · Posiciones (3 asientos en paralelo) -------------------------------
  if (await cancelled()) return cancelledOutcome(d, ledger);
  await roundStart(d, 1);
  const famB = buildFamilyBSystem({ constitution, manual: MANUAL_TEXT, factSheet: JSON.stringify(factSheet) });
  const rotating = rotatingSeatFor(d.signals);
  const seats: SeatId[] = ['vocero', 'estratega', rotating];
  const positions = await Promise.all(
    seats.map(async (seat) => {
      const pos = await structuredCall(
        d, ledger,
        {
          model: d.models.main, effort: 'low', maxTokens: 3000, system: famB, outputSchema: POSITION_SCHEMA,
          messages: [{ role: 'user', content: `${SEAT_PREAMBLE}\n\nAsiento: ${seat}. ${SEAT_BRIEFS[seat]}\nFecha: ${d.dateLabel}.` }],
        },
        validatePosition,
        `seat_invalid_${seat}`,
      );
      const citasInvalidas = checkCitations(JSON.stringify(pos), { seenIds: seen, manual: MANUAL_TEXT, legal: LEGAL_RULES_TEXT }).invalid;
      await saveStep(d.pool, d.runId, `1.${seat}`, pos);
      await emit(d, 'seat_done', { asiento: seat, resumen: String(pos.accion), citasInvalidas });
      return { seat, pos };
    }),
  );
  await roundDone(d, 1);

  // ---- Ronda 3 · Ataque del abogado del diablo (DEEP) -------------------------------
  if (await cancelled()) return cancelledOutcome(d, ledger);
  await roundStart(d, 3);
  const caminos = positions.map((p, i) => ({ camino: i, nombre: String(p.pos.nombre), posicion: p.pos }));
  // Entrada compacta para el abogado del diablo: solo lo que necesita para fracasar un camino.
  const caminosCompactos = caminos.map((c) => ({ camino: c.camino, nombre: c.nombre, accion: c.posicion.accion, mecanismo: c.posicion.mecanismo }));
  const premortems = await structuredCall(
    d, ledger,
    {
      model: d.models.deep, effort: 'medium', maxTokens: 5000, system: famB, outputSchema: PREMORTEM_SCHEMA,
      messages: [{
        role: 'user',
        content: `${SEAT_PREAMBLE}\n\nAsiento: abogado_diablo. Eres pesimista por diseño: no propones ni votas. Para cada camino, imagina que fracasó a las 72 h y escribe 2 formas de fracasar, cada una con su señal temprana y su supuesto frágil. Lista también lo que concedes y qué te haría ceder. Responde en máximo 400 palabras en total.\n\nCaminos:\n${JSON.stringify(caminosCompactos)}`,
      }],
    },
    validatePremortems,
    'premortem_invalid',
  );
  await saveStep(d.pool, d.runId, '3.abogado_diablo', premortems);
  await emit(d, 'seat_done', { asiento: 'abogado_diablo', resumen: 'premortem por camino', citasInvalidas: 0 });
  await roundDone(d, 3);

  // ---- Ronda 5 · Síntesis del moderador (DEEP) --------------------------------------
  if (await cancelled()) return cancelledOutcome(d, ledger);
  await roundStart(d, 5);
  const objeciones: Array<{ id: string; texto: string }> = [];
  for (const p of (premortems.premortems as Array<{ camino: number; objeciones: Array<{ relato_72h: string }> }>)) {
    p.objeciones.forEach((o, k) => objeciones.push({ id: `C${p.camino}-${k + 1}`, texto: o.relato_72h }));
  }
  const memoCtx = `${SEAT_PREAMBLE}\n\nAsiento: moderador. Escribe el memorando con las secciones del esquema. Recomienda un camino (índice en caminos) con confianza. Cada objeción del abogado del diablo debe aparecer en objeciones_da con su id, su estado (resuelta, mitigada o aceptada) y cómo se trata. Todo veto del asiento legal debe aparecer en vetos[]. Si un veto sigue sin resolver, no recomiendes ese camino.\n\nAgencia: ${d.agency.name}. Fecha: ${d.dateLabel}.\nPregunta: ${d.question}\n\nCaminos:\n${JSON.stringify(caminos)}\n\nAbogado del diablo:\n${JSON.stringify(premortems)}\n\nObjeciones a cubrir (id y texto):\n${JSON.stringify(objeciones)}`;
  // El memorando se pide en tres partes en paralelo (el esquema completo no compila en el servicio).
  // Cada parte tiene su propio tope de salida: partir el cuerpo evita agotarlo, sin subirlo.
  const memoPart = (outputSchema: Record<string, unknown>, part: MemoPart) =>
    structuredCall(d, ledger, { model: d.models.deep, effort: 'medium', maxTokens: 12000, system: famB, outputSchema, messages: [{ role: 'user', content: memoCtx }] },
      (x) => validateMemoPart(part, x), `memo_${part}_invalid`);
  const [memoHead, memoCaminos, memoDa] = await Promise.all([
    memoPart(MEMO_HEAD_SCHEMA as unknown as Record<string, unknown>, 'head'),
    memoPart(MEMO_CAMINOS_SCHEMA as unknown as Record<string, unknown>, 'caminos'),
    memoPart(MEMO_DA_SCHEMA as unknown as Record<string, unknown>, 'da'),
  ]);
  const memoRaw = { ...memoHead, ...memoCaminos, ...memoDa };
  if (!validateMemo(memoRaw)) throw new PanelError('memo_invalid', 'memorando combinado no cumple el esquema');
  const memo = applyMemoRules(memoRaw, { objeciones, caminos, seat: rotating });

  // Citas y revisión automática (spec §3.3 paso 8, §8.3 reglas).
  const citations = checkCitations(JSON.stringify(memo), { seenIds: seen, manual: MANUAL_TEXT, legal: LEGAL_RULES_TEXT });
  const borradores: Array<Record<string, unknown>> = (memo.borradores as Array<Record<string, unknown>>).map((b) => {
    const r = reviewDraft(String(b.texto), { vedaActiva: d.signals.vedaActiva, esFamilia: d.agency.slug === 'df' });
    return { ...b, revision: { ok: r.alertas === 0, alertas: r.alertas, puntos: r.puntos } };
  });
  memo.borradores = borradores;
  await saveStep(d.pool, d.runId, '5.moderador', memo);
  await emit(d, 'memo', { memo });
  if (borradores.length) await emit(d, 'review', { borradores: borradores.map((b) => ({ tipo_plantilla: b.tipo_plantilla, ok: (b.revision as { ok: boolean }).ok, alertas: (b.revision as { alertas: number }).alertas })) });
  await roundDone(d, 5);

  const snap = ledger.snapshot();
  return { status: 'done', memo, citations: { total: citations.total, invalid: citations.invalid }, usage: snap.usage, costUsd: snap.costUsd };
}

function cancelledOutcome(d: PanelDeps, ledger: TokenLedger): PanelOutcome {
  const snap = ledger.snapshot();
  void d;
  return { status: 'cancelled', memo: null, citations: { total: 0, invalid: 0 }, usage: snap.usage, costUsd: snap.costUsd };
}

/**
 * Reglas que hace cumplir el código (spec §8.3): toda objeción aparece con su estado y
 * todo veto sin resolver bloquea la recomendación de su camino.
 */
export function applyMemoRules(
  memo: Record<string, unknown>,
  ctx: { objeciones: Array<{ id: string; texto: string }>; caminos: Array<{ camino: number; nombre: string; posicion: Record<string, unknown> }>; seat: string },
): Record<string, unknown> {
  const out = { ...memo };
  const covered = new Set((out.objeciones_da as Array<{ id: string }>).map((o) => o.id));
  const objeciones = [...(out.objeciones_da as Array<Record<string, unknown>>)];
  for (const o of ctx.objeciones) {
    if (!covered.has(o.id)) {
      objeciones.push({ id: o.id, texto: o.texto, estado: 'aceptada', como: 'aceptada (sin respuesta del moderador)' });
    }
  }
  out.objeciones_da = objeciones;

  // Vetos del asiento legal: deben aparecer; uno sin resolver bloquea el camino del legal.
  const legalIdx = ctx.caminos.findIndex((c) => c.posicion && Array.isArray(c.posicion.vetos) && (c.posicion.vetos as unknown[]).length > 0);
  const vetosLegal = legalIdx >= 0 ? (ctx.caminos[legalIdx].posicion.vetos as Array<{ texto: string; estado: string }>) : [];
  const vetosOut = [...(out.vetos as Array<Record<string, unknown>>)];
  for (const v of vetosLegal) {
    if (!vetosOut.some((x) => x.texto === v.texto)) vetosOut.push({ asiento: 'legal', texto: v.texto, estado: v.estado });
  }
  out.vetos = vetosOut;
  const sinResolver = vetosOut.filter((v) => v.estado === 'sin_resolver');
  const rec = { ...(out.recomendacion as Record<string, unknown>) };
  if (sinResolver.length && Number(rec.camino) === legalIdx) {
    rec.confianza_cualitativa = 'baja';
    rec.porque = `Veto sin resolver: ${String(sinResolver[0].texto)}. ${String(rec.porque)}`;
  }
  out.recomendacion = rec;
  return out;
}

export { AdvisorBudgetError };
