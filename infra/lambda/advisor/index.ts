/**
 * eco-advisor — rondas 1 a 5 y revisión del consejo (camino 3) (spec §9.7, §11.1).
 *
 * La web deja la corrida en `rounds_queued` con la hoja de hechos de la ronda 0 y la invoca de forma
 * asíncrona (`{ runId }`). Aquí se toma la corrida de forma atómica (solo pasa a `running` desde
 * `rounds_queued`: una invocación duplicada sale sin hacer nada), se corren las rondas sobre la hoja
 * guardada —sin herramientas, solo llamadas al modelo y escritura en la base— y se deja el
 * memorando, los eventos y el costo. Cada salida es un checkpoint en `deliberacion_json`.
 *
 * Eventos del handler:
 *   { runId }                  corrida normal
 *   { runId, resume: true }    reanuda una corrida `error_interrupted` desde la última ronda completa
 *   { reaper: true }           barrido cada 10 min: interrumpe lo atascado y reinvoca `rounds_queued`
 *
 * Reglas del módulo LLM (spec §5.2): sin temperature ni tool_choice forzado, solo salidas
 * estructuradas, libro de tokens con techo de 3× el costo esperado. Cancelación: se consulta
 * `cancel_requested` cada pocos segundos y se aborta la petición en curso con AbortController.
 *
 * `pg` va bundleado (no externo) y `@aws-sdk/*` lo provee el runtime (CLAUDE.md).
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { Pool } from 'pg';
import { AdvisorBudgetError, RuntimeLLM, TokenLedger, type AdvisorLLM } from '@eco/shared/src/advisor/llm';
import { advisorModelId } from '@eco/shared/src/advisor/models';
import { COUNCIL_EXPECTED_COST_USD, CouncilError, runCouncil } from '@eco/shared/src/advisor/council';
import {
  appendEvent, claimRun, isCancelRequested, reapStaleRuns, saveStep, setRunStatus, type PgLike,
} from '@eco/shared/src/advisor/run-store';

const sm = new SecretsManagerClient({});
const lambda = new LambdaClient({});

const DB_SECRET_ARN = process.env.DB_SECRET_ARN!;
/** Margen antes del timeout para guardar el avance y terminar limpio. */
const DEADLINE_MARGIN_MS = 45_000;
const CANCEL_POLL_MS = 4_000;

let pool: Pool | null = null;
async function db(): Promise<Pool> {
  if (pool) return pool;
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
  const p = JSON.parse(secret.SecretString!);
  pool = new Pool({
    host: p.host, port: p.port ?? 5432, user: p.username, password: p.password, database: p.dbname ?? 'eco',
    ssl: { rejectUnauthorized: false }, max: 4,
  });
  return pool;
}

interface AdvisorEvent {
  runId?: string;
  resume?: boolean;
  reaper?: boolean;
}

interface LambdaContext {
  functionName?: string;
  getRemainingTimeInMillis?: () => number;
}

export async function handler(event: AdvisorEvent, context: LambdaContext = {}): Promise<{ ok: boolean; [k: string]: unknown }> {
  const p = (await db()) as unknown as PgLike;
  if (event.reaper) return reaper(p, context);
  if (!event.runId || !/^[0-9a-f-]{36}$/i.test(event.runId)) return { ok: false, error: 'runId inválido' };
  return processRun(p, event.runId, !!event.resume, context);
}

async function reinvoke(runId: string, context: LambdaContext): Promise<void> {
  await lambda.send(new InvokeCommand({
    FunctionName: context.functionName ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'eco-advisor',
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ runId })),
  }));
}

export async function reaper(pg: PgLike, context: LambdaContext, invoke: (runId: string) => Promise<void> = (runId) => reinvoke(runId, context)): Promise<{ ok: boolean; interrupted: number; requeued: number }> {
  const r = await reapStaleRuns(pg);
  for (const runId of r.requeue) await invoke(runId);
  console.log(JSON.stringify({ msg: 'advisor.reaper', interrupted: r.interrupted.length, requeued: r.requeue.length }));
  return { ok: true, interrupted: r.interrupted.length, requeued: r.requeue.length };
}

export async function processRun(
  pg: PgLike, runId: string, resume: boolean, context: LambdaContext, deps: { llm?: AdvisorLLM } = {},
): Promise<{ ok: boolean; [k: string]: unknown }> {
  const started = Date.now();
  const run = await claimRun(pg, runId, { resume });
  if (!run) {
    // Estado distinto de rounds_queued: invocación duplicada o ya procesada. No se hace nada.
    console.log(JSON.stringify({ msg: 'advisor.skip', runId }));
    return { ok: true, skipped: true };
  }
  const handoff = run.fact_sheet_json;
  if (!handoff?.factSheet) {
    await appendEvent(pg, runId, 'error', { code: 'sin_hoja_de_hechos', message: 'La corrida no tiene hoja de hechos.' });
    await setRunStatus(pg, runId, 'error', { errorCode: 'sin_hoja_de_hechos', durationMs: Date.now() - started });
    return { ok: false, error: 'sin_hoja_de_hechos' };
  }

  // Cancelación (spec §8.4): se consulta el indicador y se aborta la petición en curso.
  const cancel = new AbortController();
  const deadline = new AbortController();
  const abortAll = new AbortController();
  cancel.signal.addEventListener('abort', () => abortAll.abort());
  deadline.signal.addEventListener('abort', () => abortAll.abort());
  const poll = setInterval(() => {
    isCancelRequested(pg, runId).then((c) => { if (c) cancel.abort(); }).catch(() => undefined);
  }, CANCEL_POLL_MS);
  const remaining = context.getRemainingTimeInMillis?.() ?? 900_000;
  const guard = setTimeout(() => deadline.abort(), Math.max(10_000, remaining - DEADLINE_MARGIN_MS));

  const store = {
    appendEvent: (type: string, payload: unknown) => appendEvent(pg, runId, type, payload),
    saveStep: (key: string, value: unknown) => saveStep(pg, runId, key, value),
    isCancelRequested: () => isCancelRequested(pg, runId),
  };
  const ledger = new TokenLedger(COUNCIL_EXPECTED_COST_USD);
  const prior = run.usage_json as { round0?: { costUsd?: number | null }; contencion?: { costUsd?: number | null } };

  try {
    const llm = deps.llm ?? new RuntimeLLM(new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' }));
    const out = await runCouncil({
      llm, store, ledger,
      models: { fast: advisorModelId('FAST'), main: advisorModelId('MAIN'), deep: advisorModelId('DEEP') },
      factSheet: handoff.factSheet,
      seenIds: new Set(handoff.seenIds ?? []),
      question: run.question,
      agency: { slug: run.agency_slug, name: run.agency_name },
      dateLabel: handoff.context.dateLabel,
      vedaActiva: handoff.context.vedaActiva,
      seed: runId,
      checkpoints: run.deliberacion_json ?? {},
      signal: abortAll.signal,
    });

    // El costo total suma la ronda 0 y la contención (web) y las rondas (aquí); null si falta algún precio.
    const costParts = [prior.round0?.costUsd, prior.contencion?.costUsd, out.costUsd];
    const costUsd = costParts.every((c) => typeof c === 'number') ? +(costParts as number[]).reduce((a, b) => a + b, 0).toFixed(4) : null;
    const usage = { ...run.usage_json, rondas: { usage: out.usage, costUsd: out.costUsd, calls: out.calls, alarmas: out.alarms, reanudada: resume || undefined } };

    if (out.status === 'cancelled' && deadline.signal.aborted && !cancel.signal.aborted) {
      // Se acabó el tiempo del lambda: lo hecho queda en checkpoints y se puede reanudar.
      await appendEvent(pg, runId, 'error', { code: 'timeout', message: 'El consejo se interrumpió por tiempo. Puedes volver a preguntar.' });
      await setRunStatus(pg, runId, 'error_interrupted', { errorCode: 'timeout', usage, costUsd, durationMs: Date.now() - started });
      return { ok: false, error: 'timeout' };
    }
    if (out.status === 'cancelled') {
      await appendEvent(pg, runId, 'cancelled', {});
      await setRunStatus(pg, runId, 'cancelled', { usage, costUsd, durationMs: Date.now() - started });
      return { ok: true, cancelled: true };
    }
    await setRunStatus(pg, runId, 'done', { memo: out.memo, usage, costUsd, citations: out.citations, durationMs: Date.now() - started });
    console.log(JSON.stringify({ msg: 'advisor.done', runId, ms: Date.now() - started, alarmas: out.alarms }));
    return { ok: true };
  } catch (err) {
    const budget = err instanceof AdvisorBudgetError;
    const code = budget ? 'error_budget' : err instanceof CouncilError ? err.code : 'error';
    // Solo el código y el ID de corrida a los logs: la deliberación contiene menciones con nombres (spec §10.3).
    console.error(JSON.stringify({ msg: 'advisor.failed', runId, code, name: (err as Error).name }));
    await appendEvent(pg, runId, 'error', { code, message: budget ? 'La consulta superó el presupuesto de costo.' : 'El consejo no pudo terminar. Puedes intentar de nuevo.' }).catch(() => undefined);
    await setRunStatus(pg, runId, budget ? 'error_budget' : 'error', { errorCode: code, durationMs: Date.now() - started }).catch(() => undefined);
    return { ok: false, error: code };
  } finally {
    clearInterval(poll);
    clearTimeout(guard);
  }
}
