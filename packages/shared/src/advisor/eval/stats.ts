// Estadística del arnés (spec §13.3): errores estándar agrupados por crisis y kappa de Cohen.
// Las 3 repeticiones por caso NO son observaciones independientes: se agrupan por episodio.

export const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export interface ClusteredMean {
  n: number;
  clusters: number;
  mean: number;
  /** Error estándar robusto por clúster (CR1). NaN con menos de 2 clústeres. */
  se: number;
}

/**
 * Media con error estándar agrupado: SE = sqrt( G/(G-1) · Σ_g (Σ_{i∈g}(y_i − ȳ))² ) / N.
 * Es lo que evita presumir 3 repeticiones × 2 preguntas como 6 crisis distintas.
 */
export function clusteredMean(values: ReadonlyArray<{ cluster: string; y: number }>): ClusteredMean {
  const n = values.length;
  const byCluster = new Map<string, number[]>();
  for (const v of values) byCluster.set(v.cluster, [...(byCluster.get(v.cluster) ?? []), v.y]);
  const G = byCluster.size;
  const m = mean(values.map((v) => v.y));
  if (n === 0) return { n, clusters: 0, mean: NaN, se: NaN };
  if (G < 2) return { n, clusters: G, mean: m, se: NaN };
  let ss = 0;
  for (const ys of byCluster.values()) ss += ys.reduce((a, y) => a + (y - m), 0) ** 2;
  return { n, clusters: G, mean: m, se: Math.sqrt((G / (G - 1)) * ss) / n };
}

/**
 * Kappa de Cohen para dos calificadores con etiquetas categóricas (mismo orden de elementos).
 * Devuelve NaN si no hay elementos; 1 si coinciden del todo con una sola categoría.
 */
export function cohenKappa(a: readonly string[], b: readonly string[]): number {
  if (a.length !== b.length) throw new Error('cohenKappa: las listas deben tener la misma longitud');
  const n = a.length;
  if (n === 0) return NaN;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((acc, c) => acc + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

/** Etiqueta cualitativa de Landis y Koch, para el informe. */
export function kappaBand(k: number): string {
  if (Number.isNaN(k)) return 'sin datos';
  if (k < 0) return 'peor que el azar';
  if (k <= 0.2) return 'leve';
  if (k <= 0.4) return 'aceptable';
  if (k <= 0.6) return 'moderado';
  if (k <= 0.8) return 'sustancial';
  return 'casi perfecto';
}
