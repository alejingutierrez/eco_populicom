import { appendEvent, type Pool } from './runs';

// Simula el esquema real: PK (run_id, seq) y seq = MAX + 1 calculado en el INSERT.
function fakePool(opts: { collideFirst?: number; failWith?: { code: string } } = {}) {
  const seqs: number[] = [];
  let calls = 0;
  const pool = {
    query: async () => {
      calls++;
      if (opts.failWith) throw Object.assign(new Error('boom'), opts.failWith);
      if (calls <= (opts.collideFirst ?? 0)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      seqs.push(seqs.length + 1);
      return { rowCount: 1 };
    },
  } as unknown as Pool;
  return { pool, seqs, calls: () => calls };
}

describe('appendEvent', () => {
  it('reintenta cuando el seq choca con la clave primaria (23505)', async () => {
    const f = fakePool({ collideFirst: 3 });
    await appendEvent(f.pool, 'run-1', 'tool_call', { a: 1 });
    expect(f.calls()).toBe(4);
    expect(f.seqs).toEqual([1]);
  });

  it('escrituras en paralelo no matan la corrida', async () => {
    const f = fakePool({ collideFirst: 2 });
    await expect(
      Promise.all([appendEvent(f.pool, 'r', 'tool_call', {}), appendEvent(f.pool, 'r', 'tool_call', {})]),
    ).resolves.toBeDefined();
  });

  it('no reintenta errores distintos de 23505', async () => {
    const f = fakePool({ failWith: { code: '42P01' } });
    await expect(appendEvent(f.pool, 'r', 'x', {})).rejects.toMatchObject({ code: '42P01' });
    expect(f.calls()).toBe(1);
  });

  it('se rinde tras los reintentos máximos', async () => {
    const f = fakePool({ failWith: { code: '23505' } });
    await expect(appendEvent(f.pool, 'r', 'x', {})).rejects.toMatchObject({ code: '23505' });
    expect(f.calls()).toBe(9);
  });
});
