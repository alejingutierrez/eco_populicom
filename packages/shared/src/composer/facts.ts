/**
 * Etapa 0 del motor: paquete de hechos (spec 10.2). Lo calcula el código; el
 * modelo solo cita cifras por marcador `{{id}}`.
 *
 * Port de `build_facts` + `comment_share` del prototipo (agents.py), con lo que
 * el spec añade: base mínima también para el día y la semana completa, el
 * periodo previo explícito si el caller lo tiene, y tópicos, fuentes,
 * municipios y emociones del mismo universo.
 */
import { formatLongDay } from '../format-period';
import type { ComposerDailyPoint, ComposerInput, ComposerTotals, Fact } from './types';

/** Un porcentaje de variación solo se ofrece si la base previa llega a esto (evita «+1400 %»). */
export const FACT_MIN_DELTA_BASE = 30;

export interface FactPackage {
  facts: Record<string, Fact>;
  /** Día que se resume y su etiqueta en palabras («domingo 1 de noviembre»). */
  dayYmd: string;
  dayLabel: string;
  startLabel: string;
  endLabel: string;
  /** Días de la serie (para la ventana «7» y los días del mes permitidos). */
  windowDays: number;
  seriesDates: string[];
  minBase: number;
  /** Totales previos usados (reales o estimados) y de dónde salieron. */
  prevTotals: ComposerTotals | null;
  prevTotalsSource: 'input' | 'estimated_from_delta' | 'none';
}

export interface BuildFactPackageOptions {
  minBase?: number;
}

const dayTotal = (p: ComposerDailyPoint) => p.negative + p.neutral + p.positive;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function add(facts: Record<string, Fact>, id: string, value: number, display: string, label: string) {
  facts[id] = { id, value, display, label };
}

/**
 * Totales del periodo previo. El lambda conoce los conteos reales; si solo
 * llega la variación porcentual (salida de repro.ts), se invierte como hace el
 * prototipo. Una variación de −100 % o ausente no permite estimar.
 */
export function resolvePrevTotals(input: ComposerInput): { prev: ComposerTotals | null; source: FactPackage['prevTotalsSource'] } {
  if (input.prevTotals) return { prev: input.prevTotals, source: 'input' };
  const d = input.deltaVsPrev;
  if (!d) return { prev: null, source: 'none' };
  const est = (cur: number, delta: number | null | undefined): number | null => {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
    const f = 1 + delta / 100;
    if (f <= 0) return null;
    return Math.round(cur / f);
  };
  const negative = est(input.totals.negative, d.negative);
  const neutral = est(input.totals.neutral, d.neutral);
  const positive = est(input.totals.positive, d.positive);
  if (negative === null || neutral === null || positive === null) return { prev: null, source: 'none' };
  const total = d.total !== undefined && d.total !== null ? est(input.totals.total, d.total) ?? negative + neutral + positive : negative + neutral + positive;
  return { prev: { negative, neutral, positive, total }, source: 'estimated_from_delta' };
}

/**
 * Variación con base mínima: siempre la diferencia absoluta; el porcentaje
 * solo si la base previa es ≥ minBase. Exportada para pruebas.
 *
 * Nombre propio del composer a propósito: WP-4 exporta `minBaseDelta` /
 * `MIN_DELTA_BASE` / `BuildFactsOptions` desde `../aggregations` con otra
 * forma (pct sin redondear, `prev` obligatorio) y `export *` de los dos en
 * `src/index.ts` chocaría (TS2308). Aquí el porcentaje sale redondeado para
 * el marcador y `prev` puede faltar.
 */
export function factDelta(prev: number | null | undefined, cur: number, minBase = FACT_MIN_DELTA_BASE): { abs: number | null; pct: number | null } {
  if (prev === null || prev === undefined || !Number.isFinite(prev)) return { abs: null, pct: null };
  const abs = cur - prev;
  const p = prev >= minBase && prev > 0 ? Math.round((100 * abs) / prev) : null;
  return { abs, pct: p };
}

export function buildFactPackage(input: ComposerInput, opts: BuildFactPackageOptions = {}): FactPackage {
  const minBase = opts.minBase ?? FACT_MIN_DELTA_BASE;
  const f: Record<string, Fact> = {};
  const t = input.totals;
  const series = [...input.dailySeries].sort((a, b) => a.date.localeCompare(b.date));
  const n = series.length;

  add(f, 'week_total', t.total, `${t.total}`, `menciones pertinentes de los ${n || 7} días`);
  add(f, 'week_neg', t.negative, `${t.negative}`, `negativas en los ${n || 7} días`);
  add(f, 'week_neu', t.neutral, `${t.neutral}`, `neutrales en los ${n || 7} días`);
  add(f, 'week_pos', t.positive, `${t.positive}`, `positivas en los ${n || 7} días`);
  if (t.total > 0) {
    add(f, 'week_neg_pct', pct(t.negative, t.total), `${pct(t.negative, t.total)} %`, '% de negativas sobre el total del periodo');
    add(f, 'week_neu_pct', pct(t.neutral, t.total), `${pct(t.neutral, t.total)} %`, '% de neutrales sobre el total del periodo');
    add(f, 'week_pos_pct', pct(t.positive, t.total), `${pct(t.positive, t.total)} %`, '% de positivas sobre el total del periodo');
  }

  // Día que se resume: por defecto el último de la serie.
  const dayYmd = input.window.dayYmd ?? series[n - 1]?.date ?? input.window.endYmd;
  const dayIdx = series.findIndex((s) => s.date === dayYmd);
  const day = dayIdx >= 0 ? series[dayIdx] : null;
  const prevDay = dayIdx > 0 ? series[dayIdx - 1] : null;
  const dayLabel = formatLongDay(dayYmd);
  if (day) {
    const dt = dayTotal(day);
    add(f, 'day_total', dt, `${dt}`, `menciones del ${dayLabel}`);
    add(f, 'day_neg', day.negative, `${day.negative}`, 'negativas del día');
    add(f, 'day_neu', day.neutral, `${day.neutral}`, 'neutrales del día');
    add(f, 'day_pos', day.positive, `${day.positive}`, 'positivas del día');
    if (prevDay) {
      const pt = dayTotal(prevDay);
      add(f, 'prev_day_total', pt, `${pt}`, `menciones del ${formatLongDay(prevDay.date)}`);
      const d = factDelta(pt, dt, minBase);
      add(f, 'day_delta_abs', d.abs ?? 0, signed(d.abs ?? 0), 'variación absoluta contra el día anterior');
      if (d.pct !== null) add(f, 'day_delta_pct', d.pct, `${signed(d.pct)} %`, 'variación % contra el día anterior');
    }
    // Posición del día por volumen (empates: el primero que aparece, como el prototipo).
    const sorted = series.map(dayTotal).sort((a, b) => b - a);
    const rank = sorted.indexOf(dt) + 1;
    add(f, 'day_rank', rank, `posición ${rank} de ${n} por volumen`, `lugar del día entre los ${n} días`);
  }
  if (n > 0) {
    let peak = series[0];
    for (const s of series) if (dayTotal(s) > dayTotal(peak)) peak = s;
    add(f, 'peak_total', dayTotal(peak), `${dayTotal(peak)}`, `menciones del día pico (${formatLongDay(peak.date)})`);
  }

  // Periodo previo con base mínima.
  const { prev, source } = resolvePrevTotals(input);
  if (prev) {
    add(f, 'prev_week_total', prev.total, `${prev.total}`, 'menciones pertinentes del periodo previo');
    const keys: Array<[keyof ComposerTotals, string, string]> = [
      ['total', 'total', 'menciones'],
      ['negative', 'neg', 'negativas'],
      ['neutral', 'neu', 'neutrales'],
      ['positive', 'pos', 'positivas'],
    ];
    for (const [k, short, lab] of keys) {
      if (k !== 'total') add(f, `prev_week_${short}`, prev[k], `${prev[k]}`, `${lab} del periodo previo`);
      const d = factDelta(prev[k], t[k], minBase);
      add(f, `week_${short}_delta_abs`, d.abs ?? 0, signed(d.abs ?? 0), `variación absoluta de ${lab} contra el periodo previo`);
      if (d.pct !== null) add(f, `week_${short}_delta_pct`, d.pct, `${signed(d.pct)} %`, `variación % de ${lab} contra el periodo previo`);
    }
  }

  // Serie diaria.
  for (const s of series) {
    const tt = dayTotal(s);
    const lab = formatLongDay(s.date);
    add(f, `series_${s.date}`, tt, `${tt}`, `menciones del ${lab}`);
    add(f, `series_${s.date}_neg`, s.negative, `${s.negative}`, `negativas del ${lab}`);
    add(f, `series_${s.date}_pos`, s.positive, `${s.positive}`, `positivas del ${lab}`);
  }

  // Composición (comentarios de usuarios en redes de la agencia).
  const comp = input.composition;
  if (comp?.week) {
    const p = pct(comp.week.comments, comp.week.total);
    add(f, 'comment_share_week', p, `${p} %`, '% de las menciones del periodo que son comentarios de usuarios en publicaciones de redes de la agencia');
    add(f, 'comments_week', comp.week.comments, `${comp.week.comments}`, 'comentarios de usuarios en publicaciones de redes de la agencia en el periodo');
  }
  if (comp?.prevWeek) {
    const p = pct(comp.prevWeek.comments, comp.prevWeek.total);
    add(f, 'comment_share_prev_week', p, `${p} %`, 'mismo % en el periodo previo');
  }

  // Tópicos, fuentes, municipios y emociones (top 5, mismo universo).
  (input.topics ?? []).slice(0, 5).forEach((tp, i) => {
    add(f, `topic_${i + 1}`, tp.total, `${tp.total}`, `menciones del tópico «${tp.topic}»`);
    if (tp.negative !== undefined) add(f, `topic_${i + 1}_neg`, tp.negative, `${tp.negative}`, `negativas del tópico «${tp.topic}»`);
  });
  (input.sources ?? []).slice(0, 5).forEach((s, i) => add(f, `source_${i + 1}`, s.mentions, `${s.mentions}`, `menciones en la fuente «${s.source}»`));
  (input.municipalities ?? []).slice(0, 5).forEach((m, i) => add(f, `muni_${i + 1}`, m.total, `${m.total}`, `menciones con municipio «${m.municipality}»`));
  (input.emotions ?? []).slice(0, 5).forEach((e, i) => add(f, `emotion_${i + 1}`, e.count, `${e.count}`, `menciones con la emoción «${e.emotion}»`));

  for (const x of input.extraFacts ?? []) f[x.id] = x;

  return {
    facts: f,
    dayYmd,
    dayLabel,
    startLabel: formatLongDay(input.window.startYmd),
    endLabel: formatLongDay(input.window.endYmd),
    windowDays: n || 7,
    seriesDates: series.map((s) => s.date),
    minBase,
    prevTotals: prev,
    prevTotalsSource: source,
  };
}

/** Bloque de hechos tal como entra al prompt: `- {{id}} = valor  (etiqueta)`. */
export function factsBlock(facts: Record<string, Fact>, withMarkers = true): string {
  return Object.values(facts)
    .map((x) => (withMarkers ? `- {{${x.id}}} = ${x.display}  (${x.label})` : `- ${x.id} = ${x.display}  (${x.label})`))
    .join('\n');
}
