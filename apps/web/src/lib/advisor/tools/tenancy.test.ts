import { runAdvisorTool } from './index';
import type { AdvisorToolCtx } from './types';

const AGENCY_A = 'aaaaaaaa-1111-4222-8333-000000000001';
const AGENCY_B = 'bbbbbbbb-1111-4222-8333-000000000002';
const NARR_A = '3f2a9c1e-0000-4000-8000-00000000000a';

type Call = { sql: string; params: unknown[] };

/**
 * Pool falso: la tabla narratives solo devuelve filas si el ID y la agencia
 * coinciden (como la consulta real con `agency_id = $2`). Todo lo demás vacío.
 */
function tenantPool(owner: Record<string, string>, log: Call[], extra?: (sql: string) => unknown[] | undefined) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (/FROM narratives WHERE id/.test(sql)) {
        const [id, agency] = params as string[];
        return { rows: owner[id] === agency ? [{ id }] : [] };
      }
      const hit = extra?.(sql);
      return { rows: hit ?? [] };
    },
  };
}

const ctxFor = (agencyId: string, pool: unknown): AdvisorToolCtx => ({
  agencyId,
  agencySlug: 'ddecpr',
  agencyName: 'DDEC',
  userSub: 'user-test',
  asOf: new Date('2026-10-28T15:00:00Z'),
  runId: null,
  pool: pool as AdvisorToolCtx['pool'],
});

describe('tenencia: IDs de narrativa', () => {
  test('ID de otra agencia devuelve «no encontrado» y no consulta nada más', async () => {
    const log: Call[] = [];
    const pool = tenantPool({ [NARR_A]: AGENCY_A }, log);
    const r = await runAdvisorTool('quien_movio_nss', { narrativa: `N-${NARR_A}` }, ctxFor(AGENCY_B, pool));
    expect(r.ok).toBe(false);
    expect((JSON.parse(r.text) as { error: string }).error).toContain('no encontrado');
    expect(log).toHaveLength(1);
    expect(log[0].sql).toContain('agency_id = $2::uuid');
    expect(log[0].params).toEqual([NARR_A, AGENCY_B]);
  });

  test('ID de la propia agencia pasa la verificación', async () => {
    const log: Call[] = [];
    const pool = tenantPool({ [NARR_A]: AGENCY_A }, log);
    const r = await runAdvisorTool('quien_movio_nss', { narrativa: `N-${NARR_A}` }, ctxFor(AGENCY_A, pool));
    expect(r.text).not.toContain('no encontrado');
    expect(r.ok).toBe(true);
    expect(log.length).toBeGreaterThan(1);
  });

  test('ID inexistente en cualquier agencia: «no encontrado»', async () => {
    const pool = tenantPool({}, []);
    const r = await runAdvisorTool('quien_movio_nss', { narrativa: `N-${NARR_A}` }, ctxFor(AGENCY_A, pool));
    expect(r.ok).toBe(false);
    expect(r.text).toContain('no encontrado');
  });

  test('formato de ID mal escrito: error accionable con el valor recibido', async () => {
    const r = await runAdvisorTool('quien_movio_nss', { narrativa: 'N-112' }, ctxFor(AGENCY_A, tenantPool({}, [])));
    expect(r.ok).toBe(false);
    const msg = (JSON.parse(r.text) as { error: string }).error;
    expect(msg).toContain('"N-<identificador>"');
    expect(msg).toContain('N-112');
  });
});

describe('tenencia: historial_agencia consulta solo la agencia del contexto', () => {
  test('todas las consultas llevan el agencyId del contexto', async () => {
    const log: Call[] = [];
    const pool = tenantPool({}, log, (sql) =>
      /FROM agencies a/.test(sql)
        ? [{ brandwatch_project_id: null, brandwatch_query_ids: null, start_ymd: '2026-01-01', last_published_at: null, last_ingested_at: null }]
        : undefined,
    );
    const r = await runAdvisorTool('historial_agencia', {}, ctxFor(AGENCY_B, pool));
    expect(r.ok).toBe(true);
    expect(log.length).toBeGreaterThan(0);
    for (const c of log) {
      expect(c.params).toContain(AGENCY_B);
      expect(c.params).not.toContain(AGENCY_A);
    }
    const snapQuery = log.find((c) => /daily_metric_snapshots/.test(c.sql));
    expect(snapQuery?.sql).toContain('agency_id = $1::uuid');
  });
});
