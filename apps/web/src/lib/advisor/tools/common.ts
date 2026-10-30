import { addDaysYmd, closedWindowYmdInTZ, ymdInTimeZone } from '@eco/shared';
import type { AdvisorToolResult } from './types';

export const PR_TZ = 'America/Puerto_Rico';
/** ≈ 4 000 tokens (spec §6.1). */
export const MAX_RESULT_CHARS = 16000;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/** Nombres que un modelo podría intentar usar para elegir agencia o fecha. Se rechazan. */
const FORBIDDEN_ARGS = new Set(['agency', 'agency_id', 'agencia', 'agencia_id', 'agency_slug', 'slug', 'as_of', 'asof', 'fecha_corte']);

export type ResponseFormat = 'resumen' | 'detalle';

/** Error de argumentos: su mensaje (en español, accionable) va tal cual al modelo. */
export class ToolArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolArgError';
  }
}

// ---------- resultados ----------

export function toResult(payload: Record<string, unknown>, ok = true): AdvisorToolResult {
  const text = JSON.stringify(payload);
  return { ok, text, resultTokens: Math.ceil(text.length / 4) };
}

export function errorResult(message: string): AdvisorToolResult {
  return toResult({ ok: false, error: message }, false);
}

/** Convierte ToolArgError en resultado ok:false; cualquier otro error sigue hacia arriba. */
export async function guard(fn: () => Promise<AdvisorToolResult>): Promise<AdvisorToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Error && e.name === 'ToolArgError') return errorResult(e.message);
    throw e;
  }
}

/**
 * Lista con tope: si no cabe en MAX_RESULT_CHARS, recorta a la mitad hasta que
 * quepa, y dice cuántos hay y cómo filtrar. `items` ya viene con el límite de
 * elementos aplicado; `total` es el número antes de ese límite.
 */
export function withList(base: Record<string, unknown>, key: string, items: unknown[], total: number, comoFiltrar: string): AdvisorToolResult {
  let shown = items.length;
  for (;;) {
    const list = items.slice(0, shown);
    const payload: Record<string, unknown> = { ...base, [key]: list, total, mostrados: list.length };
    if (list.length < total) {
      payload.truncado = true;
      payload.como_filtrar = comoFiltrar;
    }
    if (JSON.stringify(payload).length <= MAX_RESULT_CHARS || shown === 0) return toResult(payload);
    shown = Math.floor(shown / 2);
  }
}

// ---------- argumentos ----------

export function describeValue(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

export function asArgs(raw: unknown, allowed: readonly string[], herramienta: string): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolArgError(`Los argumentos de «${herramienta}» deben ser un objeto JSON, por ejemplo {} o {"response_format":"detalle"}. Se recibió: ${describeValue(raw)}.`);
  }
  const obj = raw as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_ARGS.has(k)) {
      throw new ToolArgError(`«${k}» no es un argumento válido: la agencia y la fecha de corte las fija el sistema. Quita «${k}» y vuelve a llamar a «${herramienta}».`);
    }
    if (!allowed.includes(k)) {
      throw new ToolArgError(`Argumento no admitido «${k}» en «${herramienta}». Admitidos: ${allowed.length ? allowed.join(', ') : 'ninguno'}.`);
    }
  }
  return obj;
}

export function readResponseFormat(v: unknown): ResponseFormat {
  if (v === undefined || v === null) return 'resumen';
  if (v === 'resumen' || v === 'detalle') return v;
  throw new ToolArgError(`«response_format» debe ser "resumen" (por defecto) o "detalle". Se recibió: ${describeValue(v)}.`);
}

export function readInt(v: unknown, name: string, min: number, max: number, def: number): number {
  if (v === undefined || v === null) return def;
  if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
  throw new ToolArgError(`«${name}» debe ser un entero entre ${min} y ${max}. Se recibió: ${describeValue(v)}.`);
}

export function readLimit(v: unknown): number {
  return readInt(v, 'limite', 1, MAX_LIMIT, DEFAULT_LIMIT);
}

export function readOptionalText(v: unknown, name: string, max = 60): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max) return v.trim();
  throw new ToolArgError(`«${name}» debe ser texto de 1 a ${max} caracteres (el nombre o slug exacto). Se recibió: ${describeValue(v)}.`);
}

const NARRATIVE_REF = /^N-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** «N-<uuid>» → uuid en minúsculas. */
export function readNarrativeRef(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const m = typeof v === 'string' ? NARRATIVE_REF.exec(v.trim()) : null;
  if (m) return m[1].toLowerCase();
  throw new ToolArgError(`«narrativa» debe tener el formato "N-<identificador>", por ejemplo "N-3f2a9c1e-0000-4000-8000-000000000000" (el ID que devolvió una consulta previa). Se recibió: ${describeValue(v)}.`);
}

// ---------- esquemas de herramientas ----------

export function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: [], additionalProperties: false };
}

export const P_RESPONSE_FORMAT = {
  type: 'string',
  enum: ['resumen', 'detalle'],
  description: 'resumen (por defecto) o detalle, con más filas y más contexto.',
};

export const P_LIMIT = {
  type: 'integer',
  description: 'Máximo de elementos a devolver: 20 por defecto, tope 50.',
};

// ---------- fechas (America/Puerto_Rico, UTC-4 todo el año) ----------

export function prYmd(d: Date): string {
  return ymdInTimeZone(d, PR_TZ);
}

/** Medianoche PR de un día YYYY-MM-DD, como instante UTC. PR no tiene horario de verano. */
export function prMidnight(ymd: string): Date {
  return new Date(`${ymd}T04:00:00.000Z`);
}

/** Ventana de `daysBack` días cerrados que terminan AYER en PR (convención del correo semanal). */
export function closedWindow(asOf: Date, daysBack: number) {
  return closedWindowYmdInTZ(daysBack, asOf, PR_TZ);
}

export const addDays = addDaysYmd;

/** a − b en días (enteros) para dos YYYY-MM-DD. */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

// ---------- números ----------

export const num = (v: unknown): number | null => (v == null ? null : Number(v));
export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
