// Persistencia de corridas del asesor compartida por la web (camino 2, ronda 0 y contención del
// camino 3) y por el lambda `eco-advisor` (rondas 1 a 5): advisor_events, deliberacion_json y los
// estados de advisor_runs (spec §8.4, §9.7, §10.1, §10.4). Solo depende de `query`, así cualquier
// pool de `pg` sirve y los tests usan uno falso.

export interface PgLike {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type RunStatus =
  | 'queued'
  | 'r0_running'
  | 'rounds_queued'
  | 'running'
  | 'done'
  | 'error'
  | 'error_budget'
  | 'error_interrupted'
  | 'cancelled';

export const TERMINAL_STATUSES: RunStatus[] = ['done', 'error', 'error_budget', 'error_interrupted', 'cancelled'];

const UNIQUE_VIOLATION = '23505';

/**
 * Añade un evento con el siguiente seq. Varios asientos terminan casi a la vez y calculan el mismo
 * MAX(seq)+1: el segundo choca con la llave primaria. Se reintenta con una pausa corta y distinta
 * para cada intento en vez de perder el evento o tumbar la corrida.
 */
export async function appendEvent(pool: PgLike, runId: string, type: string, payload: unknown): Promise<void> {
  const sql = `INSERT INTO advisor_events (run_id, seq, type, payload)
     SELECT $1::uuid, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb FROM advisor_events WHERE run_id = $1::uuid`;
  const body = JSON.stringify(payload);
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query(sql, [runId, type, body]);
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== UNIQUE_VIOLATION || attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 25) * (attempt + 1)));
    }
  }
}

export interface RunStatusExtra {
  errorCode?: string;
  memo?: unknown;
  usage?: unknown;
  costUsd?: number | null;
  citations?: { total: number; invalid: number };
  durationMs?: number;
}

export async function setRunStatus(pool: PgLike, runId: string, status: RunStatus, extra: RunStatusExtra = {}): Promise<void> {
  await pool.query(
    `UPDATE advisor_runs SET
       status = $2,
       error_code = COALESCE($3, error_code),
       memo_json = COALESCE($4::jsonb, memo_json),
       usage_json = COALESCE($5::jsonb, usage_json),
       cost_usd = COALESCE($6, cost_usd),
       citations_total = COALESCE($7, citations_total),
       citations_invalid = COALESCE($8, citations_invalid),
       duration_ms = COALESCE($9, duration_ms),
       updated_at = now()
     WHERE id = $1`,
    [
      runId,
      status,
      extra.errorCode ?? null,
      extra.memo === undefined ? null : JSON.stringify(extra.memo),
      extra.usage === undefined ? null : JSON.stringify(extra.usage),
      extra.costUsd ?? null,
      extra.citations?.total ?? null,
      extra.citations?.invalid ?? null,
      extra.durationMs ?? null,
    ],
  );
}

/** Guarda la salida de un paso en deliberacion_json con la clave `{ronda}.{asiento}` (spec §8.4). */
export async function saveStep(pool: PgLike, runId: string, key: string, value: unknown): Promise<void> {
  await pool.query(
    `UPDATE advisor_runs SET deliberacion_json = deliberacion_json || jsonb_build_object($2::text, $3::jsonb), updated_at = now() WHERE id = $1`,
    [runId, key, JSON.stringify(value)],
  );
}

export async function isCancelRequested(pool: PgLike, runId: string): Promise<boolean> {
  const { rows } = await pool.query<{ cancel_requested: boolean }>('SELECT cancel_requested FROM advisor_runs WHERE id = $1', [runId]);
  return rows[0]?.cancel_requested === true;
}

/** Hoja de hechos de la ronda 0 y el contexto que el lambda necesita para correr las rondas 1 a 5. */
export interface CouncilHandoff {
  factSheet: Record<string, unknown>;
  /** IDs M-/N- que consultó la ronda 0 (base de la verificación de citas). */
  seenIds: string[];
  /** Menciones que el filtro marcó como intento de manipulación. */
  injection: Array<{ id: string; motivo: string; capa: string }>;
  context: { dateLabel: string; vedaActiva: boolean; guiaProbable: string | null; riesgoPersonas: boolean };
}

/** Deja lista la corrida para el lambda: guarda la hoja de hechos y pasa a `rounds_queued`. */
export async function queueRounds(pool: PgLike, runId: string, handoff: CouncilHandoff): Promise<void> {
  await pool.query(
    `UPDATE advisor_runs SET fact_sheet_json = $2::jsonb, status = 'rounds_queued', updated_at = now() WHERE id = $1`,
    [runId, JSON.stringify(handoff)],
  );
}

export interface ClaimedRun {
  id: string;
  agency_id: string;
  question: string;
  status: RunStatus;
  fact_sheet_json: CouncilHandoff | null;
  deliberacion_json: Record<string, unknown>;
  usage_json: Record<string, unknown>;
  agency_slug: string;
  agency_name: string;
  created_at: Date;
}

/**
 * Toma la corrida de forma atómica (spec §9.7): solo pasa a `running` si estaba en `rounds_queued`
 * (o en `error_interrupted` cuando se pide reanudar). Una invocación duplicada no encuentra la fila
 * en ese estado y sale sin hacer nada.
 */
export async function claimRun(pool: PgLike, runId: string, opts: { resume?: boolean } = {}): Promise<ClaimedRun | null> {
  const from: RunStatus[] = opts.resume ? ['rounds_queued', 'error_interrupted'] : ['rounds_queued'];
  const { rows } = await pool.query<ClaimedRun>(
    `WITH c AS (
       UPDATE advisor_runs SET status = 'running', error_code = NULL, updated_at = now()
        WHERE id = $1::uuid AND status = ANY($2::text[]) AND camino = 3
        RETURNING id, agency_id, question, status, fact_sheet_json, deliberacion_json, usage_json, created_at
     )
     SELECT c.*, a.slug AS agency_slug, a.name AS agency_name FROM c JOIN agencies a ON a.id = c.agency_id`,
    [runId, from],
  );
  return rows[0] ?? null;
}

export interface ReapResult {
  /** Corridas que pasaron a `error_interrupted`. */
  interrupted: string[];
  /** `rounds_queued` sin cambio que hay que reinvocar (una sola vez). */
  requeue: string[];
}

/**
 * Reaper (spec §10.4):
 *  · `r0_running` o `running` sin eventos en `staleMin` minutos → `error_interrupted`;
 *  · `rounds_queued` sin cambio en `queuedMin` minutos → se reinvoca una vez (marca `reinvoked`);
 *    si ya se había reinvocado y sigue igual, → `error_interrupted`.
 */
export async function reapStaleRuns(pool: PgLike, opts: { staleMin?: number; queuedMin?: number } = {}): Promise<ReapResult> {
  const staleMin = opts.staleMin ?? 15;
  const queuedMin = opts.queuedMin ?? 5;

  const stale = await pool.query<{ id: string }>(
    `UPDATE advisor_runs r SET status = 'error_interrupted', error_code = 'interrupted', updated_at = now()
      WHERE r.status IN ('r0_running', 'running')
        AND GREATEST(r.updated_at, COALESCE((SELECT MAX(e.created_at) FROM advisor_events e WHERE e.run_id = r.id), r.updated_at))
            < now() - ($1::int * INTERVAL '1 minute')
      RETURNING r.id`,
    [staleMin],
  );

  const stuck = await pool.query<{ id: string; reinvoked: boolean }>(
    `SELECT id, COALESCE((usage_json->>'reinvoked')::int, 0) > 0 AS reinvoked
       FROM advisor_runs
      WHERE status = 'rounds_queued' AND updated_at < now() - ($1::int * INTERVAL '1 minute')`,
    [queuedMin],
  );
  const requeue: string[] = [];
  const giveUp: string[] = [];
  for (const r of stuck.rows) (r.reinvoked ? giveUp : requeue).push(r.id);

  if (requeue.length) {
    await pool.query(
      `UPDATE advisor_runs SET usage_json = usage_json || '{"reinvoked":1}'::jsonb, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [requeue],
    );
  }
  if (giveUp.length) {
    await pool.query(
      `UPDATE advisor_runs SET status = 'error_interrupted', error_code = 'interrupted', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'rounds_queued'`,
      [giveUp],
    );
  }
  const interrupted = [...stale.rows.map((r) => r.id), ...giveUp];
  for (const id of interrupted) {
    await appendEvent(pool, id, 'error', { code: 'interrupted', message: 'La corrida se interrumpió. Puedes volver a preguntar.' });
  }
  return { interrupted, requeue };
}
