// Persistencia de corridas del asesor: advisor_runs y advisor_events (spec §9.2–§9.6, §10.1).
// Todas las consultas filtran por agency_id; el acceso por usuario lo decide el caller.

import type { getPool } from '@eco/database';

export type Pool = ReturnType<typeof getPool>;

export type RunStatus = 'queued' | 'running' | 'done' | 'error' | 'error_budget' | 'error_interrupted' | 'cancelled';
export const TERMINAL_STATUSES: RunStatus[] = ['done', 'error', 'error_budget', 'error_interrupted', 'cancelled'];

export interface RunRow {
  id: string;
  agency_id: string;
  user_sub: string;
  user_email: string | null;
  conversation_id: string | null;
  question: string;
  camino: number;
  forced: string | null;
  status: RunStatus;
  cancel_requested: boolean;
  as_of: Date;
  triage_json: unknown;
  memo_json: unknown;
  choice: string | null;
  choice_note: string | null;
  cost_usd: string | number | null;
  citations_total: number | null;
  citations_invalid: number | null;
  error_code: string | null;
  duration_ms: number | null;
  created_at: Date;
}

export async function createRun(
  pool: Pool,
  r: { agencyId: string; userSub: string; userEmail: string | null; conversationId: string; question: string; camino: number; forced: string | null; asOf: Date; knowledgeVersion: Record<string, string>; triage: unknown },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO advisor_runs (agency_id, user_sub, user_email, conversation_id, question, camino, forced, status, as_of, knowledge_version, triage_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9, $10) RETURNING id`,
    [r.agencyId, r.userSub, r.userEmail, r.conversationId, r.question, r.camino, r.forced, r.asOf, JSON.stringify(r.knowledgeVersion), JSON.stringify(r.triage)],
  );
  return rows[0].id;
}

/** Añade un evento con el siguiente seq. Una corrida tiene un solo escritor (el proceso que la ejecuta). */
export async function appendEvent(pool: Pool, runId: string, type: string, payload: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO advisor_events (run_id, seq, type, payload)
     SELECT $1::uuid, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb FROM advisor_events WHERE run_id = $1::uuid`,
    [runId, type, JSON.stringify(payload)],
  );
}

export async function setRunStatus(
  pool: Pool,
  runId: string,
  status: RunStatus,
  extra: { errorCode?: string; memo?: unknown; usage?: unknown; costUsd?: number | null; citations?: { total: number; invalid: number }; durationMs?: number } = {},
): Promise<void> {
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
export async function saveStep(pool: Pool, runId: string, key: string, value: unknown): Promise<void> {
  await pool.query(
    `UPDATE advisor_runs SET deliberacion_json = deliberacion_json || jsonb_build_object($2::text, $3::jsonb), updated_at = now() WHERE id = $1`,
    [runId, key, JSON.stringify(value)],
  );
}

export async function isCancelRequested(pool: Pool, runId: string): Promise<boolean> {
  const { rows } = await pool.query<{ cancel_requested: boolean }>('SELECT cancel_requested FROM advisor_runs WHERE id = $1', [runId]);
  return rows[0]?.cancel_requested === true;
}

/**
 * Lee una corrida si es del usuario (o si el caller es staff). Un ID ajeno devuelve null,
 * no «prohibido» (spec §12.1). El acceso por agencia lo decide el caller con advisorAllowed.
 */
export async function loadRun(pool: Pool, runId: string, userSub: string, staff: boolean): Promise<RunRow | null> {
  const { rows } = await pool.query<RunRow>(
    `SELECT * FROM advisor_runs WHERE id = $1::uuid AND ($2::boolean OR user_sub = $3)`,
    [runId, staff, userSub],
  );
  return rows[0] ?? null;
}

export async function listEvents(pool: Pool, runId: string, after: number, limit = 100): Promise<Array<{ seq: number; type: string; payload: unknown; createdAt: Date }>> {
  const { rows } = await pool.query<{ seq: number; type: string; payload: unknown; created_at: Date }>(
    `SELECT seq, type, payload, created_at FROM advisor_events WHERE run_id = $1::uuid AND seq > $2 ORDER BY seq LIMIT $3`,
    [runId, after, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r) => ({ seq: r.seq, type: r.type, payload: r.payload, createdAt: r.created_at }));
}

export async function listRuns(pool: Pool, agencyId: string, userSub: string, staff: boolean, limit: number): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT id, status, camino, question, cost_usd, choice, created_at, user_email
       FROM advisor_runs
      WHERE agency_id = $1::uuid AND ($2::boolean OR user_sub = $3)
      ORDER BY created_at DESC
      LIMIT $4`,
    [agencyId, staff, userSub, Math.min(Math.max(limit, 1), 50)],
  );
  return rows;
}

export async function setChoice(pool: Pool, runId: string, userSub: string, staff: boolean, choice: string, note: string | null): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE advisor_runs SET choice = $4, choice_note = $5, chosen_at = now(), updated_at = now()
      WHERE id = $1::uuid AND ($2::boolean OR user_sub = $3)`,
    [runId, staff, userSub, choice, note],
  );
  return (rowCount ?? 0) > 0;
}

export async function requestCancel(pool: Pool, runId: string, userSub: string, staff: boolean): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE advisor_runs SET cancel_requested = true, updated_at = now()
      WHERE id = $1::uuid AND ($2::boolean OR user_sub = $3) AND status NOT IN ('done','error','error_budget','error_interrupted','cancelled')`,
    [runId, staff, userSub],
  );
  return (rowCount ?? 0) > 0;
}
