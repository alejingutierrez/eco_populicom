// Cierre de la conexión a la base con tiempo máximo (incidente del 15-nov-2026:
// `client.end()` no volvió y el refresh llegó al timeout de 900 s del lambda).

import { closeClientWithin, DB_CLOSE_TIMEOUT_MS } from '../lambda/ingestion/db-close';

describe('closeClientWithin', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('un cierre normal devuelve closed y no deja temporizadores vivos', async () => {
    const warn = jest.fn();
    const outcome = await closeClientWithin({ end: async () => undefined }, 5_000, warn);
    expect(outcome).toBe('closed');
    expect(warn).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('si end() no vuelve, se abandona al cumplirse el tiempo y se destruye el socket', async () => {
    const warn = jest.fn();
    const destroy = jest.fn();
    const pending = closeClientWithin(
      { end: () => new Promise(() => undefined), connection: { stream: { destroy } } },
      5_000,
      warn,
    );
    let settled = false;
    void pending.then(() => { settled = true; });

    await jest.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(await pending).toBe('timed-out');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DB-CIERRE-COLGADO'));
  });

  test('si end() no vuelve y no hay socket a mano, igual termina', async () => {
    const pending = closeClientWithin({ end: () => new Promise(() => undefined) }, 1_000, jest.fn());
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBe('timed-out');
  });

  test('un end() que falla no lanza: se avisa y devuelve failed', async () => {
    const warn = jest.fn();
    const outcome = await closeClientWithin(
      { end: async () => { throw new Error('socket hang up'); } },
      5_000,
      warn,
    );
    expect(outcome).toBe('failed');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('socket hang up'));
    expect(jest.getTimerCount()).toBe(0);
  });

  test('el tiempo por defecto es corto frente al timeout del lambda', () => {
    expect(DB_CLOSE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});
