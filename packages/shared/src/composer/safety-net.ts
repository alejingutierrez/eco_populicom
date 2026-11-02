/**
 * Red de seguridad (spec 10.1 etapa 5 y 10.4). Nunca bloquea el envío: quita
 * la frase, viñeta o insight con defectos de código que sobrevivieron al
 * corrector y reemplaza un titular reprobado por uno determinista. Todo lo
 * que quita queda en el registro. Port de `safety_net` del prototipo.
 */
import type { FactPackage } from './facts';
import { codeLint, countWords, hardDefects, headlineLengthDefects, mapDraft, stripTags, type LintContext } from './lint';
import type { CodeDefect, Draft } from './types';

export type SafetyNetAction =
  | 'frase_removida'
  | 'item_removido'
  | 'titular_reemplazado'
  | 'parrafo_reemplazado'
  | 'aviso';

export interface SafetyNetLogEntry {
  action: SafetyNetAction;
  where: string;
  text: string;
  reasons: CodeDefect[];
}

/** Un titular largo se tolera (va como aviso) salvo que pase de estos límites. */
export const HEADLINE_HARD_MAX_WORDS = 24;
export const HEADLINE_HARD_MAX_CHARS = 150;

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Titular determinista: «<Día>: N menciones, X negativas y Y positivas».
 * Sus cifras salen del paquete, así que pasa el lint.
 */
export function deterministicHeadline(pkg: FactPackage, scope: 'day' | 'period' = 'day'): string {
  const f = pkg.facts;
  if (scope === 'day' && f.day_total) {
    return `${capitalize(pkg.dayLabel)}: ${f.day_total.display} menciones, ${f.day_neg.display} negativas y ${f.day_pos.display} positivas`;
  }
  const head = pkg.startLabel === pkg.endLabel ? capitalize(pkg.endLabel) : `Del ${pkg.startLabel} al ${pkg.endLabel}`;
  return `${head}: ${f.week_total?.display ?? '0'} menciones, ${f.week_neg?.display ?? '0'} negativas y ${f.week_pos?.display ?? '0'} positivas`;
}

/** Párrafo determinista para cuando no queda texto utilizable. */
export function deterministicParagraph(pkg: FactPackage, scope: 'day' | 'period' = 'day'): string {
  const f = pkg.facts;
  if (scope === 'day' && f.day_total) {
    return `El ${pkg.dayLabel} hubo ${f.day_total.display} menciones pertinentes: ${f.day_neg.display} negativas, ${f.day_neu.display} neutrales y ${f.day_pos.display} positivas.`;
  }
  return `Entre el ${pkg.startLabel} y el ${pkg.endLabel} hubo ${f.week_total?.display ?? '0'} menciones pertinentes: ${f.week_neg?.display ?? '0'} negativas, ${f.week_neu?.display ?? '0'} neutrales y ${f.week_pos?.display ?? '0'} positivas.`;
}

/** Divide un párrafo en oraciones (mismo criterio que el prototipo). */
export function splitSentences(p: string): string[] {
  return (p ?? '').split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}

export interface SafetyNetResult {
  draft: Draft;
  log: SafetyNetLogEntry[];
}

export function safetyNet(d: Draft, pkg: FactPackage, ctx: LintContext, scope: 'day' | 'period' = 'day'): SafetyNetResult {
  const log: SafetyNetLogEntry[] = [];
  const bad = (t: string, where: string) => hardDefects(codeLint(t, where, ctx));

  const out = mapDraft(d, (text, where, kind) => {
    if (kind === 'paragraph') {
      const kept: string[] = [];
      for (const s of splitSentences(text)) {
        const p = bad(s, where);
        if (p.length) log.push({ action: 'frase_removida', where, text: s, reasons: p });
        else kept.push(s);
      }
      return kept.join(' ');
    }
    return text;
  });

  // Ítems: se quitan enteros. Se marcan con un centinela y luego se filtran.
  const REMOVED = '\u0000removed\u0000';
  const marked = mapDraft(out, (text, where, kind) => {
    if (kind !== 'item') return text;
    const p = bad(text, where);
    if (!text.trim()) return REMOVED;
    if (p.length) { log.push({ action: 'item_removido', where, text, reasons: p }); return REMOVED; }
    return text;
  });
  const keep = (xs: string[] | undefined) => (xs ?? []).filter((x) => x !== REMOVED);
  const final: Draft = { headline: marked.headline, paragraph: marked.paragraph, highlights: keep(marked.highlights) };
  if (marked.insights) {
    final.insights = { negative: keep(marked.insights.negative), neutral: keep(marked.insights.neutral), positive: keep(marked.insights.positive) };
  }
  if (marked.comparison) final.comparison = keep(marked.comparison);
  if (marked.sections) {
    final.sections = Object.fromEntries(Object.entries(marked.sections).map(([k, s]) => [k, { narrative: s.narrative, points: keep(s.points) }]));
  }

  // Párrafo vacío tras la limpieza: uno determinista para que el bloque no quede en blanco.
  if (!stripTags(final.paragraph).trim()) {
    const rep = deterministicParagraph(pkg, scope);
    log.push({ action: 'parrafo_reemplazado', where: 'párrafo', text: final.paragraph, reasons: [] });
    final.paragraph = rep;
  }

  // Titular: reprobado por código o vacío → determinista. Largo moderado → aviso.
  const hp = bad(final.headline, 'titular');
  const words = countWords(final.headline);
  const chars = stripTags(final.headline).trim().length;
  const grossLength = words > HEADLINE_HARD_MAX_WORDS || chars > HEADLINE_HARD_MAX_CHARS;
  if (!final.headline.trim() || hp.length || grossLength) {
    const reasons = hp.length ? hp : headlineLengthDefects(final.headline, ctx);
    log.push({ action: 'titular_reemplazado', where: 'titular', text: final.headline, reasons });
    final.headline = deterministicHeadline(pkg, scope);
  } else {
    const soft = headlineLengthDefects(final.headline, ctx);
    if (soft.length) log.push({ action: 'aviso', where: 'titular', text: final.headline, reasons: soft });
  }
  return { draft: final, log };
}
