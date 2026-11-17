// Horario del cron de 5 min de eco-ingestion (ING-01, WP-4).
//
// Antes era `rate(5 minutes)`: la fase de un `rate` depende de cuándo se creó
// la regla, y la de BrandIQ (misma cuenta de Brandwatch, misma cuota) caía 48 s
// antes que la de ECO. Con minutos fijos y distintos los dos productos no piden
// a la vez: ECO en los minutos 0, 5, 10… y BrandIQ en los 2, 7, 12…
//
// Las dos expresiones son el acuerdo con BrandIQ: ver
// docs/tecnica/propuesta-reparto-cuota-brandwatch-brandiq.md. La de BrandIQ
// vive en su repo; aquí está solo para que la prueba vigile que no se pisan.
export const ECO_INGESTION_CRON = 'cron(0/5 * * * ? *)';
export const BIQ_INGESTION_CRON = 'cron(2/5 * * * ? *)';

/**
 * Minutos de la hora en que dispara una expresión `cron(A/B * * * ? *)` de
 * EventBridge (campo de minutos «desde A, cada B»). Solo entiende esa forma:
 * es la única que usan los crons de ingesta.
 */
export function cronMinutes(expression: string): number[] {
  const m = /^cron\((\d+)\/(\d+) \* \* \* \? \*\)$/.exec(expression);
  if (!m) throw new Error(`Expresión de cron no soportada: ${expression}`);
  const start = Number(m[1]);
  const step = Number(m[2]);
  if (start > 59 || step < 1) throw new Error(`Expresión de cron inválida: ${expression}`);
  const minutes: number[] = [];
  for (let minute = start; minute < 60; minute += step) minutes.push(minute);
  return minutes;
}

/** Separación mínima, en minutos y en círculo sobre la hora, entre dos crons. */
export function minGapMinutes(a: number[], b: number[]): number {
  let gap = 60;
  for (const x of a) {
    for (const y of b) {
      const d = Math.abs(x - y);
      gap = Math.min(gap, d, 60 - d);
    }
  }
  return gap;
}
