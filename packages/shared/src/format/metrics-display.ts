/**
 * Capa ÚNICA de formato legible-para-el-público de las métricas compuestas.
 *
 * PROBLEMA QUE RESUELVE: muchas métricas son números 0–1 (Crisis, BHI) o
 * z-scores que el público no interpreta ("0.59", "1.732"). Cada superficie
 * (dashboard SPA, web app, correo, prompts IA) los formateaba a su manera, con
 * escalas y bandas DUPLICADAS y a veces contradictorias (BHI salía "6.3" en una
 * tarjeta y "0.59" en el chart de al lado).
 *
 * DECISIÓN (jun 2026): la representación principal es una PALABRA cualitativa
 * (reusando las bandas que ya existían) + un número de apoyo legible
 * (%, escala /10, o número con signo). La velocidad pasa a ser "% vs período
 * anterior" + palabra (Acelerada/Estable/Desacelerada). Los "sin cambio"
 * distinguen "estable" de "sin base de comparación".
 *
 * Este módulo es la ÚNICA fuente de verdad de:
 *   - umbrales de banda por métrica (reconciliados a una sola escala),
 *   - vocabulario de palabras,
 *   - conversiones de escala (BHI 0–1 → 1–10),
 *   - mapa banda → tono → color.
 *
 * Es dependency-free (Node + browser). Lo consumen las rutas API (que adjuntan
 * los campos `*Display` al payload), el correo y los prompts. La SPA estática
 * (public/eco-prototype) no puede importar TS, así que recibe estos campos ya
 * formateados desde la API; sólo el formateo escalar por-punto del chart vive
 * espejado allí (ver charts.js fmtVal, marcado como espejo de este módulo).
 */

export type MetricTone = 'neg' | 'warn' | 'pos' | 'accent' | 'neutral';

/** Métricas con banda cualitativa. El valor de entrada es SIEMPRE el crudo que
 *  produce `calculateMetrics` (crisis 0–1, bhi 0–1, polarization 0–100,
 *  nss −100..100). El módulo se encarga de toda conversión de escala. */
export type BandedMetricKey = 'crisis' | 'bhi' | 'polarization' | 'nss';

/** Métricas que ya son un porcentaje legible y no llevan banda. */
export type PercentMetricKey = 'engagementRate' | 'amplificationRate';

export type DisplayMetricKey = BandedMetricKey | PercentMetricKey;

export interface MetricDisplay {
  /** Etiqueta cualitativa protagonista, p.ej. "Alerta", "Sano", "Negativo".
   *  Para métricas de % puro es el propio porcentaje ("2.4%"). */
  word: string;
  /** Número de apoyo ya formateado: "59%", "5.9 / 10", "+12.4". null si no aplica. */
  value: string | null;
  /** Combinación compacta para espacios estrechos: "Alerta · 59%". */
  short: string;
  /** Valor numérico en la ESCALA DE DISPLAY (crisis 0–1, bhi 1–10,
   *  polarization 0–100, nss −100..100) para ejes/posición de gauge. */
  raw: number | null;
  /** Token canónico de banda en mayúsculas ("ALERTA"). null si no aplica. */
  band: string | null;
  tone: MetricTone;
  /** Variable CSS del tono, p.ej. "var(--neg)". */
  color: string;
}

export interface DeltaDisplay {
  /** "sube" | "baja" | "estable" | "sin base" */
  word: string;
  direction: 'up' | 'down' | 'flat' | 'none';
  /** "▲" | "▼" | "·" | "—" */
  arrow: string;
  /** Magnitud ya formateada con signo: "+0.08", "+12%", "−3.1", "nuevo". null si sin base. */
  value: string | null;
  /** Magnitud numérica redondeada (para lógica de color). null si sin base. */
  magnitude: number | null;
  /** false cuando falta período de comparación (≠ "estable"). */
  hasBaseline: boolean;
  tone: MetricTone;
}

// ============================================================
// Tono / color
// ============================================================

const TONE_COLOR: Record<MetricTone, string> = {
  neg: 'var(--neg)',
  warn: 'var(--warn)',
  pos: 'var(--pos)',
  accent: 'var(--accent)',
  neutral: 'var(--text-3)',
};

/** Banda → tono. Mantiene la semántica de color que ya usaba el dashboard
 *  (shell.js bandColor) y la extiende a las bandas de 5 niveles del NSS y a la
 *  velocidad. */
const BAND_TONE: Record<string, MetricTone> = {
  // negativo / crítico
  CRISIS: 'neg', ALERTA: 'neg', NEGATIVO: 'neg', 'CRÍTICO': 'neg', 'MUY NEG': 'neg',
  // advertencia
  ELEVADO: 'warn', 'DÉBIL': 'warn', MODERADA: 'warn', EXTREMA: 'warn', NEG: 'warn',
  // positivo / sano
  NORMAL: 'pos', SANO: 'pos', POSITIVO: 'pos', ALTA: 'pos', POS: 'pos',
  // destacado
  FUERTE: 'accent', 'MUY POS': 'accent', ACELERADA: 'accent',
  // neutral
  NEUTRAL: 'neutral', 'APÁTICA': 'neutral', ESTABLE: 'neutral', DESACELERADA: 'neutral',
};

export function bandTone(band: string | null): MetricTone {
  if (!band) return 'neutral';
  return BAND_TONE[band.toUpperCase()] ?? 'neutral';
}

export function bandColor(band: string | null): string {
  return TONE_COLOR[bandTone(band)];
}

// ============================================================
// Números
// ============================================================

const MINUS = '−'; // signo menos tipográfico (−), más legible que el guion ASCII

function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** Formatea un número con signo explícito y menos tipográfico. */
function signed(v: number, decimals = 1): string {
  const r = roundTo(v, decimals);
  const abs = Math.abs(r).toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (r > 0) return `+${abs}`;
  if (r < 0) return `${MINUS}${abs}`;
  return abs; // cero sin signo
}

/** Formatea sin signo forzado (p.ej. "5.9", "59"). */
function plain(v: number, decimals = 1): string {
  return roundTo(v, decimals).toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

// ============================================================
// Bandas por métrica (operan sobre el valor crudo de calculateMetrics)
// ============================================================

/** Crisis Risk Score (0–1). Umbrales canónicos confirmados en el backtest. */
export function crisisBand(raw: number): string {
  if (raw >= 0.60) return 'CRISIS';
  if (raw >= 0.40) return 'ALERTA';
  if (raw >= 0.25) return 'ELEVADO';
  return 'NORMAL';
}

/** Convierte el BHI crudo (0–1) a la escala pública 1–10. */
export function toBhi10(raw0to1: number): number {
  return 1 + raw0to1 * 9;
}

/** BHI en escala 1–10. Umbrales 4.6/6.4/8.2 ≡ 0.40/0.60/0.80 en 0–1
 *  (reconciliación de las dos escalas que antes divergían en el código).
 *  Redondea a 1 decimal antes de comparar para que la banda SIEMPRE concuerde
 *  con el número "/10" que se muestra (evita que 6.3999…≡6.4 caiga en DÉBIL). */
export function bhiBand10(v10: number): string {
  const r = Math.round(v10 * 10) / 10;
  if (r >= 8.2) return 'FUERTE';
  if (r >= 6.4) return 'SANO';
  if (r >= 4.6) return 'DÉBIL';
  return 'CRÍTICO';
}

/** Polarization Index (0–100). Variante canónica = la del gauge del dashboard. */
export function polarizationBand(pct: number): string {
  if (pct >= 75) return 'EXTREMA';
  if (pct >= 50) return 'ALTA';
  if (pct >= 30) return 'MODERADA';
  return 'APÁTICA';
}

/** NSS (−100..100). Cinco bandas, alineadas con el gauge y los prompts. */
export function nssBand(nss: number): string {
  if (nss >= 20) return 'MUY POS';
  if (nss >= 5) return 'POS';
  if (nss > -5) return 'NEUTRAL';
  if (nss > -20) return 'NEG';
  return 'MUY NEG';
}

/** Banda canónica (token mayúsculas) para una métrica, desde su valor crudo. */
export function metricBand(key: BandedMetricKey, raw: number): string {
  switch (key) {
    case 'crisis': return crisisBand(raw);
    case 'bhi': return bhiBand10(toBhi10(raw));
    case 'polarization': return polarizationBand(raw);
    case 'nss': return nssBand(raw);
  }
}

// ============================================================
// Vocabulario (palabra protagonista, title-case amigable)
// ============================================================

const CRISIS_WORD: Record<string, string> = { NORMAL: 'Normal', ELEVADO: 'Elevado', ALERTA: 'Alerta', CRISIS: 'Crisis' };
const BHI_WORD: Record<string, string> = { 'CRÍTICO': 'Crítico', 'DÉBIL': 'Débil', SANO: 'Sano', FUERTE: 'Fuerte' };
const POL_WORD: Record<string, string> = { 'APÁTICA': 'Apática', MODERADA: 'Moderada', ALTA: 'Alta', EXTREMA: 'Extrema' };
const NSS_WORD: Record<string, string> = { 'MUY NEG': 'Muy negativo', NEG: 'Negativo', NEUTRAL: 'Neutral', POS: 'Positivo', 'MUY POS': 'Muy positivo' };

/** Palabra amigable para una banda. Cae al propio token si no se reconoce. */
export function bandWord(key: BandedMetricKey, band: string): string {
  const map = key === 'crisis' ? CRISIS_WORD
    : key === 'bhi' ? BHI_WORD
    : key === 'polarization' ? POL_WORD
    : NSS_WORD;
  return map[band] ?? band;
}

// ============================================================
// formatMetric — el principal
// ============================================================

function emptyDisplay(): MetricDisplay {
  return { word: '—', value: null, short: '—', raw: null, band: null, tone: 'neutral', color: TONE_COLOR.neutral };
}

function mk(word: string, value: string | null, raw: number | null, band: string | null): MetricDisplay {
  const tone = bandTone(band);
  return {
    word,
    value,
    short: value ? `${word} · ${value}` : word,
    raw,
    band,
    tone,
    color: TONE_COLOR[tone],
  };
}

/**
 * Formatea una métrica a su representación pública (palabra + número de apoyo).
 * El `raw` de entrada es SIEMPRE el valor crudo de `calculateMetrics`.
 */
export function formatMetric(key: DisplayMetricKey, raw: number | null): MetricDisplay {
  if (raw == null || Number.isNaN(raw)) return emptyDisplay();

  switch (key) {
    case 'crisis': {
      const band = crisisBand(raw);
      const value = `${Math.round(raw * 100)}%`;
      return mk(bandWord('crisis', band), value, raw, band);
    }
    case 'bhi': {
      const v10 = toBhi10(raw);
      const band = bhiBand10(v10);
      const value = `${plain(v10, 1)} / 10`;
      return mk(bandWord('bhi', band), value, v10, band);
    }
    case 'polarization': {
      const band = polarizationBand(raw);
      const value = `${Math.round(raw)}%`;
      return mk(bandWord('polarization', band), value, raw, band);
    }
    case 'nss': {
      const band = nssBand(raw);
      const value = signed(raw, 1);
      return mk(bandWord('nss', band), value, raw, band);
    }
    case 'engagementRate':
    case 'amplificationRate': {
      // Ya es un porcentaje legible, sin banda cualitativa.
      const value = `${plain(raw, 1)}%`;
      return { word: value, value, short: value, raw, band: null, tone: 'neutral', color: TONE_COLOR.neutral };
    }
  }
}

// ============================================================
// Velocidad — "% vs período anterior" + palabra
// ============================================================

/** Umbral (en % de cambio) para considerar la velocidad "estable". */
export const VELOCITY_STABLE_PCT = 15;

const VEL_WORD: Record<string, string> = { ACELERADA: 'Acelerada', ESTABLE: 'Estable', DESACELERADA: 'Desacelerada' };

/**
 * Velocidad de engagement como CAMBIO % del engagement-por-mención del período
 * actual vs el período anterior de igual duración. Reemplaza el z-score opaco
 * que nunca se mostraba. Resuelve el caso "igual que el período anterior":
 *   - sin cambio  → "Estable · +0%"
 *   - sin período previo con datos → "Sin base de comparación"
 *
 * @param curPerMention  engagement-por-mención del período actual
 * @param prevPerMention engagement-por-mención del período anterior
 */
export function formatVelocity(
  curPerMention: number | null,
  prevPerMention: number | null,
): MetricDisplay {
  if (curPerMention == null || prevPerMention == null || prevPerMention <= 0) {
    return {
      word: 'Sin base',
      value: null,
      short: 'Sin base de comparación',
      raw: null,
      band: null,
      tone: 'neutral',
      color: TONE_COLOR.neutral,
    };
  }
  const pct = ((curPerMention - prevPerMention) / prevPerMention) * 100;
  const rounded = Math.round(pct);

  let band: string;
  if (rounded >= VELOCITY_STABLE_PCT) band = 'ACELERADA';
  else if (rounded <= -VELOCITY_STABLE_PCT) band = 'DESACELERADA';
  else band = 'ESTABLE';

  const value = `${signed(rounded, 0)}%`;
  return mk(VEL_WORD[band], value, pct, band);
}

// ============================================================
// formatDelta — tendencia vs período anterior, para CUALQUIER métrica
// ============================================================

/**
 * Formatea un delta vs el período anterior con palabra (sube/baja/estable) y
 * preserva la distinción "estable" (cambio real ≈ 0) vs "sin base" (falta
 * período de comparación). La palabra se deriva del valor YA REDONDEADO para
 * evitar el bug histórico "0% sube" (donde el % redondeaba a 0 pero la palabra
 * leía el float crudo).
 *
 * @param opts.kind     'absolute' (cur−prev) | 'percent' ((cur−prev)/prev*100)
 * @param opts.decimals decimales del valor mostrado (default 1)
 * @param opts.suffix   sufijo de unidad ('%', ' pts', …). Por defecto '%' si kind='percent'
 * @param opts.invert   true cuando "baja" es lo bueno (p.ej. Crisis): colorea al revés
 */
export function formatDelta(
  cur: number | null,
  prev: number | null,
  opts: { kind?: 'absolute' | 'percent'; decimals?: number; suffix?: string; invert?: boolean } = {},
): DeltaDisplay {
  const { kind = 'absolute', decimals = 1, invert = false } = opts;
  const suffix = opts.suffix ?? (kind === 'percent' ? '%' : '');

  if (cur == null || prev == null) {
    return { word: 'sin base', direction: 'none', arrow: '—', value: null, magnitude: null, hasBaseline: false, tone: 'neutral' };
  }

  // Crecimiento desde cero: el % no es honesto. Lo marcamos "nuevo".
  if (kind === 'percent' && prev === 0) {
    if (cur === 0) {
      return { word: 'estable', direction: 'flat', arrow: '·', value: `0${suffix}`, magnitude: 0, hasBaseline: true, tone: 'neutral' };
    }
    const up = cur > 0;
    return { word: up ? 'sube' : 'baja', direction: up ? 'up' : 'down', arrow: up ? '▲' : '▼', value: 'nuevo', magnitude: null, hasBaseline: true, tone: toneFor(up ? 'up' : 'down', invert) };
  }

  const delta = kind === 'percent' ? ((cur - prev) / prev) * 100 : cur - prev;
  const rounded = roundTo(delta, decimals);
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const word = direction === 'up' ? 'sube' : direction === 'down' ? 'baja' : 'estable';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '·';
  const value = `${signed(rounded, decimals)}${suffix}`;
  return { word, direction, arrow, value, magnitude: rounded, hasBaseline: true, tone: toneFor(direction, invert) };
}

function toneFor(direction: 'up' | 'down' | 'flat', invert: boolean): MetricTone {
  if (direction === 'flat') return 'neutral';
  const goodUp = !invert;
  return (direction === 'up') === goodUp ? 'pos' : 'neg';
}
