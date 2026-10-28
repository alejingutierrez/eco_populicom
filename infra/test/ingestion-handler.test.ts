// Prueba del handler de eco-ingestion de punta a punta con TODO simulado: AWS
// (S3/SQS/Secrets Manager), pg, fetch de Brandwatch y el reloj. Nunca llama a
// la API real (consumiría la cuota de producción).

const mockS3Send = jest.fn();
const mockSqsSend = jest.fn();
const mockSmSend = jest.fn();
const mockPgQuery = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = (cmd: unknown) => mockS3Send(cmd);
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send = (cmd: unknown) => mockSqsSend(cmd);
  },
  SendMessageBatchCommand: class {
    constructor(public input: unknown) {}
  },
}));
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = (cmd: unknown) => mockSmSend(cmd);
  },
  GetSecretValueCommand: class {
    constructor(public input: unknown) {}
  },
}));
jest.mock(
  'pg',
  () => ({
    __esModule: true,
    default: {
      Client: class {
        connect = async () => undefined;
        end = async () => undefined;
        query = (sql: string, params?: unknown[]) => mockPgQuery(sql, params);
      },
    },
  }),
  { virtual: true },
);

import { handler } from '../lambda/ingestion/index';

const NOW = Date.parse('2026-10-28T15:05:00Z');
const MINUTE = 60_000;

interface AgencyFixture {
  slug: string;
  brandwatch_project_id: number;
  brandwatch_query_ids: number[];
}

type FetchStep = { status: number; headers?: Record<string, string>; mentions?: Array<{ resourceId: string; date: string | null }>; total?: number };

let cursorWrites: unknown[][];
let fetchCalls: Array<{ queryId: string; at: number }>;
let logs: string[];

function setupAgencies(agencies: AgencyFixture[], cursors: Record<number, string> = {}) {
  mockPgQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/FROM agencies/.test(sql)) return { rows: agencies };
    if (/FROM ingestion_cursors/.test(sql)) {
      const iso = cursors[params![0] as number];
      return { rows: iso ? [{ last_mention_date: iso }] : [] };
    }
    if (/INSERT INTO ingestion_cursors/.test(sql)) {
      cursorWrites.push(params!);
      return { rows: [] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
}

/** `script(queryId, callIndexForThatQuery)` decide la respuesta de cada request. */
function setupFetch(script: (queryId: string, n: number) => FetchStep) {
  const perQuery = new Map<string, number>();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    const queryId = new URL(url).searchParams.get('queryId')!;
    const n = perQuery.get(queryId) ?? 0;
    perQuery.set(queryId, n + 1);
    fetchCalls.push({ queryId, at: Date.now() });
    const step = script(queryId, n);
    const mentions = step.mentions ?? [];
    const body =
      step.status === 200
        ? JSON.stringify({
            results: mentions,
            resultsTotal: step.total ?? mentions.length,
            resultsPage: 0,
            resultsPageSize: 100,
          })
        : 'error body';
    return new Response(body, { status: step.status, headers: step.headers });
  });
}

const mention = (i: number, iso: string | null) => ({ resourceId: `r${i}`, date: iso });
const page = (n: number, iso: string) => Array.from({ length: n }, (_, i) => mention(i, iso));

/** Corre el handler avanzando el reloj falso hasta que termine. */
async function run(event: unknown, context?: { getRemainingTimeInMillis: () => number }) {
  const p = handler(event, context);
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 5000 && !done; i++) await jest.advanceTimersByTimeAsync(1000);
  return p;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  cursorWrites = [];
  fetchCalls = [];
  logs = [];
  mockS3Send.mockReset().mockResolvedValue({});
  mockSqsSend.mockReset().mockResolvedValue({ Failed: [] });
  mockSmSend.mockReset().mockResolvedValue({
    SecretString: JSON.stringify({ username: 'u', password: 'p', host: 'h', port: 5432, dbname: 'd', token: 'tok' }),
  });
  mockPgQuery.mockReset();
  const grab = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  jest.spyOn(console, 'log').mockImplementation(grab);
  jest.spyOn(console, 'warn').mockImplementation(grab);
  jest.spyOn(console, 'error').mockImplementation(grab);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('eco-ingestion: racha de 429 (incidente 28-oct)', () => {
  const agencies: AgencyFixture[] = [
    { slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: [11, 12, 13] },
    { slug: 'df', brandwatch_project_id: 2, brandwatch_query_ids: [21, -1001] },
  ];

  test('el primer query que agota sus reintentos por 429 aborta el resto de la corrida', async () => {
    setupAgencies(agencies);
    setupFetch(() => ({ status: 429 }));

    const res = await run({}, { getRemainingTimeInMillis: () => 15 * MINUTE });

    // Solo la escalera del primer query: 3 requests (antes: 11 por query × 4 queries).
    expect(fetchCalls.map((c) => c.queryId)).toEqual(['11', '11', '11']);
    expect(Date.now() - NOW).toBeLessThanOrEqual(60_000); // 15 s + 30 s de espera (antes ≈ 22 min)
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ABORTED por cortacircuitos');
    // Lo que falta se reporta; el queryId negativo (import) ni se lista.
    expect(res.body).toContain('ddecpr:12, ddecpr:13, df:21');
    expect(res.body).not.toContain('-1001');
    expect(cursorWrites).toEqual([]);
  });

  test('un 429 que se recupera dentro de los 3 intentos NO aborta nada', async () => {
    setupAgencies(agencies);
    setupFetch((q, n) => (q === '11' && n === 0 ? { status: 429 } : { status: 200 }));

    const res = await run({});

    expect(res.body).not.toContain('ABORTED');
    expect(fetchCalls.map((c) => c.queryId)).toEqual(['11', '11', '12', '13', '21']);
  });

  test('un 5xx persistente en un query NO abre el cortacircuitos: el resto sigue', async () => {
    setupAgencies(agencies);
    setupFetch((q) => (q === '11' ? { status: 500 } : { status: 200 }));

    const res = await run({});

    expect(res.body).toContain('Query 11: FAILED (continúa el resto)');
    expect(res.body).not.toContain('ABORTED');
    expect(new Set(fetchCalls.map((c) => c.queryId))).toEqual(new Set(['11', '12', '13', '21']));
  });

  test('429 a media paginación: el cursor avanza con lo ya encolado y luego aborta', async () => {
    setupAgencies(agencies, { 11: '2026-10-28T14:00:00.000Z' });
    setupFetch((q, n) => {
      if (q === '11' && n === 0) return { status: 200, mentions: page(100, '2026-10-28T14:30:00.000+0000'), total: 250 };
      return { status: 429 };
    });

    const res = await run({});

    // página 0 OK + escalera de 3 intentos en la página 1; nadie más se sondea
    expect(fetchCalls.map((c) => c.queryId)).toEqual(['11', '11', '11', '11']);
    // las 100 menciones de la página 0 se encolaron...
    expect(mockSqsSend).toHaveBeenCalledTimes(10);
    // ...y el cursor se compromete a su fecha (antes: sin avance → la corrida
    // siguiente repetía la página y un backlog grande nunca avanzaba)
    expect(cursorWrites).toEqual([[11, '2026-10-28T14:30:00.000Z', 100]]);
    expect(res.body).toContain('ABORTED por cortacircuitos');
    expect(res.body).toContain('ddecpr:12, ddecpr:13, df:21');
  });

  test('429 en la primera página: no hay nada que comprometer', async () => {
    setupAgencies(agencies, { 11: '2026-10-28T14:00:00.000Z' });
    setupFetch(() => ({ status: 429 }));

    await run({});

    expect(cursorWrites).toEqual([]);
  });

  test('si el lambda casi no tiene tiempo, no duerme una espera que no cabe', async () => {
    setupAgencies(agencies);
    setupFetch(() => ({ status: 429 }));

    // 70 s restantes − 60 s de margen = 10 s de presupuesto < la espera de 15 s
    const res = await run({}, { getRemainingTimeInMillis: () => 70_000 });

    expect(fetchCalls).toHaveLength(1);
    expect(Date.now() - NOW).toBeLessThan(15_000);
    expect(res.body).toContain('ABORTED por cortacircuitos');
  });
});

describe('eco-ingestion: corrida normal (sin regresiones)', () => {
  test('lee, encola, avanza el cursor a la mención más reciente y registra el summary', async () => {
    setupAgencies([{ slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: [11] }], {
      11: '2026-10-28T14:00:00.000Z',
    });
    setupFetch(() => ({
      status: 200,
      mentions: [mention(1, '2026-10-28T14:10:00.000+0000'), mention(2, null), mention(3, '2026-10-28T14:40:00.000+0000'), mention(4, null)],
    }));

    const res = await run({});

    expect(cursorWrites).toEqual([[11, '2026-10-28T14:40:00.000Z', 4]]);
    expect(res.body).toContain('Query 11: 4 mentions in 1 pages');
    expect(res.body).toMatch(/\[run\] mode=incremental requests=1 elapsed=\d+s/);
  });
});

describe('eco-ingestion: refresh diario de 07:00Z', () => {
  // El handler muta el evento (traduce refreshLastHours a una ventana): uno nuevo por prueba.
  const refresh = () => ({ refreshLastHours: 48 });

  test('espacia los requests 30 s (antes: ~19 req en 20 s) y no toca los cursores', async () => {
    setupAgencies([{ slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: [11, 12, 13] }]);
    setupFetch(() => ({ status: 200 }));

    const res = await run(refresh());

    expect(fetchCalls.map((c) => c.at - NOW)).toEqual([0, 30_000, 60_000]);
    expect(cursorWrites).toEqual([]);
    expect(res.body).toContain('mode=refresh');
  });

  test('tope de 24 requests: lo que sobra se reporta y la corrida termina limpia', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => 100 + i);
    setupAgencies([{ slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: ids }]);
    setupFetch(() => ({ status: 200 }));

    const res = await run(refresh());

    expect(fetchCalls).toHaveLength(24);
    expect(Date.now() - NOW).toBeLessThan(12 * MINUTE);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ABORTED por cortacircuitos');
    expect(res.body).toContain('request cap reached (24 requests');
    // 100..123 se sondearon; el 124 topó con el cap (abre el cortacircuitos) y 125..129 se saltan
    expect(res.body).toContain('[ddecpr] Query 124: FAILED (cortacircuitos');
    expect(res.body).toContain('5 queries sin sondear: ddecpr:125, ddecpr:126');
  });

  test('un 429 en el refresh lo abandona igual (reintentos acotados; mañana repite la ventana de 48 h)', async () => {
    setupAgencies([{ slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: [11, 12] }]);
    setupFetch(() => ({ status: 429 }));

    const res = await run(refresh());

    expect(fetchCalls).toHaveLength(3);
    expect(res.body).toContain('ABORTED por cortacircuitos');
  });
});

describe('eco-ingestion: backfill manual', () => {
  test('conserva los reintentos largos: 2 s tras el primer 429, no 15 s', async () => {
    setupAgencies([{ slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: [11] }]);
    setupFetch((_q, n) => (n === 0 ? { status: 429 } : { status: 200 }));

    const res = await run({ backfillStartDate: '2026-10-20T00:00:00Z', backfillEndDate: '2026-10-21T00:00:00Z' });

    expect(fetchCalls.map((c) => c.at - NOW)).toEqual([0, 2_000]);
    expect(res.body).toContain('(backfill)');
    expect(res.body).not.toContain('ABORTED');
    expect(cursorWrites).toEqual([]);
  });

  test('sigue sin tocar el cursor aunque falle a media paginación', async () => {
    setupAgencies([{ slug: 'ddecpr', brandwatch_project_id: 1, brandwatch_query_ids: [11] }]);
    setupFetch((_q, n) =>
      n === 0 ? { status: 200, mentions: page(100, '2026-10-20T10:00:00.000+0000'), total: 250 } : { status: 401 },
    );

    const res = await run({ backfillStartDate: '2026-10-20T00:00:00Z', backfillEndDate: '2026-10-21T00:00:00Z' });

    expect(res.body).toContain('FAILED');
    expect(cursorWrites).toEqual([]);
  });
});
