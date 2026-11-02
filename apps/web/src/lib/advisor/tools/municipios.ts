import { computeGeoAnalysis } from '../../geo/payload';
import type { AdvisorToolSpec } from './types';
import {
  asArgs, closedWindow, guard, objectSchema, P_LIMIT, P_RESPONSE_FORMAT, readLimit, readOptionalText, readResponseFormat,
  round2, toResult, withList,
} from './common';

/** Municipios: menciones del periodo contra lo usual y por habitante. */
export const municipios: AdvisorToolSpec = {
  def: {
    name: 'municipios',
    description:
      'Municipios de Puerto Rico que nombran a la agencia en los últimos 7 días cerrados (terminan ayer): menciones, positivas y negativas, lo usual llevado a la misma longitud, estado (nuevo, mas, menos, igual) y menciones por cada 10 mil habitantes. Admite filtros opcionales por fuente, tema o subtema (slug o nombre exacto).',
    input_schema: objectSchema({
      fuente: { type: 'string', description: 'Opcional. Fuente, por ejemplo "prensa" o "redes".' },
      tema: { type: 'string', description: 'Opcional. Slug del tópico.' },
      subtema: { type: 'string', description: 'Opcional. Nombre exacto del subtópico.' },
      limite: P_LIMIT,
      response_format: P_RESPONSE_FORMAT,
    }),
    strict: true,
  },
  run: (ctx, args) =>
    guard(async () => {
      const a = asArgs(args, ['fuente', 'tema', 'subtema', 'limite', 'response_format'], 'municipios');
      readResponseFormat(a.response_format);
      const limite = readLimit(a.limite);
      const fuente = readOptionalText(a.fuente, 'fuente');
      const tema = readOptionalText(a.tema, 'tema');
      const subtema = readOptionalText(a.subtema, 'subtema');
      const win = closedWindow(ctx.asOf, 7);

      const geo = await computeGeoAnalysis(
        ctx.pool,
        ctx.agencyId,
        { startYmd: win.startYmd, endYmd: win.endYmd },
        { source: fuente, topic: tema, subtopic: subtema },
      );

      const lista = geo.munis
        .filter((m) => m.n > 0)
        .sort((x, y) => y.n - x.n || x.name.localeCompare(y.name))
        .map((m) => ({
          municipio: m.name,
          region: m.region,
          menciones: m.n,
          positivas: m.pos,
          negativas: m.neg,
          usual: m.usual,
          estado: m.state,
          habitantes: m.population,
          por_10_mil_habitantes: m.population ? round2((m.n / m.population) * 10000) : null,
        }));

      return withList(
        {
          ok: true,
          herramienta: 'municipios',
          ventana: { desde: win.startYmd, hasta: win.endYmd, criterio: '7 días cerrados; el último es ayer (America/Puerto_Rico)' },
          filtros: { fuente, tema, subtema },
          cobertura: geo.coverage,
          leyenda: 'estado: nuevo = sin menciones en lo usual; mas / menos / igual = frente a lo usual llevado a 7 días',
        },
        'municipios',
        lista.slice(0, limite),
        lista.length,
        'Añade fuente, tema o subtema para acotar la lista.',
      );
    }),
};
