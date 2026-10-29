import { orderQueryJobs } from '../lambda/ingestion/query-order';
import type { QueryServedAt } from '../lambda/ingestion/query-order';

const job = (queryId: number, agency = 'a') => ({ queryId, agency });
const ids = (jobs: Array<{ queryId: number }>) => jobs.map((j) => j.queryId);
const served = (entries: Array<[number, QueryServedAt]>) => new Map(entries);

describe('orderQueryJobs', () => {
  test('la query que lleva más tiempo sin servirse va primero', () => {
    const out = orderQueryJobs(
      [job(1), job(2), job(3)],
      served([
        [1, { lastRunAt: '2026-10-28T15:00:00Z' }],
        [2, { lastRunAt: '2026-10-28T14:00:00Z' }],
        [3, { lastRunAt: '2026-10-28T14:30:00Z' }],
      ]),
    );
    expect(ids(out)).toEqual([2, 3, 1]);
  });

  test('sin fila de cursor, con last_run_at null o ilegible = nunca servida: va primero', () => {
    const out = orderQueryJobs(
      [job(1), job(2), job(3), job(4)],
      served([
        [1, { lastRunAt: '2026-10-28T10:00:00Z' }],
        [3, { lastRunAt: null }],
        [4, { lastRunAt: 'garbage' }],
      ]),
    );
    // 2 (sin fila), 3 (null) y 4 (ilegible) empatan y conservan su orden relativo
    expect(ids(out)).toEqual([2, 3, 4, 1]);
  });

  test('acepta Date (pg) y string ISO mezclados', () => {
    const out = orderQueryJobs(
      [job(1), job(2)],
      served([
        [1, { lastRunAt: new Date('2026-10-28T15:00:00Z') }],
        [2, { lastRunAt: '2026-10-28T14:00:00Z' }],
      ]),
    );
    expect(ids(out)).toEqual([2, 1]);
  });

  test('empate en last_run_at: gana el cursor más viejo; si también empata, el orden original', () => {
    const t = '2026-10-28T15:00:00Z';
    const out = orderQueryJobs(
      [job(1), job(2), job(3), job(4)],
      served([
        [1, { lastRunAt: t, lastMentionDate: '2026-10-28T14:55:00Z' }],
        [2, { lastRunAt: t, lastMentionDate: '2026-10-28T12:00:00Z' }],
        [3, { lastRunAt: t, lastMentionDate: '2026-10-28T14:55:00Z' }],
        [4, { lastRunAt: t }],
      ]),
    );
    // 4 (sin cursor) < 2 (12:00) < 1 y 3 (14:55, en su orden original)
    expect(ids(out)).toEqual([4, 2, 1, 3]);
  });

  test('sin información de nadie conserva el orden original (como antes de este cambio)', () => {
    const jobs = [job(30), job(10), job(20)];
    expect(ids(orderQueryJobs(jobs, new Map()))).toEqual([30, 10, 20]);
  });

  test('ordena por cuándo se SIRVIÓ, no por la fecha de la mención más reciente', () => {
    // 100 = query muy activa: cursor a minutos, pero hace horas que no se sirve (la saltó el cortacircuitos).
    // 200 = query tranquila: cursor de hace días, pero se sirvió hace un minuto.
    // Ordenar por cursor mandaría a la activa al final para siempre; por last_run_at, va primero.
    const out = orderQueryJobs(
      [job(200), job(100)],
      served([
        [100, { lastRunAt: '2026-10-28T09:00:00Z', lastMentionDate: '2026-10-28T08:58:00Z' }],
        [200, { lastRunAt: '2026-10-28T15:04:00Z', lastMentionDate: '2026-10-25T02:00:00Z' }],
      ]),
    );
    expect(ids(out)).toEqual([100, 200]);
  });

  test('no muta la entrada y conserva los objetos (agencia incluida)', () => {
    const jobs = [job(1, 'ddecpr'), job(2, 'df')];
    const copy = [...jobs];
    const out = orderQueryJobs(jobs, served([[1, { lastRunAt: '2026-10-28T15:00:00Z' }], [2, { lastRunAt: '2026-10-28T14:00:00Z' }]]));
    expect(jobs).toEqual(copy);
    expect(out[0]).toBe(jobs[1]);
    expect(out[0].agency).toBe('df');
  });

  test('lista vacía o de una sola query', () => {
    expect(orderQueryJobs([], new Map())).toEqual([]);
    expect(ids(orderQueryJobs([job(7)], new Map()))).toEqual([7]);
  });
});
