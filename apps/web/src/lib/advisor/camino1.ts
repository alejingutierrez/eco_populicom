// Camino 1 · directo (spec §7.1, §6.4, §5.2, §5.4). Un solo agente con herramientas, en streaming.
// Sin acceso a la base aquí: el caller pasa las herramientas y el emisor de eventos.

import {
  AdvisorBudgetError,
  TokenLedger,
  type AdvisorContentBlock,
  type AdvisorLLM,
  type AdvisorMessage,
  type AdvisorTool,
} from '@eco/shared/src/advisor/llm';
import { buildFamilyASystem, withTurnBreakpoint, toolsFingerprint } from '@eco/shared/src/advisor/cache';
import { ADVISOR_CONSTITUTION } from '@eco/shared/src/advisor/constitution';
import { MANUAL_TEXT } from '@eco/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT } from '@eco/shared/src/advisor/legal-rules';
import { ADVISOR_ROLES } from '@eco/shared/src/advisor/models';
import { checkCitations, idsInToolResult, type CitationCheck } from '@eco/shared/src/advisor/citations';
import { reviewDraft, type ReviewResult } from '@eco/shared/src/advisor/review';

/** Tope de turnos del modelo y de llamadas a herramientas del camino 1 (spec §6.4). */
export const CAMINO1_MAX_TURNS = 5;
export const CAMINO1_MAX_TOOL_CALLS = 10;
/** Costo esperado de una corrida del camino 1 para el libro de tokens (estimación de fase 0). */
export const CAMINO1_EXPECTED_COST_USD = 0.15;

/** Texto del aviso del harness al llegar al límite (spec §6.4). Va como mensaje de sistema. */
export const LIMIT_NOTICE = 'Llegaste al límite de consultas; responde con lo que tienes y di qué faltó.';

const PROGRESS_LABEL: Record<string, string> = {
  situacion_actual: 'Revisé la situación actual',
  como_viajo: 'Revisé hacia dónde va la atención',
  quien_movio_nss: 'Revisé qué movió el sentimiento',
  municipios: 'Revisé los municipios',
  historial_agencia: 'Revisé crisis anteriores de esta agencia',
  calendario_legal: 'Revisé el calendario legal',
};

export interface Camino1Tool {
  defs: AdvisorTool[];
  run(name: string, args: unknown): Promise<{ ok: boolean; text: string; resultTokens: number }>;
}

export interface Camino1Events {
  status(texto: string): void;
  toolCall(nombre: string, argsResumen: string): void;
  toolResult(nombre: string, ok: boolean, resumen: string): void;
  delta(text: string): void;
}

export interface Camino1Input {
  question: string;
  /** Turnos previos del mismo hilo, solo texto. */
  priorTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Fecha de hoy en palabras, hora de Puerto Rico. Va en el turno del usuario, nunca en el prefijo. */
  dateLabel: string;
  model: string;
  /** Slug de la agencia; solo para decidir la regla de Familia del revisor. */
  agencySlug: string;
}

export interface Camino1Outcome {
  text: string;
  stopReason: string;
  toolCalls: number;
  turns: number;
  seenIds: Set<string>;
  citations: CitationCheck;
  review: ReviewResult;
  usage: ReturnType<TokenLedger['snapshot']>['usage'];
  costUsd: number | null;
  model: string;
  ms: number;
  /** Hash de la firma de herramientas usada en la corrida (test de orden fijo). */
  toolsFingerprint: string;
}

export async function runCamino1(
  input: Camino1Input,
  deps: { llm: AdvisorLLM; tools: Camino1Tool; events: Camino1Events },
): Promise<Camino1Outcome> {
  const t0 = Date.now();
  const cfg = ADVISOR_ROLES.camino1;
  const ledger = new TokenLedger(CAMINO1_EXPECTED_COST_USD);
  const system = buildFamilyASystem({ constitution: ADVISOR_CONSTITUTION, manual: MANUAL_TEXT });
  const seenIds = new Set<string>();

  const messages: AdvisorMessage[] = [
    ...input.priorTurns.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: `Fecha de hoy: ${input.dateLabel}.\n\n${input.question}` },
  ];

  let toolCalls = 0;
  let turns = 0;
  let stopReason = 'end_turn';
  let finalBlocks: AdvisorContentBlock[] = [];
  let model = input.model;

  for (let turn = 0; turn < CAMINO1_MAX_TURNS; turn++) {
    turns = turn + 1;
    const atLimit = turn === CAMINO1_MAX_TURNS - 1;
    // El aviso del harness va como mensaje de sistema después del último turno de usuario, nunca en un tool_result.
    if (atLimit && turn > 0) messages.push({ role: 'system', content: LIMIT_NOTICE });

    const res = await deps.llm.stream(
      {
        model: input.model,
        effort: cfg.effort,
        maxTokens: cfg.maxTokens,
        system,
        // Las herramientas se pasan en cada turno: cambiar el arreglo invalida la caché (spec §6.1).
        tools: deps.tools.defs,
        messages: withTurnBreakpoint(messages),
      },
      { onTextDelta: deps.events.delta },
    );
    model = res.model;
    // El precio se busca por el perfil que pedimos (us.*), no por el ID que devuelve el servicio.
    ledger.add(input.model, res);
    stopReason = res.stopReason;
    finalBlocks = res.content;

    if (res.stopReason === 'refusal') break;

    const toolUses = res.content.filter((b): b is Extract<AdvisorContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    messages.push({ role: 'assistant', content: res.content });

    if (toolUses.length === 0 || atLimit) break;

    // Respetar el tope de herramientas: lo que sobra se responde con error, sin ejecutarse.
    const remaining = Math.max(0, CAMINO1_MAX_TOOL_CALLS - toolCalls);
    const runnable = toolUses.slice(0, remaining);
    const skipped = toolUses.slice(remaining);

    const results = await Promise.all(
      runnable.map(async (use) => {
        const argsResumen = summarizeArgs(use.input);
        deps.events.toolCall(use.name, argsResumen);
        deps.events.status(PROGRESS_LABEL[use.name] ?? `Consulté ${use.name}`);
        const r = await deps.tools.run(use.name, use.input);
        for (const id of idsInToolResult(r.text)) seenIds.add(id);
        deps.events.toolResult(use.name, r.ok, r.ok ? `${r.resultTokens} tokens` : 'error');
        return { type: 'tool_result' as const, tool_use_id: use.id, content: r.text, is_error: !r.ok };
      }),
    );
    toolCalls += runnable.length;
    for (const use of skipped) {
      results.push({
        type: 'tool_result' as const,
        tool_use_id: use.id,
        content: JSON.stringify({ error: 'Límite de consultas alcanzado en esta respuesta.' }),
        is_error: true,
      });
    }
    messages.push({ role: 'user', content: results });
  }

  const text = finalBlocks
    .filter((b): b is Extract<AdvisorContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const citations = checkCitations(text, { seenIds, manual: MANUAL_TEXT, legal: LEGAL_RULES_TEXT });
  const review = reviewDraft(text, { vedaActiva: false, esFamilia: input.agencySlug === 'df' });

  const snap = ledger.snapshot();
  return {
    text,
    stopReason,
    toolCalls,
    turns,
    seenIds,
    citations,
    review,
    usage: snap.usage,
    costUsd: snap.costUsd,
    model,
    ms: Date.now() - t0,
    toolsFingerprint: toolsFingerprint(deps.tools.defs),
  };
}

/** Resumen corto de los argumentos para el evento tool_call. Nunca incluye texto de terceros. */
function summarizeArgs(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const keys = Object.keys(input as Record<string, unknown>);
  return keys.length ? keys.join(', ') : 'sin argumentos';
}

export { AdvisorBudgetError };
