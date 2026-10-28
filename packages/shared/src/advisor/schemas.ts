// Esquemas de salida estructurada del asesor (spec §5.2 regla 2, §8.6). Fase 0 solo define
// el del revisor. Las salidas de triaje, asientos y memorando llegan con las fases 1 y 2.
// Structured outputs / herramientas estrictas: nunca tool_choice forzado.

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    puntos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          ok: { type: 'boolean' },
          nota: { type: 'string' },
        },
        required: ['id', 'ok', 'nota'],
        additionalProperties: false,
      },
    },
    titular_peor: { type: 'string' },
  },
  required: ['puntos', 'titular_peor'],
  additionalProperties: false,
} as const;

export interface ReviewOutput {
  puntos: Array<{ id: number; ok: boolean; nota: string }>;
  titular_peor: string;
}

/**
 * Valida la salida del revisor contra REVIEW_SCHEMA. Devuelve null si no cumple.
 * Tool-use no valida tipos (memoria: coerceBulletList): los campos llegan normalizados aquí.
 */
export function parseReviewOutput(raw: unknown): ReviewOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.puntos) || typeof r.titular_peor !== 'string') return null;
  const puntos: ReviewOutput['puntos'] = [];
  for (const p of r.puntos) {
    if (!p || typeof p !== 'object') return null;
    const q = p as Record<string, unknown>;
    if (typeof q.id !== 'number' || !Number.isInteger(q.id) || typeof q.ok !== 'boolean' || typeof q.nota !== 'string') {
      return null;
    }
    puntos.push({ id: q.id, ok: q.ok, nota: q.nota });
  }
  return { puntos, titular_peor: r.titular_peor };
}

// ---- Panel (camino 2) · spec §8.5, §8.6 -----------------------------------------
// Los esquemas sirven de `outputSchema` (structured outputs). Como el servicio no valida
// todos los tipos, cada respuesta pasa también por un validador en código.

const str = { type: 'string' } as const;
const strArr = { type: 'array', items: str } as const;

export const POSITION_SCHEMA = {
  type: 'object',
  properties: {
    nombre: str,
    accion: str,
    quien: str,
    canal: str,
    cuando: str,
    mecanismo: str,
    efectos_esperados: {
      type: 'array',
      items: {
        type: 'object',
        properties: { metrica: str, horizonte_h: { type: 'integer' }, rango_min: { type: 'number' }, rango_max: { type: 'number' } },
        required: ['metrica', 'horizonte_h', 'rango_min', 'rango_max'],
        additionalProperties: false,
      },
    },
    supuestos: strArr,
    citas: strArr,
    que_me_haria_cambiar: str,
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
    vetos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { texto: str, estado: { type: 'string', enum: ['sin_resolver', 'resuelto'] } },
        required: ['texto', 'estado'],
        additionalProperties: false,
      },
    },
  },
  required: ['nombre', 'accion', 'quien', 'canal', 'cuando', 'mecanismo', 'efectos_esperados', 'supuestos', 'citas', 'que_me_haria_cambiar', 'confianza', 'vetos'],
  additionalProperties: false,
} as const;

export const FACT_SHEET_SCHEMA = {
  type: 'object',
  properties: {
    pregunta_normalizada: str,
    preferencia_usuario: { type: ['string', 'null'] },
    sabido: { type: 'array', items: { type: 'object', properties: { afirmacion: str, citas: strArr }, required: ['afirmacion', 'citas'], additionalProperties: false } },
    no_claro: { type: 'array', items: { type: 'object', properties: { pregunta: str, que_lo_aclararia: str, cuando: str }, required: ['pregunta', 'que_lo_aclararia', 'cuando'], additionalProperties: false } },
    supuesto: { type: 'array', items: { type: 'object', properties: { afirmacion: str }, required: ['afirmacion'], additionalProperties: false } },
    caso_peor: { type: 'object', properties: { descripcion: str, citas: strArr }, required: ['descripcion', 'citas'], additionalProperties: false },
    linea_base: { type: 'object', properties: { descripcion: str, rango_indice_72h: { type: ['string', 'null'] } }, required: ['descripcion', 'rango_indice_72h'], additionalProperties: false },
    puntos_ciegos: strArr,
  },
  required: ['pregunta_normalizada', 'preferencia_usuario', 'sabido', 'no_claro', 'supuesto', 'caso_peor', 'linea_base', 'puntos_ciegos'],
  additionalProperties: false,
} as const;

export const PREMORTEM_SCHEMA = {
  type: 'object',
  properties: {
    premortems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          camino: { type: 'integer' },
          objeciones: {
            type: 'array',
            items: {
              type: 'object',
              properties: { relato_72h: str, senal_temprana: str, supuesto_fragil: str },
              required: ['relato_72h', 'senal_temprana', 'supuesto_fragil'],
              additionalProperties: false,
            },
          },
          concede: strArr,
          que_me_haria_ceder: str,
        },
        required: ['camino', 'objeciones', 'concede', 'que_me_haria_ceder'],
        additionalProperties: false,
      },
    },
  },
  required: ['premortems'],
  additionalProperties: false,
} as const;

export const MEMO_SCHEMA = {
  type: 'object',
  properties: {
    encabezado: { type: 'object', properties: { agencia: str, fecha: str, camino: str, motivo: str }, required: ['agencia', 'fecha', 'camino', 'motivo'], additionalProperties: false },
    hechos: {
      type: 'object',
      properties: {
        sabido: { type: 'array', items: { type: 'object', properties: { afirmacion: str, citas: strArr }, required: ['afirmacion', 'citas'], additionalProperties: false } },
        no_claro: { type: 'array', items: { type: 'object', properties: { pregunta: str, que_lo_aclararia: str, cuando: str }, required: ['pregunta', 'que_lo_aclararia', 'cuando'], additionalProperties: false } },
        supuesto: { type: 'array', items: { type: 'object', properties: { afirmacion: str }, required: ['afirmacion'], additionalProperties: false } },
      },
      required: ['sabido', 'no_claro', 'supuesto'],
      additionalProperties: false,
    },
    linea_base: { type: 'object', properties: { descripcion: str, rango_indice_72h: { type: ['string', 'null'] } }, required: ['descripcion', 'rango_indice_72h'], additionalProperties: false },
    caminos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nombre: str, que: str, quien: str, canal: str, cuando: str, por_que: str,
          reglas: strArr, efectos: strArr, riesgos: strArr, supuestos: strArr, apoyos: strArr,
        },
        required: ['nombre', 'que', 'quien', 'canal', 'cuando', 'por_que', 'reglas', 'efectos', 'riesgos', 'supuestos', 'apoyos'],
        additionalProperties: false,
      },
    },
    sin_camino_b_porque: { type: ['string', 'null'] },
    senales: {
      type: 'object',
      properties: {
        h24: { type: 'object', properties: { va_bien_si: str, va_mal_si: str }, required: ['va_bien_si', 'va_mal_si'], additionalProperties: false },
        h48: { type: 'object', properties: { va_bien_si: str, va_mal_si: str }, required: ['va_bien_si', 'va_mal_si'], additionalProperties: false },
        h72: { type: 'object', properties: { va_bien_si: str, va_mal_si: str }, required: ['va_bien_si', 'va_mal_si'], additionalProperties: false },
        cambiar_si: strArr,
      },
      required: ['h24', 'h48', 'h72', 'cambiar_si'],
      additionalProperties: false,
    },
    recomendacion: { type: 'object', properties: { camino: { type: 'integer' }, confianza_cualitativa: { type: 'string', enum: ['alta', 'media', 'baja'] }, porque: str }, required: ['camino', 'confianza_cualitativa', 'porque'], additionalProperties: false },
    disenso: strArr,
    objeciones_da: {
      type: 'array',
      items: { type: 'object', properties: { id: str, texto: str, estado: { type: 'string', enum: ['resuelta', 'mitigada', 'aceptada'] }, como: str }, required: ['id', 'texto', 'estado', 'como'], additionalProperties: false },
    },
    vetos: { type: 'array', items: { type: 'object', properties: { asiento: str, texto: str, estado: { type: 'string', enum: ['sin_resolver', 'resuelto'] } }, required: ['asiento', 'texto', 'estado'], additionalProperties: false } },
    borradores: { type: 'array', items: { type: 'object', properties: { tipo_plantilla: str, canal: str, texto: str }, required: ['tipo_plantilla', 'canal', 'texto'], additionalProperties: false } },
    limites: strArr,
  },
  required: ['encabezado', 'hechos', 'linea_base', 'caminos', 'sin_camino_b_porque', 'senales', 'recomendacion', 'disenso', 'objeciones_da', 'vetos', 'borradores', 'limites'],
  additionalProperties: false,
} as const;

// ---- Validadores en código ------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validatePosition(x: unknown): Obj | null {
  if (!isObj(x)) return null;
  const ok =
    isStr(x.nombre) && isStr(x.accion) && isStr(x.quien) && isStr(x.canal) && isStr(x.cuando) && isStr(x.mecanismo) &&
    Array.isArray(x.efectos_esperados) && x.efectos_esperados.every((e) => isObj(e) && isStr(e.metrica) && isNum(e.horizonte_h) && isNum(e.rango_min) && isNum(e.rango_max)) &&
    isStrArr(x.supuestos) && isStrArr(x.citas) && x.citas.length >= 1 && isStr(x.que_me_haria_cambiar) &&
    ['alta', 'media', 'baja'].includes(x.confianza as string) &&
    Array.isArray(x.vetos) && x.vetos.every((v) => isObj(v) && isStr(v.texto) && ['sin_resolver', 'resuelto'].includes(v.estado as string));
  return ok ? x : null;
}

export function validateFactSheet(x: unknown): Obj | null {
  if (!isObj(x)) return null;
  const ok =
    isStr(x.pregunta_normalizada) &&
    (x.preferencia_usuario === null || isStr(x.preferencia_usuario)) &&
    Array.isArray(x.sabido) && x.sabido.every((s) => isObj(s) && isStr(s.afirmacion) && isStrArr(s.citas)) &&
    Array.isArray(x.no_claro) && x.no_claro.every((s) => isObj(s) && isStr(s.pregunta) && isStr(s.que_lo_aclararia) && isStr(s.cuando)) &&
    Array.isArray(x.supuesto) && x.supuesto.every((s) => isObj(s) && isStr(s.afirmacion)) &&
    isObj(x.caso_peor) && isStr(x.caso_peor.descripcion) && isStrArr(x.caso_peor.citas) &&
    isObj(x.linea_base) && isStr(x.linea_base.descripcion) &&
    isStrArr(x.puntos_ciegos);
  return ok ? x : null;
}

export function validatePremortems(x: unknown): Obj | null {
  if (!isObj(x) || !Array.isArray(x.premortems)) return null;
  const ok = x.premortems.every(
    (p) => isObj(p) && isNum(p.camino) && Array.isArray(p.objeciones) && p.objeciones.every((o) => isObj(o) && isStr(o.relato_72h) && isStr(o.senal_temprana) && isStr(o.supuesto_fragil)) && isStrArr(p.concede) && isStr(p.que_me_haria_ceder),
  );
  return ok ? x : null;
}

/**
 * Memorando (§8.6). Valida forma y tipos de cada sección que la interfaz necesita.
 * Devuelve null si algo no cumple: el caller reintenta una vez.
 */
export function validateMemo(x: unknown): Obj | null {
  if (!isObj(x)) return null;
  const e = x.encabezado, h = x.hechos, lb = x.linea_base, s = x.senales, r = x.recomendacion;
  if (!isObj(e) || !isStr(e.agencia) || !isStr(e.fecha) || !isStr(e.camino) || !isStr(e.motivo)) return null;
  if (!isObj(h) || !Array.isArray(h.sabido) || !Array.isArray(h.no_claro) || !Array.isArray(h.supuesto)) return null;
  if (!isObj(lb) || !isStr(lb.descripcion)) return null;
  if (!Array.isArray(x.caminos) || !x.caminos.every((c) => isObj(c) && isStr(c.nombre) && isStr(c.que) && isStr(c.quien) && isStr(c.canal) && isStr(c.cuando) && isStr(c.por_que) && isStrArr(c.reglas) && isStrArr(c.efectos) && isStrArr(c.riesgos) && isStrArr(c.supuestos) && isStrArr(c.apoyos))) return null;
  if (!isObj(s) || !isStrArr(s.cambiar_si)) return null;
  for (const k of ['h24', 'h48', 'h72'] as const) {
    const v = s[k];
    if (!isObj(v) || !isStr(v.va_bien_si) || !isStr(v.va_mal_si)) return null;
  }
  if (!isObj(r) || !isNum(r.camino) || !['alta', 'media', 'baja'].includes(r.confianza_cualitativa as string) || !isStr(r.porque)) return null;
  if (!isStrArr(x.disenso)) return null;
  if (!Array.isArray(x.objeciones_da) || !x.objeciones_da.every((o) => isObj(o) && isStr(o.id) && isStr(o.texto) && ['resuelta', 'mitigada', 'aceptada'].includes(o.estado as string) && isStr(o.como))) return null;
  if (!Array.isArray(x.vetos) || !x.vetos.every((v) => isObj(v) && isStr(v.asiento) && isStr(v.texto) && ['sin_resolver', 'resuelto'].includes(v.estado as string))) return null;
  if (!Array.isArray(x.borradores) || !x.borradores.every((b) => isObj(b) && isStr(b.tipo_plantilla) && isStr(b.canal) && isStr(b.texto))) return null;
  if (!isStrArr(x.limites)) return null;
  return x;
}
