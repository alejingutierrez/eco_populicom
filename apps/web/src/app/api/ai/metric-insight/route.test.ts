/**
 * Contrato de /api/ai/metric-insight (modal de KPI) con la bandera del motor
 * (WP-8).
 *
 *  - Bandera vacía: una sola llamada legacy, ninguna consulta extra, el
 *    payload de siempre (sin `composerVersion`).
 *  - Bandera encendida: perfil ligero del motor; el número del texto lo pone
 *    el marcador, la banda la calcula el código, y lo que el modelo escriba
 *    con vetados o cifras sin fuente no llega al usuario.
 *
 * Sin DB ni Bedrock: todo simulado.
 */
import { NextRequest } from 'next/server';
import { COMPOSER_VERSION, findVetoed } from '@eco/shared';

const mockLegacyInvoke = jest.fn(async (_opts: unknown) => ({ interpretation: 'Texto legacy del modal.' }));
let mockDraft: Record<string, unknown> = {};
const mockComposerCalls: string[] = [];
const mockPoolQuery = jest.fn(async (sql: string) => {
  if (/FROM agencies/.test(sql)) return { rows: [{ slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' }] };
  if (/percentile_cont/.test(sql)) return { rows: [{ p25: 0.2, p75: 0.45 }] };
  if (/JOIN topics t/.test(sql)) return { rows: [{ name: 'Desarrollo Empresarial', total: 120 }, { name: 'Permisos', total: 40 }] };
  return { rows: [] };
});

jest.mock('@eco/database', () => {
  const actual = jest.requireActual('@eco/database');
  const snaps = [
    { date: '2026-10-26', crisisRiskScore: 0.3 },
    { date: '2026-10-27', crisisRiskScore: 0.5 },
  ];
  const chain = { select: () => chain, from: () => chain, where: () => chain, orderBy: async () => snaps };
  return { ...actual, getDb: () => chain, getPool: () => ({ query: mockPoolQuery }) };
});
jest.mock('@/lib/agency', () => ({ resolveAgencyId: async () => 'agency-uuid' }));
jest.mock('@eco/shared', () => {
  const actual = jest.requireActual('@eco/shared');
  const totals = (n: number) => ({ negative: Math.round(n * 0.2), neutral: Math.round(n * 0.5), positive: n - Math.round(n * 0.2) - Math.round(n * 0.5), total: n });
  return {
    ...actual,
    loadMetricsForWindow: async (_p: unknown, _a: string, start: string) => ({
      nss: 10, crisisRiskScore: start === '2026-10-20' ? 0.56 : 0.41, totals: totals(300), brandHealthIndex: 0.6, polarizationIndex: 30,
    }),
    loadSentimentTotals: async (_p: unknown, _a: string, start: string) => totals(start === '2026-10-20' ? 300 : 250),
    loadDailySentimentSeries: async (_p: unknown, _a: string, start: string, end: string) => {
      const out = [];
      for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
        out.push({ date: new Date(t).toISOString().slice(0, 10), dayLabel: '', negative: 8, neutral: 20, positive: 15 });
      }
      return out;
    },
  };
});
jest.mock('@eco/shared/src/bedrock', () => ({ invokeClaudeWithTool: (o: unknown) => mockLegacyInvoke(o) }));
jest.mock('@/lib/bedrock-client', () => ({
  getBedrockClient: () => ({}),
  getComposerLlm: () => ({
    invokeTool: async (r: { role: string }) => { mockComposerCalls.push(r.role); return mockDraft; },
  }),
}));

const req = () =>
  new NextRequest('http://localhost/api/ai/metric-insight?metric=crisis&period=custom&from=2026-10-20&to=2026-10-26&agency=ddecpr', {
    headers: { 'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 250)}` },
  });

async function call() {
  let GET: (r: NextRequest) => Promise<Response>;
  // Módulo nuevo por prueba: el LRU del modal es estado de módulo.
  jest.isolateModules(() => { GET = require('./route').GET; });
  const res = await GET!(req());
  return { status: res.status, body: await res.json() };
}

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => undefined); });
beforeEach(() => {
  mockLegacyInvoke.mockClear();
  mockPoolQuery.mockClear();
  mockComposerCalls.length = 0;
  delete process.env.COMPOSER_WEB_AGENCIES;
});

describe('/api/ai/metric-insight — bandera vacía', () => {
  it('una llamada legacy, sin consultas extra, payload de siempre', async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(mockLegacyInvoke).toHaveBeenCalledTimes(1);
    expect(mockComposerCalls).toEqual([]);
    expect(mockPoolQuery.mock.calls.some(([sql]) => /FROM agencies/.test(String(sql)))).toBe(false);
    expect(body.interpretation).toBe('Texto legacy del modal.');
    expect(body).not.toHaveProperty('composerVersion');
    expect(Object.keys(body).sort()).toEqual([
      'band', 'deltaDisplay', 'deltaVsPrev', 'historicalP25', 'historicalP75', 'interpretation', 'label', 'metric',
      'periodEnd', 'periodStart', 'series', 'topContributingTopics', 'value', 'valueDisplay', 'windowDays',
    ]);
    expect(body.value).toBe(0.56);
    expect(body.band).toBe('ALERTA');
  });
});

describe('/api/ai/metric-insight — bandera encendida (perfil ligero)', () => {
  it('el número lo pone el marcador y la banda el código', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'ddecpr';
    mockDraft = {
      headline: 'El riesgo de crisis del DDEC subió en la semana',
      paragraph: 'El riesgo de crisis está en <strong>{{kpi_value}}</strong>, banda Alerta, {{kpi_delta}} contra el periodo previo. Lo explica sobre todo Desarrollo Empresarial ({{kpi_topic_1_share}} de las menciones).',
      highlights: [],
    };
    const { body } = await call();
    expect(mockLegacyInvoke).not.toHaveBeenCalled();
    expect(mockComposerCalls).toEqual(['writer']); // sin defectos: no corre el corrector
    expect(body.composerVersion).toBe(COMPOSER_VERSION);
    expect(body.band).toBe('ALERTA'); // banda del código, igual que legacy
    expect(body.value).toBe(0.56);
    expect(body.interpretation).toContain('<strong>56 %</strong>');
    expect(body.interpretation).toContain('+15 puntos');
    expect(body.interpretation).toContain('40 %');
    expect(body.interpretation).not.toMatch(/\{\{/);
  });

  it('vetados y cifras sin marcador no llegan al usuario', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'ddecpr';
    mockDraft = {
      headline: 'La crisis se dispara en el DDEC',
      paragraph: 'El riesgo de crisis está en {{kpi_value}}. La conversación se dispara por 37 críticas nuevas. Pesa sobre todo Desarrollo Empresarial.',
      highlights: [],
    };
    const { body } = await call();
    expect(mockComposerCalls).toEqual(['writer', 'corrector']); // una vuelta de corrector
    expect(findVetoed(body.interpretation)).toEqual([]);
    expect(body.interpretation).not.toMatch(/37/);
    expect(body.interpretation).toContain('56 %');
  });

  it('si el redactor falla, la interpretación por reglas de siempre', async () => {
    process.env.COMPOSER_WEB_AGENCIES = 'ddecpr';
    mockDraft = { nope: true } as unknown as Record<string, unknown>;
    const { body } = await call();
    expect(body.interpretation).toMatch(/riesgo de crisis está en <strong>0.56<\/strong>/);
  });
});
