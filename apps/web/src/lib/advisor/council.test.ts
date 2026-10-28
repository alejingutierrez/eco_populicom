import { runPanel, rotatingSeatFor, applyMemoRules, type PanelDeps } from './council';
import type { AdvisorLLM, AdvisorRequest, AdvisorResponse } from '@eco/shared/src/advisor/llm';
import {
  FACT_SHEET_SCHEMA,
  MEMO_HEAD_SCHEMA,
  MEMO_BODY_SCHEMA,
  POSITION_SCHEMA,
  PREMORTEM_SCHEMA,
  validateMemo,
  validatePosition,
} from '@eco/shared/src/advisor/schemas';

const FACT = {
  pregunta_normalizada: 'apagón en San Juan',
  preferencia_usuario: null,
  sabido: [{ afirmacion: 'Piden explicación en X', citas: ['M-48213'] }],
  no_claro: [],
  supuesto: [],
  caso_peor: { descripcion: 'escalada', citas: ['M-48213'] },
  linea_base: { descripcion: 'sin acción', rango_indice_72h: null },
  puntos_ciegos: ['WhatsApp'],
};

const pos = (nombre: string, vetos: unknown[] = []) => ({
  nombre, accion: `acción de ${nombre}`, quien: 'secretario', canal: 'comunicado', cuando: 'hoy',
  mecanismo: 'explicar el hecho', efectos_esperados: [], supuestos: [], citas: ['M-48213'],
  que_me_haria_cambiar: 'evidencia nueva', confianza: 'media', vetos,
});

const PREMORT = {
  premortems: [0, 1, 2].map((camino) => ({
    camino,
    objeciones: [1, 2, 3].map((k) => ({ relato_72h: `fracaso ${camino}-${k}`, senal_temprana: 's', supuesto_fragil: 'f' })),
    concede: ['algo'],
    que_me_haria_ceder: 'dato',
  })),
};

/** Memo válido que omite la objeción C1-2 y recomienda el camino 2 (el del legal, si rota a legal). */
const MEMO_BASE = {
  encabezado: { agencia: 'DDEC', fecha: 'hoy', camino: '2', motivo: 'panel' },
  hechos: { sabido: [], no_claro: [], supuesto: [] },
  linea_base: { descripcion: 'sin acción', rango_indice_72h: null },
  caminos: [0, 1, 2].map((i) => ({ nombre: `c${i}`, que: 'q', quien: 'q', canal: 'c', cuando: 'c', por_que: 'p', reglas: [], efectos: [], riesgos: [], supuestos: [], apoyos: [] })),
  sin_camino_b_porque: null,
  senales: { h24: { va_bien_si: 'a', va_mal_si: 'b' }, h48: { va_bien_si: 'a', va_mal_si: 'b' }, h72: { va_bien_si: 'a', va_mal_si: 'b' }, cambiar_si: [] },
  recomendacion: { camino: 2, confianza_cualitativa: 'alta', porque: 'razones' },
  disenso: [],
  objeciones_da: [
    { id: 'C0-1', texto: 'fracaso 0-1', estado: 'mitigada', como: 'x' },
    { id: 'C0-2', texto: 'fracaso 0-2', estado: 'resuelta', como: 'y' },
    { id: 'C0-3', texto: 'fracaso 0-3', estado: 'aceptada', como: 'z' },
  ],
  vetos: [],
  borradores: [],
  limites: ['ECO no ve WhatsApp'],
};

/** LLM falso: responde según el esquema pedido. Sin esquema y con herramientas, termina el turno. */
function fakeLLM(overrides: { failSeat?: string } = {}): { llm: AdvisorLLM; calls: AdvisorRequest[] } {
  const calls: AdvisorRequest[] = [];
  const llm: AdvisorLLM = {
    stream: async () => { throw new Error('no usado'); },
    create: async (req) => {
      calls.push(req);
      let payload: unknown;
      if (!req.outputSchema) payload = null;
      else if (req.outputSchema === FACT_SHEET_SCHEMA) payload = FACT;
      else if (req.outputSchema === POSITION_SCHEMA) {
        const seat = seatNameFrom(req);
        if (seat === overrides.failSeat) payload = { nope: true };
        else if (seat === 'legal') payload = pos('legal', [{ texto: 'publicidad vedada', estado: 'sin_resolver' }]);
        else payload = pos(seat);
      } else if (req.outputSchema === PREMORTEM_SCHEMA) payload = PREMORT;
      else if (req.outputSchema === MEMO_HEAD_SCHEMA) payload = Object.fromEntries(['encabezado', 'hechos', 'linea_base', 'senales', 'recomendacion', 'disenso', 'sin_camino_b_porque', 'limites'].map((k) => [k, (MEMO_BASE as Record<string, unknown>)[k]]));
      else if (req.outputSchema === MEMO_BODY_SCHEMA) payload = Object.fromEntries(['caminos', 'objeciones_da', 'vetos', 'borradores'].map((k) => [k, (MEMO_BASE as Record<string, unknown>)[k]]));
      const content: AdvisorResponse['content'] = payload === null
        ? [{ type: 'text', text: 'Listo.' }]
        : [{ type: 'text', text: JSON.stringify(payload) }];
      return { model: req.model, stopReason: 'end_turn', content, usage: { inputNew: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 1 }, ms: 1 };
    },
  };
  return { llm, calls };
}

function seatNameFrom(req: AdvisorRequest): string {
  const text = req.messages[0].content as string;
  const m = /Asiento: (\w+)/.exec(text);
  return m ? m[1] : 'x';
}

function fakePool() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/INSERT INTO advisor_events/.test(sql)) events.push({ type: String(params[1]), payload: JSON.parse(String(params[2])) });
      return { rows: [], rowCount: 1 };
    },
  };
  return { pool: pool as unknown as PanelDeps['pool'], events, queries };
}

function deps(over: Partial<PanelDeps> & { llm: AdvisorLLM }, pool: PanelDeps['pool']): PanelDeps {
  return {
    tools: { defs: [], run: async () => ({ ok: true, text: '{}', resultTokens: 1 }) },
    pool,
    runId: '00000000-0000-0000-0000-000000000001',
    models: { fast: 'f', main: 'm', deep: 'd' },
    dateLabel: 'miércoles, 28 de octubre de 2026',
    agency: { slug: 'ddecpr', name: 'DDEC' },
    signals: { guiaProbable: null, riesgoPersonas: false, vedaActiva: false },
    question: '¿Qué digo del apagón?',
    isCancelled: async () => false,
    ...over,
  };
}

describe('rotación del asiento del panel (spec §8.2)', () => {
  test('legal con veda o guía G-3, G-4, G-6, G-11; ciudadano con riesgo a personas; oposición si no', () => {
    expect(rotatingSeatFor({ guiaProbable: 'G-4', riesgoPersonas: false, vedaActiva: false })).toBe('legal');
    expect(rotatingSeatFor({ guiaProbable: null, riesgoPersonas: false, vedaActiva: true })).toBe('legal');
    expect(rotatingSeatFor({ guiaProbable: 'G-1', riesgoPersonas: true, vedaActiva: false })).toBe('ciudadano');
    expect(rotatingSeatFor({ guiaProbable: 'G-1', riesgoPersonas: false, vedaActiva: false })).toBe('oposicion');
  });
});

describe('validadores de salida (spec §8.6)', () => {
  test('una posición sin cita se rechaza; con una, se acepta', () => {
    expect(validatePosition({ ...pos('v'), citas: [] })).toBeNull();
    expect(validatePosition(pos('v'))).not.toBeNull();
  });

  test('un memorando con tipos incorrectos se rechaza', () => {
    expect(validateMemo({ ...MEMO_BASE, disenso: 'texto suelto' })).toBeNull();
    expect(validateMemo(MEMO_BASE)).not.toBeNull();
  });
});

describe('reglas del memorando (spec §8.3)', () => {
  test('una objeción omitida se añade de oficio como aceptada sin respuesta', () => {
    const memo = applyMemoRules(MEMO_BASE, {
      objeciones: [{ id: 'C0-1', texto: 'a' }, { id: 'C0-2', texto: 'b' }, { id: 'C0-3', texto: 'c' }, { id: 'C1-1', texto: 'd' }],
      caminos: [0, 1, 2].map((i) => ({ camino: i, nombre: 'n', posicion: {} })),
      seat: 'legal',
    });
    const added = (memo.objeciones_da as Array<{ id: string; estado: string; como: string }>).find((o) => o.id === 'C1-1');
    expect(added).toEqual({ id: 'C1-1', texto: 'd', estado: 'aceptada', como: 'aceptada (sin respuesta del moderador)' });
  });

  test('un veto legal sin resolver baja la confianza del camino que bloquea', () => {
    const caminos = [
      { camino: 0, nombre: 'a', posicion: pos('a') },
      { camino: 1, nombre: 'b', posicion: pos('b') },
      { camino: 2, nombre: 'legal', posicion: pos('legal', [{ texto: 'publicidad vedada', estado: 'sin_resolver' }]) },
    ];
    const memo = applyMemoRules(MEMO_BASE, { objeciones: [], caminos, seat: 'legal' });
    expect(memo.recomendacion).toMatchObject({ camino: 2, confianza_cualitativa: 'baja' });
    expect(String((memo.recomendacion as { porque: string }).porque).startsWith('Veto sin resolver: publicidad vedada')).toBe(true);
    expect(memo.vetos).toEqual([{ asiento: 'legal', texto: 'publicidad vedada', estado: 'sin_resolver' }]);
  });
});

describe('runPanel · orden de rondas y eventos (spec §8.3, §9.3)', () => {
  test('hechos → posiciones → ataque → síntesis, con eventos y memorando', async () => {
    const { pool, events } = fakePool();
    const { llm, calls } = fakeLLM();
    const out = await runPanel(deps({ llm, signals: { guiaProbable: 'G-4', riesgoPersonas: false, vedaActiva: false } }, pool));

    expect(out.status).toBe('done');
    const rounds = events.filter((e) => e.type === 'round_started').map((e) => (e.payload as { ronda: number }).ronda);
    expect(rounds).toEqual([0, 1, 3, 5]);
    const seats = events.filter((e) => e.type === 'seat_done').map((e) => (e.payload as { asiento: string }).asiento);
    expect(seats).toEqual(expect.arrayContaining(['vocero', 'estratega', 'legal', 'abogado_diablo']));
    expect(events.some((e) => e.type === 'memo')).toBe(true);
    // El asiento rotativo recibe el veto legal al memorando.
    expect((out.memo as { vetos: unknown[] }).vetos.length).toBeGreaterThan(0);
    // La recomendación queda bloqueada si su camino tiene un veto sin resolver (el legal).
    expect(out.memo).toMatchObject({ recomendacion: { confianza_cualitativa: 'baja' } });
    // Ninguna llamada pide temperature ni tool_choice forzado.
    for (const c of calls) expect(JSON.stringify(c)).not.toMatch(/"temperature"|"tool_choice"/);
  });

  test('un asiento que falla dos veces aborta con código seat_invalid', async () => {
    const { pool } = fakePool();
    const { llm } = fakeLLM({ failSeat: 'vocero' });
    await expect(runPanel(deps({ llm }, pool))).rejects.toMatchObject({ code: expect.stringMatching(/^seat_invalid_/) });
  });

  test('cancelar entre rondas detiene la corrida sin síntesis', async () => {
    const { pool, events } = fakePool();
    const { llm } = fakeLLM();
    let calls = 0;
    const out = await runPanel(deps({ llm, isCancelled: async () => ++calls > 1 }, pool));
    expect(out.status).toBe('cancelled');
    expect(events.some((e) => e.type === 'memo')).toBe(false);
  });
});
