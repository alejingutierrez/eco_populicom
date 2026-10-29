// Orden de las queries dentro de una corrida de ingesta (puro, sin I/O),
// separado del handler para probarlo sin AWS ni Brandwatch.
//
// Con la cuota de Brandwatch al límite, el cortacircuitos (run-guard.ts) aborta
// lo que falta de la corrida cuando una query agota sus reintentos. Si el orden
// fuera siempre el mismo (agencias y queries tal como salen de la tabla:
// DDEC → Gobernadora → DF), las últimas del recorrido serían las que se quedan
// sin sondear una y otra vez. Aquí se ordena por "quién lleva más tiempo sin
// servirse" para que ese hueco rote: lo que se saltó hoy va primero mañana.
//
// Clave principal: `last_run_at` (la última vez que la query se sirvió), NO
// `last_mention_date`. La fecha de la mención más reciente depende del volumen
// de la query y no de cuánto se sondeó: una query de mucho tráfico (DF, DDEC)
// siempre tiene el cursor a minutos y una tranquila siempre lo tiene viejo, así
// que ordenar por ella dejaría a las muy activas —las más caras— al final del
// recorrido para siempre. `last_run_at` sí sube con cada servicio y se queda
// atrás cuando una query se salta.

export interface QueryServedAt {
  /** Última vez que se sirvió la query (ingestion_cursors.last_run_at). */
  lastRunAt?: Date | string | null;
  /** Cursor de la query (ingestion_cursors.last_mention_date); solo desempata. */
  lastMentionDate?: Date | string | null;
}

function toMs(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) return Number.NEGATIVE_INFINITY;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Ordena las queries de la más desatendida a la más reciente. Una query sin
 * fila de cursor (nunca servida) o con fecha ilegible va primero. Empata por
 * cursor más viejo y, si siguen empatadas, por su posición original (así el
 * resultado es estable y, sin información de cursores, se conserva el orden de
 * antes). No muta la entrada.
 */
export function orderQueryJobs<T extends { queryId: number }>(
  jobs: ReadonlyArray<T>,
  served: ReadonlyMap<number, QueryServedAt>,
): T[] {
  return jobs
    .map((job, index) => {
      const s = served.get(job.queryId);
      return { job, index, runMs: toMs(s?.lastRunAt), cursorMs: toMs(s?.lastMentionDate) };
    })
    .sort((a, b) => {
      if (a.runMs !== b.runMs) return a.runMs < b.runMs ? -1 : 1;
      if (a.cursorMs !== b.cursorMs) return a.cursorMs < b.cursorMs ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.job);
}
