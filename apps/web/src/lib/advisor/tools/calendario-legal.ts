import { VEDA_ELECTORAL, vedaStatus } from '../calendar';
import type { AdvisorToolSpec, AdvisorToolCtx } from './types';
import { asArgs, guard, objectSchema, P_RESPONSE_FORMAT, prYmd, readResponseFormat, toResult } from './common';

const SIN_EMERGENCIAS = 'sin emergencias registradas';

interface EmergenciaRow {
  id: string;
  starts_on: string;
  ends_on: string;
  reference: string | null;
  municipalities: string[] | null;
}

/**
 * Proclamas de emergencia de la tabla advisor_legal_calendar (la llena el staff).
 * Muestra las activas, las futuras y las que terminaron hace menos de 90 días.
 * Si la tabla no existe (42P01), responde «sin emergencias registradas».
 */
async function emergencias(ctx: AdvisorToolCtx, hoy: string): Promise<{ nota: string; items: unknown[] }> {
  try {
    const r = await ctx.pool.query<EmergenciaRow>(
      `SELECT id::text AS id,
              to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
              to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
              reference,
              municipalities
         FROM advisor_legal_calendar
        WHERE kind = 'emergencia'
          AND ends_on >= ($1::date - 90)
        ORDER BY starts_on DESC
        LIMIT 20`,
      [hoy],
    );
    if (r.rows.length === 0) return { nota: SIN_EMERGENCIAS, items: [] };
    const items = r.rows.map((e) => ({
      id: e.id,
      estado: e.starts_on > hoy ? 'futura' : e.ends_on < hoy ? 'pasada' : 'activa',
      desde: e.starts_on,
      hasta: e.ends_on,
      referencia: e.reference,
      alcance: e.municipalities == null ? 'toda la isla' : e.municipalities,
    }));
    return { nota: `${items.length} registradas`, items };
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return { nota: SIN_EMERGENCIAS, items: [] };
    throw e;
  }
}

/** Veda electoral (constante del manual) y emergencias declaradas. */
export const calendarioLegal: AdvisorToolSpec = {
  def: {
    name: 'calendario_legal',
    description:
      'Calendario legal para comunicar: si la veda electoral está vigente o cuándo empieza (según el manual de ECO, §8.1), qué prohíbe y qué está exento, los plazos ante la Oficina del Contralor Electoral y las emergencias declaradas registradas. Sin argumentos obligatorios.',
    input_schema: objectSchema({ response_format: P_RESPONSE_FORMAT }),
    strict: true,
  },
  run: (ctx, args) =>
    guard(async () => {
      const a = asArgs(args, ['response_format'], 'calendario_legal');
      const formato = readResponseFormat(a.response_format);
      const hoy = prYmd(ctx.asOf);
      const veda = vedaStatus(hoy);
      const em = await emergencias(ctx, hoy);

      return toResult({
        ok: true,
        herramienta: 'calendario_legal',
        fecha_consulta: hoy,
        veda_electoral: {
          estado: veda.estado,
          texto: veda.texto,
          proxima: { inicio: veda.proximaInicio, fin: veda.fin },
          fuente: VEDA_ELECTORAL.fuente,
          version: VEDA_ELECTORAL.version,
          ...(formato === 'detalle'
            ? {
                periodo: VEDA_ELECTORAL.periodo,
                que_prohibe: VEDA_ELECTORAL.queProhibe,
                exento: VEDA_ELECTORAL.exento,
                plazos_oce: VEDA_ELECTORAL.plazosOCE,
                pendiente_de_verificar: VEDA_ELECTORAL.pendienteDeVerificar,
              }
            : {}),
        },
        emergencias: { nota: em.nota, items: em.items },
      });
    }),
};
