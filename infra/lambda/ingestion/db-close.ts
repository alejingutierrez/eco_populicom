// Cierre de la conexión a la base con tiempo máximo (ING-01).
//
// Por qué existe: el 15-nov-2026 el refresh de las 07:00 UTC sondeó sus 6
// queries en 3 min y después se quedó en `await client.end()` hasta el timeout
// de 900 s del lambda. Con concurrencia 1, eso dejó la ingesta 20 min sin
// correr y la corrida sin línea de métricas. `pg` espera a que el servidor
// cierre el socket; si la conexión quedó medio muerta, no vuelve nunca.
//
// Al cerrar, el trabajo de la corrida ya está hecho: un cierre que no termina
// se abandona, se destruye el socket y la corrida sigue hasta su línea de
// métricas.

export const DB_CLOSE_TIMEOUT_MS = 5_000;

interface ClosableClient {
  end: () => Promise<unknown>;
  /** Interno de `pg`: el socket crudo, para soltarlo si `end()` no vuelve. */
  connection?: { stream?: { destroy?: () => void } };
}

export type CloseOutcome = 'closed' | 'timed-out' | 'failed';

/**
 * Cierra `client` sin esperar más de `timeoutMs`. Nunca lanza: un fallo al
 * cerrar no debe convertir una corrida buena en un error del lambda.
 */
export async function closeClientWithin(
  client: ClosableClient,
  timeoutMs: number = DB_CLOSE_TIMEOUT_MS,
  warn: (msg: string) => void = console.warn,
): Promise<CloseOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs);
  });
  const closing = client.end().then(
    () => 'closed' as const,
    (err: unknown) => {
      warn(`No se pudo cerrar la conexión a la base: ${(err as Error)?.message ?? err}`);
      return 'failed' as const;
    },
  );
  const outcome = await Promise.race([closing, timedOut]);
  if (timer !== undefined) clearTimeout(timer);
  if (outcome === 'timed-out') {
    warn(`DB-CIERRE-COLGADO: client.end() no volvió en ${timeoutMs} ms; se destruye el socket y la corrida sigue`);
    try {
      client.connection?.stream?.destroy?.();
    } catch {
      // Sin socket que soltar: no hay nada más que hacer.
    }
  }
  return outcome;
}
