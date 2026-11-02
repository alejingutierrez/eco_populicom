// Calificación de predicciones contra los snapshots a 24, 48 y 72 h (spec §13.3).
// Los rangos del modelo de lenguaje NO son probabilidades (spec §13.4): se califican por cobertura
// y ancho. El Brier de un rango solo tiene sentido si el rango se pidió con un nivel declarado
// (el spec habla de cobertura al 80 %): `intervalBrier` lo calcula con ese nivel nominal y debe
// leerse como «¿qué tan bien calibrada está la afirmación implícita del 80 %?», no como una
// probabilidad del modelo. Las probabilidades de código (línea base, modelo estadístico) usan `brierScore`.

export interface PredictedRange {
  metrica: string;
  horizonte_h: number;
  rango_min: number;
  rango_max: number;
}

/** Clave de lo observado: `metrica@horizonte_h`, p. ej. `crisis_index@48`. */
export type ObservedMap = Record<string, number>;

export const obsKey = (metrica: string, horizonteH: number) => `${metrica}@${horizonteH}`;

export interface RangeScore {
  n: number;
  /** Cuántas predicciones no tenían observado (snapshot ausente): no cuentan ni a favor ni en contra. */
  sinObservado: number;
  hits: number;
  coverage: number | null;
  meanWidth: number | null;
  items: Array<{ key: string; min: number; max: number; observed: number; hit: boolean; width: number }>;
}

export function scoreRanges(preds: readonly PredictedRange[], observed: ObservedMap): RangeScore {
  const items: RangeScore['items'] = [];
  let sinObservado = 0;
  for (const p of preds) {
    const key = obsKey(p.metrica, p.horizonte_h);
    const o = observed[key];
    if (typeof o !== 'number' || !Number.isFinite(o)) { sinObservado++; continue; }
    const lo = Math.min(p.rango_min, p.rango_max), hi = Math.max(p.rango_min, p.rango_max);
    items.push({ key, min: lo, max: hi, observed: o, hit: o >= lo && o <= hi, width: hi - lo });
  }
  const hits = items.filter((i) => i.hit).length;
  return {
    n: items.length, sinObservado, hits,
    coverage: items.length ? hits / items.length : null,
    meanWidth: items.length ? items.reduce((a, i) => a + i.width, 0) / items.length : null,
    items,
  };
}

/** Brier de pronósticos binarios: promedio de (p − resultado)². Menor es mejor. */
export function brierScore(forecasts: ReadonlyArray<{ p: number; outcome: 0 | 1 }>): number | null {
  if (!forecasts.length) return null;
  return forecasts.reduce((a, f) => a + (f.p - f.outcome) ** 2, 0) / forecasts.length;
}

/** Brier del evento «lo observado cae dentro del rango» con el nivel nominal declarado (0.8 por defecto). */
export function intervalBrier(score: Pick<RangeScore, 'items'>, nominal = 0.8): number | null {
  return brierScore(score.items.map((i) => ({ p: nominal, outcome: i.hit ? 1 : 0 })));
}

/** Brier skill score frente a la tasa base: 1 − Brier/Brier_base; > 0 mejora la tasa base. */
export function brierSkill(brier: number | null, baseRate: number, outcomes: readonly (0 | 1)[]): number | null {
  if (brier === null || !outcomes.length) return null;
  const base = brierScore(outcomes.map((o) => ({ p: baseRate, outcome: o })));
  if (base === null || base === 0) return null;
  return 1 - brier / base;
}

/** Predicciones de un memorando: efectos esperados de las posiciones y de los caminos si traen rango. */
export function rangesFromPositions(positions: ReadonlyArray<Record<string, unknown>>): PredictedRange[] {
  const out: PredictedRange[] = [];
  for (const pos of positions) {
    for (const e of (pos.efectos_esperados as Array<Record<string, unknown>> | undefined) ?? []) {
      if (typeof e.metrica === 'string' && typeof e.horizonte_h === 'number' && typeof e.rango_min === 'number' && typeof e.rango_max === 'number') {
        out.push({ metrica: e.metrica, horizonte_h: e.horizonte_h, rango_min: e.rango_min, rango_max: e.rango_max });
      }
    }
  }
  return out;
}
