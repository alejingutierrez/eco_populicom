// Persistencia de corridas del asesor: advisor_runs y advisor_events (spec §9.2–§9.6, §10.1).
// Todas las consultas filtran por agency_id; el acceso por usuario lo decide el caller.

import type { getPool } from '@eco/database';
import { type RunStatus } from '@eco/shared/src/advisor/run-store';

// La persistencia que también usa el lambda `eco-advisor` vive en shared (un solo SQL para los dos).
export { appendEvent, setRunStatus, saveStep, isCancelRequested, queueRounds, TERMINAL_STATUSES } from '@eco/shared/src/advisor/run-store';
export type { RunStatus, CouncilHandoff } from '@eco/shared/src/advisor/run-store';

export type Pool = ReturnType<typeof getPool>;

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
  r: { agencyId: string; userSub: string; userEmail: string | null; conversationId: string; question: string; camino: number; forced: string | null; asOf: Date; knowledgeVersion: Record<string, string>; triage: unknown; status?: RunStatus },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO advisor_runs (agency_id, user_sub, user_email, conversation_id, question, camino, forced, status, as_of, knowledge_version, triage_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $11, $8, $9, $10) RETURNING id`,
    [r.agencyId, r.userSub, r.userEmail, r.conversationId, r.question, r.camino, r.forced, r.asOf, JSON.stringify(r.knowledgeVersion), JSON.stringify(r.triage), r.status ?? 'running'],
  );
  return rows[0].id;
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
