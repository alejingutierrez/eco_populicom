/**
 * Calendario legal del asesor (manual-eco.md §8.1). Constantes versionadas:
 * solo lo que el manual afirma. Donde el manual no da una fecha, el valor es
 * null y la herramienta responde «sin fecha confirmada en la versión del manual».
 *
 * Las proclamas de emergencia NO viven aquí: están en la tabla
 * advisor_legal_calendar (kind = 'emergencia'), que llena el staff.
 */

export const CALENDAR_VERSION = '2026-10-28';

export const SIN_FECHA = 'sin fecha confirmada en la versión del manual';

export const VEDA_ELECTORAL = {
  version: CALENDAR_VERSION,
  fuente: 'docs/manejo-de-crisis/manual-eco.md §8.1: Ley 222-2011, art. 10.006, enmendada por la Ley 154-2026 (31-jul-2026)',
  /** «del 1 de enero del año de elección general hasta la certificación de resultados» */
  periodo: 'Desde el 1 de enero del año de elección general hasta la certificación de resultados.',
  /** El manual da la próxima apertura; no da fecha de cierre (certificación). */
  proximoInicio: '2028-01-01' as string | null,
  fin: null as string | null,
  queProhibe: [
    'Gastar fondos públicos para difundir logros, metas, planes o mensajes que favorezcan o perjudiquen a un candidato, funcionario o partido, sin autorización previa de la Oficina del Contralor Electoral.',
    'Desde el 1 de enero del año de elección, pagar promoción en las redes oficiales.',
  ],
  exento: ['Avisos sobre emergencias declaradas, limitados a lo necesario, entre otros (el manual no enumera el resto).'],
  plazosOCE: {
    ordinaria: 'solicitud con 20 días naturales o más',
    expedita: 'solicitud con 5 días laborables o más',
  },
  pendienteDeVerificar: [
    'Penalidades de la Ley 154-2026.',
    'Texto completo de las excepciones.',
  ],
} as const;

export type VedaEstado = 'no vigente' | 'vigente';

export interface VedaStatus {
  estado: VedaEstado;
  texto: string;
  proximaInicio: string | null;
  fin: string;
}

/**
 * Estado de la veda en un día YYYY-MM-DD (hoy en PR). Con las fechas del manual:
 * antes de proximoInicio no hay veda; desde ese día la veda está vigente y su
 * fin no tiene fecha confirmada.
 */
export function vedaStatus(todayYmd: string): VedaStatus {
  const inicio = VEDA_ELECTORAL.proximoInicio;
  const fin = VEDA_ELECTORAL.fin ?? SIN_FECHA;
  if (inicio === null || todayYmd < inicio) {
    return {
      estado: 'no vigente',
      texto: inicio
        ? `veda: no vigente hoy; la próxima empieza el ${inicio} (manual §8.1)`
        : 'veda: sin fecha confirmada en la versión del manual',
      proximaInicio: inicio,
      fin,
    };
  }
  return {
    estado: 'vigente',
    texto: `veda: vigente desde el ${inicio}; fin: ${fin}`,
    proximaInicio: inicio,
    fin,
  };
}
