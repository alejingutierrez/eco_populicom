// LLM simulado del consejo: responde según el esquema pedido, sin llamar a Bedrock. Lo usan los tests
// y el modo `--dry-run` del arnés de evaluación (scripts/advisor-eval) para ejercitar el flujo completo.

import type { AdvisorLLM, AdvisorRequest, AdvisorResponse } from './llm';
import {
  ATTACK_SCHEMA, GROUPING_SCHEMA, HEADLINE_SCHEMA, MEMO_CAMINOS_SCHEMA, MEMO_DA_SCHEMA, MEMO_HEAD_SCHEMA,
  POSITION_SCHEMA, PREMORTEM_SCHEMA, REBUTTAL_SCHEMA, REVIEW_SCHEMA,
} from './schemas';

export const pos = (nombre: string, extra: Record<string, unknown> = {}) => ({
  nombre, accion: `acción ${nombre}`, quien: 'q', canal: 'c', cuando: 'hoy', mecanismo: 'm', efectos_esperados: [],
  supuestos: [], citas: ['M-48213'], que_me_haria_cambiar: 'dato', confianza: 'media', vetos: [], ...extra,
});

export function resp(payload: unknown, usage = { inputNew: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 90, output: 20 }): AdvisorResponse {
  return { model: 'm', stopReason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }], usage, ms: 5 };
}

export const memoOf = (n: number, rec = 0, objIds: string[] = []) => ({
  encabezado: { agencia: 'DDEC', fecha: 'hoy', camino: '3', motivo: 'consejo' },
  hechos: { sabido: [], no_claro: [], supuesto: [] },
  linea_base: { descripcion: 'b', rango_indice_72h: null },
  caminos: Array.from({ length: n }, (_, i) => ({ nombre: `c${i}`, que: 'q', quien: 'q', canal: 'c', cuando: 'c', por_que: 'p', reglas: [], efectos: [], riesgos: [], supuestos: [], apoyos: [] })),
  sin_camino_b_porque: null,
  senales: { h24: { va_bien_si: 'a', va_mal_si: 'b' }, h48: { va_bien_si: 'a', va_mal_si: 'b' }, h72: { va_bien_si: 'a', va_mal_si: 'b' }, cambiar_si: [] },
  recomendacion: { camino: rec, confianza_cualitativa: 'alta', porque: 'razones M-48213' },
  disenso: [], objeciones_da: objIds.map((id) => ({ id, texto: id, estado: 'mitigada', como: 'x' })), vetos: [],
  borradores: [{ tipo_plantilla: 'A-1', canal: 'comunicado', texto: 'Hoy a las 3:00 p. m. informaremos de nuevo. Atendemos a las personas afectadas.' }],
  limites: ['WhatsApp'],
});

export interface FakeCouncilOpts {
  grouping?: unknown;
  rebuttal?: (seat: string) => unknown;
  positions?: (seat: string) => unknown;
  memoDaMissing?: boolean;
}

/** LLM falso: responde según el esquema pedido y recuerda cada petición. */
export function fakeCouncilLLM(o: FakeCouncilOpts = {}) {
  const calls: AdvisorRequest[] = [];
  const llm: AdvisorLLM = {
    stream: async () => { throw new Error('no usado'); },
    create: async (req) => {
      calls.push(req);
      const user = typeof req.messages[0].content === 'string' ? req.messages[0].content : '';
      const seat = /Asiento: (\w+)/.exec(user)?.[1] ?? '';
      const s = req.outputSchema;
      if (s === POSITION_SCHEMA) return resp(o.positions ? o.positions(seat) : pos(`ruta-${seat}`, seat === 'legal' ? { vetos: [{ texto: 'LC-5 sin base', estado: 'sin_resolver' }] } : {}));
      if (s === GROUPING_SCHEMA) {
        return resp(o.grouping ?? {
          caminos: [
            { id: 'C1', nombre_verbo: 'Informar ya', descripcion: 'd', apoyado_por: ['P1', 'P2', 'P3'] },
            { id: 'C2', nombre_verbo: 'Esperar datos', descripcion: 'd', apoyado_por: ['P4', 'P5', 'P6'] },
          ],
          contraplan_construido: false,
        });
      }
      if (s === PREMORTEM_SCHEMA) {
        return resp({ premortems: [0, 1].map((camino) => ({ camino, objeciones: [1, 2, 3].map((k) => ({ relato_72h: `fracaso ${camino}-${k}`, senal_temprana: 's', supuesto_fragil: 'f' })), concede: ['x'], que_me_haria_ceder: 'y' })) });
      }
      if (s === HEADLINE_SCHEMA) return resp({ titulares: [0, 1].map((camino) => ({ camino, titular: 't', medio: 'El Nuevo Día' })) });
      if (s === ATTACK_SCHEMA) return resp({ ataques: [0, 1].map((camino) => ({ camino, linea_de_ataque: 'a', quien_la_dice: 'oposición' })) });
      if (s === REBUTTAL_SCHEMA) {
        return resp(o.rebuttal ? o.rebuttal(seat) : {
          mantiene: true, nuevo_camino: null, evidencia_nueva: null, ajuste_rangos: [],
          vetos: seat === 'legal' ? [{ camino: 0, texto: 'LC-5 sin base', estado: 'sin_resolver' }] : [],
        });
      }
      if (s === MEMO_HEAD_SCHEMA) { const m = memoOf(2); return resp({ encabezado: m.encabezado, hechos: m.hechos, linea_base: m.linea_base, senales: m.senales, recomendacion: m.recomendacion, disenso: m.disenso, sin_camino_b_porque: null, limites: m.limites }); }
      if (s === MEMO_CAMINOS_SCHEMA) return resp({ caminos: memoOf(2).caminos });
      if (s === MEMO_DA_SCHEMA) {
        const ids = ['C0-1', 'C0-2', 'C0-3', 'C1-1', 'C1-2', 'C1-3'];
        const retry = user.includes('FALTARON');
        const m = memoOf(2, 0, o.memoDaMissing && !retry ? ids.slice(0, 4) : ids);
        return resp({ objeciones_da: m.objeciones_da, vetos: [], borradores: m.borradores });
      }
      if (s === REVIEW_SCHEMA) return resp({ puntos: [{ id: 1, ok: true, nota: 'ok' }], titular_peor: 'titular' });
      throw new Error('esquema no esperado');
    },
  };
  return { llm, calls };
}

