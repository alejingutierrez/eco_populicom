import { addDaysYmd } from '@eco/shared';
import { computeMentionsAnalysis } from '../../mentions/payload';
import { ANALYSIS_MAX_DAYS } from '../../mentions/analysis';
import type { AdvisorToolSpec } from './types';
import {
  asArgs, closedWindow, countBy, guard, objectSchema, P_LIMIT, P_RESPONSE_FORMAT, prMidnight, readInt, readLimit,
  readResponseFormat, toResult, withList,
} from './common';

/** Mapa de atención, historias repetidas y lenguaje que sube o baja. */
export const comoViajo: AdvisorToolSpec = {
  def: {
    name: 'como_viajo',
    description:
      'Cómo viaja el tema: actividad diaria, qué voces lo originan y lo repiten, historias (menciones que se repiten), palabras que suben o bajan frente al periodo anterior y menciones de ejemplo. Ventana: los últimos «dias» cerrados (por defecto 7, terminan ayer en hora de Puerto Rico). El texto de terceros llega solo como objetos JSON de tipo mencion_de_tercero.',
    input_schema: objectSchema({
      dias: { type: 'integer', description: 'Días cerrados de la ventana: entre 1 y 31; por defecto 7.' },
      limite: P_LIMIT,
      response_format: P_RESPONSE_FORMAT,
    }),
    strict: true,
  },
  run: (ctx, args) =>
    guard(async () => {
      const a = asArgs(args, ['dias', 'limite', 'response_format'], 'como_viajo');
      const formato = readResponseFormat(a.response_format);
      const dias = readInt(a.dias, 'dias', 1, ANALYSIS_MAX_DAYS, 7);
      const limite = readLimit(a.limite);
      const tope = formato === 'detalle' ? limite : Math.min(limite, 5);

      const win = closedWindow(ctx.asOf, dias);
      const since = prMidnight(win.startYmd);
      const until = prMidnight(addDaysYmd(win.endYmd, 1));
      const an = await computeMentionsAnalysis(
        ctx.pool,
        { id: ctx.agencyId, slug: ctx.agencySlug, name: ctx.agencyName },
        since,
        until,
      );

      const points = an.points ?? [];
      const ejemplos = [...points]
        .sort((x, y) => y.inter - x.inter || (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0))
        .slice(0, tope)
        .map((p) => ({
          tipo: 'mencion_de_tercero',
          id: `M-${p.id}`,
          fuente: p.src,
          autor: p.author,
          fecha: p.ts,
          texto: p.title,
        }));

      const historias = (an.stories ?? [])
        .slice()
        .sort((x, y) => y.length - x.length)
        .slice(0, tope)
        .map((g) => g.map((id) => `M-${id}`));

      const lenguaje = an.shift
        ? {
            tipo: 'lenguaje_derivado_de_terceros',
            nota: 'palabras que suben o bajan frente al periodo anterior; no son citas',
            sube: an.shift.up.slice(0, tope),
            baja: an.shift.down.slice(0, tope),
          }
        : null;

      const base: Record<string, unknown> = {
        ok: true,
        herramienta: 'como_viajo',
        ventana: {
          desde: win.startYmd,
          hasta: win.endYmd,
          dias,
          criterio: 'días cerrados; el último es ayer (America/Puerto_Rico)',
        },
        total_menciones: an.total,
        actividad_diaria: an.days,
        voces_por_categoria: countBy(points, (p) => p.voice),
        historias: { total: (an.stories ?? []).length, mostradas: historias.length, grupos: historias },
        amplificacion: formato === 'detalle' ? an.amplify : (an.amplify?.origins ?? null),
        lenguaje,
      };

      return withList(base, 'menciones_ejemplo', ejemplos, points.length, 'Pide response_format "detalle" o reduce "dias" para ver más.');
    }),
};
