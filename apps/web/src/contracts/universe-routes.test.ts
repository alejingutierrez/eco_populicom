/**
 * WP-9a — universo pertinente en TODAS las rutas de datos (spec interpretación
 * v1, sección 8; plan WP-9a).
 *
 * Dos garantías, ambas con un cliente ESPÍA (como hizo WP-4 con
 * buildSentimentReport): se invoca el handler real de cada ruta con
 * `@eco/database` sustituido por un pool falso que registra el SQL y los
 * parámetros, sin tocar ninguna base de datos.
 *
 *   1. Con UNIVERSE_STRICT_AGENCIES vacía el SQL de cada ruta es IDÉNTICO al
 *      que tenían antes de WP-9a (golden `__golden__/universe-legacy-sql.json`,
 *      grabado sobre el código previo y normalizado solo en espacios en
 *      blanco). Lo único permitido es lo ADITIVO: las consultas nuevas de
 *      composición (commentShare) y las columnas nuevas del feed.
 *   2. Con la bandera para ddecpr, TODAS las consultas de menciones de TODAS
 *      las rutas usan el predicado estricto de universe.ts y ninguna conserva
 *      el histórico — por eso los totales de Overview, Scorecard y
 *      Sentimiento coinciden entre sí.
 *
 * Regenerar el golden (solo si el cambio de SQL es intencional y revisado):
 *   UPDATE_GOLDEN=1 npx jest src/contracts/universe-routes.test.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const GOLDEN = path.join(__dirname, '__golden__', 'universe-legacy-sql.json');
// El SQL de Drizzle cita las columnas ("mentions"."nlp_pertinence"); el crudo no.
const LEGACY_PERT = /nlp_pertinence"?\s+IS NULL OR/;
const STRICT_PERT = /nlp_pertinence"?\s+IN \('alta','media'/;

interface Q { sql: string; params: unknown[] }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Pool falso: registra y responde lo mínimo para que cada handler llegue al final. */
function makeSpyPool(captured: Q[]) {
  const query = async (arg: unknown, params?: unknown[]) => {
    const cfg = typeof arg === 'string' ? { text: arg } : (arg as { text: string; values?: unknown[]; rowMode?: string });
    const text = cfg.text;
    const values = params ?? (cfg as { values?: unknown[] }).values ?? [];
    captured.push({ sql: norm(text), params: values });
    const rowMode = (cfg as { rowMode?: string }).rowMode;
    const empty = { rows: [] as unknown[], rowCount: 0, fields: [] as unknown[], command: 'SELECT', oid: 0 };
    // Lookup de agencia por id (slug/nombre): lo usan varios handlers.
    if (!rowMode && /FROM agencies/i.test(text) && /slug/i.test(text) && !/ANY\(/i.test(text)) {
      return { ...empty, rows: [{ slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' }], rowCount: 1 };
    }
    // Narrativa propia (propagación): sin ella la ruta responde 404 antes de consultar menciones.
    if (!rowMode && /FROM narratives req/i.test(text)) {
      return { ...empty, rows: [{ id: '00000000-0000-0000-0000-000000000001', name: 'n', status: 'active', was_merged: false, slug: 'ddecpr', agency_name: 'DDEC' }], rowCount: 1 };
    }
    // Un COUNT sin GROUP BY siempre devuelve una fila (Drizzle destructura `[{ total }]`).
    if (rowMode === 'array' && /count\(/i.test(text) && !/group by/i.test(text)) {
      return { ...empty, rows: [Array(8).fill(0)], rowCount: 1 };
    }
    // Agregado sin GROUP BY en SQL crudo: una fila con ceros (`rows[0].total_mentions`).
    if (!rowMode && /count\(/i.test(text) && !/group by/i.test(text)) {
      const zeros = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? 0 : undefined) });
      return { ...empty, rows: [zeros], rowCount: 1 };
    }
    return empty;
  };
  return { query, on: () => undefined, connect: async () => ({ query, release: () => undefined }) };
}

type Handler = (req: unknown) => Promise<{ status: number }>;
interface Routes {
  ecoData: Handler; overview: Handler; ecoMentions: Handler; mentionsAnalysis: Handler;
  sentimentAnalysis: Handler; scorecard: Handler; geoAnalysis: Handler; ecoGeo: Handler;
  ecoTerms: Handler; narrativeOverview: Handler; narrativePropagation: (req: unknown, ctx: unknown) => Promise<{ status: number }>;
  execOverview: Handler;
}

/** Carga los handlers con módulos frescos (cada ruta tiene cachés propias) y el pool espía. */
async function loadRoutes(captured: Q[]): Promise<Routes> {
  jest.resetModules();
  const pool = makeSpyPool(captured);
  jest.doMock('@eco/database', () => {
    const actual = jest.requireActual('@eco/database');
    const { drizzle } = jest.requireActual('drizzle-orm/node-postgres');
    return {
      ...actual,
      getPool: () => pool,
      getDb: () => drizzle(pool, { schema: actual }),
    };
  });
  jest.doMock('@/lib/agency', () => ({
    resolveAgencyId: async () => 'agency-1',
    resolveAllowedAgencySlugs: async () => null,
    filterAgenciesForCaller: async (rows: unknown[]) => rows,
    listActiveAgencies: async () => [{ id: 'agency-1', slug: 'ddecpr' }],
  }));
  jest.doMock('@/lib/auth/require-admin', () => ({ requireAuth: async () => ({ ok: true }) }));
  jest.doMock('@/lib/log', () => ({ log: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
  /* eslint-disable @typescript-eslint/no-require-imports */
  return {
    ecoData: require('@/app/api/eco-data/route').GET,
    overview: require('@/app/api/overview/route').GET,
    ecoMentions: require('@/app/api/eco-mentions/route').GET,
    mentionsAnalysis: require('@/app/api/mentions/analysis/route').GET,
    sentimentAnalysis: require('@/app/api/sentiment/analysis/route').GET,
    scorecard: require('@/app/api/scorecard/route').GET,
    geoAnalysis: require('@/app/api/geo/analysis/route').GET,
    ecoGeo: require('@/app/api/eco-geo/route').GET,
    ecoTerms: require('@/app/api/eco-terms/route').GET,
    narrativeOverview: require('@/app/api/narrative/overview/route').GET,
    narrativePropagation: require('@/app/api/narrative/[id]/propagation/route').GET,
    execOverview: require('@/app/api/exec-overview/route').GET,
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
}

/** Escenarios: nombre de la ruta + cómo invocarla. */
const SCENARIOS: Array<{ name: keyof Routes; url: string; ctx?: unknown }> = [
  { name: 'ecoData', url: '/api/eco-data?period=7D&agency=ddecpr' },
  { name: 'overview', url: '/api/overview?period=7D&agency=ddecpr' },
  { name: 'ecoMentions', url: '/api/eco-mentions?period=7D&agency=ddecpr' },
  { name: 'mentionsAnalysis', url: '/api/mentions/analysis?period=7D&agency=ddecpr' },
  { name: 'sentimentAnalysis', url: '/api/sentiment/analysis?period=7D&agency=ddecpr' },
  { name: 'scorecard', url: '/api/scorecard?period=7D&agency=ddecpr' },
  { name: 'geoAnalysis', url: '/api/geo/analysis?period=7D&agency=ddecpr' },
  { name: 'ecoGeo', url: '/api/eco-geo?period=7D&agency=ddecpr' },
  { name: 'ecoTerms', url: '/api/eco-terms?period=7D&agency=ddecpr&mode=frequent' },
  { name: 'narrativeOverview', url: '/api/narrative/overview?agency=ddecpr' },
  { name: 'narrativePropagation', url: '/api/narrative/00000000-0000-0000-0000-000000000001/propagation?agency=ddecpr', ctx: { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }) } },
  { name: 'execOverview', url: '/api/exec-overview?period=7D' },
];

async function run(env: string | undefined): Promise<Record<string, Q[]>> {
  const prev = process.env.UNIVERSE_STRICT_AGENCIES;
  if (env === undefined) delete process.env.UNIVERSE_STRICT_AGENCIES; else process.env.UNIVERSE_STRICT_AGENCIES = env;
  try {
    const out: Record<string, Q[]> = {};
    for (const sc of SCENARIOS) {
      const captured: Q[] = [];
      const routes = await loadRoutes(captured);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NextRequest } = require('next/server');
      const req = new NextRequest(`http://localhost${sc.url}`, { headers: { 'x-forwarded-for': '10.0.0.1' } });
      const res = await (routes[sc.name] as (r: unknown, c?: unknown) => Promise<{ status: number }>)(req, sc.ctx);
      if (res.status >= 500) {
        const body = await (res as unknown as Response).json().catch(() => null);
        throw new Error(`${sc.name} respondió ${res.status}: ${JSON.stringify(body)}`);
      }
      out[sc.name] = captured;
    }
    return out;
  } finally {
    if (prev === undefined) delete process.env.UNIVERSE_STRICT_AGENCIES; else process.env.UNIVERSE_STRICT_AGENCIES = prev;
  }
}

/** Consultas ADITIVAS de WP-9a que el golden previo no puede contener. */
const isAdditive = (q: Q) =>
  /#channels_comment/.test(q.sql) // commentShare (composición)
  || /FROM mentions WHERE id = ANY/.test(q.sql); // padres de los comentarios del feed

beforeAll(() => {
  jest.useFakeTimers({
    now: new Date('2026-11-02T15:00:00Z'),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'],
  });
});
afterAll(() => jest.useRealTimers());

describe('universo — SQL de cada ruta de datos', () => {
  test('bandera VACÍA: el SQL de cada ruta es idéntico al previo a WP-9a (golden)', async () => {
    const got = await run(undefined);
    const plain: Record<string, Q[]> = {};
    for (const [k, qs] of Object.entries(got)) plain[k] = qs.filter((q) => !isAdditive(q));
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify(plain, null, 1) + '\n');
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as Record<string, Q[]>;
    for (const sc of SCENARIOS) {
      // Una ruta a la vez: el mensaje de fallo dice cuál diverge.
      expect({ route: sc.name, queries: plain[sc.name] }).toEqual({ route: sc.name, queries: golden[sc.name] });
    }
  });

  test('bandera VACÍA: ninguna ruta pierde el predicado histórico', async () => {
    const got = await run('');
    const mentionQs = Object.values(got).flat().filter((q) => /FROM mentions|JOIN mentions|mentions m/.test(q.sql) && /is_duplicate/.test(q.sql));
    expect(mentionQs.length).toBeGreaterThan(20);
    expect(mentionQs.some((q) => STRICT_PERT.test(q.sql))).toBe(false);
  });

  test('bandera ddecpr: ninguna consulta de universo conserva el predicado histórico', async () => {
    const got = await run('ddecpr');
    const offenders: string[] = [];
    for (const [route, qs] of Object.entries(got)) {
      for (const q of qs) if (LEGACY_PERT.test(q.sql)) offenders.push(`${route}: ${q.sql.slice(0, 160)}`);
    }
    expect(offenders).toEqual([]);
  });

  test('bandera ddecpr: las consultas de menciones de cada ruta usan el predicado estricto', async () => {
    const got = await run('ddecpr');
    const missing: string[] = [];
    for (const [route, qs] of Object.entries(got)) {
      const withDup = qs.filter((q) => /is_duplicate/.test(q.sql) && /mentions/.test(q.sql) && !/ARRAY|FROM agencies/i.test(q.sql.slice(0, 40)));
      // Debe haber consultas de universo en la ruta, y todas con el predicado estricto.
      if (route !== 'execOverview' && withDup.length === 0) missing.push(`${route}: sin consultas de universo`);
      for (const q of withDup) if (!STRICT_PERT.test(q.sql)) missing.push(`${route}: ${q.sql.slice(0, 160)}`);
    }
    expect(missing).toEqual([]);
  });

  test('bandera de OTRA agencia (aaa): ddecpr sigue en el universo histórico', async () => {
    const got = await run('aaa');
    const mentionQs = Object.values(got).flat().filter((q) => /is_duplicate/.test(q.sql));
    expect(mentionQs.some((q) => STRICT_PERT.test(q.sql))).toBe(false);
  });
});
