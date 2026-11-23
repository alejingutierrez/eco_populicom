/**
 * INT-02 — veredicto de un correo ENVIADO contra los criterios del revisor:
 *
 *   1. ninguna afirmación de dirección contradice su cifra, ni queda una
 *      variación sin nivel o una frase de calma con el nivel sostenido;
 *   3. cada corrección queda archivada con el antes y el después;
 *   4. ninguna palabra vetada.
 *
 * Además cuenta los signos dobles («bajó -18 %»), que no son un criterio pero
 * sí un defecto de redacción. Puro: lo usan `scripts/int-02-enviados-check.ts`
 * y su prueba.
 */
import { findSignedDirections, findVetoed, listDraftUnits, stripTags, type Draft } from '@eco/shared';

const LEVEL_TYPES = ['direccion_sin_nivel', 'mejora_con_nivel_sostenido'];

export interface SentRow {
  slug: string;
  templateKey: string;
  sentAt: string;
  final: Draft | null;
  warnings: Array<{ type: string; where?: string; quote?: string }>;
  residual: Array<{ type: string; where?: string; quote?: string }>;
  safetyNetLog: Array<{ action: string; where?: string; text?: string; after?: string }>;
  correctorRan: boolean;
  hasDraft1: boolean;
  hasDraft2: boolean;
  /** Errores de la composición (un corrector que falló no deja borrador y no es una corrección). */
  errors: string[];
}

export interface SentVerdict {
  vetoed: string[];
  contradictions: string[];
  doubleSigns: string[];
  levelWarnings: string[];
  residual: string[];
  /** Correcciones sin el antes o sin el después en el archivo. */
  unarchived: string[];
  ok: boolean;
}

export function judgeSent(row: SentRow): SentVerdict {
  const vetoed: string[] = [];
  const contradictions: string[] = [];
  const doubleSigns: string[] = [];
  for (const u of row.final ? listDraftUnits(row.final) : []) {
    const text = stripTags(u.text ?? '');
    for (const v of findVetoed(text)) vetoed.push(`${u.where}: «${v}»`);
    for (const s of findSignedDirections(text)) {
      (s.kind === 'contradice' ? contradictions : doubleSigns).push(`${u.where}: «${s.quote}»`);
    }
  }
  const levelWarnings = [...row.warnings, ...row.residual]
    .filter((w) => LEVEL_TYPES.includes(w.type))
    .map((w) => `${w.where ?? '?'}: ${w.type}`);
  const residual = row.residual.filter((w) => !LEVEL_TYPES.includes(w.type)).map((w) => `${w.where ?? '?'}: ${w.type} «${w.quote ?? ''}»`);

  const unarchived: string[] = [];
  if (!row.final) unarchived.push('sin texto final archivado');
  const correctorFailed = row.errors.some((e) => /^corrector:/.test(e));
  if (row.correctorRan && !correctorFailed && !(row.hasDraft1 && row.hasDraft2)) unarchived.push('corrector sin borrador antes o después');
  for (const e of row.safetyNetLog) {
    // Un párrafo que quedó vacío se reemplaza: su «antes» es legítimamente vacío.
    if (e.action === 'aviso' || e.action === 'parrafo_reemplazado') continue;
    if (e.action === 'nivel_añadido' ? !(e.text && e.after) : !(e.text ?? '').trim() && e.action !== 'titular_reemplazado') {
      unarchived.push(`${e.action} en ${e.where ?? '?'} sin texto`);
    }
  }
  // El signo doble se informa pero no rompe ningún criterio.
  const ok = !vetoed.length && !contradictions.length && !levelWarnings.length && !residual.length && !unarchived.length;
  return { vetoed, contradictions, doubleSigns, levelWarnings, residual, unarchived, ok };
}
