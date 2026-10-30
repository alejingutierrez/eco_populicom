import {
  runCouncil, seededShuffle, groupingRulesOk, resolveRebuttal, applyCouncilMemoRules, missingObjections,
  type CouncilStore,
} from '@eco/shared/src/advisor/council';
import type { AdvisorLLM, AdvisorRequest } from '@eco/shared/src/advisor/llm';
import { fakeCouncilLLM as fakeLLM, memoOf, pos } from '@eco/shared/src/advisor/fake-llm';
import {
  GROUPING_SCHEMA, MEMO_CAMINOS_SCHEMA, MEMO_DA_SCHEMA, MEMO_HEAD_SCHEMA, POSITION_SCHEMA, REBUTTAL_SCHEMA,
} from '@eco/shared/src/advisor/schemas';

const SEEN = new Set(['M-48213', 'M-48214', 'N-112']);
const FACT = {
  pregunta_normalizada: 'apagón', preferencia_usuario: 'PREFERENCIA-SECRETA: emitir comunicado ya',
  sabido: [{ afirmacion: 'x', citas: ['M-48213'] }], no_claro: [], supuesto: [],
  caso_peor: { descripcion: 'p', citas: ['M-48213'] }, linea_base: { descripcion: 'b', rango_indice_72h: null }, puntos_ciegos: [],
};
const MODELS = { fast: 'fast', main: 'main', deep: 'deep' };

function memStore(cancelAfterEvents = Infinity) {
  const events: Array<{ type: string; payload: unknown }> = [];
  const steps: Record<string, unknown> = {};
  const store: CouncilStore = {
    appendEvent: async (type, payload) => { events.push({ type, payload }); },
    saveStep: async (k, v) => { steps[k] = v; },
    isCancelRequested: async () => events.length >= cancelAfterEvents,
  };
  return { store, events, steps };
}

const base = (llm: AdvisorLLM, store: CouncilStore, extra: Record<string, unknown> = {}) => ({
  llm, store, models: MODELS, factSheet: FACT, seenIds: SEEN, question: '¿qué hacemos?', agency: { slug: 'ddecpr', name: 'DDEC' },
  dateLabel: 'jueves 30 de octubre de 2026', vedaActiva: false, seed: 'run-seed', retryBaseMs: 0, ...extra,
});

describe('reglas puras del consejo', () => {
  test('seededShuffle es determinista y es una permutación', () => {
    const a = seededShuffle([1, 2, 3, 4, 5, 6], 'x');
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 'x')).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 'y')).not.toEqual(a);
  });

  test('groupingRulesOk: cubre todas las posiciones y exige contraplán si todos convergen', () => {
    const g = (caminos: Array<{ apoyado_por: string[] }>, contraplan: boolean) => ({ caminos, contraplan_construido: contraplan });
    const all = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    expect(groupingRulesOk(g([{ apoyado_por: all.slice(0, 3) }, { apoyado_por: all.slice(3) }], false), 6)).toBe(true);
    expect(groupingRulesOk(g([{ apoyado_por: all.slice(0, 3) }, { apoyado_por: all.slice(3, 5) }], false), 6)).toBe(false); // falta P6
    expect(groupingRulesOk(g([{ apoyado_por: all }, { apoyado_por: [] }], false), 6)).toBe(false); // converge sin contraplán
    expect(groupingRulesOk(g([{ apoyado_por: all }, { apoyado_por: [] }], true), 6)).toBe(true);
  });

  test('resolveRebuttal: cambio sin evidencia nueva válida cuenta como «mantiene»', () => {
    const corpus = { seenIds: SEEN, manual: 'M-116 regla', legal: 'LC-5' };
    const prev = ['M-48213'];
    const sinEvidencia = resolveRebuttal({ mantiene: false, nuevo_camino: 1, evidencia_nueva: null }, prev, corpus);
    expect(sinEvidencia).toMatchObject({ mantiene: true, invalidado: true, reclamoCambio: true });
    const repetida = resolveRebuttal({ mantiene: false, nuevo_camino: 1, evidencia_nueva: 'ver M-48213' }, prev, corpus);
    expect(repetida.invalidado).toBe(true);
    const inventada = resolveRebuttal({ mantiene: false, nuevo_camino: 1, evidencia_nueva: 'ver M-99999' }, prev, corpus);
    expect(inventada.invalidado).toBe(true);
    const ok = resolveRebuttal({ mantiene: false, nuevo_camino: 1, evidencia_nueva: 'ver M-48214' }, prev, corpus);
    expect(ok).toMatchObject({ mantiene: false, nuevoCamino: 1, invalidado: false });
    expect(resolveRebuttal({ mantiene: true, nuevo_camino: null, evidencia_nueva: null }, prev, corpus).reclamoCambio).toBe(false);
  });

  test('applyCouncilMemoRules: añade objeciones y vetos faltantes y no recomienda un camino vetado', () => {
    const memo = memoOf(2, 0, ['C0-1']);
    const out = applyCouncilMemoRules(memo, {
      objeciones: [{ id: 'C0-1', texto: 'a' }, { id: 'C1-1', texto: 'b' }], nCaminos: 2,
      vetosR1: [{ texto: 'riesgo general', estado: 'sin_resolver' }],
      vetosR4: [{ camino: 0, texto: 'LC-5 sin base', estado: 'sin_resolver' }],
    });
    const ob = out.objeciones_da as Array<{ id: string; estado: string; como: string }>;
    expect(ob.find((o) => o.id === 'C1-1')).toMatchObject({ estado: 'aceptada', como: 'aceptada (sin respuesta del moderador)' });
    expect((out.vetos as Array<{ texto: string }>).map((v) => v.texto)).toEqual(expect.arrayContaining(['riesgo general', 'LC-5 sin base']));
    const rec = out.recomendacion as { camino: number; confianza_cualitativa: string; porque: string };
    expect(rec.camino).toBe(1);
    expect(rec.confianza_cualitativa).toBe('media');
    expect(rec.porque).toContain('veto sin resolver');
  });

  test('applyCouncilMemoRules: si todos los caminos están vetados, baja la confianza', () => {
    const out = applyCouncilMemoRules(memoOf(2, 0), {
      objeciones: [], nCaminos: 2, vetosR1: [],
      vetosR4: [{ camino: 0, texto: 'a', estado: 'sin_resolver' }, { camino: 1, texto: 'b', estado: 'sin_resolver' }],
    });
    expect((out.recomendacion as { confianza_cualitativa: string }).confianza_cualitativa).toBe('baja');
  });

  test('un veto que el moderador marcó resuelto no bloquea', () => {
    const memo = { ...memoOf(2, 0), vetos: [{ asiento: 'legal', texto: 'a', estado: 'resuelto' }] };
    const out = applyCouncilMemoRules(memo, { objeciones: [], nCaminos: 2, vetosR1: [], vetosR4: [{ camino: 0, texto: 'a', estado: 'sin_resolver' }] });
    expect((out.recomendacion as { camino: number }).camino).toBe(0);
  });

  test('missingObjections', () => {
    expect(missingObjections(memoOf(2, 0, ['C0-1']), [{ id: 'C0-1' }, { id: 'C0-2' }])).toEqual(['C0-2']);
  });
});

describe('runCouncil', () => {
  test('corre las rondas 1 a 5 y la revisión; la preferencia del usuario solo llega a la ronda 5', async () => {
    const { llm, calls } = fakeLLM();
    const { store, events, steps } = memStore();
    const out = await runCouncil(base(llm, store));
    expect(out.status).toBe('done');
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['round_started', 'seat_done', 'round_done', 'memo', 'review', 'veto']));
    for (const k of ['1.estratega', '1.vocero', '1.legal', '1.ciudadano', '1.periodista', '1.oposicion', '2.semilla', '2.moderador', '3.abogado_diablo', '3.periodista', '3.oposicion', '4.legal', '5.moderador', '6.revision', 'alarmas']) {
      expect(steps).toHaveProperty([k]);
    }
    const pref = 'PREFERENCIA-SECRETA';
    const sys = (r: AdvisorRequest) => JSON.stringify(r.system);
    const conPref = calls.filter((r) => sys(r).includes(pref) || JSON.stringify(r.messages).includes(pref));
    // Solo las tres partes del memorando (ronda 5) ven la preferencia.
    expect(conPref.length).toBe(3);
    expect(conPref.every((r) => [MEMO_HEAD_SCHEMA, MEMO_CAMINOS_SCHEMA, MEMO_DA_SCHEMA].includes(r.outputSchema as never))).toBe(true);
  });

  test('ninguna petición lleva temperature ni tool_choice forzado, y las salidas son estructuradas', async () => {
    const { llm, calls } = fakeLLM();
    await runCouncil(base(llm, memStore().store));
    for (const r of calls) {
      expect(r.outputSchema).toBeDefined();
      expect(JSON.stringify(r)).not.toMatch(/temperature|tool_choice|top_p/);
    }
  });

  test('ronda 2: las posiciones llegan sin el nombre del rol, etiquetadas P1 a P6', async () => {
    const { llm, calls } = fakeLLM();
    await runCouncil(base(llm, memStore().store));
    const g = calls.find((r) => r.outputSchema === GROUPING_SCHEMA)!;
    const text = String(g.messages[0].content);
    for (let i = 1; i <= 6; i++) expect(text).toContain(`"etiqueta":"P${i}"`);
    expect(text).not.toContain('"asiento"');
    expect(text).not.toMatch(/"(?:seat|rol|role)"/);
  });

  test('abanico: el primer asiento termina antes de lanzar los demás', async () => {
    const order: string[] = [];
    const inner = fakeLLM();
    let inflight = 0, peak = 0;
    const llm: AdvisorLLM = {
      stream: inner.llm.stream,
      create: async (req) => {
        if (req.outputSchema === POSITION_SCHEMA) {
          inflight++; peak = Math.max(peak, inflight);
          order.push(`start:${/Asiento: (\w+)/.exec(String(req.messages[0].content))![1]}`);
          await new Promise((r) => setTimeout(r, 5));
          inflight--;
        }
        return inner.llm.create(req);
      },
    };
    await runCouncil(base(llm, memStore().store));
    expect(order[0]).toBe('start:estratega');
    expect(peak).toBe(5); // 5 en paralelo tras el primero, nunca 6
  });

  test('cambio de postura sin evidencia se invalida y se cuenta en la alarma', async () => {
    const { llm } = fakeLLM({
      rebuttal: (seat) => ({ mantiene: seat !== 'vocero', nuevo_camino: seat === 'vocero' ? 1 : null, evidencia_nueva: null, ajuste_rangos: [], vetos: [] }),
    });
    const { store, steps } = memStore();
    const out = await runCouncil(base(llm, store));
    expect(out.alarms).toMatchObject({ cambios_postura: 1, cambios_sin_evidencia: 1 });
    expect((steps['4.vocero'] as { efectivo: { mantiene: boolean } }).efectivo.mantiene).toBe(true);
  });

  test('un solo grupo dispara la alarma de diversidad solo si el moderador no construyó contraplán', async () => {
    const all = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const { llm } = fakeLLM({ grouping: { caminos: [{ id: 'C1', nombre_verbo: 'Informar', descripcion: 'd', apoyado_por: all }, { id: 'C2', nombre_verbo: 'Contraplán', descripcion: 'd', apoyado_por: [] }], contraplan_construido: true } });
    const out = await runCouncil(base(llm, memStore().store));
    expect(out.alarms?.diversidad_un_solo_grupo).toBe(true);
  });

  test('la agrupación inválida (converge sin contraplán) se reintenta y luego falla con código', async () => {
    const all = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const { llm } = fakeLLM({ grouping: { caminos: [{ id: 'C1', nombre_verbo: 'a', descripcion: 'd', apoyado_por: all }, { id: 'C2', nombre_verbo: 'b', descripcion: 'd', apoyado_por: [] }], contraplan_construido: false } });
    await expect(runCouncil(base(llm, memStore().store))).rejects.toMatchObject({ code: 'grouping_invalid' });
  });

  test('objeción omitida: se reintenta la parte y, si sigue faltando, se añade de oficio', async () => {
    const { llm, calls } = fakeLLM({ memoDaMissing: true });
    const out = await runCouncil(base(llm, memStore().store));
    // El reintento incluye las que faltaban, así que el memorando final trae las seis.
    expect((out.memo!.objeciones_da as unknown[]).length).toBe(6);
    expect(out.alarms?.objeciones_ausentes).toBe(2);
    expect(calls.filter((r) => r.outputSchema === MEMO_DA_SCHEMA).length).toBe(2);
  });

  test('veto legal sin resolver de la ronda 4 bloquea el camino recomendado y llega al memorando', async () => {
    const { llm } = fakeLLM(); // el legal veta el camino 0 y el moderador (fake) recomienda el 0
    const out = await runCouncil(base(llm, memStore().store));
    const rec = out.memo!.recomendacion as { camino: number };
    expect(rec.camino).toBe(1);
    expect((out.memo!.vetos as Array<{ texto: string }>).some((v) => v.texto === 'LC-5 sin base')).toBe(true);
  });

  test('ciudadanía inventada: citas del asiento ciudadano que no son M- válidas se cuentan', async () => {
    const { llm } = fakeLLM({ positions: (seat) => pos(`r-${seat}`, seat === 'ciudadano' ? { citas: ['M-48213', 'M-77777', 'M-12'] } : {}) });
    const out = await runCouncil(base(llm, memStore().store));
    expect(out.alarms?.ciudadania_inventada).toBe(2);
  });

  test('checkpoints: con todo guardado no se vuelve a llamar al modelo', async () => {
    const first = fakeLLM();
    const m1 = memStore();
    const out1 = await runCouncil(base(first.llm, m1.store));
    const second = fakeLLM();
    const m2 = memStore();
    const out2 = await runCouncil(base(second.llm, m2.store, { checkpoints: m1.steps }));
    expect(second.calls).toHaveLength(0);
    expect(out2.status).toBe('done');
    expect(out2.memo).toEqual(out1.memo);
  });

  test('checkpoints: reanuda desde la última ronda completa', async () => {
    const full = fakeLLM();
    const m1 = memStore();
    await runCouncil(base(full.llm, m1.store));
    const partial = Object.fromEntries(Object.entries(m1.steps).filter(([k]) => /^(1\.|2\.|3\.)/.test(k)));
    const resumed = fakeLLM();
    await runCouncil(base(resumed.llm, memStore().store, { checkpoints: partial }));
    const schemas = new Set(resumed.calls.map((r) => r.outputSchema));
    expect(schemas.has(POSITION_SCHEMA)).toBe(false);
    expect(schemas.has(GROUPING_SCHEMA)).toBe(false);
    expect(schemas.has(REBUTTAL_SCHEMA)).toBe(true);
    expect(schemas.has(MEMO_HEAD_SCHEMA)).toBe(true);
  });

  test('cancelación entre rondas: estado cancelled y se conserva lo producido', async () => {
    const { llm, calls } = fakeLLM();
    const { store, steps } = memStore(8); // se pide cancelar tras ~8 eventos (ronda 1 terminada)
    const out = await runCouncil(base(llm, store));
    expect(out.status).toBe('cancelled');
    expect(out.memo).toBeNull();
    expect(steps['1.estratega']).toBeDefined();
    expect(steps['5.moderador']).toBeUndefined();
    expect(calls.some((r) => r.outputSchema === MEMO_HEAD_SCHEMA)).toBe(false);
  });

  test('AbortSignal: una petición en curso abortada devuelve cancelled', async () => {
    const ac = new AbortController();
    const llm: AdvisorLLM = {
      stream: async () => { throw new Error('no usado'); },
      create: async (req) => {
        ac.abort();
        const e = new Error('aborted'); e.name = 'AbortError';
        expect(req.signal).toBe(ac.signal);
        throw e;
      },
    };
    const out = await runCouncil(base(llm, memStore().store, { signal: ac.signal }));
    expect(out.status).toBe('cancelled');
  });

  test('reintenta errores de transporte (límite de tasa) y no los de validación', async () => {
    const inner = fakeLLM();
    let n = 0;
    const llm: AdvisorLLM = {
      stream: inner.llm.stream,
      create: async (req) => {
        if (req.outputSchema === POSITION_SCHEMA && n++ < 2) { const e = new Error('ThrottlingException: Too many requests'); e.name = 'ThrottlingException'; throw e; }
        return inner.llm.create(req);
      },
    };
    const out = await runCouncil(base(llm, memStore().store));
    expect(out.status).toBe('done');
    expect(n).toBeGreaterThan(2);
  });

  test('los cuatro conceptos de uso se acumulan y el costo no se inventa si falta precio de Opus', async () => {
    const { llm } = fakeLLM();
    const out = await runCouncil(base(llm, memStore().store, { models: { fast: 'us.anthropic.claude-haiku-5-5', main: 'us.anthropic.claude-sonnet-5-5', deep: 'us.anthropic.claude-opus-5-5' } }));
    expect(out.usage.cacheRead).toBeGreaterThan(0);
    expect(out.costUsd).toBeNull(); // Opus sin precio verificado
    expect(out.alarms?.cache_ratio).toBeGreaterThan(0.6);
  });
});
