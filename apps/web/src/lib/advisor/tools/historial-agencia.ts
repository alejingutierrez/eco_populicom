import { loadAgencyCoverage } from '@eco/shared';
import {
  baseRates, computeEpisodes, loadAlertTimes, loadEpisodeNarratives, loadSnapshotScores,
} from '../history';
import type { AdvisorToolSpec } from './types';
import { asArgs, closedWindow, guard, objectSchema, P_RESPONSE_FORMAT, readResponseFormat, toResult } from './common';

/**
 * Crisis anteriores de ESTA agencia y su referencia: episodios del índice V5
 * (días con score ≥ 0.40), alertas, cómo terminaron y tasas base en código.
 */
export const historialAgencia: AdvisorToolSpec = {
  def: {
    name: 'historial_agencia',
    description:
      'Historial de crisis de esta agencia: episodios en que el índice de crisis V5 estuvo en 0.40 o más (inicio, pico, duración, banda máxima, si disparó alerta, narrativas dominantes y días hasta bajar de 0.25) y tasas base calculadas por código. Solo datos de esta agencia. Con menos de 5 episodios usables no da porcentajes.',
    input_schema: objectSchema({ response_format: P_RESPONSE_FORMAT }),
    strict: true,
  },
  run: (ctx, args) =>
    guard(async () => {
      const a = asArgs(args, ['response_format'], 'historial_agencia');
      const formato = readResponseFormat(a.response_format);
      const win = closedWindow(ctx.asOf, 1);
      const endYmd = win.endYmd;

      const coverage = await loadAgencyCoverage(ctx.pool, ctx.agencyId);
      const [snaps, alertTimes] = await Promise.all([
        loadSnapshotScores(ctx.pool, ctx.agencyId, endYmd, ctx.asOf),
        loadAlertTimes(ctx.pool, ctx.agencyId, ctx.asOf),
      ]);

      const episodes = computeEpisodes(snaps, coverage.startYmd ?? null, { asOfYmd: endYmd, alertTimes });
      const rates = baseRates(episodes);

      const tope = formato === 'detalle' ? 20 : 5;
      const mostrados = episodes.slice().reverse().slice(0, tope);
      const detalle = await Promise.all(
        mostrados.map(async (e) => ({
          id: e.id,
          inicio: e.start,
          fin: e.end,
          duracion_dias: e.durationDays,
          pico: { fecha: e.peak.date, score: e.peak.score },
          banda_maxima: e.maxBand,
          alerta_disparada: e.alertFired,
          formula_incierta: e.formulaIncierta,
          dias_hasta_bajo_0_25: e.diasHastaBajo025,
          narrativas_dominantes: await loadEpisodeNarratives(ctx.pool, ctx.agencyId, e.start, e.end, ctx.asOf),
        })),
      );

      return toResult({
        ok: true,
        herramienta: 'historial_agencia',
        cobertura_desde: coverage.startYmd ?? null,
        hasta: endYmd,
        umbral_episodio: 0.4,
        total_episodios: episodes.length,
        episodios_excluidos_de_referencia: rates.excluidosFormulaIncierta,
        referencia: {
          n_episodios_usables: rates.n,
          tasa_crisis_desde_alerta: rates.tasaCrisisDesdeAlerta,
          mediana_dias_hasta_bajo_0_25: rates.medianaDiasHastaBajo025,
          nota: 'Tasas calculadas por código sobre episodios de esta agencia; con n < 5 no hay porcentajes.',
        },
        episodios: detalle,
        mostrados: detalle.length,
        ...(episodes.length > detalle.length ? { como_filtrar: 'Pide response_format "detalle" para ver hasta 20 episodios.' } : {}),
      });
    }),
};
