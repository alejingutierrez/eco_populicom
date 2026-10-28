// Guardas de una corrida de ingesta (puras, sin I/O), separadas del handler
// para probarlas sin AWS ni Brandwatch. El detalle de reintentos, pacing y
// presupuesto por request vive en @eco/brandwatch (resilience.ts); aquí está
// lo que decide el handler: qué modo es la corrida, qué plan le toca y cuándo
// se aborta lo que falta (cortacircuitos).
//
// Importa solo tipos de @eco/brandwatch (y las políticas, que son datos) para
// que las pruebas no dependan del workspace.

import { BOUNDED_RETRY, LONG_RETRY } from '../../../packages/brandwatch/src/resilience';
import type { RetryPolicy } from '../../../packages/brandwatch/src/resilience';

export type RunMode = 'incremental' | 'refresh' | 'backfill';

// Un `refreshLastHours` mayor que esto es en realidad un backfill pedido a mano
// (ventana larga): merece reintentos largos y no el tope de requests del
// refresh diario (que usa 48).
export const REFRESH_MAX_HOURS = 72;

export interface RunModeInput {
  backfillStartDate?: string;
  refreshLastHours?: number;
}

/**
 * incremental = cron de 5 min (avanza el cursor); refresh = cron diario de
 * 07:00Z (`refreshLastHours`, no toca el cursor); backfill = ventana explícita
 * pedida a mano. Una ventana explícita gana sobre `refreshLastHours`, igual que
 * en el handler.
 */
export function resolveRunMode(evt: RunModeInput): RunMode {
  if (evt.backfillStartDate) return 'backfill';
  const hours = evt.refreshLastHours;
  if (typeof hours === 'number' && hours > 0) {
    return hours <= REFRESH_MAX_HOURS ? 'refresh' : 'backfill';
  }
  return 'incremental';
}

export interface RunPlan {
  mode: RunMode;
  retry: RetryPolicy;
  /** Tiempo máximo de reloj de la corrida entera. */
  budgetMs: number;
  /** Separación mínima entre requests a Brandwatch (0 = sin pacing). */
  minRequestIntervalMs: number;
  /** Tope de requests de la corrida (undefined = sin tope). */
  maxRequests?: number;
}

const MINUTE = 60_000;

// El lambda tiene timeout de 15 min y el cron cae cada 5: una corrida
// incremental normal dura segundos; 3 min de presupuesto es holgura de sobra y
// acota el peor caso (antes 11 reintentos de hasta 45 s por query: 676–759 s).
//
// El refresh de 07:00Z pide ~19 requests en 20 s (48 h × todas las queries) y
// es el disparador habitual de la espiral. 30 s entre requests = 20 req/10 min:
// deja ~10 de los ~30 de la cuota para biq-ingestion, y 24 requests (≈12 min a
// ese ritmo) como techo duro. Corre a las 03:00 hora de PR, y como el refresh
// repite cada día la ventana de 48 h, abandonarlo a medias no pierde nada.
const PLANS: Record<RunMode, Omit<RunPlan, 'mode'>> = {
  incremental: { retry: BOUNDED_RETRY, budgetMs: 3 * MINUTE, minRequestIntervalMs: 0 },
  refresh: {
    retry: BOUNDED_RETRY,
    budgetMs: 12 * MINUTE,
    minRequestIntervalMs: 30_000,
    maxRequests: 24,
  },
  backfill: { retry: LONG_RETRY, budgetMs: 14 * MINUTE, minRequestIntervalMs: 0 },
};

export function planRun(mode: RunMode): RunPlan {
  return { mode, ...PLANS[mode] };
}

/**
 * Hora límite (epoch ms) de la corrida: el presupuesto del plan, recortado a lo
 * que le queda al lambda menos un margen para cerrar (summary, conexión a la
 * DB). Sin `lambdaRemainingMs` (ejecución local) manda solo el presupuesto.
 */
export function computeDeadlineMs(
  startMs: number,
  budgetMs: number,
  lambdaRemainingMs?: number,
  safetyMs: number = MINUTE,
): number {
  const byLambda = lambdaRemainingMs === undefined ? Infinity : lambdaRemainingMs - safetyMs;
  return startMs + Math.max(0, Math.min(budgetMs, byLambda));
}

// ---- Cortacircuitos ----

export type FailureKind = 'rate-limit' | 'budget' | 'other';

/**
 * Clasifica el error de una query por su `code` (no por `instanceof`): el
 * handler va en un bundle de esbuild y así no depende de qué copia de la clase
 * lo lanzó.
 */
export function classifyFailure(err: unknown): FailureKind {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === 'BW_RATE_LIMIT') return 'rate-limit';
  if (code === 'BW_BUDGET') return 'budget';
  return 'other';
}

/**
 * Cortacircuitos de la corrida. Se abre con el PRIMER fallo que implica que
 * ningún request más va a pasar: una query agotó sus reintentos por 429, o se
 * acabó el presupuesto (tiempo / requests). Con la cuota de Brandwatch
 * saturada, seguir con las demás queries solo gasta ~5 min de reintentos en
 * cada una y más cupo compartido. Los demás errores (5xx de una query, DB,
 * SQS) no lo abren: afectan solo a esa query.
 */
export class RunBreaker {
  private openedBy: string | null = null;

  get isOpen(): boolean {
    return this.openedBy !== null;
  }

  /** Por qué se abrió (para el log y el summary), o null. */
  get reason(): string | null {
    return this.openedBy;
  }

  /** Registra el fallo de una query; devuelve true si abrió el cortacircuitos. */
  record(err: unknown, label: string): boolean {
    if (this.isOpen) return false;
    const kind = classifyFailure(err);
    if (kind === 'other') return false;
    const detail = (err as Error)?.message ?? String(err);
    this.openedBy = `${label}: ${kind === 'rate-limit' ? '429 sin reintentos' : 'presupuesto agotado'} (${detail})`;
    return true;
  }
}
