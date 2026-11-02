/**
 * Verificación por código (spec 10.4, etapa 3a): marcadores `{{id}}`,
 * vetados (Anexo C), números sin fuente y largo del titular. Port de `fill`,
 * `fill_draft`, `code_lint` y `lint_draft` del prototipo (agents.py).
 */
import type { FactPackage } from './facts';
import type { AnnotatedSampleSet, CodeDefect, Draft, Fact } from './types';
import { allSamples } from './samples';
import { findVetoed } from './vetoed';

export const HEADLINE_MAX_WORDS = 16;
export const HEADLINE_MAX_CHARS = 100;

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MARKER_RE = /\{\{([a-zA-Z0-9_\-]+)\}\}/g;
const DATE_RE = new RegExp(`(?<!\\d)\\d{1,2} de (${MONTHS.join('|')})(?![\\p{L}])`, 'giu');
const YEAR_RE = /(?<!\d)20\d\d(?!\d)/g;
const NUMBER_RE = /\d[\d.,]*/g;

// ------------------------------------------------------------------ recorrido del borrador

export type DraftUnitKind = 'headline' | 'paragraph' | 'item';

export interface DraftUnit {
  where: string;
  kind: DraftUnitKind;
  text: string;
}

/** Aplica `fn` a cada texto del borrador; devuelve un borrador nuevo con la misma forma. */
export function mapDraft(d: Draft, fn: (text: string, where: string, kind: DraftUnitKind) => string): Draft {
  const out: Draft = {
    headline: fn(d.headline ?? '', 'titular', 'headline'),
    paragraph: fn(d.paragraph ?? '', 'párrafo', 'paragraph'),
    highlights: (d.highlights ?? []).map((x, i) => fn(x, `viñeta ${i + 1}`, 'item')),
  };
  if (d.insights) {
    out.insights = {
      negative: (d.insights.negative ?? []).map((x, i) => fn(x, `insight negative ${i + 1}`, 'item')),
      neutral: (d.insights.neutral ?? []).map((x, i) => fn(x, `insight neutral ${i + 1}`, 'item')),
      positive: (d.insights.positive ?? []).map((x, i) => fn(x, `insight positive ${i + 1}`, 'item')),
    };
  }
  if (d.comparison) out.comparison = d.comparison.map((x, i) => fn(x, `comparación ${i + 1}`, 'item'));
  if (d.sections) {
    out.sections = Object.fromEntries(
      Object.entries(d.sections).map(([k, s]) => [
        k,
        {
          narrative: fn(s.narrative ?? '', `sección ${k} narrativa`, 'paragraph'),
          points: (s.points ?? []).map((x, i) => fn(x, `sección ${k} punto ${i + 1}`, 'item')),
        },
      ]),
    );
  }
  return out;
}

export function listDraftUnits(d: Draft): DraftUnit[] {
  const units: DraftUnit[] = [];
  mapDraft(d, (text, where, kind) => { units.push({ where, kind, text }); return text; });
  return units;
}

/** Texto plano del borrador para QA, juez y archivo (port de `draft_text`). */
export function draftText(d: Draft): string {
  const lines = [`TITULAR: ${d.headline}`, '', `PÁRRAFO: ${d.paragraph}`, '', 'VIÑETAS:', ...d.highlights.map((x) => `- ${x}`)];
  if (d.insights) {
    lines.push('', 'INSIGHTS:');
    for (const k of ['negative', 'neutral', 'positive'] as const) for (const x of d.insights[k]) lines.push(`[${k}] ${x}`);
  }
  if (d.comparison) lines.push('', 'COMPARACIÓN CON EL PERIODO PREVIO:', ...d.comparison.map((x) => `- ${x}`));
  if (d.sections) {
    for (const [k, s] of Object.entries(d.sections)) {
      lines.push('', `SECCIÓN ${k.toUpperCase()}: ${s.narrative}`, ...s.points.map((x) => `- ${x}`));
    }
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ marcadores

/** Reemplaza `{{id}}` por el valor mostrado del hecho; un id inexistente se quita y se reporta. */
export function fillPlaceholders(
  text: string,
  facts: Record<string, Fact>,
  where = 'texto',
  problems: CodeDefect[] = [],
  keepInvalid = false,
): string {
  return (text ?? '').replace(MARKER_RE, (m, id: string) => {
    const f = facts[id];
    if (f) return f.display;
    problems.push({ where, type: 'marcador_invalido', quote: m, severity: 'hard' });
    // Para la red de seguridad se deja el marcador: el lint lo ve y quita la frase entera.
    return keepInvalid ? m : '';
  });
}

export function fillDraft(d: Draft, facts: Record<string, Fact>, opts: { keepInvalid?: boolean } = {}): { filled: Draft; problems: CodeDefect[] } {
  const problems: CodeDefect[] = [];
  const filled = mapDraft(d, (t, where) => fillPlaceholders(t, facts, where, problems, !!opts.keepInvalid));
  return { filled, problems };
}

// ------------------------------------------------------------------ lint

export interface LintContext {
  /** Números permitidos como texto (valores de hechos, días del mes, la ventana). */
  allowedNumbers: Set<string>;
  /** Nombres propios con dígitos que no son cifras («En Contacto 787 Tv»). Más largos primero. */
  nameWhitelist: string[];
  headlineMaxWords: number;
  headlineMaxChars: number;
}

function numKey(n: number): string[] {
  const s = String(n);
  const a = String(Math.abs(n));
  return [s, a];
}

/**
 * Contexto del lint: valores de los hechos (y su valor absoluto), la ventana
 * («7»), los días del mes del periodo y de las fechas de las muestras y sus
 * publicaciones originales, y la lista blanca de nombres propios con dígitos
 * tomada de autores, fuentes, páginas, tópicos y tokens alfanuméricos de las muestras.
 */
export function buildLintContext(pkg: FactPackage, samples: AnnotatedSampleSet, extraNames: string[] = []): LintContext {
  const allowed = new Set<string>();
  for (const f of Object.values(pkg.facts)) numKey(f.value).forEach((k) => allowed.add(k));
  allowed.add('7');
  allowed.add(String(pkg.windowDays));
  const ymds = new Set<string>(pkg.seriesDates);
  const names = new Set<string>(extraNames.filter((n) => /\d/.test(n)));
  for (const s of allSamples(samples)) {
    ymds.add(s.dayYmd);
    if (s.parent?.dayYmd) ymds.add(s.parent.dayYmd);
    for (const n of [s.author, s.source, s.parent?.author, s.topic]) if (n && /\d/.test(n)) names.add(n);
    const body = `${s.text} ${s.parent?.text ?? ''}`;
    // Tokens que empiezan por letra o # y llevan dígitos (COVID-19, #PR2026, WAPA4): son nombres, no cifras.
    for (const tok of body.match(/[^\s,.;:()«»"“”¡!¿?]+/g) ?? []) {
      if (/^[#@]?\p{L}/u.test(tok) && /\d/.test(tok) && (tok.match(/\p{L}/gu) ?? []).length >= 2) names.add(tok);
    }
    // Leyes, proyectos, órdenes y carreteras citados en las muestras («Ley 60», «PR-52»).
    for (const m of body.matchAll(/(?<![\p{L}])(?:Ley|Proyecto(?: de la Cámara| del Senado)?|Resolución(?: Conjunta)?|Orden Ejecutiva|Carretera|PR)[\s-]*(?:núm\.\s*|número\s*)?\d+(?:-\d+)?/gu)) {
      names.add(m[0]);
    }
  }
  for (const f of Object.values(pkg.facts)) {
    for (const m of f.label.matchAll(/«([^»]+)»/g)) if (/\d/.test(m[1])) names.add(m[1]);
  }
  for (const y of ymds) { const d = Number(y.slice(8, 10)); if (d) allowed.add(String(d)); }
  return {
    allowedNumbers: allowed,
    nameWhitelist: Array.from(names).sort((a, b) => b.length - a.length),
    headlineMaxWords: HEADLINE_MAX_WORDS,
    headlineMaxChars: HEADLINE_MAX_CHARS,
  };
}

export function stripTags(s: string): string {
  return (s ?? '').replace(/<[^>]+>/g, '');
}

export function countWords(s: string): number {
  return stripTags(s).trim().split(/\s+/).filter(Boolean).length;
}

/** Lint de un texto ya rellenado (sin marcadores). Port de `code_lint`. */
export function codeLint(text: string, where: string, ctx: LintContext): CodeDefect[] {
  const probs: CodeDefect[] = [];
  let txt = stripTags(text ?? '');
  for (const m of txt.match(/\{\{[^{}]*\}\}/g) ?? []) probs.push({ where, type: 'marcador_invalido', quote: m, severity: 'hard' });
  txt = txt.replace(/\{\{[^{}]*\}\}/g, ' ');
  for (const nm of ctx.nameWhitelist) txt = txt.split(nm).join(' ');
  for (const v of findVetoed(txt)) probs.push({ where, type: 'tono_dramatico', quote: v, severity: 'hard' });
  const clean = txt.replace(DATE_RE, ' ').replace(YEAR_RE, ' ');
  for (const n of clean.match(NUMBER_RE) ?? []) {
    const n2 = n.replace(/[.,]+$/, '');
    if (!n2) continue;
    const ok = ctx.allowedNumbers.has(n2) || ctx.allowedNumbers.has(n2.replace(/,/g, '')) || ctx.allowedNumbers.has(n2.replace(',', '.'));
    if (!ok) probs.push({ where, type: 'cifra_sin_fuente', quote: n2, severity: 'hard' });
  }
  return probs;
}

/** Largo del titular (spec 9.1 regla 5): aviso para el corrector. */
export function headlineLengthDefects(headline: string, ctx: LintContext): CodeDefect[] {
  const words = countWords(headline);
  const chars = stripTags(headline).trim().length;
  if (words > ctx.headlineMaxWords || chars > ctx.headlineMaxChars) {
    return [{ where: 'titular', type: 'titular_largo', quote: `${words} palabras, ${chars} caracteres`, severity: 'soft' }];
  }
  return [];
}

/** Lint de todo el borrador rellenado. Port de `lint_draft` + largo del titular. */
export function lintDraft(d: Draft, ctx: LintContext): CodeDefect[] {
  const probs: CodeDefect[] = [];
  for (const u of listDraftUnits(d)) probs.push(...codeLint(u.text, u.where, ctx));
  probs.push(...headlineLengthDefects(d.headline, ctx));
  return probs;
}

export const hardDefects = (ds: CodeDefect[]) => ds.filter((d) => d.severity === 'hard');
