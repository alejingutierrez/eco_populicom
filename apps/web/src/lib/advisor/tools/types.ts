import type { AdvisorTool } from '@eco/shared/src/advisor/llm';
import type { PgClientLike } from '@eco/shared';

/**
 * Contexto que pone el servidor. El modelo nunca elige la agencia ni la fecha
 * de corte: ninguna herramienta acepta esos argumentos.
 */
export interface AdvisorToolCtx {
  /** UUID de la agencia (agencies.id). Se usa tal cual en cada consulta `agency_id = $n::uuid`. */
  agencyId: string;
  agencySlug: string;
  agencyName: string;
  userSub: string;
  /** Producción: ahora. Evaluación: minuto congelado. */
  asOf: Date;
  runId: string | null;
  pool: PgClientLike;
}

export interface AdvisorToolResult {
  ok: boolean;
  /** Lo que recibe el modelo: siempre un string JSON. */
  text: string;
  /** Aproximado: Math.ceil(text.length / 4). */
  resultTokens: number;
}

export interface AdvisorToolSpec {
  def: AdvisorTool;
  run(ctx: AdvisorToolCtx, args: Record<string, unknown>): Promise<AdvisorToolResult>;
}
