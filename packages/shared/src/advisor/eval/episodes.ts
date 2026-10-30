// Carga y validación de `episodes.json` y control de contaminación (spec §13.1).
// Elegir los 20–30 episodios reales es un paso humano: este módulo solo exige que el set
// cumpla la forma y las condiciones del spec antes de gastar una sola llamada.

import { createHash } from 'node:crypto';
import { QUESTION_TYPES, type Case, type Episode } from './types';

export const SET_SIZE = { min: 20, max: 30 } as const;
const AGENCIES = ['ddecpr', 'gobernadora', 'df'];
/** Episodios que el spec §13.1 exige; el del apagón solo «si hay cobertura». */
export const REQUIRED_TAGS = ['renuncia-ddec-2026-05', 'familia-2026-10'] as const;
export const OPTIONAL_TAGS = ['apagon-2025-04'] as const;

export interface EpisodeValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  episodes: Episode[];
}

const isIso = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);

/**
 * Valida el arreglo de episodios. `full` exige el tamaño del spec (20–30) y los episodios
 * obligatorios; sin `full` (ejemplo, pruebas) solo se revisa la forma.
 */
export function validateEpisodes(raw: unknown, opts: { full?: boolean } = {}): EpisodeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ['episodes.json debe ser un arreglo'], warnings, episodes: [] };

  const ids = new Set<string>();
  const episodes: Episode[] = [];
  raw.forEach((e, i) => {
    const at = `episodio[${i}]${e && typeof e === 'object' && 'id' in e ? ` (${String((e as { id: unknown }).id)})` : ''}`;
    if (!e || typeof e !== 'object') return void errors.push(`${at}: no es un objeto`);
    const ep = e as Record<string, unknown>;
    if (typeof ep.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(ep.id)) errors.push(`${at}: id inválido (minúsculas, dígitos y guiones)`);
    else if (ids.has(ep.id)) errors.push(`${at}: id repetido`);
    else ids.add(ep.id);
    if (!AGENCIES.includes(String(ep.agencySlug))) errors.push(`${at}: agencySlug debe ser ${AGENCIES.join(' | ')}`);
    if (typeof ep.titulo !== 'string' || !ep.titulo.trim()) errors.push(`${at}: falta titulo`);
    if (!isIso(ep.asOf)) errors.push(`${at}: asOf debe ser ISO 8601 con hora`);
    if (!Array.isArray(ep.tags) || !ep.tags.every((t) => typeof t === 'string')) errors.push(`${at}: tags debe ser un arreglo de texto`);
    if (typeof ep.bajaCoberturaNacional !== 'boolean') errors.push(`${at}: falta bajaCoberturaNacional (boolean)`);
    const ctl = ep.control as { nombresSustituidos?: unknown; nombres?: unknown } | undefined;
    if (!ctl || typeof ctl.nombresSustituidos !== 'boolean') errors.push(`${at}: falta control.nombresSustituidos (boolean)`);
    else if (ctl.nombresSustituidos && !(Array.isArray(ctl.nombres) && ctl.nombres.length > 0)) errors.push(`${at}: con control de nombres hay que listar control.nombres`);
    if (ep.snapshotsV5 !== true) errors.push(`${at}: snapshotsV5 debe ser true (solo episodios con computed_at de V5, spec §13.1)`);

    const qs = ep.preguntas;
    if (!Array.isArray(qs) || qs.length < 2 || qs.length > 3) errors.push(`${at}: debe tener de 2 a 3 preguntas`);
    else {
      const tipos = new Set<string>();
      const qids = new Set<string>(); // el caseId es episodio:pregunta, basta con ids únicos dentro del episodio
      qs.forEach((q, j) => {
        const qa = `${at} pregunta[${j}]`;
        const qq = q as Record<string, unknown>;
        if (typeof qq?.id !== 'string' || !qq.id) errors.push(`${qa}: falta id`);
        else if (qids.has(qq.id)) errors.push(`${qa}: id repetido`);
        else qids.add(qq.id);
        if (!QUESTION_TYPES.includes(qq?.tipo as never)) errors.push(`${qa}: tipo debe ser ${QUESTION_TYPES.join(' | ')}`);
        else if (tipos.has(qq.tipo as string)) errors.push(`${qa}: tipo repetido en el episodio`);
        else tipos.add(qq.tipo as string);
        if (typeof qq?.texto !== 'string' || qq.texto.trim().length < 10) errors.push(`${qa}: texto demasiado corto`);
      });
    }
    episodes.push(ep as unknown as Episode);
  });

  if (opts.full) {
    if (episodes.length < SET_SIZE.min || episodes.length > SET_SIZE.max) {
      errors.push(`el set debe tener de ${SET_SIZE.min} a ${SET_SIZE.max} episodios (tiene ${episodes.length})`);
    }
    for (const tag of REQUIRED_TAGS) {
      if (!episodes.some((e) => e.tags?.includes(tag))) errors.push(`falta el episodio obligatorio del spec: etiqueta «${tag}»`);
    }
    for (const tag of OPTIONAL_TAGS) {
      if (!episodes.some((e) => e.tags?.includes(tag))) warnings.push(`sin episodio «${tag}» (el spec lo pide solo si hay cobertura)`);
    }
    const lowCov = episodes.filter((e) => e.bajaCoberturaNacional).length;
    if (episodes.length && lowCov / episodes.length < 0.5) warnings.push('menos de la mitad son de baja cobertura nacional: sube el riesgo de contaminación (spec §13.1)');
    if (!episodes.some((e) => e.control?.nombresSustituidos)) warnings.push('ningún episodio lleva control con nombres sustituidos');
  }
  return { ok: errors.length === 0, errors, warnings, episodes };
}

/** Expande episodios en casos (episodio × pregunta). */
export function expandCases(episodes: Episode[]): Case[] {
  return episodes.flatMap((episode) => episode.preguntas.map((question) => ({ caseId: `${episode.id}:${question.id}`, episode, question })));
}

// ---- Control de contaminación -----------------------------------------------------------

/**
 * Alias estables para nombres propios: el mismo nombre da el mismo alias en toda corrida (se calcula
 * del propio nombre, no del orden), así el caso «con nombres sustituidos» se puede repetir y comparar.
 */
export function aliasFor(name: string): string {
  const h = createHash('sha256').update(name.trim().toLowerCase()).digest();
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `Persona ${letters[h[0] % letters.length]}${letters[h[1] % letters.length]}${h[2] % 10}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sustituye cada nombre (y sus partes de 4+ letras, como el apellido) por su alias. Los más largos primero. */
export function maskNames(text: string, names: string[]): string {
  const forms = new Map<string, string>();
  for (const n of names) {
    const alias = aliasFor(n);
    forms.set(n, alias);
    for (const part of n.split(/\s+/)) if (part.length >= 4) forms.set(part, forms.get(part) ?? alias);
  }
  let out = text;
  for (const form of [...forms.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(form)}(?![\\p{L}\\p{N}])`, 'giu'), forms.get(form)!);
  }
  return out;
}

/** Aplica el control a un caso: pregunta y hoja de hechos con nombres sustituidos. */
export function maskCaseText(text: string, episode: Episode): string {
  return episode.control.nombresSustituidos ? maskNames(text, episode.control.nombres ?? []) : text;
}
