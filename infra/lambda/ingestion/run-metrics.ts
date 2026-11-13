// Señal de salud de la ingesta (ING-01). Puro, sin I/O: arma la línea EMF
// (CloudWatch Embedded Metric Format) que el handler escribe al cierre de cada
// corrida. CloudWatch extrae las métricas del log: no hace falta permiso de
// PutMetricData ni cambiar el CDK del lambda.
//
// Por qué existe: el lambda responde 200 aunque el cortacircuitos aborte o
// fallen todas las queries, así que las métricas de Lambda (Invocations,
// Errors) no distinguen una ingesta sana de una que no trae nada. Las alarmas
// de `infra/lib/monitoring-stack.ts` miran estas métricas.

import type { RunMode } from './run-guard';

export const METRICS_NAMESPACE = 'ECO/Ingesta';

export interface RunMetricsInput {
  mode: RunMode;
  /** Epoch ms del cierre de la corrida. */
  timestampMs: number;
  /** Queries que completaron su sondeo (con o sin menciones). */
  queriesOk: number;
  /** Queries con error más las que el cortacircuitos dejó sin sondear. */
  queriesFailed: number;
  aborted: boolean;
  /** Respuestas 429 recibidas (cada una gastó cupo). */
  rateLimited: number;
  /** Peticiones hechas a Brandwatch, reintentos incluidos. */
  requests: number;
  /** `x-rate-limit-used` más alto visto; null si la API no lo mandó. */
  quotaUsedMax: number | null;
  /** Antigüedad del sondeo más viejo al empezar; null si no se pudo leer. */
  maxMinutesSinceServed: number | null;
}

interface ServedAtLike {
  lastRunAt?: Date | string | null;
}

/**
 * Minutos desde el sondeo más viejo entre las queries de la corrida, medido al
 * EMPEZAR (antes de servir nada). Una query sin fila de cursor, o con una
 * fecha ilegible, no cuenta; sin ninguna, null (no se publica la métrica).
 */
export function maxMinutesSinceServed(
  queryIds: number[],
  served: Map<number, ServedAtLike>,
  nowMs: number,
): number | null {
  let max: number | null = null;
  for (const queryId of queryIds) {
    const raw = served.get(queryId)?.lastRunAt;
    if (raw === null || raw === undefined) continue;
    const at = raw instanceof Date ? raw.getTime() : Date.parse(raw);
    if (!Number.isFinite(at)) continue;
    const minutes = Math.max(0, (nowMs - at) / 60_000);
    max = max === null ? minutes : Math.max(max, minutes);
  }
  return max === null ? null : Math.round(max * 10) / 10;
}

/**
 * Línea EMF de la corrida. Cada métrica se publica dos veces: sin dimensiones
 * (la que usan las alarmas: cualquier modo cuenta como señal de vida) y con
 * `Modo` (para el diagnóstico). Las dos opcionales solo aparecen si hay dato:
 * una métrica ausente no es un cero.
 */
export function buildRunMetricsLine(input: RunMetricsInput): string {
  const values: Record<string, number> = {
    QueriesSondeadas: input.queriesOk,
    QueriesFallidas: input.queriesFailed,
    CorridaAbortada: input.aborted ? 1 : 0,
    Avisos429: input.rateLimited,
    Peticiones: input.requests,
  };
  const units: Record<string, string> = {
    QueriesSondeadas: 'Count',
    QueriesFallidas: 'Count',
    CorridaAbortada: 'Count',
    Avisos429: 'Count',
    Peticiones: 'Count',
  };
  if (input.quotaUsedMax !== null) {
    values.CuotaUsadaMax = input.quotaUsedMax;
    units.CuotaUsadaMax = 'Count';
  }
  if (input.maxMinutesSinceServed !== null) {
    values.MinutosSinSondeoMax = input.maxMinutesSinceServed;
    units.MinutosSinSondeoMax = 'None';
  }

  return JSON.stringify({
    _aws: {
      Timestamp: input.timestampMs,
      CloudWatchMetrics: [
        {
          Namespace: METRICS_NAMESPACE,
          Dimensions: [[], ['Modo']],
          Metrics: Object.keys(values).map((Name) => ({ Name, Unit: units[Name] })),
        },
      ],
    },
    Modo: input.mode,
    ...values,
  });
}
