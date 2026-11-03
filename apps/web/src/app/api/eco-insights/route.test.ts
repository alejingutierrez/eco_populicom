/**
 * Contrato de /api/eco-insights con la bandera del motor (WP-8).
 *
 *  - Bandera vacía: la respuesta y el payload del disparo al lambda son los
 *    de siempre (sin `composer`, sin `stale` extra por la versión).
 *  - Bandera encendida: una fila legacy (composer_version NULL) se sirve y se
 *    recalcula una vez con `composer: true`; una fila del motor vigente no.
 *
 * Sin DB ni AWS: se simulan @eco/database, la resolución de agencia y el
 * cliente de Lambda.
 */
import { NextRequest } from 'next/server';
import { COMPOSER_VERSION } from '@eco/shared';

const mockSend = jest.fn(async (_cmd: unknown) => ({}));
let mockRow: Record<string, unknown> | null = null;
const mockPoolQuery = jest.fn(async (sql: string) => {
  if (/FROM agencies/.test(sql)) return { rows: [{ slug: 'ddecpr' }] };
  // loadWindowFreshness: nada llegó después de generar.
  return { rows: [{ total: 100, newer: 0 }] };
});

jest.mock('@eco/database', () => {
  const actual = jest.requireActual('@eco/database');
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => (mockRow ? [mockRow] : []),
  };
  return { ...actual, getDb: () => chain, getPool: () => ({ query: mockPoolQuery }) };
});
jest.mock('@/lib/agency', () => ({ resolveAgencyId: async () => 'agency-uuid' }));
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class { send = mockSend; },
  InvokeCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));

const WINDOW = { from: '2026-10-20', to: '2026-10-26' }; // histórica
const req = (agency = 'ddecpr') =>
  new NextRequest(`http://localhost/api/eco-insights?period=custom&from=${WINDOW.from}&to=${WINDOW.to}&agency=${agency}`, {
    headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
  });

function legacyRow(extra: Record<string, unknown> = {}) {
  return {
    agencyId: 'agency-uuid',
    periodStartDate: WINDOW.from,
    periodEndDate: WINDOW.to,
    negativeInsights: ['n1'],
    neutralInsights: ['e1'],
    positiveInsights: ['p1'],
    dailySummary: 'Resumen del periodo.',
    lede: { v: 2, headline: 'Titular', highlights: ['h1'], peaks: [], hero: null },
    modelUsed: 'us.anthropic.claude-opus-4-6-v1',
    generatedAt: new Date('2026-10-27T12:00:00Z'),
    composition: null,
    composerVersion: null,
    ...extra,
  };
}

async function call(agency = 'ddecpr') {
  // Módulo nuevo por prueba: el dedup de disparos (claimAiTrigger) es estado de módulo.
  let GET: (r: NextRequest) => Promise<Response>;
  jest.isolateModules(() => { GET = require('./route').GET; });
  const res = await GET!(req(agency));
  await new Promise((r) => setImmediate(r)); // deja correr el disparo en segundo plano
  return { status: res.status, body: await res.json() };
}

const invokedPayloads = () =>
  mockSend.mock.calls.map((c) => JSON.parse(Buffer.from((c[0] as { input: { Payload: Buffer } }).input.Payload).toString()));

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => undefined); });
beforeEach(() => {
  mockSend.mockClear();
  mockPoolQuery.mockClear();
  mockRow = null;
  delete process.env.COMPOSER_WEB_AGENCIES;
});

describe('/api/eco-insights — bandera vacía (comportamiento actual)', () => {
  it('fila histórica vigente: ready, sin recálculo, misma forma de respuesta', async () => {
    mockRow = legacyRow();
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({
      status: 'ready',
      periodStart: WINDOW.from,
      periodEnd: WINDOW.to,
      insights: { negative: ['n1'], neutral: ['e1'], positive: ['p1'] },
      dailySummary: 'Resumen del periodo.',
      lede: { v: 2, headline: 'Titular', highlights: ['h1'], peaks: [], hero: null },
      generatedAt: '2026-10-27T12:00:00.000Z',
      stale: false,
      outdated: false,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('el disparo al lambda no lleva `composer` (payload de siempre)', async () => {
    mockRow = legacyRow({ lede: null }); // sin lede → recalcula una vez
    await call();
    expect(invokedPayloads()).toEqual([
      { action: 'period-insights', agencySlug: 'ddecpr', periodStart: WINDOW.from, periodEnd: WINDOW.to },
    ]);
  });

  it('sin fila: 202 y disparo sin `composer`', async () => {
    const { status, body } = await call();
    expect(status).toBe(202);
    expect(body).toEqual({ status: 'computing', periodStart: WINDOW.from, periodEnd: WINDOW.to });
    expect(invokedPayloads()[0]).not.toHaveProperty('composer');
  });
});

describe('/api/eco-insights — bandera encendida', () => {
  it('fila legacy con la agencia en la bandera: se sirve stale y se recalcula con el motor', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'ddecpr';
    mockRow = legacyRow();
    const { body } = await call();
    expect(body.status).toBe('ready');
    expect(body.stale).toBe(true);
    expect(body.outdated).toBe(false);
    expect(invokedPayloads()).toEqual([
      { action: 'period-insights', agencySlug: 'ddecpr', periodStart: WINDOW.from, periodEnd: WINDOW.to, composer: true },
    ]);
  });

  it('fila del motor vigente: no se recalcula', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'ddecpr';
    mockRow = legacyRow({ composerVersion: COMPOSER_VERSION, modelUsed: `${COMPOSER_VERSION} · opus` });
    const { body } = await call();
    expect(body.stale).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('otra agencia en la bandera: la fila legacy sigue vigente', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'df';
    mockRow = legacyRow();
    const { body } = await call();
    expect(body.stale).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('apagar la bandera invalida las filas del motor (vuelven a legacy)', async () => {
    mockRow = legacyRow({ composerVersion: COMPOSER_VERSION });
    const { body } = await call();
    expect(body.stale).toBe(true);
    expect(invokedPayloads()[0]).not.toHaveProperty('composer');
  });

  it('fila «sin señal» de otra versión: 202 para que el SPA siga consultando', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'ddecpr';
    mockRow = legacyRow({ dailySummary: null, lede: null, negativeInsights: [], neutralInsights: [], positiveInsights: [] });
    const { status, body } = await call();
    expect(status).toBe(202);
    expect(body.status).toBe('computing');
    expect(invokedPayloads()[0]).toMatchObject({ composer: true });
  });
});
