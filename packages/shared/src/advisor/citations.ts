// Verificación de citas (spec §3.3, §5.5 y §12.2). Una cita es válida si:
//  - M-#### (4 dígitos o más) y N-### de menciones y narrativas: el ID apareció en un resultado
//    de herramienta de esta corrida (no se puede citar lo que no se consultó);
//  - M-## (1 a 3 dígitos), G-#, L-# y LC-#: la regla existe en la versión del conocimiento.
// Una cita inválida no se borra: se cuenta, y el memorando la marca.

export type CitationKind = 'mention' | 'narrative' | 'rule' | 'guide' | 'red_line' | 'legal';

export interface CitationItem {
  ref: string;
  kind: CitationKind;
  ok: boolean;
}

export interface CitationCheck {
  total: number;
  invalid: number;
  items: CitationItem[];
}

export interface CitationCorpus {
  /** IDs legibles que devolvieron las herramientas en esta corrida: M-48213, N-112. */
  seenIds: ReadonlySet<string>;
  /** Texto de docs/manejo-de-crisis/manual-eco.md tal como se generó (manual.ts). */
  manual: string;
  /** Texto de la sección §C (LC-x) generado en legal-rules.ts. */
  legal: string;
}

const RE_MENTION = /\bM-\d{4,}\b/g;
const RE_NARRATIVE = /\bN-\d{1,6}\b/g;
const RE_RULE_M = /\bM-\d{1,3}\b/g;
const RE_GUIDE = /\bG-\d{1,2}\b/g;
const RE_RED_LINE = /\bL-\d{1,2}\b/g;
const RE_LEGAL = /\bLC-\d{1,2}\b/g;

/** La regla existe si aparece con su encabezado en el manual, p. ej. «**M-116 (T-01).». */
function ruleInCorpus(id: string, corpus: string): boolean {
  const escaped = id.replace(/[-]/g, '\\-');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![0-9])`).test(corpus);
}

export function checkCitations(answer: string, c: CitationCorpus): CitationCheck {
  const items: CitationItem[] = [];
  const seen = new Set<string>();
  const add = (ref: string, kind: CitationKind, ok: boolean) => {
    if (seen.has(ref)) return; // una cita repetida cuenta una vez
    seen.add(ref);
    items.push({ ref, kind, ok });
  };

  for (const m of answer.matchAll(RE_MENTION)) add(m[0], 'mention', c.seenIds.has(m[0]));
  for (const m of answer.matchAll(RE_NARRATIVE)) add(m[0], 'narrative', c.seenIds.has(m[0]));
  for (const m of answer.matchAll(RE_RULE_M)) add(m[0], 'rule', ruleInCorpus(m[0], c.manual));
  for (const m of answer.matchAll(RE_GUIDE)) add(m[0], 'guide', ruleInCorpus(m[0], c.manual));
  for (const m of answer.matchAll(RE_RED_LINE)) add(m[0], 'red_line', ruleInCorpus(m[0], c.manual));
  for (const m of answer.matchAll(RE_LEGAL)) add(m[0], 'legal', ruleInCorpus(m[0], c.legal));

  const invalid = items.filter((i) => !i.ok).length;
  return { total: items.length, invalid, items };
}

/** IDs legibles presentes en un resultado de herramienta (para llenar seenIds). */
export function idsInToolResult(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(RE_MENTION)) out.add(m[0]);
  for (const m of text.matchAll(RE_NARRATIVE)) out.add(m[0]);
  return [...out];
}
