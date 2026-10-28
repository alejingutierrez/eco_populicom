// Resiliencia ante los 429 de Brandwatch. Lógica pura (sin red; reloj y sleep
// inyectables) separada del cliente para poder probarla sin llamar a la API.
//
// Contexto: la cuota es ~30 req/10 min por cuenta y se comparte con
// biq-ingestion. Los 429 TAMBIÉN consumen cupo, así que reintentar rápido o
// durante mucho rato dentro de una racha empeora la racha (24–26-oct y
// 28-oct-2026: una corrida de 676 s y otra de 759 s, con Gobernadora y DF sin
// ingesta). Reglas:
//   - una corrida incremental reintenta poco (3 intentos) y tiene un
//     presupuesto de tiempo y de requests; al agotarlo se rinde;
//   - agotar los reintentos por 429 lanza BrandwatchRateLimitError, que el
//     handler usa para abortar el resto de la corrida (cortacircuitos);
//   - los reintentos largos (11 intentos, esperas de hasta 45 s) quedan solo
//     para backfill manual, donde esperar una ventana de cuota es aceptable.

export interface RetryPolicy {
  /** Intentos totales por request (el primero + los reintentos). */
  maxAttempts: number;
  /** Espera tras un 429 sin Retry-After: base · 2^(intento-1). */
  rateLimitBaseDelayMs: number;
  /** Espera tras un 5xx: base · 2^(intento-1). */
  serverErrorBaseDelayMs: number;
  /** Tope de cualquier espera entre reintentos. */
  maxDelayMs: number;
  /**
   * Retry-After por encima del tope. true = esperar solo el tope (conducta
   * histórica). false = rendirse: esperar menos de lo que Brandwatch pide solo
   * gasta otro request en un 429 casi seguro.
   */
  truncateRetryAfter: boolean;
}

// Incremental (cada 5 min) y refresh diario: 3 intentos con esperas de 15 s y
// 30 s. Esperar segundos tras un 429 no sirve (la ventana es de 10 min), pero
// cada intento extra gasta cupo compartido; por eso pocos y espaciados.
export const BOUNDED_RETRY: RetryPolicy = {
  maxAttempts: 3,
  rateLimitBaseDelayMs: 15_000,
  serverErrorBaseDelayMs: 2_000,
  maxDelayMs: 30_000,
  truncateRetryAfter: false,
};

// Backfill manual: la política histórica (MAX_RETRIES = 10 → 11 intentos,
// 2 s · 2^n con tope de 45 s).
export const LONG_RETRY: RetryPolicy = {
  maxAttempts: 11,
  rateLimitBaseDelayMs: 2_000,
  serverErrorBaseDelayMs: 2_000,
  maxDelayMs: 45_000,
  truncateRetryAfter: true,
};

// Un Retry-After de 0 (o negativo) no es permiso para reintentar al instante.
export const MIN_RETRY_WAIT_MS = 1_000;

export type RateLimitReason = 'attempts-exhausted' | 'retry-after-too-long' | 'budget-exhausted';

export type RetryDecision =
  | { retry: true; waitMs: number }
  | { retry: false; reason: RateLimitReason };

export interface RetryContext {
  /** 429 o ≥500. */
  status: number;
  /** Intento (1-based) que acaba de fallar. */
  attempt: number;
  /** Retry-After del servidor ya en ms, o null si no vino / no se entiende. */
  retryAfterMs: number | null;
}

/**
 * Retry-After en ms. Acepta segundos enteros y fecha HTTP; cualquier otra cosa
 * → null (el llamador cae al backoff). Antes `parseInt` de una fecha daba NaN
 * y el `setTimeout(NaN)` reintentaba al instante.
 */
export function parseRetryAfterMs(header: string | null | undefined, nowMs: number): number | null {
  if (header === null || header === undefined) return null;
  const value = header.trim();
  if (value === '') return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // Una fecha HTTP lleva letras (día y mes); sin ellas `Date.parse` se traga
  // basura como "-5" o "5.5" y devolvería fechas absurdas.
  if (!/[a-z]/i.test(value)) return null;
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

/**
 * ¿Reintentar y cuánto esperar? `remainingBudgetMs` es el tiempo que queda de
 * la corrida: si la espera no deja tiempo para hacer el request después,
 * rendirse ya es mejor que dormir y fallar igual.
 */
export function decideRetry(
  policy: RetryPolicy,
  ctx: RetryContext,
  remainingBudgetMs: number = Infinity,
): RetryDecision {
  if (ctx.attempt >= policy.maxAttempts) return { retry: false, reason: 'attempts-exhausted' };

  let waitMs: number;
  if (ctx.status === 429 && ctx.retryAfterMs !== null) {
    if (ctx.retryAfterMs > policy.maxDelayMs) {
      if (!policy.truncateRetryAfter) return { retry: false, reason: 'retry-after-too-long' };
      waitMs = policy.maxDelayMs;
    } else {
      waitMs = ctx.retryAfterMs;
    }
  } else {
    const base = ctx.status === 429 ? policy.rateLimitBaseDelayMs : policy.serverErrorBaseDelayMs;
    waitMs = Math.min(base * 2 ** (ctx.attempt - 1), policy.maxDelayMs);
  }
  waitMs = Math.max(waitMs, MIN_RETRY_WAIT_MS);

  if (waitMs >= remainingBudgetMs) return { retry: false, reason: 'budget-exhausted' };
  return { retry: true, waitMs };
}

/** Cuánto esperar para que entre un request a `minIntervalMs` del anterior. */
export function paceDelayMs(nowMs: number, lastAtMs: number | null, minIntervalMs: number): number {
  if (lastAtMs === null || minIntervalMs <= 0) return 0;
  return Math.max(0, lastAtMs + minIntervalMs - nowMs);
}

/**
 * Se agotaron los reintentos por 429 (o no hay tiempo para otro). El `code` es
 * lo que usa el handler para reconocerlo sin depender de `instanceof`.
 */
export class BrandwatchRateLimitError extends Error {
  readonly code = 'BW_RATE_LIMIT' as const;
  readonly status = 429;

  constructor(
    readonly reason: RateLimitReason,
    readonly attempts: number,
    readonly retryAfterMs: number | null,
  ) {
    super(
      `Brandwatch rate limit (429): ${reason} after ${attempts} attempt(s)` +
        (retryAfterMs !== null ? `, Retry-After ${Math.round(retryAfterMs / 1000)}s` : ''),
    );
    this.name = 'BrandwatchRateLimitError';
  }
}

/** El presupuesto de la corrida (tiempo o requests) no permite otro request. */
export class BrandwatchBudgetError extends Error {
  readonly code = 'BW_BUDGET' as const;

  constructor(readonly reason: 'deadline' | 'request-cap', message: string) {
    super(message);
    this.name = 'BrandwatchBudgetError';
  }
}

export interface RunBudgetOptions {
  /** Hora límite absoluta (epoch ms). Sin ella, sin límite de tiempo. */
  deadlineMs?: number;
  /** Tope de requests de la corrida (incluye reintentos). */
  maxRequests?: number;
  /** Separación mínima entre requests (pacing). 0 = sin pacing. */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Presupuesto COMPARTIDO por todos los clientes de una corrida (el handler crea
 * un BrandwatchClient por agencia, pero el tiempo, el tope y el pacing son de
 * la corrida entera). Cada request pasa por `acquire()`.
 */
export class RunBudget {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  private readonly deadlineMs?: number;
  private readonly maxRequests?: number;
  private readonly minIntervalMs: number;
  private used = 0;
  private lastAtMs: number | null = null;

  constructor(opts: RunBudgetOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
    this.deadlineMs = opts.deadlineMs;
    this.maxRequests = opts.maxRequests;
    this.minIntervalMs = opts.minIntervalMs ?? 0;
  }

  get requestsMade(): number {
    return this.used;
  }

  /** Ms hasta la hora límite (Infinity si no hay). Puede ser ≤ 0. */
  remainingMs(): number {
    return this.deadlineMs === undefined ? Infinity : this.deadlineMs - this.now();
  }

  /**
   * Reserva el siguiente request: espera el pacing y lo cuenta. Lanza
   * BrandwatchBudgetError si ya se alcanzó el tope o si la espera (o el
   * momento actual) pasa de la hora límite.
   */
  async acquire(): Promise<void> {
    if (this.maxRequests !== undefined && this.used >= this.maxRequests) {
      throw new BrandwatchBudgetError(
        'request-cap',
        `Brandwatch request cap reached (${this.maxRequests} requests this run)`,
      );
    }
    const t = this.now();
    const waitMs = paceDelayMs(t, this.lastAtMs, this.minIntervalMs);
    if (this.deadlineMs !== undefined && t + waitMs >= this.deadlineMs) {
      throw new BrandwatchBudgetError(
        'deadline',
        `Brandwatch run time budget exhausted (${this.used} requests made)`,
      );
    }
    if (waitMs > 0) await this.sleep(waitMs);
    this.lastAtMs = this.now();
    this.used++;
  }
}
