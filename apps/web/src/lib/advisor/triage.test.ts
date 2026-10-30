import * as fs from 'fs';
import * as path from 'path';
import { advisorModelId } from '@eco/shared/src/advisor/models';
import type { AdvisorLLM, AdvisorRequest, AdvisorResponse } from '@eco/shared/src/advisor/llm';
import {
  CLASIFICACION_SCHEMA,
  classify,
  computeFloor,
  contextoTexto,
  decideCamino,
  triage,
  TRIAGE_SYSTEM,
  validateClasificacion,
  type Clasificacion,
  type TipoPregunta,
  type TriageInputs,
} from './triage';

// ---- Helpers -----------------------------------------------------------------

const clas = (o: Partial<Clasificacion> = {}): Clasificacion => ({
  tipo_pregunta: 'descriptiva',
  reversible: true,
  quien_da_la_cara: 'nadie',
  presion_tiempo: 'baja',
  riesgo_personas: false,
  situacion: 'no_aplica',
  guia_probable: 'ninguna',
  camino_sugerido: 1,
  motivo: 'Pregunta de prueba.',
  ...o,
});

const inp = (o: Partial<TriageInputs> = {}): TriageInputs => ({
  indiceHoy: null,
  alertasUltimas12h: 0,
  riesgoPersonas: false,
  vedaActiva: false,
  guiaProbable: null,
  clasificacion: null,
  ...o,
});

const conTipo = (tipo: TipoPregunta, o: Partial<TriageInputs> = {}): TriageInputs =>
  inp({ clasificacion: clas({ tipo_pregunta: tipo }), ...o });

function respuesta(text: string, stopReason = 'end_turn'): AdvisorResponse {
  return {
    model: 'test-model',
    stopReason,
    content: [{ type: 'text', text }],
    usage: { inputNew: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
    ms: 1,
  };
}

/**
 * LLM falso. Cada entrada de `script` es la respuesta de una llamada en orden: un string
 * (texto crudo), un objeto (se serializa a JSON), un Error (la llamada lanza) o `{stop}`.
 * Si se agotan las entradas, repite la última.
 */
function fakeLLM(script: Array<unknown>) {
  const calls: AdvisorRequest[] = [];
  const llm = {
    create: async (req: AdvisorRequest): Promise<AdvisorResponse> => {
      calls.push(req);
      const entrada = script[Math.min(calls.length - 1, script.length - 1)];
      if (entrada instanceof Error) throw entrada;
      if (typeof entrada === 'object' && entrada !== null && 'stop' in entrada) {
        return respuesta('{}', (entrada as { stop: string }).stop);
      }
      const text = typeof entrada === 'string' ? entrada : JSON.stringify(entrada);
      return respuesta(text);
    },
    stream: async (): Promise<AdvisorResponse> => {
      throw new Error('no usado');
    },
  };
  return { llm: llm as unknown as AdvisorLLM, calls };
}

// ---- Capa 1 · computeFloor ---------------------------------------------------

describe('computeFloor', () => {
  const casos: Array<[string, TriageInputs, 1 | 2 | 3, boolean]> = [
    ['sin reglas activas', inp(), 1, false],
    ['índice 0.39 descriptiva: nada se activa', conTipo('descriptiva', { indiceHoy: 0.39 }), 1, false],
    ['índice 0.40 descriptiva: piso 2', conTipo('descriptiva', { indiceHoy: 0.4 }), 2, false],
    ['índice 0.40 decisión: piso 3', conTipo('decision', { indiceHoy: 0.4 }), 3, false],
    ['índice 0.40 redacción: piso 2', conTipo('redaccion', { indiceHoy: 0.4 }), 2, false],
    ['índice 0.40 revisión de borrador: piso 2', conTipo('revision_borrador', { indiceHoy: 0.4 }), 2, false],
    ['índice 0.59 redacción: piso 2 (aún ALERTA)', conTipo('redaccion', { indiceHoy: 0.59 }), 2, false],
    ['índice 0.60 descriptiva: piso 2', conTipo('descriptiva', { indiceHoy: 0.6 }), 2, false],
    ['índice 0.60 decisión: piso 3', conTipo('decision', { indiceHoy: 0.6 }), 3, false],
    ['índice 0.60 redacción: piso 3', conTipo('redaccion', { indiceHoy: 0.6 }), 3, false],
    ['índice 0.60 revisión de borrador: piso 3 (agrupada con redacción)', conTipo('revision_borrador', { indiceHoy: 0.6 }), 3, false],
    ['índice 0.95 descriptiva: piso 2', conTipo('descriptiva', { indiceHoy: 0.95 }), 2, false],
    ['sin clasificación, índice 0.30: sin regla de índice', inp({ indiceHoy: 0.3 }), 1, false],
    ['sin clasificación, índice 0.40: peor caso (decisión) → piso 3', inp({ indiceHoy: 0.4 }), 3, false],
    ['sin clasificación, índice 0.80: peor caso → piso 3', inp({ indiceHoy: 0.8 }), 3, false],
    ['alerta sola: 1 → 2', inp({ alertasUltimas12h: 1 }), 2, false],
    ['dos alertas: +1 una sola vez (1 → 2, no 3)', inp({ alertasUltimas12h: 2 }), 2, false],
    ['cinco alertas: sigue en +1 (1 → 2)', inp({ alertasUltimas12h: 5 }), 2, false],
    ['alerta sobre piso 2: 3', conTipo('descriptiva', { indiceHoy: 0.4, alertasUltimas12h: 1 }), 3, false],
    ['alerta sobre piso 3: tope en 3', conTipo('decision', { indiceHoy: 0.6, alertasUltimas12h: 1 }), 3, false],
    ['riesgo a personas: piso 2', inp({ riesgoPersonas: true }), 2, false],
    ['riesgo sobre piso 3: se queda en 3', conTipo('decision', { indiceHoy: 0.6, riesgoPersonas: true }), 3, false],
    ['veda + redacción: 1 → 2 y legal', conTipo('redaccion', { vedaActiva: true }), 2, true],
    ['veda + decisión: 1 → 2 y legal', conTipo('decision', { vedaActiva: true }), 2, true],
    ['veda + revisión de borrador: 1 → 2 y legal', conTipo('revision_borrador', { vedaActiva: true }), 2, true],
    ['veda + descriptiva: sin efecto ni legal', conTipo('descriptiva', { vedaActiva: true }), 1, false],
    ['veda + redacción + alerta: 3 (tope) y legal', conTipo('redaccion', { vedaActiva: true, alertasUltimas12h: 1 }), 3, true],
    ['veda + decisión sobre CRISIS: tope 3 y legal', conTipo('decision', { vedaActiva: true, indiceHoy: 0.6 }), 3, true],
    ['sin clasificación + veda: peor caso → 2 y legal', inp({ vedaActiva: true }), 2, true],
    ['guía G-3: piso 3', inp({ guiaProbable: 'G-3' }), 3, false],
    ['guía G-4: piso 3', inp({ guiaProbable: 'G-4' }), 3, false],
    ['guía G-11: piso 3', inp({ guiaProbable: 'G-11' }), 3, false],
    ['guía G-3 con descriptiva: piso 3', conTipo('descriptiva', { guiaProbable: 'G-3' }), 3, false],
    ['guía G-6 con descriptiva: piso 2', conTipo('descriptiva', { guiaProbable: 'G-6' }), 2, false],
    ['guía G-6 con redacción: piso 3', conTipo('redaccion', { guiaProbable: 'G-6' }), 3, false],
    ['guía G-6 con decisión: piso 3', conTipo('decision', { guiaProbable: 'G-6' }), 3, false],
    ['guía G-6 sin clasificación: peor caso, piso 3', inp({ guiaProbable: 'G-6' }), 3, false],
    ['paracrisis con índice bajo: piso 2', inp({ indiceHoy: 0.1, clasificacion: clas({ situacion: 'paracrisis' }) }), 2, false],
    ['situación crisis sin paracrisis: sin efecto', inp({ indiceHoy: 0.1, clasificacion: clas({ situacion: 'crisis' }) }), 1, false],
    ['guía G-12: sin efecto', inp({ guiaProbable: 'G-12' }), 1, false],
  ];

  it.each(casos)('%s', (_nombre, entrada, pisoEsperado, legalEsperado) => {
    const r = computeFloor(entrada);
    expect(r.piso).toBe(pisoEsperado);
    expect(r.legalObligatorio).toBe(legalEsperado);
  });

  it('sin reglas activas no deja motivos', () => {
    expect(computeFloor(inp()).motivos).toEqual([]);
  });

  it('cada regla que se cumple deja su motivo en español', () => {
    const r = computeFloor(
      conTipo('decision', { indiceHoy: 0.6, alertasUltimas12h: 1, riesgoPersonas: true, vedaActiva: true, guiaProbable: 'G-3' }),
    );
    expect(r.piso).toBe(3);
    const texto = r.motivos.join(' | ');
    expect(texto).toMatch(/Índice de crisis ≥ 0\.40/);
    expect(texto).toMatch(/Índice ≥ 0\.60/);
    expect(texto).toMatch(/Alerta de crisis/);
    expect(texto).toMatch(/Personas en riesgo/);
    expect(texto).toMatch(/Veda activa/);
    expect(texto).toMatch(/Guía probable G-3/);
  });
});

// ---- Capa 3 · decideCamino ---------------------------------------------------

describe('decideCamino', () => {
  it('sin override: camino = max(piso, camino_sugerido)', () => {
    expect(decideCamino({ piso: 2, clasificacion: clas({ camino_sugerido: 1 }), override: null }).camino).toBe(2);
    expect(decideCamino({ piso: 1, clasificacion: clas({ camino_sugerido: 3 }), override: null }).camino).toBe(3);
    expect(decideCamino({ piso: 2, clasificacion: clas({ camino_sugerido: 3 }), override: null }).camino).toBe(3);
  });

  it('override council fuerza 3 aunque el piso y la sugerencia sean 1', () => {
    const r = decideCamino({ piso: 1, clasificacion: clas({ camino_sugerido: 1 }), override: 'council' });
    expect(r.camino).toBe(3);
    expect(r.override).toBe('council');
  });

  it('override council también aplica sin clasificación', () => {
    expect(decideCamino({ piso: 1, clasificacion: null, override: 'council' }).camino).toBe(3);
  });

  it('override quick = max(piso, 1): ignora la sugerencia del clasificador', () => {
    expect(decideCamino({ piso: 1, clasificacion: clas({ camino_sugerido: 3 }), override: 'quick' }).camino).toBe(1);
    expect(decideCamino({ piso: 2, clasificacion: clas({ camino_sugerido: 1 }), override: 'quick' }).camino).toBe(2);
    expect(decideCamino({ piso: 3, clasificacion: null, override: 'quick' }).camino).toBe(3);
  });

  it('sin clasificación: camino = piso y el motivo lo dice', () => {
    const r = decideCamino({ piso: 2, clasificacion: null, override: null, motivosPiso: ['Índice de crisis ≥ 0.40 (ALERTA): piso 2'] });
    expect(r.camino).toBe(2);
    expect(r.piso).toBe(2);
    expect(r.clasificacion).toBeNull();
    expect(r.motivo).toMatch(/Clasificador no disponible/);
    expect(r.motivo).toMatch(/ALERTA/);
  });

  it('el motivo combina los motivos del piso y el del clasificador', () => {
    const r = decideCamino({
      piso: 3,
      clasificacion: clas({ camino_sugerido: 2, motivo: 'Pide texto para prensa.' }),
      override: null,
      motivosPiso: ['Guía probable G-3 (integridad, renuncia o menor): piso 3'],
    });
    expect(r.motivo).toMatch(/Guía probable G-3/);
    expect(r.motivo).toMatch(/Pide texto para prensa\./);
  });

  it('pasa legalObligatorio y clasificación tal cual', () => {
    const c = clas({ camino_sugerido: 2 });
    const r = decideCamino({ piso: 2, clasificacion: c, override: null, legalObligatorio: true });
    expect(r.legalObligatorio).toBe(true);
    expect(r.clasificacion).toBe(c);
  });
});

// ---- Capa 2 · classify -------------------------------------------------------

const VALIDA = {
  tipo_pregunta: 'decision',
  reversible: false,
  quien_da_la_cara: 'secretario',
  presion_tiempo: 'horas',
  riesgo_personas: false,
  situacion: 'crisis',
  guia_probable: 'G-4',
  camino_sugerido: 3,
  motivo: 'Renuncia con carta pública.',
};

describe('classify', () => {
  const PREGUNTA = 'PREGUNTA_SECRETA_DE_PRUEBA ¿Respondemos a la carta de renuncia?';
  const CONTEXTO = contextoTexto({
    indiceHoy: 0.7,
    alertasUltimas12h: 1,
    riesgoPersonas: false,
    vedaActiva: false,
    guiaProbable: null,
  });

  it('respuesta válida: devuelve la clasificación y llama una sola vez con el contrato de triaje', async () => {
    const { llm, calls } = fakeLLM([VALIDA]);
    const r = await classify(llm, PREGUNTA, CONTEXTO);
    expect(r).toEqual(VALIDA);
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req.model).toBe(advisorModelId('FAST'));
    expect(req.effort).toBe('low');
    expect(req.maxTokens).toBe(1000);
    expect(req.outputSchema).toEqual(CLASIFICACION_SCHEMA);
    expect(req.tools).toBeUndefined();
    expect('temperature' in req).toBe(false);
  });

  it('la pregunta viaja solo en el turno de usuario, nunca en el sistema', async () => {
    const { llm, calls } = fakeLLM([VALIDA]);
    await classify(llm, PREGUNTA, CONTEXTO);
    const sistema = (calls[0].system ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    expect(sistema).not.toContain('PREGUNTA_SECRETA_DE_PRUEBA');
    const usuario = calls[0].messages[0].content as string;
    expect(usuario).toContain('PREGUNTA_SECRETA_DE_PRUEBA');
    expect(usuario.startsWith(CONTEXTO)).toBe(true);
  });

  it('JSON inválido dos veces: null tras dos intentos', async () => {
    const { llm, calls } = fakeLLM(['esto no es json', 'tampoco']);
    expect(await classify(llm, PREGUNTA, CONTEXTO)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('enum inválido dos veces: se reintenta y devuelve null', async () => {
    const malo = { ...VALIDA, tipo_pregunta: 'opinion' };
    const { llm, calls } = fakeLLM([malo, malo]);
    expect(await classify(llm, PREGUNTA, CONTEXTO)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('enum inválido y luego válido: el reintento gana', async () => {
    const malo = { ...VALIDA, camino_sugerido: 4 };
    const { llm, calls } = fakeLLM([malo, VALIDA]);
    expect(await classify(llm, PREGUNTA, CONTEXTO)).toEqual(VALIDA);
    expect(calls).toHaveLength(2);
  });

  it('salida interrumpida (max_tokens) cuenta como fallo y se reintenta', async () => {
    const { llm, calls } = fakeLLM([{ stop: 'max_tokens' }, VALIDA]);
    expect(await classify(llm, PREGUNTA, CONTEXTO)).toEqual(VALIDA);
    expect(calls).toHaveLength(2);
  });

  it('error de red en ambos intentos: null, sin propagar', async () => {
    const { llm, calls } = fakeLLM([new Error('timeout'), new Error('timeout')]);
    expect(await classify(llm, PREGUNTA, CONTEXTO)).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe('validateClasificacion', () => {
  it('acepta exactamente el esquema', () => {
    expect(validateClasificacion(VALIDA)).toEqual(VALIDA);
  });

  it.each([
    ['clave extra', { ...VALIDA, extra: 1 }],
    ['clave faltante', (() => { const { motivo, ...r } = VALIDA; return r; })()],
    ['booleano como texto', { ...VALIDA, reversible: 'si' }],
    ['camino 0', { ...VALIDA, camino_sugerido: 0 }],
    ['camino como texto', { ...VALIDA, camino_sugerido: '2' }],
    ['arreglo en vez de objeto', []],
    ['null', null],
  ])('rechaza %s', (_n, raw) => {
    expect(validateClasificacion(raw)).toBeNull();
  });

  it('motivo de exactamente 200 caracteres es válido', () => {
    expect(validateClasificacion({ ...VALIDA, motivo: 'x'.repeat(200) })).not.toBeNull();
  });

  it('motivo de más de 200 caracteres se recorta y la clasificación se acepta', () => {
    const r = validateClasificacion({ ...VALIDA, motivo: 'x'.repeat(250) });
    expect(r).not.toBeNull();
    expect(r?.motivo.length).toBe(200);
  });
});

// ---- Orquestador -------------------------------------------------------------

describe('triage (orquestador)', () => {
  it('índice 0.65 con respuesta descriptiva del clasificador: el piso sube el camino a 2', async () => {
    const { llm, calls } = fakeLLM([clas({ tipo_pregunta: 'descriptiva', camino_sugerido: 1, motivo: 'Dato.', guia_probable: 'ninguna' })]);
    const d = await triage({
      llm,
      question: '¿Cuántas menciones hay?',
      inputs: { indiceHoy: 0.65, alertasUltimas12h: 0, riesgoPersonas: false, vedaActiva: false, guiaProbable: null },
      override: null,
    });
    expect(d.piso).toBe(2);
    expect(d.camino).toBe(2);
  });

  it('clasificador caído: camino = piso', async () => {
    const { llm } = fakeLLM([new Error('down')]);
    const d = await triage({
      llm,
      question: '¿Qué decimos?',
      inputs: { indiceHoy: 0.45, alertasUltimas12h: 0, riesgoPersonas: false, vedaActiva: false, guiaProbable: null },
      override: null,
    });
    expect(d.clasificacion).toBeNull();
    expect(d.camino).toBe(d.piso);
    expect(d.piso).toBe(3); // peor caso sin clasificación: índice ≥ 0.40 con decisión supuesta
  });

  it('la guía que sugiere el clasificador (G-3) fija piso 3 aunque el caller no la envíe', async () => {
    const { llm } = fakeLLM([{ ...VALIDA, tipo_pregunta: 'descriptiva', camino_sugerido: 1, guia_probable: 'G-3' }]);
    const d = await triage({
      llm,
      question: 'pregunta',
      inputs: { indiceHoy: null, alertasUltimas12h: 0, riesgoPersonas: false, vedaActiva: false, guiaProbable: null },
      override: null,
    });
    expect(d.piso).toBe(3);
    expect(d.camino).toBe(3);
  });

  it('override council se respeta tras el clasificador', async () => {
    const { llm } = fakeLLM([clas()]);
    const d = await triage({
      llm,
      question: 'pregunta',
      inputs: { indiceHoy: null, alertasUltimas12h: 0, riesgoPersonas: false, vedaActiva: false, guiaProbable: null },
      override: 'council',
    });
    expect(d.camino).toBe(3);
    expect(d.override).toBe('council');
  });
});

// ---- Integridad del set de triaje -------------------------------------------

interface SetItem {
  id: string;
  tipo: string;
  variante: string;
  pregunta: string;
  contexto: {
    indiceHoy: number | null;
    alertasUltimas12h: number;
    riesgoPersonas: boolean;
    vedaActiva: boolean;
    guiaProbable: string | null;
  };
  caminoMinimo: 1 | 2 | 3;
  reglaBase: boolean;
}

const SET: SetItem[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'triage-set', 'set.json'), 'utf8'));

describe('triage-set/set.json', () => {
  it('tiene entre 100 y 200 preguntas', () => {
    expect(SET.length).toBeGreaterThanOrEqual(100);
    expect(SET.length).toBeLessThanOrEqual(200);
  });

  it('los ids son únicos', () => {
    expect(new Set(SET.map((x) => x.id)).size).toBe(SET.length);
  });

  it('caminoMinimo ∈ {1,2,3} y reglaBase es booleano', () => {
    for (const x of SET) {
      expect([1, 2, 3]).toContain(x.caminoMinimo);
      expect(typeof x.reglaBase).toBe('boolean');
    }
  });

  it('reglaBase solo se marca en caminos 2 o 3 (un 1 no necesita regla)', () => {
    for (const x of SET) {
      if (x.reglaBase) expect(x.caminoMinimo).toBeGreaterThanOrEqual(2);
    }
  });

  it('cada contexto tiene las claves requeridas con su tipo', () => {
    for (const x of SET) {
      const c = x.contexto;
      expect(c).toBeDefined();
      expect(c.indiceHoy === null || typeof c.indiceHoy === 'number').toBe(true);
      expect(typeof c.alertasUltimas12h).toBe('number');
      expect(typeof c.riesgoPersonas).toBe('boolean');
      expect(typeof c.vedaActiva).toBe('boolean');
      expect(c.guiaProbable === null || typeof c.guiaProbable === 'string').toBe(true);
    }
  });

  it('cada pregunta es texto no vacío', () => {
    for (const x of SET) expect(x.pregunta.trim().length).toBeGreaterThan(0);
  });
});

describe('subestimación con reglas solas (CI, sin LLM)', () => {
  it('para cada ítem con reglaBase, el piso con clasificación null alcanza caminoMinimo', () => {
    const fallos: string[] = [];
    const reglaBase = SET.filter((x) => x.reglaBase);
    for (const x of reglaBase) {
      const piso = computeFloor({ ...x.contexto, clasificacion: null }).piso;
      if (piso < x.caminoMinimo) fallos.push(`${x.id}: piso ${piso} < gold ${x.caminoMinimo}`);
    }
    // Los ítems con reglaBase son los que exigen camino por una regla (no por el contenido).
    expect(reglaBase.length).toBeGreaterThan(0);
    expect(fallos).toEqual([]);
  });
});

describe('prompt del clasificador: positivos y paracrisis (spec §8.1)', () => {
  it('un texto positivo para publicar sin controversia va a camino 1 y no cuenta como duda', () => {
    const l = TRIAGE_SYSTEM.split('\n');
    const c1 = l.find((x) => x.startsWith('- 1 = '))!;
    expect(c1).toContain('texto positivo para publicar');
    expect(c1).toMatch(/agradecimiento, felicitación/);
    expect(c1).toMatch(/no responde a ninguna crítica, rumor ni polémica/);
    expect(c1).toMatch(/no cuenta como duda/);
  });

  it('el positivo que responde a una controversia, se disculpa o corrige va a camino 2', () => {
    const c2 = TRIAGE_SYSTEM.split('\n').find((x) => x.startsWith('- 2 = '))!;
    expect(c2).toMatch(/agradecimiento o una felicitación que responde a una crítica/);
    expect(c2).toMatch(/disculpa o corrige un error/);
    expect(c2).toContain('camino 2');
  });

  it('el campo paracrisis cubre preguntar si crece o si tiene prensa, pero no el conteo de quejas aisladas', () => {
    const sit = TRIAGE_SYSTEM.split('\n').find((x) => x.startsWith('Escala de situacion'))!;
    expect(sit).toMatch(/si crece, si va en aumento, si ya tiene prensa o si va a explotar/);
    expect(sit).toMatch(/Una queja aislada, sin eco, no es paracrisis/);
    expect(sit).toMatch(/solo pide el contenido o el conteo/);
  });

  it('el prompt alinea la veda con el piso de la spec: redacción o decisión en veda es camino 2, no 3', () => {
    const l1 = TRIAGE_SYSTEM.split('\n');
    const c2 = l1.find((x) => x.startsWith('- 2 ='))!;
    const c3 = l1.find((x) => x.startsWith('- 3 ='))!;
    expect(c2).toMatch(/veda electoral activa, redactar, revisar o decidir algo para publicar también es camino 2/);
    expect(c2).toMatch(/sube a 3 solo si además hay alerta reciente/);
    expect(c3).not.toMatch(/veda/);
    // y el piso por código coincide: +1 sobre 1 = 2, con asiento legal; con alerta reciente llega a 3
    const solo = computeFloor(inp({ vedaActiva: true, clasificacion: clas({ tipo_pregunta: 'decision', camino_sugerido: 2 }) }));
    expect([solo.piso, solo.legalObligatorio]).toEqual([2, true]);
    const alerta = computeFloor(
      inp({ vedaActiva: true, alertasUltimas12h: 1, clasificacion: clas({ tipo_pregunta: 'decision', camino_sugerido: 2 }) }),
    );
    expect(alerta.piso).toBe(3);
  });

  it('quién firma, quién da la cara o cuándo enviar, sin controversia, es camino 2 (spec §8.1)', () => {
    const l = TRIAGE_SYSTEM.split('\n');
    const c1 = l.find((x) => x.startsWith('- 1 ='))!;
    const c2 = l.find((x) => x.startsWith('- 2 ='))!;
    expect(c2).toMatch(/decisión sobre quién da la cara, quién firma o habla en nombre de la agencia, o cuándo enviar o publicar/);
    expect(c2).toMatch(/aunque no haya controversia ni alerta/);
    // la excepción de los positivos no se come la regla de vocería ni de momento
    expect(c1).toMatch(/no alcanza a las decisiones de vocería ni de momento de publicación: esas son camino 2/);
    // el camino 1 sigue siendo solo para lo descriptivo y los positivos
    expect(c1).not.toMatch(/quién firma|cuándo enviar/);
  });

  it('los pisos por reglas no cambian con los positivos: veda con redacción sube a 2', () => {
    const f = computeFloor(
      inp({ indiceHoy: 0.1, vedaActiva: true, clasificacion: clas({ tipo_pregunta: 'redaccion', camino_sugerido: 1 }) }),
    );
    expect(f.piso).toBe(2);
    expect(f.legalObligatorio).toBe(true);
  });
});

describe('triage-set/holdout-7.json', () => {
  interface H7 { id: string; tipo: string; variante: string; pregunta: string; contexto: TriageInputs; caminoMinimo: 1 | 2 | 3; reglaBase: boolean }
  const dir = path.join(__dirname, 'triage-set');
  const H7: H7[] = JSON.parse(fs.readFileSync(path.join(dir, 'holdout-7.json'), 'utf8'));
  const toks = (t: string) => new Set(t.toLowerCase().match(/\p{L}[\p{L}\p{N}]*|\p{N}+/gu) ?? []);
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    return n / (a.size + b.size - n);
  };

  it('tiene al menos 183 casos, ids únicos y mezcla de los tres caminos', () => {
    expect(H7.length).toBeGreaterThanOrEqual(183);
    expect(new Set(H7.map((x) => x.id)).size).toBe(H7.length);
    for (const c of [1, 2, 3]) expect(H7.filter((x) => x.caminoMinimo === c).length).toBeGreaterThanOrEqual(40);
  });

  it('ninguna etiqueta queda por debajo del piso por reglas con su propio tipo', () => {
    const bajo = H7.filter(
      (x) =>
        computeFloor({ ...x.contexto, clasificacion: clas({ tipo_pregunta: x.tipo as TipoPregunta }) }).piso > x.caminoMinimo,
    ).map((x) => x.id);
    expect(bajo).toEqual([]);
  });

  it('sin casi copias (similitud de tokens < 0,5) con los demás sets ni entre sí', () => {
    const otros = fs
      .readdirSync(dir)
      .filter((f) => /^(set|holdout(-[2-6])?)\.json$/.test(f))
      .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { pregunta: string }[])
      .map((x) => toks(x.pregunta));
    const propios = H7.map((x) => toks(x.pregunta));
    const malos: string[] = [];
    propios.forEach((t, i) => {
      if (otros.some((o) => jaccard(t, o) >= 0.5)) malos.push(`${H7[i].id} (otro set)`);
      for (let j = 0; j < i; j++) if (jaccard(t, propios[j]) >= 0.5) malos.push(`${H7[i].id} ~ ${H7[j].id}`);
    });
    expect(malos).toEqual([]);
  });
});

describe('triage-set/holdout-8.json', () => {
  interface H8 { id: string; tipo: string; pregunta: string; contexto: TriageInputs; caminoMinimo: 1 | 2 | 3 }
  const dir = path.join(__dirname, 'triage-set');
  const H8: H8[] = JSON.parse(fs.readFileSync(path.join(dir, 'holdout-8.json'), 'utf8'));
  const toks = (t: string) => new Set(t.toLowerCase().match(/\p{L}[\p{L}\p{N}]*|\p{N}+/gu) ?? []);
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    return n / (a.size + b.size - n);
  };

  it('tiene al menos 200 casos, ids únicos y mezcla de los tres caminos', () => {
    expect(H8.length).toBeGreaterThanOrEqual(200);
    expect(new Set(H8.map((x) => x.id)).size).toBe(H8.length);
    for (const c of [1, 2, 3]) expect(H8.filter((x) => x.caminoMinimo === c).length).toBeGreaterThanOrEqual(25);
  });

  it('ninguna etiqueta queda por debajo del piso por reglas con su propio tipo', () => {
    const bajo = H8.filter(
      (x) =>
        computeFloor({ ...x.contexto, clasificacion: clas({ tipo_pregunta: x.tipo as TipoPregunta }) }).piso > x.caminoMinimo,
    ).map((x) => x.id);
    expect(bajo).toEqual([]);
  });

  it('sin casi copias (similitud de tokens < 0,5) con holdout-1 a -7, el set ni entre sí', () => {
    const otros = fs
      .readdirSync(dir)
      .filter((f) => /^(set|holdout(-[2-7])?)\.json$/.test(f))
      .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { pregunta: string }[])
      .map((x) => toks(x.pregunta));
    const propios = H8.map((x) => toks(x.pregunta));
    const malos: string[] = [];
    propios.forEach((t, i) => {
      if (otros.some((o) => jaccard(t, o) >= 0.5)) malos.push(`${H8[i].id} (otro set)`);
      for (let j = 0; j < i; j++) if (jaccard(t, propios[j]) >= 0.5) malos.push(`${H8[i].id} ~ ${H8[j].id}`);
    });
    expect(malos).toEqual([]);
  });
});
