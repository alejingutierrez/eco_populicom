/**
 * Frescura de menciones por agencia (OPS-04, nov 2026).
 *
 * La pregunta es «¿esta agencia lleva demasiado sin recibir menciones?», y
 * «demasiado» depende de la hora. Medido sobre 30 días (25-oct a 24-nov-2026)
 * con las tres agencias activas: un umbral plano de 3 horas habría saltado 63
 * veces, casi todas de madrugada o en fin de semana, cuando es normal que no
 * se publique nada (silencios nocturnos de hasta 7 horas, y de casi 6 un
 * sábado de día).
 *
 * Por eso no se cuentan minutos de reloj sino MINUTOS HÁBILES: cada minuto de
 * silencio pesa según cuándo cae, en hora de Puerto Rico (UTC−4 fijo, sin
 * horario de verano):
 *
 *   lunes a viernes, 8:00–22:00   pesa 1
 *   sábado y domingo, 8:00–22:00  pesa 0.5
 *   22:00–8:00                    pesa 0
 *
 * La agencia está «callada» al pasar de 240 minutos hábiles: 4 horas de un
 * día de semana, 8 de un fin de semana. Sobre los mismos 30 días: con 180
 * habrían salido 6 avisos (5 de DDEC, que recibe ~80 menciones al día y pasa
 * mañanas enteras sin ninguna; cuatro se resolvieron solos); con 240 salen 2,
 * y uno es el incidente real de cuota del 26-oct. El límite se cambia sin
 * desplegar código con la variable `FRESHNESS_LIMIT_AWAKE_MINUTES` del lambda.
 * Una caída de madrugada se avisa a las 12:00 del mediodía; para enterarse antes están las alarmas de la ingesta (callada a
 * los 12 minutos, query desatendida a la hora), que no dependen de que haya
 * conversación. Esta cubre el caso que aquellas no ven: la ingesta corre pero
 * una agencia dejó de recibir (canal caído, query rota).
 */

const PR_OFFSET_MS = -4 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

export const FRESHNESS_DAY_START_HOUR = 8;
export const FRESHNESS_DAY_END_HOUR = 22;
export const FRESHNESS_WEEKEND_WEIGHT = 0.5;
/** Minutos hábiles sin menciones a partir de los cuales una agencia está callada. */
export const FRESHNESS_LIMIT_AWAKE_MINUTES = 240;
/** Tope del cálculo: más allá de 7 días el número ya no dice nada nuevo. */
const MAX_SPAN_MINUTES = 7 * 24 * 60;

/** Peso de un instante según la hora y el día de la semana en Puerto Rico. */
export function freshnessWeightAt(utcMs: number): number {
  const pr = new Date(utcMs + PR_OFFSET_MS);
  const hour = pr.getUTCHours();
  if (hour < FRESHNESS_DAY_START_HOUR || hour >= FRESHNESS_DAY_END_HOUR) return 0;
  const dow = pr.getUTCDay();
  return dow === 0 || dow === 6 ? FRESHNESS_WEEKEND_WEIGHT : 1;
}

/**
 * Minutos hábiles entre dos instantes. Suma por tramos de una hora local (el
 * peso solo cambia en punto), así que es exacto al minuto y barato.
 */
export function awakeMinutesBetween(from: Date, to: Date): number {
  const end = to.getTime();
  let cursor = Math.max(from.getTime(), end - MAX_SPAN_MINUTES * MINUTE_MS);
  if (!(cursor < end)) return 0;
  let total = 0;
  while (cursor < end) {
    // Fin del tramo: la próxima hora en punto (igual en UTC y en PR: el
    // desfase es de horas enteras) o el final del intervalo.
    const nextHour = (Math.floor(cursor / (60 * MINUTE_MS)) + 1) * 60 * MINUTE_MS;
    const stop = Math.min(nextHour, end);
    total += ((stop - cursor) / MINUTE_MS) * freshnessWeightAt(cursor);
    cursor = stop;
  }
  return total;
}

export interface AgencyFreshness {
  slug: string;
  /** Minutos de reloj desde la última mención recibida. */
  minutesSince: number;
  /** Los mismos minutos, pesados por hora y día. */
  awakeMinutes: number;
  silent: boolean;
}

export function agencyFreshness(
  slug: string,
  lastIngestedAt: Date,
  now: Date,
  limitAwakeMinutes: number = FRESHNESS_LIMIT_AWAKE_MINUTES,
): AgencyFreshness {
  const minutesSince = Math.max(0, (now.getTime() - lastIngestedAt.getTime()) / MINUTE_MS);
  const awakeMinutes = awakeMinutesBetween(lastIngestedAt, now);
  return {
    slug,
    minutesSince: Math.round(minutesSince),
    awakeMinutes: Math.round(awakeMinutes),
    silent: awakeMinutes > limitAwakeMinutes,
  };
}

export const DATA_METRICS_NAMESPACE = 'ECO/Datos';

/**
 * Línea EMF (CloudWatch Embedded Metric Format) con la salud de los datos al
 * cierre de una corrida de `eco-metrics-calculator`. Basta con escribirla en
 * el log: CloudWatch la convierte en métricas, sin permisos ni llamadas extra.
 *
 *   SnapshotsCalculados   agencias cuyo snapshot de hoy se calculó en esta corrida
 *   AgenciasCalladas      agencias sobre el límite de minutos hábiles sin menciones
 *
 * y, por agencia (dimensión `Agencia`), `MinutosSinMenciones` y
 * `MinutosHabilesSinMenciones`.
 */
export function buildDataHealthMetricLines(input: {
  snapshotsComputed: number;
  agencies: AgencyFreshness[];
  timestampMs?: number;
}): string[] {
  const ts = input.timestampMs ?? Date.now();
  const lines: string[] = [];
  lines.push(JSON.stringify({
    _aws: {
      Timestamp: ts,
      CloudWatchMetrics: [{
        Namespace: DATA_METRICS_NAMESPACE,
        Dimensions: [[]],
        Metrics: [
          { Name: 'SnapshotsCalculados', Unit: 'Count' },
          { Name: 'AgenciasCalladas', Unit: 'Count' },
        ],
      }],
    },
    SnapshotsCalculados: input.snapshotsComputed,
    AgenciasCalladas: input.agencies.filter((a) => a.silent).length,
    calladas: input.agencies.filter((a) => a.silent).map((a) => a.slug),
  }));
  for (const a of input.agencies) {
    lines.push(JSON.stringify({
      _aws: {
        Timestamp: ts,
        CloudWatchMetrics: [{
          Namespace: DATA_METRICS_NAMESPACE,
          Dimensions: [['Agencia']],
          Metrics: [
            { Name: 'MinutosSinMenciones', Unit: 'Count' },
            { Name: 'MinutosHabilesSinMenciones', Unit: 'Count' },
          ],
        }],
      },
      Agencia: a.slug,
      MinutosSinMenciones: a.minutesSince,
      MinutosHabilesSinMenciones: a.awakeMinutes,
    }));
  }
  return lines;
}
