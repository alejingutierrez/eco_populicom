import { processRun, reaper } from '../../../../../infra/lambda/advisor/index';
import { fakeCouncilLLM } from '@eco/shared/src/advisor/fake-llm';
import type { AdvisorLLM } from '@eco/shared/src/advisor/llm';
import type { PgLike } from '@eco/shared/src/advisor/run-store';

const RUN = '00000000-0000-0000-0000-0000000000aa';
const FACT = {
  pregunta_normalizada: 'apagón', preferencia_usuario: null, sabido: [{ afirmacion: 'x', citas: ['M-48213'] }], no_claro: [], supuesto: [],
  caso_peor: { descripcion: 'p', citas: ['M-48213'] }, linea_base: { descripcion: 'b', rango_indice_72h: null }, puntos_ciegos: [],
};

type Row = Record<string, unknown>;
function fakePg(claimed: Row | null, cancelFlag = false) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const steps: Record<string, unknown> = {};
  let status: unknown = null;
  let statusParams: unknown[] = [];
  const pg: PgLike = {
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/WITH c AS \(/.test(sql)) return { rows: claimed ? [claimed] : [], rowCount: claimed ? 1 : 0 };
      if (/SELECT cancel_requested/.test(sql)) return { rows: [{ cancel_requested: cancelFlag }], rowCount: 1 };
      if (/INSERT INTO advisor_events/.test(sql)) events.push({ type: String(params[1]), payload: JSON.parse(String(params[2])) });
      if (/jsonb_build_object/.test(sql)) steps[String(params[1])] = JSON.parse(String(params[2]));
      if (/UPDATE advisor_runs SET\s+status = \$2/.test(sql)) { status = params[1]; statusParams = params; }
      return { rows: [], rowCount: 1 };
    }) as PgLike['query'],
  };
  return { pg, queries, events, steps, status: () => status, statusParams: () => statusParams };
}

const claimedRow = (over: Row = {}): Row => ({
  id: RUN, agency_id: 'a1', question: '¿qué hacemos?', status: 'running', agency_slug: 'ddecpr', agency_name: 'DDEC', created_at: new Date(),
  fact_sheet_json: { factSheet: FACT, seenIds: ['M-48213', 'M-48214'], injection: [], context: { dateLabel: 'jueves', vedaActiva: false, guiaProbable: null, riesgoPersonas: false } },
  deliberacion_json: {}, usage_json: { round0: { costUsd: 0.2 }, contencion: { costUsd: 0.05 } }, ...over,
});

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('eco-advisor · processRun', () => {
  test('una invocación duplicada (la corrida no está en rounds_queued) sale sin hacer nada', async () => {
    const f = fakePg(null);
    const llm = fakeCouncilLLM().llm;
    const out = await processRun(f.pg, RUN, false, {}, { llm });
    expect(out).toEqual({ ok: true, skipped: true });
    expect(f.events).toHaveLength(0);
    expect(f.status()).toBeNull();
  });

  test('corrida completa: rondas 1 a 5 y revisión, memorando, citas y costo en la corrida', async () => {
    const f = fakePg(claimedRow());
    const { llm, calls } = fakeCouncilLLM();
    const out = await processRun(f.pg, RUN, false, { getRemainingTimeInMillis: () => 900_000 }, { llm });
    expect(out.ok).toBe(true);
    expect(f.status()).toBe('done');
    // 6 posiciones + agrupación + 3 ataques + 6 réplicas + 3 partes del memorando + 1 revisión
    expect(calls.length).toBe(20);
    // memo_json es el 4.º parámetro; usage_json el 5.º
    const [, , , memo, usage, , citTotal] = f.statusParams();
    expect(JSON.parse(String(memo))).toHaveProperty('recomendacion');
    const u = JSON.parse(String(usage));
    expect(u.round0).toBeDefined();
    expect(u.rondas.alarmas).toBeDefined();
    expect(u.rondas.calls.length).toBe(calls.length);
    expect(typeof citTotal).toBe('number');
    expect(f.events.map((e) => e.type)).toEqual(expect.arrayContaining(['round_started', 'memo', 'review']));
    expect(Object.keys(f.steps)).toEqual(expect.arrayContaining(['1.estratega', '2.moderador', '5.moderador']));
  });

  test('sin hoja de hechos: error con código y evento', async () => {
    const f = fakePg(claimedRow({ fact_sheet_json: null }));
    const out = await processRun(f.pg, RUN, false, {}, { llm: fakeCouncilLLM().llm });
    expect(out).toMatchObject({ ok: false, error: 'sin_hoja_de_hechos' });
    expect(f.status()).toBe('error');
  });

  test('un fallo de validación termina en error con su código y sin texto de terceros en el evento', async () => {
    const f = fakePg(claimedRow());
    const all = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const { llm } = fakeCouncilLLM({ grouping: { caminos: [{ id: 'C1', nombre_verbo: 'a', descripcion: 'd', apoyado_por: all }, { id: 'C2', nombre_verbo: 'b', descripcion: 'd', apoyado_por: [] }], contraplan_construido: false } });
    const out = await processRun(f.pg, RUN, false, {}, { llm });
    expect(out).toMatchObject({ ok: false, error: 'grouping_invalid' });
    expect(f.status()).toBe('error');
    expect(JSON.stringify(f.events.at(-1))).not.toContain('M-48213');
  });

  test('presupuesto: AdvisorBudgetError termina en error_budget', async () => {
    const f = fakePg(claimedRow());
    const inner = fakeCouncilLLM().llm;
    // Cada respuesta cuesta mucho más que 3× el costo esperado con Sonnet.
    const llm: AdvisorLLM = {
      stream: inner.stream,
      create: async (req) => { const r = await inner.create(req); return { ...r, usage: { inputNew: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 5_000_000 } }; },
    };
    const prev = process.env.ADVISOR_MODEL_MAIN;
    process.env.ADVISOR_MODEL_MAIN = 'us.anthropic.claude-sonnet-5-5';
    try {
      const out = await processRun(f.pg, RUN, false, {}, { llm });
      expect(out).toMatchObject({ ok: false, error: 'error_budget' });
      expect(f.status()).toBe('error_budget');
    } finally {
      if (prev === undefined) delete process.env.ADVISOR_MODEL_MAIN; else process.env.ADVISOR_MODEL_MAIN = prev;
    }
  });

  test('cancel_requested desde antes: termina en cancelled sin producir memorando', async () => {
    const f = fakePg(claimedRow(), true);
    const { llm, calls } = fakeCouncilLLM();
    const out = await processRun(f.pg, RUN, false, {}, { llm });
    expect(out).toMatchObject({ ok: true, cancelled: true });
    expect(f.status()).toBe('cancelled');
    expect(calls).toHaveLength(0);
    expect(f.events.at(-1)?.type).toBe('cancelled');
  });

  test('reanudar usa los checkpoints guardados: no repite las rondas completas', async () => {
    const first = fakePg(claimedRow());
    await processRun(first.pg, RUN, false, {}, { llm: fakeCouncilLLM().llm });
    const partial = Object.fromEntries(Object.entries(first.steps).filter(([k]) => /^(1\.|2\.|3\.)/.test(k)));
    const f = fakePg(claimedRow({ deliberacion_json: partial, status: 'running' }));
    const { llm, calls } = fakeCouncilLLM();
    const out = await processRun(f.pg, RUN, true, {}, { llm });
    expect(out.ok).toBe(true);
    expect(calls.length).toBeLessThan(15);
    expect(f.queries.find((q) => /WITH c AS/.test(q.sql))!.params[1]).toEqual(['rounds_queued', 'error_interrupted']);
  });
});

describe('eco-advisor · reaper', () => {
  test('reinvoca las rounds_queued atascadas', async () => {
    const queries: string[] = [];
    const pg: PgLike = {
      query: (async (sql: string) => {
        queries.push(sql);
        if (/SELECT id, COALESCE/.test(sql)) return { rows: [{ id: RUN, reinvoked: false }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }) as PgLike['query'],
    };
    const invoke = jest.fn(async () => undefined);
    const out = await reaper(pg, {}, invoke);
    expect(out).toMatchObject({ ok: true, requeued: 1 });
    expect(invoke).toHaveBeenCalledWith(RUN);
  });
});
