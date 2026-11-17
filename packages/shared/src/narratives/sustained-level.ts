/**
 * Nivel sostenido (INT-01, spec sección 2.7): % negativo y NSS en ventanas de
 * 14 y 28 días cerrados contra un umbral fijo, igual para todas las agencias.
 *
 * Existe para que una baja de volumen no se lea como mejora: la variación
 * contra ayer o contra la semana previa puede caer mientras el nivel sigue
 * igual de alto (DF, 23 al 30-oct-2026: el volumen de 7 días bajó 69 % y el
 * nivel a 14 días pasó de 63 % a 62 % negativo).
 *
 * Función pura: recibe la serie diaria del MISMO universo del correo
 * (`loadDailySentimentSeries`) y no conoce la base de datos.
 */
import { addDaysYmd } from '../dates';

/** % negativo a partir del cual el nivel de una ventana es alto. Es la regla de «negativo» de Narrativas (`NARRATIVE_NEG_RULE.share`). */
export const SUSTAINED_NEG_PCT = 30;
/** NSS por debajo del cual la ventana está en la banda más baja (`nssBand`: MUY NEG). */
export const SUSTAINED_NSS = -20;
/** Menciones mínimas en la ventana para ofrecer un nivel (la misma base mínima de las variaciones). */
export const SUSTAINED_MIN_BASE = 30;
/** Ventanas del nivel, en días cerrados que terminan el último día del reporte. */
export const SUSTAINED_WINDOWS = [14, 28] as const;
export type SustainedWindowDays = (typeof SUSTAINED_WINDOWS)[number];

export interface SustainedDailyPoint {
  date: string; // YYYY-MM-DD (día de Puerto Rico)
  negative: number;
  neutral: number;
  positive: number;
}

export interface SustainedWindow {
  days: SustainedWindowDays;
  startYmd: string;
  endYmd: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  /** ¿La ventana llega a la base mínima? Sin base, los cuatro campos siguientes son null. */
  enoughBase: boolean;
  /** % negativo redondeado al entero, como lo muestra el correo. */
  negPct: number | null;
  /** NSS redondeado al entero: (positivas − negativas) ÷ total × 100. */
  nss: number | null;
  /** % negativo en el umbral o por encima (se compara sin redondear). */
  overNegPct: boolean | null;
  /** NSS en el umbral o por debajo (se compara sin redondear). */
  underNss: boolean | null;
}

export interface SustainedLevel {
  asOf: string;
  thresholds: { negPct: number; nss: number; minBase: number };
  d14: SustainedWindow;
  d28: SustainedWindow;
  /**
   * Nivel sostenido: el % negativo pasa el umbral a 14 Y a 28 días. `null` si
   * alguna de las dos ventanas no tiene base suficiente. El NSS de cada
   * ventana se informa contra su propio umbral (`underNss`), pero no decide
   * `sustained`: con el NSS, Gobernadora pasaría el 36 % de los días.
   */
  sustained: boolean | null;
}

function windowLevel(byDay: Map<string, SustainedDailyPoint>, endYmd: string, days: SustainedWindowDays): SustainedWindow {
  const startYmd = addDaysYmd(endYmd, -(days - 1));
  let negative = 0, neutral = 0, positive = 0;
  for (let d = startYmd; d <= endYmd; d = addDaysYmd(d, 1)) {
    const p = byDay.get(d);
    if (!p) continue;
    negative += Number(p.negative) || 0;
    neutral += Number(p.neutral) || 0;
    positive += Number(p.positive) || 0;
  }
  const total = negative + neutral + positive;
  const enoughBase = total >= SUSTAINED_MIN_BASE;
  if (!enoughBase) {
    return { days, startYmd, endYmd, total, negative, neutral, positive, enoughBase, negPct: null, nss: null, overNegPct: null, underNss: null };
  }
  const negRaw = (100 * negative) / total;
  const nssRaw = (100 * (positive - negative)) / total;
  return {
    days, startYmd, endYmd, total, negative, neutral, positive, enoughBase,
    negPct: Math.round(negRaw),
    nss: Math.round(nssRaw),
    overNegPct: negRaw >= SUSTAINED_NEG_PCT,
    underNss: nssRaw <= SUSTAINED_NSS,
  };
}

/**
 * Nivel a 14 y 28 días que terminan en `endYmd`. La serie puede traer días de
 * más o faltarle días sin menciones (cuentan como cero).
 */
export function buildSustainedLevel(series: SustainedDailyPoint[], endYmd: string): SustainedLevel {
  const byDay = new Map(series.map((p) => [p.date, p]));
  const d14 = windowLevel(byDay, endYmd, 14);
  const d28 = windowLevel(byDay, endYmd, 28);
  const sustained = d14.overNegPct === null || d28.overNegPct === null ? null : d14.overNegPct && d28.overNegPct;
  return {
    asOf: endYmd,
    thresholds: { negPct: SUSTAINED_NEG_PCT, nss: SUSTAINED_NSS, minBase: SUSTAINED_MIN_BASE },
    d14,
    d28,
    sustained,
  };
}

/** Primer día que hace falta cargar para calcular el nivel que termina en `endYmd`. */
export function sustainedSeriesStart(endYmd: string): string {
  return addDaysYmd(endYmd, -(SUSTAINED_WINDOWS[SUSTAINED_WINDOWS.length - 1] - 1));
}
