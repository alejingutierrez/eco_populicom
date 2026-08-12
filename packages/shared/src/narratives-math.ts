/**
 * Pure math helpers for the narratives feature.
 *
 * Sin dependencias externas — solo TypeScript. Estos helpers se usan en el
 * lambda `eco-narrative-cluster` para asignación a centroides, DBSCAN sobre
 * candidatos y transiciones de ciclo de vida. Tener todo aquí, fuera del
 * lambda, los hace unit-testables y reusables (drift detection, etc).
 */

export type NarrativeStatus =
  | 'emerging'
  | 'active'
  | 'peaking'
  | 'declining'
  | 'dormant'
  | 'revived';

// ---------------------------------------------------------------------------
// Vector ops
// ---------------------------------------------------------------------------

/**
 * Similitud coseno entre dos vectores. No asume que estén normalizados; calcula
 * las normas explícitamente. Para vectores normalizados (típico con Titan v2
 * `normalize=true`), es equivalente al dot product.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dim mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Convenience: distance = 1 - similarity. Rango típico [0, 2]. */
export function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

/** L2 norm de un vector. */
export function l2Norm(v: number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) sum += v[i] * v[i];
  return Math.sqrt(sum);
}

/** Normaliza a unit length. Si el vector es cero, retorna copia. */
export function normalize(v: number[]): number[] {
  const n = l2Norm(v);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

/**
 * Promedio elemento-a-elemento de un set de vectores. Útil para construir el
 * centroide inicial de una narrativa recién nacida (mean del cluster denso).
 * Por convención el resultado se normaliza, para mantener centroides unit-length
 * y consistencia con los embeddings de Titan v2.
 */
export function vectorMean(points: number[][]): number[] {
  if (points.length === 0) throw new Error('vectorMean: empty input');
  const dim = points[0].length;
  const acc = new Array<number>(dim).fill(0);
  for (const p of points) {
    if (p.length !== dim) throw new Error(`vectorMean: dim mismatch (${p.length} vs ${dim})`);
    for (let i = 0; i < dim; i += 1) acc[i] += p[i];
  }
  for (let i = 0; i < dim; i += 1) acc[i] /= points.length;
  return normalize(acc);
}

/**
 * Update EWMA del centroide con un nuevo punto.
 *
 *   centroid' = (1 - alpha) * centroid + alpha * newPoint
 *
 * Con alpha pequeño (default 0.05) el centroide se mueve lentamente — preserva
 * identidad de la narrativa aunque deriva con el tiempo. El resultado se
 * renormaliza para mantener unit length.
 */
export function ewmaUpdate(centroid: number[], newPoint: number[], alpha = 0.05): number[] {
  if (centroid.length !== newPoint.length) {
    throw new Error(`ewmaUpdate: dim mismatch (${centroid.length} vs ${newPoint.length})`);
  }
  if (alpha < 0 || alpha > 1) {
    throw new Error(`ewmaUpdate: alpha must be in [0, 1], got ${alpha}`);
  }
  const updated = new Array<number>(centroid.length);
  for (let i = 0; i < centroid.length; i += 1) {
    updated[i] = (1 - alpha) * centroid[i] + alpha * newPoint[i];
  }
  return normalize(updated);
}

// ---------------------------------------------------------------------------
// DBSCAN — genérico por callback de distancia
// ---------------------------------------------------------------------------

export interface DbscanResult<T> {
  /** Clusters densos (cada uno con ≥ minPts items). */
  clusters: T[][];
  /** Items que no entraron a ningún cluster (densidad insuficiente). */
  noise: T[];
}

/**
 * DBSCAN clásico. `getDistance(a, b)` debe ser simétrico y > 0. Para vectores
 * coseno-normalizados, usar `cosineDistance` y `eps` ≈ 1 - threshold.
 *
 * Complexity: O(N²) por las regionQuery — aceptable hasta unos miles de puntos.
 * Para tablas grandes (>10K), considerar índice espacial; nuestra pool de
 * candidatos rara vez supera unos cientos antes de spawnear narrativas.
 */
export function dbscan<T>(
  points: T[],
  getDistance: (a: T, b: T) => number,
  eps: number,
  minPts: number,
): DbscanResult<T> {
  const n = points.length;
  const labels = new Array<number>(n).fill(-1); // -1: unvisited; -2: noise; >=0: cluster id
  let clusterId = -1;

  for (let i = 0; i < n; i += 1) {
    if (labels[i] !== -1) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = -2; // noise (puede recuperarse luego como borde de otro cluster)
      continue;
    }
    clusterId += 1;
    labels[i] = clusterId;
    const seeds = neighbors.filter((j) => j !== i);
    while (seeds.length > 0) {
      const j = seeds.shift() as number;
      if (labels[j] === -2) labels[j] = clusterId; // recover noise as border
      if (labels[j] !== -1) continue;
      labels[j] = clusterId;
      const jn = regionQuery(j);
      if (jn.length >= minPts) {
        for (const k of jn) if (labels[k] === -1 || labels[k] === -2) seeds.push(k);
      }
    }
  }

  const clusters: T[][] = [];
  const noise: T[] = [];
  for (let i = 0; i < n; i += 1) {
    if (labels[i] === -2 || labels[i] === -1) {
      noise.push(points[i]);
    } else {
      const cid = labels[i];
      if (!clusters[cid]) clusters[cid] = [];
      clusters[cid].push(points[i]);
    }
  }
  return { clusters: clusters.filter(Boolean), noise };

  function regionQuery(idx: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k += 1) {
      if (k === idx) continue;
      if (getDistance(points[idx], points[k]) <= eps) out.push(k);
    }
    out.push(idx);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

export interface LifecycleInput {
  /** Menciones primarias en últimas 24h. */
  velocity24h: number;
  /** Velocidad promedio en últimos 7 días (mentions/día). */
  avgVelocity7d: number;
  /** Días desde la última mención asignada (o desde born_at si nunca). */
  daysSinceLast: number;
  /** Total acumulado de menciones asignadas. */
  mentionCount: number;
  /** Días desde born_at. */
  ageDays: number;
  /** Estado previo — necesario para reconocer 'revived'. */
  prevStatus: NarrativeStatus | null;
}

export interface LifecycleResult {
  status: NarrativeStatus;
  /** True si la narrativa entró a peaking por primera vez (caller pone peaked_at). */
  enteredPeaking: boolean;
}

/**
 * State machine de ciclo de vida. Reglas (en orden de evaluación):
 *
 *   - dormant:    daysSinceLast > 14
 *   - revived:    prev == 'dormant' AND velocity24h > 0 (sticky 7 días via caller)
 *   - peaking:    velocity24h >= 5 AND velocity24h > avg * 2
 *   - declining:  velocity24h < avg * 0.3 AND daysSinceLast > 3
 *   - emerging:   mentionCount < 50 AND ageDays < 7
 *   - active:     resto
 *
 * El caller persiste el resultado y, si `enteredPeaking`, actualiza `peaked_at`.
 */
export function computeLifecycleState(input: LifecycleInput): LifecycleResult {
  const {
    velocity24h,
    avgVelocity7d,
    daysSinceLast,
    mentionCount,
    ageDays,
    prevStatus,
  } = input;

  // 1. Dormant: 14+ días sin actividad (estado definitivo).
  if (daysSinceLast > 14) {
    return { status: 'dormant', enteredPeaking: false };
  }

  // 2. Revived: estaba dormant y ahora hay actividad (estado transitorio).
  if (prevStatus === 'dormant' && velocity24h > 0) {
    return { status: 'revived', enteredPeaking: false };
  }

  // 3. Peaking: velocidad significativa y > 2× promedio.
  if (velocity24h >= 5 && avgVelocity7d > 0 && velocity24h > avgVelocity7d * 2) {
    return { status: 'peaking', enteredPeaking: prevStatus !== 'peaking' };
  }

  // 4. Declining: dos formas — promedio caído >70%, o sin actividad reciente
  //    (>7 días) pero aún no en zona dormant. Cubre el caso "se enfrió".
  if (avgVelocity7d > 0 && velocity24h < avgVelocity7d * 0.3 && daysSinceLast > 3) {
    return { status: 'declining', enteredPeaking: false };
  }
  if (daysSinceLast > 7) {
    return { status: 'declining', enteredPeaking: false };
  }

  // 5. Emerging: brand new y aún chica.
  if (mentionCount < 50 && ageDays < 7) {
    return { status: 'emerging', enteredPeaking: false };
  }

  // 6. Active: default.
  return { status: 'active', enteredPeaking: false };
}

// ---------------------------------------------------------------------------
// pgvector serialization
// ---------------------------------------------------------------------------

/**
 * Convierte un vector JS a literal `[x,y,z,...]` que acepta pgvector. Aliased
 * desde infra/lambda/lib/embeddings (que ya define la misma función) para que
 * @eco/shared exporte una versión utilizable desde queries no-lambda (e.g.
 * scripts locales o tests).
 */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

/** Inversa: parsea un literal pgvector a array JS. */
export function parseVectorLiteral(literal: string): number[] {
  const trimmed = literal.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error(`parseVectorLiteral: invalid literal "${literal.slice(0, 40)}…"`);
  }
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body.split(',').map((s) => {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`parseVectorLiteral: non-numeric value "${s}"`);
    return n;
  });
}
