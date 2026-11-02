import { appendEvent, claimRun, reapStaleRuns, setRunStatus, TERMINAL_STATUSES, type PgLike } from '@eco/shared/src/advisor/run-store';

type Q = { sql: string; params: unknown[] };
const mk = (handler: (sql: string, params: unknown[], n: number) => { rows: unknown[]; rowCount?: number } | Error) => {
  const queries: Q[] = [];
  const pool: PgLike = {
    query: (async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const r = handler(sql, params, queries.length);
      if (r instanceof Error) throw r;
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    }) as PgLike['query'],
  };
  return { pool, queries };
};
const uniq = () => Object.assign(new Error('duplicate key'), { code: '23505' });

describe('appendEvent', () => {
  test('reintenta cuando dos asientos calculan el mismo seq (violación de llave única)', async () => {
    let fails = 2;
    const { pool, queries } = mk(() => (fails-- > 0 ? uniq() : { rows: [] }));
    await appendEvent(pool, 'r1', 'seat_done', { a: 1 });
    expect(queries).toHaveLength(3);
  });
  test('un error distinto no se reintenta', async () => {
    const { pool, queries } = mk(() => new Error('conexión caída'));
    await expect(appendEvent(pool, 'r1', 'x', {})).rejects.toThrow('conexión caída');
    expect(queries).toHaveLength(1);
  });
  test('se rinde tras varios choques seguidos', async () => {
    const { pool, queries } = mk(() => uniq());
    await expect(appendEvent(pool, 'r1', 'x', {})).rejects.toMatchObject({ code: '23505' });
    expect(queries.length).toBeGreaterThan(5);
  });
});

describe('claimRun', () => {
  test('solo toma corridas rounds_queued del camino 3 (una invocación duplicada sale sin hacer nada)', async () => {
    const { pool, queries } = mk(() => ({ rows: [] }));
    expect(await claimRun(pool, 'r1')).toBeNull();
    expect(queries[0].sql).toMatch(/camino = 3/);
    expect(queries[0].params[1]).toEqual(['rounds_queued']);
  });
  test('reanudar admite error_interrupted', async () => {
    const { pool, queries } = mk(() => ({ rows: [{ id: 'r1' }] }));
    await claimRun(pool, 'r1', { resume: true });
    expect(queries[0].params[1]).toEqual(['rounds_queued', 'error_interrupted']);
  });
});

describe('reapStaleRuns (spec §10.4)', () => {
  test('marca interrumpidas, reinvoca una vez las rounds_queued y se rinde en la segunda', async () => {
    const { pool, queries } = mk((sql) => {
      if (/SET status = 'error_interrupted'.*r0_running/s.test(sql)) return { rows: [{ id: 'stale-1' }] };
      if (/SELECT id, COALESCE/.test(sql)) return { rows: [{ id: 'q-new', reinvoked: false }, { id: 'q-old', reinvoked: true }] };
      return { rows: [] };
    });
    const out = await reapStaleRuns(pool);
    expect(out.requeue).toEqual(['q-new']);
    expect(out.interrupted.sort()).toEqual(['q-old', 'stale-1']);
    expect(queries.some((q) => /"reinvoked":1/.test(q.sql) && (q.params[0] as string[]).includes('q-new'))).toBe(true);
    const errEvents = queries.filter((q) => /INSERT INTO advisor_events/.test(q.sql)).map((q) => q.params[0]);
    expect(errEvents.sort()).toEqual(['q-old', 'stale-1']);
  });
  test('los umbrales por defecto son 15 y 5 minutos', async () => {
    const { pool, queries } = mk(() => ({ rows: [] }));
    await reapStaleRuns(pool);
    expect(queries[0].params[0]).toBe(15);
    expect(queries[1].params[0]).toBe(5);
  });
});

describe('estados', () => {
  test('r0_running y rounds_queued no son terminales', () => {
    expect(TERMINAL_STATUSES).not.toContain('r0_running');
    expect(TERMINAL_STATUSES).not.toContain('rounds_queued');
  });
  test('setRunStatus conserva lo que no se pasa (COALESCE)', async () => {
    const { pool, queries } = mk(() => ({ rows: [] }));
    await setRunStatus(pool, 'r1', 'done', { costUsd: 0.5 });
    expect(queries[0].params).toEqual(['r1', 'done', null, null, null, 0.5, null, null, null]);
  });
});
