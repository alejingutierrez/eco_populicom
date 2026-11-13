import { BrandwatchClient } from '../../packages/brandwatch/src/client';
import {
  BOUNDED_RETRY,
  BrandwatchBudgetError,
  BrandwatchRateLimitError,
  LONG_RETRY,
  RunBudget,
  decideRetry,
  paceDelayMs,
  parseQuotaUsed,
  parseRetryAfterMs,
} from '../../packages/brandwatch/src/resilience';
import type { RetryPolicy } from '../../packages/brandwatch/src/resilience';
import { cursorToCommit } from '../lambda/ingestion/cursor';
import {
  RunBreaker,
  QUOTA_CEILING,
  classifyFailure,
  computeDeadlineMs,
  planRun,
  resolveRunMode,
} from '../lambda/ingestion/run-guard';

const ms = (iso: string) => Date.parse(iso);

describe('parseRetryAfterMs', () => {
  const now = ms('2026-10-28T15:05:30Z');

  test('segundos enteros', () => {
    expect(parseRetryAfterMs('30', now)).toBe(30_000);
    expect(parseRetryAfterMs(' 0 ', now)).toBe(0);
  });

  test('fecha HTTP → diferencia con ahora (nunca negativa)', () => {
    expect(parseRetryAfterMs('Wed, 28 Oct 2026 15:06:00 GMT', now)).toBe(30_000);
    expect(parseRetryAfterMs('Wed, 28 Oct 2026 15:00:00 GMT', now)).toBe(0);
  });

  test('ausente o ininteligible → null (el llamador cae al backoff, no a NaN)', () => {
    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs(undefined, now)).toBeNull();
    expect(parseRetryAfterMs('', now)).toBeNull();
    expect(parseRetryAfterMs('soon', now)).toBeNull();
    expect(parseRetryAfterMs('-5', now)).toBeNull();
    expect(parseRetryAfterMs('5.5', now)).toBeNull();
  });
});

describe('decideRetry', () => {
  const rl = (attempt: number, retryAfterMs: number | null = null) => ({ status: 429, attempt, retryAfterMs });

  test('política acotada: 3 intentos, esperas de 15 s y 30 s, y se rinde', () => {
    expect(decideRetry(BOUNDED_RETRY, rl(1))).toEqual({ retry: true, waitMs: 15_000 });
    expect(decideRetry(BOUNDED_RETRY, rl(2))).toEqual({ retry: true, waitMs: 30_000 });
    expect(decideRetry(BOUNDED_RETRY, rl(3))).toEqual({ retry: false, reason: 'attempts-exhausted' });
  });

  test('política larga (backfill) = la histórica: 11 intentos, 2 s·2^n con tope de 45 s', () => {
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 10; attempt++) {
      const d = decideRetry(LONG_RETRY, rl(attempt));
      expect(d.retry).toBe(true);
      if (d.retry) waits.push(d.waitMs);
    }
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000, 45000, 45000, 45000, 45000, 45000]);
    expect(decideRetry(LONG_RETRY, rl(11))).toEqual({ retry: false, reason: 'attempts-exhausted' });
  });

  test('Retry-After dentro del tope se respeta', () => {
    expect(decideRetry(BOUNDED_RETRY, rl(1, 20_000))).toEqual({ retry: true, waitMs: 20_000 });
  });

  test('Retry-After por encima del tope: la acotada se rinde, la larga espera solo el tope', () => {
    expect(decideRetry(BOUNDED_RETRY, rl(1, 300_000))).toEqual({ retry: false, reason: 'retry-after-too-long' });
    expect(decideRetry(LONG_RETRY, rl(1, 300_000))).toEqual({ retry: true, waitMs: 45_000 });
  });

  test('Retry-After de 0 no autoriza un reintento inmediato', () => {
    expect(decideRetry(BOUNDED_RETRY, rl(1, 0))).toEqual({ retry: true, waitMs: 1_000 });
  });

  test('si la espera no deja tiempo para otro request, se rinde sin dormir', () => {
    expect(decideRetry(BOUNDED_RETRY, rl(1), 15_000)).toEqual({ retry: false, reason: 'budget-exhausted' });
    expect(decideRetry(BOUNDED_RETRY, rl(1), 15_001)).toEqual({ retry: true, waitMs: 15_000 });
  });

  test('5xx: backoff corto propio, sin mirar Retry-After', () => {
    expect(decideRetry(BOUNDED_RETRY, { status: 503, attempt: 1, retryAfterMs: 999_000 })).toEqual({
      retry: true,
      waitMs: 2_000,
    });
    expect(decideRetry(BOUNDED_RETRY, { status: 503, attempt: 2, retryAfterMs: null })).toEqual({
      retry: true,
      waitMs: 4_000,
    });
    expect(decideRetry(BOUNDED_RETRY, { status: 503, attempt: 3, retryAfterMs: null }).retry).toBe(false);
  });
});

describe('paceDelayMs', () => {
  test('el primer request y el pacing 0 no esperan', () => {
    expect(paceDelayMs(1000, null, 30_000)).toBe(0);
    expect(paceDelayMs(1000, 900, 0)).toBe(0);
  });

  test('completa el intervalo mínimo desde el request anterior', () => {
    expect(paceDelayMs(10_000, 0, 30_000)).toBe(20_000);
    expect(paceDelayMs(30_000, 0, 30_000)).toBe(0);
    expect(paceDelayMs(45_000, 0, 30_000)).toBe(0);
  });
});

// Reloj falso: `sleep` solo adelanta el tiempo, así que las pruebas con
// esperas de minutos corren al instante y sin red.
function fakeClock(start = 0) {
  let t = start;
  const waits: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
    get t() {
      return t;
    },
  };
}

describe('RunBudget', () => {
  test('pacing: separa los requests por el intervalo mínimo y los cuenta', async () => {
    const clock = fakeClock();
    const budget = new RunBudget({ minIntervalMs: 30_000, now: clock.now, sleep: clock.sleep });
    const at: number[] = [];
    for (let i = 0; i < 3; i++) {
      await budget.acquire();
      at.push(clock.t);
    }
    expect(at).toEqual([0, 30_000, 60_000]);
    expect(budget.requestsMade).toBe(3);
  });

  test('tope de requests: el siguiente lanza BrandwatchBudgetError(request-cap)', async () => {
    const clock = fakeClock();
    const budget = new RunBudget({ maxRequests: 2, now: clock.now, sleep: clock.sleep });
    await budget.acquire();
    await budget.acquire();
    const err = await budget.acquire().catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchBudgetError);
    expect(err.reason).toBe('request-cap');
    expect(err.code).toBe('BW_BUDGET');
    expect(budget.requestsMade).toBe(2);
  });

  test('hora límite: no arranca un request pasada la hora ni uno cuyo pacing la cruce', async () => {
    const clock = fakeClock();
    const budget = new RunBudget({
      deadlineMs: 40_000,
      minIntervalMs: 30_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    await budget.acquire(); // t=0
    await budget.acquire(); // t=30 000
    // El siguiente tocaría en t=60 000 > 40 000: se rinde SIN dormir.
    const waitsBefore = clock.waits.length;
    const err = await budget.acquire().catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchBudgetError);
    expect(err.reason).toBe('deadline');
    expect(clock.waits.length).toBe(waitsBefore);
  });

  test('sin deadline ni tope no limita nada', async () => {
    const clock = fakeClock();
    const budget = new RunBudget({ now: clock.now, sleep: clock.sleep });
    expect(budget.remainingMs()).toBe(Infinity);
    for (let i = 0; i < 100; i++) await budget.acquire();
    expect(clock.waits).toEqual([]);
  });
});

// ---- BrandwatchClient con fetch simulado (nunca llama a la API real) ----

type Step = { status: number; headers?: Record<string, string>; results?: unknown[]; total?: number };

function scriptedFetch(steps: Step[], clock: { t: number }) {
  const calls: Array<{ url: string; at: number }> = [];
  let i = 0;
  const impl = (async (url: string | URL | Request) => {
    calls.push({ url: String(url), at: clock.t });
    const step = steps[Math.min(i++, steps.length - 1)];
    const results = step.results ?? [];
    const body = step.status === 200
      ? JSON.stringify({ results, resultsTotal: step.total ?? results.length, resultsPage: 0, resultsPageSize: 100 })
      : 'error body';
    return new Response(body, { status: step.status, headers: step.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function makeClient(retry: RetryPolicy, steps: Step[], budgetOpts: ConstructorParameters<typeof RunBudget>[0] = {}) {
  const clock = fakeClock(ms('2026-10-28T15:05:00Z'));
  const budget = new RunBudget({ ...budgetOpts, now: clock.now, sleep: clock.sleep });
  const f = scriptedFetch(steps, clock);
  const client = new BrandwatchClient({ token: 'tok', projectId: 7, retry, budget, fetch: f.impl });
  const query = { queryId: 1, startDate: '2026-10-28T00:00:00Z', endDate: '2026-10-28T15:00:00Z' };
  return { client, clock, calls: f.calls, budget, query };
}

describe('BrandwatchClient: reintentos acotados', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test('un 429 y luego 200: espera 15 s y devuelve las menciones', async () => {
    const t = makeClient(BOUNDED_RETRY, [{ status: 429 }, { status: 200, results: [{ resourceId: 'a' }] }]);
    const out = await t.client.fetchAllMentions(t.query);
    expect(out).toHaveLength(1);
    expect(t.clock.waits).toEqual([15_000]);
    expect(t.calls).toHaveLength(2);
  });

  test('3 × 429: lanza BrandwatchRateLimitError tras 3 intentos y 45 s (antes: 11 intentos, ~5.5 min)', async () => {
    const t = makeClient(BOUNDED_RETRY, [{ status: 429 }]);
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchRateLimitError);
    expect(err.reason).toBe('attempts-exhausted');
    expect(err.attempts).toBe(3);
    expect(err.code).toBe('BW_RATE_LIMIT');
    expect(t.calls).toHaveLength(3);
    expect(t.clock.waits).toEqual([15_000, 30_000]);
    expect(t.clock.t - ms('2026-10-28T15:05:00Z')).toBe(45_000);
  });

  test('Retry-After de 5 min: se rinde en el acto, sin dormir ni gastar otro request', async () => {
    const t = makeClient(BOUNDED_RETRY, [{ status: 429, headers: { 'Retry-After': '300' } }]);
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchRateLimitError);
    expect(err.reason).toBe('retry-after-too-long');
    expect(err.retryAfterMs).toBe(300_000);
    expect(t.calls).toHaveLength(1);
    expect(t.clock.waits).toEqual([]);
  });

  test('Retry-After como fecha HTTP se respeta (antes: NaN → reintento inmediato)', async () => {
    const t = makeClient(BOUNDED_RETRY, [
      { status: 429, headers: { 'Retry-After': 'Wed, 28 Oct 2026 15:05:20 GMT' } },
      { status: 200 },
    ]);
    await t.client.fetchAllMentions(t.query);
    expect(t.clock.waits).toEqual([20_000]);
  });

  test('el presupuesto de tiempo corta la escalera: no duerme una espera que no cabe', async () => {
    const start = ms('2026-10-28T15:05:00Z');
    const t = makeClient(BOUNDED_RETRY, [{ status: 429 }], { deadlineMs: start + 20_000 });
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchRateLimitError);
    expect(err.reason).toBe('budget-exhausted');
    expect(err.attempts).toBe(2);
    expect(t.clock.waits).toEqual([15_000]); // la de 30 s no cabía y no se durmió
  });

  test('política larga (backfill): 11 intentos con la escalera histórica', async () => {
    const t = makeClient(LONG_RETRY, [{ status: 429 }]);
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchRateLimitError);
    expect(err.attempts).toBe(11);
    expect(t.calls).toHaveLength(11);
    expect(t.clock.waits).toEqual([2000, 4000, 8000, 16000, 32000, 45000, 45000, 45000, 45000, 45000]);
  });

  test('401/403 no se reintentan ni cuentan como rate limit', async () => {
    const t = makeClient(BOUNDED_RETRY, [{ status: 401 }]);
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err).not.toBeInstanceOf(BrandwatchRateLimitError);
    expect(String(err.message)).toContain('auth error 401');
    expect(t.calls).toHaveLength(1);
  });

  test('5xx: reintenta con backoff corto y, si no se recupera, falla como error normal (no abre el cortacircuitos)', async () => {
    const ok = makeClient(BOUNDED_RETRY, [{ status: 503 }, { status: 200 }]);
    await ok.client.fetchAllMentions(ok.query);
    expect(ok.clock.waits).toEqual([2_000]);

    const bad = makeClient(BOUNDED_RETRY, [{ status: 500 }]);
    const err = await bad.client.fetchAllMentions(bad.query).catch((e) => e);
    expect(err).not.toBeInstanceOf(BrandwatchRateLimitError);
    expect(String(err.message)).toContain('Brandwatch API error 500');
    expect(classifyFailure(err)).toBe('other');
    expect(bad.calls).toHaveLength(3);
  });

  test('pacing entre páginas: una cada 30 s (refresh diario)', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, k) => ({ resourceId: `m${k}` }));
    const t = makeClient(
      BOUNDED_RETRY,
      [
        { status: 200, results: page(2), total: 5 },
        { status: 200, results: page(2), total: 5 },
        { status: 200, results: page(1), total: 5 },
      ],
      { minIntervalMs: 30_000 },
    );
    const out: unknown[] = [];
    for await (const p of t.client.fetchMentionPages({ ...t.query, pageSize: 2 })) out.push(...p);
    expect(out).toHaveLength(5);
    const start = ms('2026-10-28T15:05:00Z');
    expect(t.calls.map((c) => c.at - start)).toEqual([0, 30_000, 60_000]);
  });

  test('el tope de requests corta la paginación con BrandwatchBudgetError', async () => {
    const page = Array.from({ length: 2 }, (_, k) => ({ resourceId: `m${k}` }));
    const t = makeClient(BOUNDED_RETRY, [{ status: 200, results: page, total: 100 }], { maxRequests: 2 });
    const err = await t.client.fetchAllMentions({ ...t.query, pageSize: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchBudgetError);
    expect(classifyFailure(err)).toBe('budget');
    expect(t.calls).toHaveLength(2);
  });
});

describe('resolveRunMode / planRun', () => {
  test('sin parámetros es el cron incremental', () => {
    expect(resolveRunMode({})).toBe('incremental');
  });

  test('refreshLastHours del cron diario (48) es refresh', () => {
    expect(resolveRunMode({ refreshLastHours: 48 })).toBe('refresh');
  });

  test('una ventana explícita es backfill y gana sobre refreshLastHours', () => {
    expect(resolveRunMode({ backfillStartDate: '2026-10-20T00:00:00Z' })).toBe('backfill');
    expect(resolveRunMode({ backfillStartDate: '2026-10-20T00:00:00Z', refreshLastHours: 48 })).toBe('backfill');
  });

  test('un refreshLastHours enorme pedido a mano es un backfill, no el refresh con tope', () => {
    expect(resolveRunMode({ refreshLastHours: 72 })).toBe('refresh');
    expect(resolveRunMode({ refreshLastHours: 73 })).toBe('backfill');
    expect(resolveRunMode({ refreshLastHours: 720 })).toBe('backfill');
  });

  test('refreshLastHours 0 / inválido no cambia el modo', () => {
    expect(resolveRunMode({ refreshLastHours: 0 })).toBe('incremental');
    expect(resolveRunMode({ refreshLastHours: -5 })).toBe('incremental');
  });

  test('incremental: ~3 intentos, presupuesto de 3 min, sin pacing ni tope', () => {
    const p = planRun('incremental');
    expect(p.retry).toBe(BOUNDED_RETRY);
    expect(p.retry.maxAttempts).toBe(3);
    expect(p.budgetMs).toBe(3 * 60_000);
    expect(p.minRequestIntervalMs).toBe(0);
    expect(p.maxRequests).toBeUndefined();
    expect(p.quotaCeiling).toBe(QUOTA_CEILING);
  });

  test('refresh: reintentos acotados, 30 s entre requests y tope de 12 que cabe en el presupuesto', () => {
    const p = planRun('refresh');
    expect(p.retry).toBe(BOUNDED_RETRY);
    expect(p.minRequestIntervalMs).toBe(30_000);
    expect(p.maxRequests).toBe(12);
    expect(p.quotaCeiling).toBe(QUOTA_CEILING);
    // ≤ 20 req/10 min (deja cupo a biq) y el tope se alcanza dentro del presupuesto
    expect(600_000 / p.minRequestIntervalMs).toBeLessThanOrEqual(20);
    expect((p.maxRequests! - 1) * p.minRequestIntervalMs).toBeLessThan(p.budgetMs);
    // el refresh de hoy (6–8 requests con páginas de 500) cabe holgado
    expect(8).toBeLessThanOrEqual(p.maxRequests!);
    // y deja margen bajo el timeout de 15 min del lambda
    expect(p.budgetMs).toBeLessThan(15 * 60_000);
  });

  test('backfill: reintentos largos y sin pacing ni tope', () => {
    const p = planRun('backfill');
    expect(p.retry).toBe(LONG_RETRY);
    expect(p.minRequestIntervalMs).toBe(0);
    expect(p.maxRequests).toBeUndefined();
    // a mano y con las ingestas en pausa: no cede por cuota
    expect(p.quotaCeiling).toBeUndefined();
  });

  test('el techo deja 6 de los 30 requests de la cuenta como reserva', () => {
    expect(QUOTA_CEILING).toBe(24);
  });
});

describe('computeDeadlineMs', () => {
  const start = ms('2026-10-28T07:00:00Z');

  test('sin contexto de Lambda manda el presupuesto del plan', () => {
    expect(computeDeadlineMs(start, 180_000)).toBe(start + 180_000);
  });

  test('lo que le queda al lambda (menos 60 s de margen) recorta el presupuesto', () => {
    expect(computeDeadlineMs(start, 14 * 60_000, 10 * 60_000)).toBe(start + 9 * 60_000);
    expect(computeDeadlineMs(start, 180_000, 14 * 60_000)).toBe(start + 180_000);
  });

  test('nunca queda antes del inicio', () => {
    expect(computeDeadlineMs(start, 180_000, 20_000)).toBe(start);
  });
});

describe('RunBreaker (cortacircuitos)', () => {
  const rateLimit = new BrandwatchRateLimitError('attempts-exhausted', 3, null);
  const budgetErr = new BrandwatchBudgetError('request-cap', 'cap');

  test('arranca cerrado', () => {
    const b = new RunBreaker();
    expect(b.isOpen).toBe(false);
    expect(b.reason).toBeNull();
  });

  test('el primer 429 sin reintentos lo abre (y solo ese devuelve true)', () => {
    const b = new RunBreaker();
    expect(b.record(rateLimit, '[ddecpr] Query 11')).toBe(true);
    expect(b.isOpen).toBe(true);
    expect(b.reason).toContain('[ddecpr] Query 11');
    expect(b.reason).toContain('429');
    expect(b.record(rateLimit, '[df] Query 21')).toBe(false);
    expect(b.reason).toContain('[ddecpr] Query 11'); // conserva la causa original
  });

  test('presupuesto agotado (tiempo / tope de requests) también lo abre', () => {
    const b = new RunBreaker();
    expect(b.record(budgetErr, '[ddecpr] Query 11')).toBe(true);
    expect(b.reason).toContain('presupuesto');
  });

  test('errores de una sola query (5xx, DB, SQS, auth) no lo abren', () => {
    const b = new RunBreaker();
    expect(b.record(new Error('Brandwatch API error 500: x'), 'q')).toBe(false);
    expect(b.record(new Error('connection terminated'), 'q')).toBe(false);
    expect(b.record(undefined, 'q')).toBe(false);
    expect(b.record(null, 'q')).toBe(false);
    expect(b.isOpen).toBe(false);
  });

  test('reconoce el error por `code`, no por instanceof', () => {
    expect(classifyFailure({ code: 'BW_RATE_LIMIT' })).toBe('rate-limit');
    expect(classifyFailure({ code: 'BW_BUDGET' })).toBe('budget');
    expect(classifyFailure({ code: 'ECONNRESET' })).toBe('other');
  });
});

describe('cursorToCommit', () => {
  const base = {
    isBackfill: false,
    totalMentions: 100,
    sendFailures: 0,
    cursorMs: ms('2026-10-28T14:00:00Z'),
    startDate: '2026-10-28T02:00:00.000Z',
  };

  test('éxito: lleva el cursor a la mención más reciente', () => {
    expect(cursorToCommit(base)).toBe('2026-10-28T14:00:00.000Z');
  });

  test('éxito con todo shells (sin fechas): registra startDate (GREATEST lo deja quieto)', () => {
    expect(cursorToCommit({ ...base, cursorMs: null })).toBe(base.startDate);
  });

  test('backfill, sin menciones o con fallos de encolado: no toca el cursor', () => {
    expect(cursorToCommit({ ...base, isBackfill: true })).toBeNull();
    expect(cursorToCommit({ ...base, totalMentions: 0 })).toBeNull();
    expect(cursorToCommit({ ...base, sendFailures: 3 })).toBeNull();
  });

  test('fallo a media paginación (429 en la página N): compromete lo ya encolado', () => {
    expect(cursorToCommit({ ...base, partial: true })).toBe('2026-10-28T14:00:00.000Z');
  });

  test('fallo a media paginación sin fechas o sin páginas: nada que comprometer', () => {
    expect(cursorToCommit({ ...base, cursorMs: null, partial: true })).toBeNull();
    expect(cursorToCommit({ ...base, totalMentions: 0, cursorMs: null, partial: true })).toBeNull();
  });

  test('fallo a media paginación con fallos de encolado: tampoco avanza', () => {
    expect(cursorToCommit({ ...base, sendFailures: 1, partial: true })).toBeNull();
  });
});

// ---- Cuota vista (x-rate-limit-used) y tiempo máximo por petición (ING-01) ----

describe('parseQuotaUsed', () => {
  test('entero → número', () => {
    expect(parseQuotaUsed('24')).toBe(24);
    expect(parseQuotaUsed(' 7 ')).toBe(7);
    expect(parseQuotaUsed('0')).toBe(0);
  });

  test('ausente o ininteligible → null (no se observa nada)', () => {
    for (const v of [null, undefined, '', '  ', '30/10m', '-1', '2.5', 'abc']) {
      expect(parseQuotaUsed(v)).toBeNull();
    }
  });
});

describe('RunBudget: techo de cuota', () => {
  const T0 = ms('2026-11-13T15:00:00Z');

  test('con la cuenta en el techo no sale otro request (quota-ceiling)', async () => {
    const clock = fakeClock(T0);
    const budget = new RunBudget({ quotaCeiling: 24, now: clock.now, sleep: clock.sleep });
    await budget.acquire();
    budget.observeQuota(23);
    await budget.acquire(); // 23 < 24: pasa
    budget.observeQuota(24);
    const err = await budget.acquire().catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchBudgetError);
    expect(err.reason).toBe('quota-ceiling');
    expect(classifyFailure(err)).toBe('budget');
    expect(budget.requestsMade).toBe(2);
    expect(budget.quotaUsedMax).toBe(24);
  });

  test('una lectura de más de 60 s ya no bloquea (la ventana es móvil)', async () => {
    const clock = fakeClock(T0);
    const budget = new RunBudget({ quotaCeiling: 24, now: clock.now, sleep: clock.sleep });
    budget.observeQuota(29);
    expect(budget.quotaBlockedAt()).toBe(true);
    await clock.sleep(59_999);
    expect(budget.quotaBlockedAt()).toBe(true);
    await clock.sleep(1);
    expect(budget.quotaBlockedAt()).toBe(false);
    await expect(budget.acquire()).resolves.toBeUndefined();
  });

  test('con pacing, la vigencia se mide en el momento en que saldría el request', async () => {
    const clock = fakeClock(T0);
    const budget = new RunBudget({ quotaCeiling: 24, minIntervalMs: 30_000, now: clock.now, sleep: clock.sleep });
    await budget.acquire();
    budget.observeQuota(26);
    // el siguiente saldría a los 30 s: la lectura sigue vigente → cede sin dormir
    await expect(budget.acquire()).rejects.toMatchObject({ reason: 'quota-ceiling' });
    expect(clock.waits).toEqual([]);
  });

  test('sin techo (backfill) la cuota se registra pero no limita', async () => {
    const clock = fakeClock(T0);
    const budget = new RunBudget({ now: clock.now, sleep: clock.sleep });
    budget.observeQuota(30);
    await expect(budget.acquire()).resolves.toBeUndefined();
    expect(budget.quotaUsedMax).toBe(30);
  });

  test('sin lectura (la API no mandó la cabecera) nunca bloquea', async () => {
    const clock = fakeClock(T0);
    const budget = new RunBudget({ quotaCeiling: 24, now: clock.now, sleep: clock.sleep });
    budget.observeQuota(null);
    for (let i = 0; i < 40; i++) await budget.acquire();
    expect(budget.quotaUsedMax).toBeNull();
  });
});

describe('BrandwatchClient: cuota vista y tiempo máximo', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const full = Array.from({ length: 100 }, (_, i) => ({ resourceId: `r${i}` }));
  const used = (n: number) => ({ 'x-rate-limit-used': String(n) });

  test('lee x-rate-limit-used de cada respuesta y cede antes de la petición que cruzaría el techo', async () => {
    const t = makeClient(
      BOUNDED_RETRY,
      [
        { status: 200, results: full, total: 500, headers: used(22) },
        { status: 200, results: full, total: 500, headers: used(24) },
        { status: 200, results: full, total: 500, headers: used(25) },
      ],
      { quotaCeiling: 24 },
    );
    const pages: unknown[][] = [];
    const err = await (async () => {
      for await (const p of t.client.fetchMentionPages(t.query)) pages.push(p);
    })().catch((e) => e);
    expect(pages).toHaveLength(2); // las dos páginas leídas se entregan
    expect(t.calls).toHaveLength(2); // la tercera NO sale
    expect(err).toBeInstanceOf(BrandwatchBudgetError);
    expect(err.reason).toBe('quota-ceiling');
    expect(t.budget.quotaUsedMax).toBe(24);
  });

  test('un 429 con la cuenta en el techo: se rinde en el acto, sin dormir ni reintentar', async () => {
    const t = makeClient(BOUNDED_RETRY, [{ status: 429, headers: used(31) }], { quotaCeiling: 24 });
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err).toBeInstanceOf(BrandwatchRateLimitError);
    expect(err.reason).toBe('quota-ceiling');
    expect(t.calls).toHaveLength(1);
    expect(t.clock.waits).toEqual([]);
    expect(t.budget.rateLimitedCount).toBe(1);
  });

  test('un 429 sin cabecera de cuota se reintenta como antes', async () => {
    const t = makeClient(BOUNDED_RETRY, [{ status: 429 }, { status: 200, results: [{ resourceId: 'a' }] }], {
      quotaCeiling: 24,
    });
    await expect(t.client.fetchAllMentions(t.query)).resolves.toHaveLength(1);
    expect(t.clock.waits).toEqual([15_000]);
    expect(t.budget.rateLimitedCount).toBe(1);
    expect(t.budget.quotaUsedMax).toBeNull();
  });

  test('sin cabecera el comportamiento es idéntico: pagina todo', async () => {
    const t = makeClient(
      BOUNDED_RETRY,
      [
        { status: 200, results: full, total: 250 },
        { status: 200, results: full, total: 250 },
        { status: 200, results: full.slice(0, 50), total: 250 },
      ],
      { quotaCeiling: 24 },
    );
    await expect(t.client.fetchAllMentions(t.query)).resolves.toHaveLength(250);
    expect(t.calls).toHaveLength(3);
  });

  function timeoutClient(retry: RetryPolicy, failures: number, budgetOpts: ConstructorParameters<typeof RunBudget>[0] = {}) {
    const clock = fakeClock(ms('2026-11-01T03:15:00Z'));
    const budget = new RunBudget({ ...budgetOpts, now: clock.now, sleep: clock.sleep });
    const signals: Array<AbortSignal | null | undefined> = [];
    let n = 0;
    const impl = (async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal);
      if (n++ < failures) {
        const e = new Error('The operation was aborted due to timeout');
        e.name = 'TimeoutError';
        throw e;
      }
      return new Response(JSON.stringify({ results: [{ resourceId: 'a' }], resultsTotal: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new BrandwatchClient({ token: 'tok', projectId: 7, retry, budget, fetch: impl });
    const query = { queryId: 1, startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-01T03:00:00Z' };
    return { client, clock, budget, query, signals };
  }

  test('cada petición lleva una señal de tiempo máximo', async () => {
    const t = timeoutClient(BOUNDED_RETRY, 0);
    await t.client.fetchAllMentions(t.query);
    expect(t.signals).toHaveLength(1);
    expect(t.signals[0]).toBeInstanceOf(AbortSignal);
  });

  test('una petición que no responde se reintenta como un 5xx (2 s) y se recupera', async () => {
    const t = timeoutClient(BOUNDED_RETRY, 1);
    await expect(t.client.fetchAllMentions(t.query)).resolves.toHaveLength(1);
    expect(t.clock.waits).toEqual([2_000]);
    expect(t.budget.requestsMade).toBe(2);
  });

  test('tres peticiones colgadas: falla como error normal (no abre el cortacircuitos)', async () => {
    const t = timeoutClient(BOUNDED_RETRY, 99);
    const err = await t.client.fetchAllMentions(t.query).catch((e) => e);
    expect(err.message).toMatch(/timed out/);
    expect(classifyFailure(err)).toBe('other');
    expect(t.budget.requestsMade).toBe(3);
  });

  test('un error de red que no es de tiempo se propaga igual que antes', async () => {
    const clock = fakeClock(ms('2026-11-01T03:15:00Z'));
    const budget = new RunBudget({ now: clock.now, sleep: clock.sleep });
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = new BrandwatchClient({ token: 'tok', projectId: 7, retry: BOUNDED_RETRY, budget, fetch: impl });
    await expect(
      client.fetchAllMentions({ queryId: 1, startDate: 'a', endDate: 'b' }),
    ).rejects.toThrow('fetch failed');
    expect(budget.requestsMade).toBe(1);
  });
});

describe('RunBreaker: cesión por cuota', () => {
  test('quota-ceiling abre el cortacircuitos y lo nombra', () => {
    const b = new RunBreaker();
    expect(b.record(new BrandwatchBudgetError('quota-ceiling', 'techo'), '[df] Query 1')).toBe(true);
    expect(b.reason).toContain('cuota cedida');
  });
});
