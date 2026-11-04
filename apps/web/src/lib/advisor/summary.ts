// Respuesta corta del panel/consejo: el memorando completo tiene miles de palabras, citas y
// códigos internos. Un último paso redacta lo que la persona necesita para decidir, en lenguaje
// llano, a partir del memorando YA validado. Si el resumen no pasa la validación en código,
// no se muestra: la vista cae al memorando completo.

export const RESUMEN_SCHEMA = {
  type: 'object',
  properties: {
    titular: { type: 'string' },
    hacer_hoy: { type: 'array', items: { type: 'string' } },
    no_hacer: { type: 'array', items: { type: 'string' } },
    cambiar_si: { type: 'array', items: { type: 'string' } },
    falta_saber: { type: 'array', items: { type: 'string' } },
  },
  required: ['titular', 'hacer_hoy', 'no_hacer', 'cambiar_si', 'falta_saber'],
  additionalProperties: false,
} as const;

export interface Resumen {
  titular: string;
  hacer_hoy: string[];
  no_hacer: string[];
  cambiar_si: string[];
  falta_saber: string[];
}

export const RESUMEN_SYSTEM = `Eres el redactor final de ECO, una plataforma de escucha social para agencias del gobierno de Puerto Rico. Recibes el análisis de un panel de asesores sobre una consulta de comunicación de crisis y escribes la respuesta corta para la persona que tiene que decidir hoy.

Reglas:
- Español llano, frases cortas, tono de colega que ya hizo la tarea. Nada de jerga: no uses «veto», «disenso», «asiento», «abogado del diablo», «mitigada», «línea base» ni «camino 0/1/2».
- Las opciones se llaman «Opción A», «Opción B» y «Opción C», como vienen rotuladas en el texto.
- Prohibido escribir códigos o identificadores: nada de M-…, L-…, G-…, N-…, C0-1, [métrica…] ni UUID. Si una regla importa, di qué dice con palabras.
- No inventes datos. Cada cifra, fecha o nombre propio que escribas tiene que estar en el análisis. No des probabilidades ni rangos numéricos de efecto.
- Conserva la prudencia del análisis: si la recomendación depende de algo que ECO no ve, dilo en el titular.
- Cada acción empieza con un verbo en imperativo y dice quién y cuándo si el análisis lo dice.

Campos:
- titular: la decisión en una frase (máximo 30 palabras).
- hacer_hoy: de 2 a 4 acciones, en el orden en que se hacen (máximo 35 palabras cada una).
- no_hacer: de 1 a 3 cosas que hay que evitar y por qué, en pocas palabras.
- cambiar_si: de 1 a 3 señales concretas que cambiarían la decisión.
- falta_saber: de 1 a 3 cosas que ECO no puede ver y que pesan en la decisión.
El total no pasa de 220 palabras. Sé breve: si algo no cambia la decisión, no lo escribas.`;

const MAX_TITULAR = 40;
const MAX_ITEM = 40;
const MAX_TOTAL = 320;

// Códigos internos, UUID y jerga que no deben llegar a la persona.
const FORBIDDEN: RegExp[] = [
  /\b(?:M|N|G|L|LC)-(?:\d+|[0-9a-f]{8})/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,
  /\[métrica/i,
  /\bC\d-\d\b/,
  /\bcamino\s*[0-2]\b/i,
  /\bveto/i,
  /\bdisenso/i,
  /abogado del diablo/i,
  /\basientos?\b/i,
];

/** Quita citas y códigos internos del texto que se le da al redactor. */
export function scrubForSummary(text: string): string {
  return String(text ?? '')
    .replace(/\[métrica:[^\]]*\]/gi, '')
    .replace(/\(?\b(?:M|N|G|L|LC)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)\b\)?/gi, '')
    .replace(/\(\s*(?:,\s*)*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

const asArr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const asStr = (x: unknown): string => (typeof x === 'string' ? x : '');
const letter = (i: unknown): string => (typeof i === 'number' && i >= 0 && i < 26 ? String.fromCharCode(65 + i) : '');

/** Entrada compacta y sin códigos para el redactor: lo que decide, no todo el memorando. */
export function summaryInput(memo: Record<string, unknown>): string {
  const rec = (memo.recomendacion ?? {}) as Record<string, unknown>;
  const enc = (memo.encabezado ?? {}) as Record<string, unknown>;
  const hechos = (memo.hechos ?? {}) as Record<string, unknown>;
  const senales = (memo.senales ?? {}) as Record<string, unknown>;
  const lb = (memo.linea_base ?? {}) as Record<string, unknown>;
  const caminos = asArr(memo.caminos).map((c, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      opcion: letter(i),
      nombre: scrubForSummary(asStr(o.nombre)),
      que: scrubForSummary(asStr(o.que)),
      quien: scrubForSummary(asStr(o.quien)),
      canal: scrubForSummary(asStr(o.canal)),
      cuando: scrubForSummary(asStr(o.cuando)),
    };
  });
  const sinResolver = asArr(memo.vetos)
    .map((v) => (v ?? {}) as Record<string, unknown>)
    .filter((v) => v.estado === 'sin_resolver')
    .map((v) => scrubForSummary(asStr(v.texto)));
  const payload = {
    fecha: asStr(enc.fecha),
    agencia: asStr(enc.agencia),
    motivo: scrubForSummary(asStr(enc.motivo)),
    recomendada: letter(rec.camino) ? `Opción ${letter(rec.camino)}` : null,
    confianza: asStr(rec.confianza_cualitativa),
    por_que_se_recomienda: scrubForSummary(asStr(rec.porque)),
    opciones: caminos,
    se_sabe: asArr(hechos.sabido).slice(0, 6).map((x) => scrubForSummary(asStr((x as Record<string, unknown>)?.afirmacion))),
    no_esta_claro: asArr(hechos.no_claro).slice(0, 5).map((x) => scrubForSummary(asStr((x as Record<string, unknown>)?.pregunta))),
    si_no_se_actua: scrubForSummary(asStr(lb.descripcion)),
    cambiar_de_opcion_si: asArr(senales.cambiar_si).map((x) => scrubForSummary(asStr(x))),
    prohibiciones_sin_resolver: sinResolver.map(scrubForSummary),
    limites_de_los_datos: asArr(memo.limites).slice(0, 6).map((x) => scrubForSummary(asStr(x))),
  };
  return JSON.stringify(payload, null, 1);
}

function words(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}

const NUM = /\d+(?:[.,]\d+)?/g;
const normNum = (n: string): string => n.replace(',', '.');

/** Todas las cifras del texto, normalizadas (coma decimal → punto). */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUM) ?? []).map(normNum));
}

function cleanList(x: unknown, min: number, max: number, label: string, problems: string[]): string[] {
  if (!Array.isArray(x)) { problems.push(`${label}: no es lista`); return []; }
  const out = x.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  if (out.length < min || out.length > max) problems.push(`${label}: ${out.length} elementos (debe haber de ${min} a ${max})`);
  if (out.some((s) => words(s) > MAX_ITEM)) problems.push(`${label}: un elemento pasa de ${MAX_ITEM} palabras`);
  return out;
}

/** Motivos por los que un resumen no pasa; lista vacía = válido. */
export function resumenProblems(x: unknown, memo: Record<string, unknown>): string[] {
  if (!x || typeof x !== 'object') return ['no es un objeto'];
  const r = x as Record<string, unknown>;
  const problems: string[] = [];
  const titular = typeof r.titular === 'string' ? r.titular.trim() : '';
  if (!titular) problems.push('titular vacío');
  else if (words(titular) > MAX_TITULAR) problems.push(`titular de ${words(titular)} palabras`);
  const hacer = cleanList(r.hacer_hoy, 2, 4, 'hacer_hoy', problems);
  const no = cleanList(r.no_hacer, 1, 3, 'no_hacer', problems);
  const cambiar = cleanList(r.cambiar_si, 1, 3, 'cambiar_si', problems);
  const falta = cleanList(r.falta_saber, 1, 3, 'falta_saber', problems);
  const all = [titular, ...hacer, ...no, ...cambiar, ...falta];
  const total = all.reduce((n, s) => n + words(s), 0);
  if (total > MAX_TOTAL) problems.push(`${total} palabras en total`);
  const joined = all.join('\n');
  const bad = FORBIDDEN.map((re) => re.exec(joined)?.[0]).filter(Boolean);
  if (bad.length) problems.push(`jerga o códigos: ${bad.join(', ')}`);
  const allowed = numbersIn(JSON.stringify(memo));
  const extra = [...numbersIn(joined)].filter((n) => !allowed.has(n));
  if (extra.length) problems.push(`cifras que el análisis no tiene: ${extra.join(', ')}`);
  return problems;
}

/**
 * Valida el resumen contra el memorando: forma, largo, sin códigos ni jerga, y sin cifras que el
 * memorando no contenga. Devuelve null si no cumple (la vista usa el memorando completo).
 */
export function validateResumen(x: unknown, memo: Record<string, unknown>): Resumen | null {
  if (resumenProblems(x, memo).length) return null;
  const r = x as Record<string, unknown>;
  const list = (k: string): string[] => (r[k] as unknown[]).map((s) => String(s).trim()).filter(Boolean);
  return { titular: String(r.titular).trim(), hacer_hoy: list('hacer_hoy'), no_hacer: list('no_hacer'), cambiar_si: list('cambiar_si'), falta_saber: list('falta_saber') };
}
