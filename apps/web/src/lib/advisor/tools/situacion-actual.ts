import { addDaysYmd, crisisBand, MIN_WINDOW_MENTIONS } from '@eco/shared';
import { computeScorecard } from '../../scorecard/payload';
import type { AdvisorToolSpec } from './types';
import {
  asArgs, closedWindow, guard, median, num, objectSchema, P_RESPONSE_FORMAT, readResponseFormat, round1, round3, toResult,
} from './common';

interface SnapRow {
  date: string;
  total_mentions: number | string | null;
  negative_count: number | string | null;
  crisis_severity: number | string | null;
  crisis_velocity: number | string | null;
  crisis_relevance: number | string | null;
  crisis_confidence: number | string | null;
}

const DAYS_SQL = `
SELECT to_char(date, 'YYYY-MM-DD') AS date, total_mentions, negative_count,
       crisis_severity, crisis_velocity, crisis_relevance, crisis_confidence
  FROM daily_metric_snapshots
 WHERE agency_id = $1::uuid
   AND date >= $2::date
   AND date <= $3::date
   AND computed_at <= $4
 ORDER BY date`;

/**
 * Estado de crisis de la agencia en los últimos 7 días cerrados (hasta ayer,
 * hora de PR): índice V5 con sus componentes y banda, NSS, volumen y % negativo
 * contra lo usual, polarización y 12 semanas.
 */
export const situacionActual: AdvisorToolSpec = {
  def: {
    name: 'situacion_actual',
    description:
      'Estado de crisis de la agencia: índice de crisis V5 (0–1) con su banda y componentes, NSS, menciones pertinentes y % negativo contra lo usual, polarización y las últimas semanas. Ventana: 7 días cerrados que terminan ayer (hora de Puerto Rico). Sin argumentos obligatorios.',
    input_schema: objectSchema({ response_format: P_RESPONSE_FORMAT }),
    strict: true,
  },
  run: (ctx, args) =>
    guard(async () => {
      const a = asArgs(args, ['response_format'], 'situacion_actual');
      const formato = readResponseFormat(a.response_format);
      const win = closedWindow(ctx.asOf, 7);
      const from12 = addDaysYmd(win.endYmd, -(7 * 12 - 1));

      const [sc, dayRes] = await Promise.all([
        computeScorecard(ctx.pool, ctx.agencyId, win.startYmd, win.endYmd, win.prevStartYmd, win.prevEndYmd),
        ctx.pool.query<SnapRow>(DAYS_SQL, [ctx.agencyId, from12, win.endYmd, ctx.asOf]),
      ]);

      const weeks = sc.weeks.weeks;
      const cur = weeks[weeks.length - 1];
      const prev = weeks.length > 1 ? weeks[weeks.length - 2] : undefined;
      const usual = sc.weeks.usual;

      // % negativo por semana, desde los snapshots diarios de la misma agencia.
      const days = dayRes.rows.map((r) => ({ date: String(r.date), total: Number(r.total_mentions) || 0, neg: Number(r.negative_count) || 0 }));
      const negPct = (end: string): number | null => {
        const start = addDaysYmd(end, -6);
        let t = 0, n = 0;
        for (const d of days) if (d.date >= start && d.date <= end) { t += d.total; n += d.neg; }
        return t > 0 ? round1((n / t) * 100) : null;
      };
      const negSeries = weeks.map((w) => ({ desde: w.start, hasta: w.end, negativo_pct: negPct(w.end) }));
      const negHist = negSeries.slice(0, -1).map((s) => s.negativo_pct).filter((v): v is number => v != null);

      // Componentes: último día con snapshot (≤ último día cerrado).
      const lastDay = days.length ? dayRes.rows[dayRes.rows.length - 1] : undefined;
      const componentes = lastDay && lastDay.crisis_severity != null
        ? {
            fecha: String(lastDay.date),
            severidad: round3(Number(lastDay.crisis_severity)),
            velocidad: num(lastDay.crisis_velocity) == null ? null : round3(Number(lastDay.crisis_velocity)),
            relevancia: num(lastDay.crisis_relevance) == null ? null : round3(Number(lastDay.crisis_relevance)),
            confianza: num(lastDay.crisis_confidence) == null ? null : round3(Number(lastDay.crisis_confidence)),
          }
        : null;

      // El índice del dashboard viene en 0–100 por semana; aquí se devuelve en 0–1 (escala V5).
      const toUnit = (v: number | null | undefined) => (v == null ? null : round3(v / 100));
      const crisisCur = toUnit(cur?.crisis);
      const crisisPrev = toUnit(prev?.crisis);
      const crisisUsual = usual.crisis
        ? { p25: toUnit(usual.crisis.p25), mediana: toUnit(usual.crisis.median), p75: toUnit(usual.crisis.p75), semanas: usual.crisis.weeks }
        : null;

      const semanas = weeks.map((w, i) => ({
        desde: w.start,
        hasta: w.end,
        menciones: w.n,
        nss: w.nss,
        indice_crisis: toUnit(w.crisis),
        banda: w.crisis == null ? null : crisisBand(w.crisis / 100),
        polarizacion: w.polarization,
        negativo_pct: negSeries[i].negativo_pct,
      }));

      return toResult({
        ok: true,
        herramienta: 'situacion_actual',
        ventana: {
          desde: win.startYmd,
          hasta: win.endYmd,
          criterio: '7 días cerrados; el último es ayer (America/Puerto_Rico)',
          previa: { desde: win.prevStartYmd, hasta: win.prevEndYmd },
        },
        indice_crisis: {
          escala: '0–1, V5',
          valor: crisisCur,
          banda: crisisCur == null ? null : crisisBand(crisisCur),
          previo: { valor: crisisPrev, banda: crisisPrev == null ? null : crisisBand(crisisPrev) },
          usual: crisisUsual,
          componentes: componentes,
          nota: 'valor = promedio de la semana que muestra el dashboard; componentes = último día con snapshot',
        },
        nss: { actual: cur?.nss ?? null, previo: prev?.nss ?? null, usual: usual.nss },
        menciones_pertinentes: { actual: cur?.n ?? 0, previo: prev?.n ?? null, usual: usual.n },
        negativo_pct: {
          actual: negSeries[negSeries.length - 1]?.negativo_pct ?? null,
          previo: negSeries.length > 1 ? negSeries[negSeries.length - 2].negativo_pct : null,
          usual_mediana: median(negHist),
          semanas_en_usual: negHist.length,
        },
        polarizacion: { actual: cur?.polarization ?? null, previo: prev?.polarization ?? null, usual: usual.polarization },
        muestra: { menciones: cur?.n ?? 0, suficiente: (cur?.n ?? 0) >= MIN_WINDOW_MENTIONS, minimo: MIN_WINDOW_MENTIONS },
        semanas: formato === 'detalle' ? semanas : semanas.slice(-4),
      });
    }),
};
