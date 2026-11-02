// Convierte la plantilla CSV de etiquetado del triaje (docs/manejo-de-crisis/triaje-etiquetado/)
// al formato JSON de los sets de triaje y valida lo que se puede validar sin medir nada:
// columnas, valores, ids únicos y que ninguna etiqueta quede por debajo del piso por reglas.
// No usa el clasificador ni el prompt: quien etiqueta nunca ve lo que el sistema decide.

import { computeFloor, type Clasificacion, type TipoPregunta, type TriageContexto } from './triage';

export const CSV_COLUMNS = [
  'id',
  'pregunta',
  'tipo',
  'variante',
  'indice_hoy',
  'alertas_12h',
  'riesgo_personas',
  'veda_activa',
  'guia_probable',
  'camino_correcto',
  'nota',
] as const;

export interface TriageSetItem {
  id: string;
  tipo: TipoPregunta;
  variante: 'normal' | 'spanglish' | 'adversarial';
  pregunta: string;
  contexto: TriageContexto;
  caminoMinimo: 1 | 2 | 3;
  reglaBase: false;
}

const TIPOS: TipoPregunta[] = ['descriptiva', 'decision', 'redaccion', 'revision_borrador'];
const VARIANTES = ['normal', 'spanglish', 'adversarial'] as const;
const GUIAS = ['G-1', 'G-2', 'G-3', 'G-4', 'G-5', 'G-6', 'G-7', 'G-8', 'G-9', 'G-10', 'G-11', 'G-12'];

/** CSV RFC 4180 mínimo: comillas dobles, comillas escapadas como "", saltos de línea dentro de comillas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const siNo = (v: string): boolean | null => {
  const t = v.trim().toLowerCase();
  if (['si', 'sí', 'true', '1'].includes(t)) return true;
  if (['no', 'false', '0', ''].includes(t)) return false;
  return null;
};

const clasificacionDe = (tipo: TipoPregunta): Clasificacion => ({
  tipo_pregunta: tipo,
  reversible: true,
  quien_da_la_cara: 'nadie',
  presion_tiempo: 'baja',
  riesgo_personas: false,
  situacion: 'no_aplica',
  guia_probable: 'ninguna',
  camino_sugerido: 1,
  motivo: 'validación de plantilla',
});

export interface CsvResult {
  items: TriageSetItem[];
  errors: string[];
}

export function csvToSet(text: string): CsvResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length === 0) return { items: [], errors: ['El archivo está vacío.'] };
  const head = rows[0].map((h) => h.trim());
  for (const c of CSV_COLUMNS) if (!head.includes(c)) errors.push(`Falta la columna «${c}».`);
  if (errors.length) return { items: [], errors };
  const col = (r: string[], name: string) => (r[head.indexOf(name)] ?? '').trim();

  const items: TriageSetItem[] = [];
  const ids = new Set<string>();
  rows.slice(1).forEach((r, k) => {
    const fila = k + 2;
    const id = col(r, 'id');
    const err = (m: string) => errors.push(`Fila ${fila} (${id || 'sin id'}): ${m}`);
    if (!id) return err('falta el id.');
    if (ids.has(id)) err('id repetido.');
    ids.add(id);
    const pregunta = col(r, 'pregunta');
    if (!pregunta) err('falta la pregunta.');
    const tipo = col(r, 'tipo') as TipoPregunta;
    if (!TIPOS.includes(tipo)) err(`tipo «${tipo}» no válido (${TIPOS.join(', ')}).`);
    const variante = (col(r, 'variante') || 'normal') as TriageSetItem['variante'];
    if (!VARIANTES.includes(variante)) err(`variante «${variante}» no válida (${VARIANTES.join(', ')}).`);

    const idxRaw = col(r, 'indice_hoy').replace(',', '.');
    const indiceHoy = idxRaw === '' ? null : Number(idxRaw);
    if (indiceHoy !== null && !(indiceHoy >= 0 && indiceHoy <= 1)) err('indice_hoy debe estar entre 0 y 1 (o vacío si no hay dato).');
    const alertas = col(r, 'alertas_12h') === '' ? 0 : Number(col(r, 'alertas_12h'));
    if (!Number.isInteger(alertas) || alertas < 0) err('alertas_12h debe ser un entero ≥ 0.');
    const riesgo = siNo(col(r, 'riesgo_personas'));
    const veda = siNo(col(r, 'veda_activa'));
    if (riesgo === null) err('riesgo_personas debe ser si o no.');
    if (veda === null) err('veda_activa debe ser si o no.');
    const guiaRaw = col(r, 'guia_probable').toUpperCase();
    if (guiaRaw !== '' && !GUIAS.includes(guiaRaw)) err(`guia_probable «${guiaRaw}» no válida (G-1 a G-12 o vacío).`);
    const camino = Number(col(r, 'camino_correcto'));
    if (![1, 2, 3].includes(camino)) err('camino_correcto debe ser 1, 2 o 3.');

    if (errors.some((e) => e.startsWith(`Fila ${fila} `))) return;
    const contexto: TriageContexto = {
      indiceHoy,
      alertasUltimas12h: alertas,
      riesgoPersonas: riesgo as boolean,
      vedaActiva: veda as boolean,
      guiaProbable: guiaRaw === '' ? null : guiaRaw,
    };
    const piso = computeFloor({ ...contexto, clasificacion: clasificacionDe(tipo) }).piso;
    if (piso > camino) {
      err(`el camino ${camino} queda por debajo del piso por reglas (${piso}) para este contexto y tipo; revisa el contexto o la etiqueta.`);
      return;
    }
    items.push({ id, tipo, variante, pregunta, contexto, caminoMinimo: camino as 1 | 2 | 3, reglaBase: false });
  });
  return { items, errors };
}
