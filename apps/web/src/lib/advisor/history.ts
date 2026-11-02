/**
 * historial_agencia (spec §6.3): episodios de crisis de ESTA agencia y tasas
 * base calculadas en código. Solo la misma agencia; nunca otras agencias.
 *
 * Las funciones de cálculo son puras (computeEpisodes, baseRates) para
 * probarlas sin base de datos. Las consultas van aparte y siempre filtran
 * `agency_id`.
 */
import { addDaysYmd, crisisBand, type PgClientLike } from '@eco/shared';

export const ALERTA_MIN = 0.4;
export const CRISIS_MIN = 0.6;
/** Un episodio «termina» cuando el score vuelve a estar por debajo de este valor (estrictamente). */
export const RESOLVED_BELOW = 0.25;
export const MIN_N_FOR_RATES = 5;
/** Snapshots de más de estos días pueden venir de la fórmula V4. */
export const FORMULA_MAX_AGE_DAYS = 45;
/**
 * Primer día PR cuyos cálculos son de V5 (despliegue el 8-oct-2026). Se toma
 * el 9 para no dar por bueno ningún snapshot del propio día 8: criterio conservador.
 */
export const V5_TRUST_FROM_YMD = '2026-10-09';

export interface SnapshotIn {
  /** YYYY-MM-DD (fecha del snapshot, día calendario PR). */
  date: string;
  /** crisis_risk_score en 0–1; null = sin dato (rompe el episodio). */
  score: number | null;
  computedAt: Date | string | null;
}

export interface Episode {
  id: string;
  start: string;
  end: string;
  durationDays: number;
  peak: { date: string; score: number };
  maxBand: 'ALERTA' | 'CRISIS';
  alertFired: boolean;
  /** Algún día del episodio venía de la fórmula anterior a V5 (ver FORMULA_MAX_AGE_DAYS). Se excluye de las tasas base. */
  formulaIncierta: boolean;
  /** Días desde el último día ≥ 0.40 hasta el primer día posterior con score < 0.25; null si aún no ocurre. */
  diasHastaBajo025: number | null;
}

export interface EpisodeOptions {
  /** Día de corte (YYYY-MM-DD, último día cerrado en PR). Para la regla de los 45 días. */
  asOfYmd: string;
  /** Instantes de alert_history.triggered_at de esta agencia. */
  alertTimes?: Date[];
}

const addDays = (ymd: string, d: number) => addDaysYmd(ymd, d);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
/** Medianoche PR como instante UTC (PR = UTC-4 todo el año). */
const prMidnight = (ymd: string) => new Date(`${ymd}T04:00:00.000Z`);

function isUntrusted(row: { date: string; computedAt: Date | string | null }, asOfYmd: string): boolean {
  if (diffDays(asOfYmd, row.date) <= FORMULA_MAX_AGE_DAYS) return false;
  if (row.computedAt == null) return true;
  return new Date(row.computedAt).getTime() < prMidnight(V5_TRUST_FROM_YMD).getTime();
}

/**
 * Episodios de crisis: días consecutivos con score ≥ 0.40. Dos tramos
 * separados por UN solo día (presente) con score < 0.40 se unen. Un día sin
 * dato o un hueco de más de un día los separa. Se descartan los días antes de
 * `coverageStartYmd` (inicio real de cobertura); sin cobertura no hay historia.
 */
export function computeEpisodes(snaps: SnapshotIn[], coverageStartYmd: string | null, opts: EpisodeOptions): Episode[] {
  if (!coverageStartYmd) return [];
  const byDate = new Map<string, { date: string; score: number; computedAt: Date | string | null }>();
  for (const s of snaps) {
    if (s.date < coverageStartYmd) continue;
    if (s.score == null || !Number.isFinite(s.score)) continue;
    byDate.set(s.date, { date: s.date, score: s.score, computedAt: s.computedAt });
  }
  const rows = [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({ ...r, untrusted: isUntrusted(r, opts.asOfYmd) }));

  type Build = { start: string; end: string; peak: { date: string; score: number }; untrusted: boolean };
  const built: Build[] = [];
  let cur: Build | null = null;
  let last: (typeof rows)[number] | null = null;
  let lastHigh: (typeof rows)[number] | null = null;

  for (const r of rows) {
    if (r.score >= ALERTA_MIN) {
      let join = false;
      let bridge = false;
      if (cur && lastHigh) {
        const gap = diffDays(r.date, lastHigh.date);
        if (gap === 1) join = true;
        else if (gap === 2 && last && last.date === addDays(lastHigh.date, 1)) {
          join = true;
          bridge = true;
        }
      }
      if (cur && join) {
        cur.end = r.date;
        if (r.score > cur.peak.score) cur.peak = { date: r.date, score: r.score };
        cur.untrusted = cur.untrusted || r.untrusted || (bridge && !!last?.untrusted);
      } else {
        if (cur) built.push(cur);
        cur = { start: r.date, end: r.date, peak: { date: r.date, score: r.score }, untrusted: r.untrusted };
      }
      lastHigh = r;
    }
    last = r;
  }
  if (cur) built.push(cur);

  const alertTimes = opts.alertTimes ?? [];
  return built.map((b, i) => {
    const startMs = prMidnight(b.start).getTime();
    const endNextMs = prMidnight(addDays(b.end, 1)).getTime();
    const alertFired = alertTimes.some((t) => {
      const ms = t.getTime();
      return ms >= startMs && ms < endNextMs;
    });
    const after = rows.find((r) => r.date > b.end && r.score < RESOLVED_BELOW);
    return {
      id: `E-${i + 1}`,
      start: b.start,
      end: b.end,
      durationDays: diffDays(b.end, b.start) + 1,
      peak: b.peak,
      maxBand: crisisBand(b.peak.score) === 'CRISIS' ? 'CRISIS' : 'ALERTA',
      alertFired,
      formulaIncierta: b.untrusted,
      diasHastaBajo025: after ? diffDays(after.date, b.end) : null,
    };
  });
}

export interface BaseRates {
  /** Episodios usables (sin formula_incierta). Todos llegaron a ALERTA por construcción. */
  n: number;
  excluidosFormulaIncierta: number;
  tasaCrisisDesdeAlerta: {
    n: number;
    casos: number;
    fraccion: number | null;
    porcentaje: number | null;
    motivo: string | null;
  };
  medianaDiasHastaBajo025: {
    n: number;
    dias: number | null;
    motivo: string | null;
  };
}

/**
 * Tasas base de los episodios usables. Con n < 5 no hay porcentajes ni
 * medianas: fraccion y porcentaje son null y el motivo es "n<5".
 */
export function baseRates(episodes: Episode[]): BaseRates {
  const usable = episodes.filter((e) => !e.formulaIncierta);
  const excluidos = episodes.length - usable.length;
  const alerta = usable.filter((e) => e.peak.score >= ALERTA_MIN);
  const n = alerta.length;
  const resueltos = alerta.map((e) => e.diasHastaBajo025).filter((d): d is number => d != null);

  const casos = alerta.filter((e) => e.peak.score >= CRISIS_MIN).length;
  const small = n < MIN_N_FOR_RATES;
  const smallRes = resueltos.length < MIN_N_FOR_RATES;

  let mediana: number | null = null;
  if (!smallRes) {
    const s = [...resueltos].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    mediana = s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
  }

  return {
    n,
    excluidosFormulaIncierta: excluidos,
    tasaCrisisDesdeAlerta: {
      n,
      casos,
      fraccion: small ? null : casos / n,
      porcentaje: small ? null : Math.round((casos / n) * 100),
      motivo: small ? 'n<5' : null,
    },
    medianaDiasHastaBajo025: {
      n: resueltos.length,
      dias: smallRes ? null : mediana,
      motivo: smallRes ? 'n<5' : null,
    },
  };
}

// ---------- consultas (siempre con agency_id) ----------

const LOCAL_DAY = `(m.published_at AT TIME ZONE 'America/Puerto_Rico')::date`;

/** Snapshots de la agencia hasta el último día cerrado, calculados hasta asOf. */
export async function loadSnapshotScores(pool: PgClientLike, agencyId: string, untilYmd: string, asOf: Date): Promise<SnapshotIn[]> {
  const r = await pool.query<{ date: string; crisis_risk_score: number | string | null; computed_at: Date | string | null }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, crisis_risk_score, computed_at
       FROM daily_metric_snapshots
      WHERE agency_id = $1::uuid
        AND date <= $2::date
        AND computed_at <= $3
      ORDER BY date`,
    [agencyId, untilYmd, asOf],
  );
  return r.rows.map((x) => ({
    date: String(x.date),
    score: x.crisis_risk_score == null ? null : Number(x.crisis_risk_score),
    computedAt: x.computed_at,
  }));
}

/** Instantes de alertas disparadas para esta agencia hasta asOf. */
export async function loadAlertTimes(pool: PgClientLike, agencyId: string, asOf: Date): Promise<Date[]> {
  const r = await pool.query<{ triggered_at: Date | string }>(
    `SELECT triggered_at FROM alert_history WHERE agency_id = $1::uuid AND triggered_at <= $2`,
    [agencyId, asOf],
  );
  return r.rows.map((x) => new Date(x.triggered_at));
}

/** Narrativas primarias más frecuentes de la agencia durante un episodio (top 3). */
export async function loadEpisodeNarratives(pool: PgClientLike, agencyId: string, start: string, end: string, asOf: Date): Promise<Array<{ narrativa: string; menciones: number }>> {
  const r = await pool.query<{ name: string; c: number | string }>(
    `SELECT n.name AS name, COUNT(*)::int AS c
       FROM narrative_mentions nm
       JOIN narratives n ON n.id = nm.narrative_id AND n.agency_id = $1::uuid
       JOIN mentions m ON m.id = nm.mention_id AND m.agency_id = $1::uuid
      WHERE nm.is_primary = true
        AND m.is_duplicate = false
        AND (m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')
        AND m.published_at <= $4
        AND ${LOCAL_DAY} >= $2::date
        AND ${LOCAL_DAY} <= $3::date
      GROUP BY n.id, n.name
      ORDER BY c DESC, n.name
      LIMIT 3`,
    [agencyId, start, end, asOf],
  );
  return r.rows.map((x) => ({ narrativa: String(x.name), menciones: Number(x.c) || 0 }));
}
