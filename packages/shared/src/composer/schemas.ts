/**
 * Esquemas del motor (spec, Anexo B), forzados por tool-use con input_schema,
 * y normalizadores: Bedrock no garantiza tipos dentro del esquema (ver
 * `coerceBulletList` en la constitución), así que todo lo que vuelve del
 * modelo pasa por aquí antes de usarse.
 */
import { coerceBulletList } from '../prompts/constitution';
import type { Draft, DraftSection, Findings, FindingItem, FindingThread, QaDefect, QaDefectType, ThreadKind } from './types';

const STR = { type: 'string' } as const;
const ARR = (items: object) => ({ type: 'array', items });

export const THREAD_KINDS: ThreadKind[] = [
  'noticia_del_dia',
  'reaccion_tardia_a_publicacion_anterior',
  'actividad_propia_de_la_agencia',
  'reaccion_a_hecho_externo',
  'otro',
];

export const QA_DEFECT_TYPES: QaDefectType[] = [
  'cifra', 'cuantificador', 'atribucion', 'fecha_o_dia', 'novedad_sin_base', 'contradiccion',
  'tono_dramatico', 'intencion_atribuida', 'sin_respaldo', 'publicacion_vieja_como_del_dia', 'otro',
];

const FINDING_ITEM = {
  type: 'object',
  properties: { what: STR, evidence: ARR(STR), fact_ids: ARR(STR), who_said: STR, dates: STR },
  required: ['what', 'evidence'],
};

export const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    threads: ARR({
      type: 'object',
      properties: {
        id: STR, what: STR, evidence: ARR(STR),
        kind: { type: 'string', enum: THREAD_KINDS },
        origin_day: STR, fact_ids: ARR(STR), who_said: STR,
      },
      required: ['id', 'what', 'evidence', 'kind'],
    }),
    week: {
      type: 'object',
      properties: { negative: ARR(FINDING_ITEM), neutral: ARR(FINDING_ITEM), positive: ARR(FINDING_ITEM) },
      required: ['negative', 'neutral', 'positive'],
    },
    tone_of_day: STR,
    cautions: ARR(STR),
  },
  required: ['threads', 'week'],
};

export const DEFECTS_SCHEMA = {
  type: 'object',
  properties: {
    defects: ARR({
      type: 'object',
      properties: { where: STR, quote: STR, type: { type: 'string', enum: QA_DEFECT_TYPES }, why: STR, fix: STR },
      required: ['where', 'quote', 'type', 'why', 'fix'],
    }),
  },
  required: ['defects'],
};

/** Veredicto del juez: solo evaluación (paridad, arnés), no producción. */
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    claims: ARR({
      type: 'object',
      properties: {
        section: STR, claim: STR,
        verdict: { type: 'string', enum: ['verdadera', 'verdadera_pero_enganosa', 'exagerada', 'falsa', 'sin_respaldo', 'mal_fechada'] },
        why: STR,
      },
      required: ['section', 'claim', 'verdict', 'why'],
    }),
    headline_drama_0_5: { type: 'integer' },
    old_post_presented_as_day_news: { type: 'boolean' },
    contradictions_between_blocks: ARR(STR),
    notes: STR,
  },
  required: ['claims', 'headline_drama_0_5', 'old_post_presented_as_day_news', 'contradictions_between_blocks'],
};

export interface DraftShape {
  insights: boolean;
  comparison: boolean;
  /** Secciones del scorecard (signal, emerging, crisis). */
  sections?: string[];
}

/** Esquema del borrador según el perfil (el semanal añade comparison[], el scorecard sections). */
export function draftSchema(shape: DraftShape): Record<string, unknown> {
  const properties: Record<string, unknown> = { headline: STR, paragraph: STR, highlights: ARR(STR) };
  const required = ['headline', 'paragraph', 'highlights'];
  if (shape.insights) {
    properties.insights = {
      type: 'object',
      properties: { negative: ARR(STR), neutral: ARR(STR), positive: ARR(STR) },
      required: ['negative', 'neutral', 'positive'],
    };
    required.push('insights');
  }
  if (shape.comparison) { properties.comparison = ARR(STR); required.push('comparison'); }
  if (shape.sections?.length) {
    properties.sections = {
      type: 'object',
      properties: Object.fromEntries(shape.sections.map((k) => [k, {
        type: 'object', properties: { narrative: STR, points: ARR(STR) }, required: ['narrative', 'points'],
      }])),
      required: shape.sections,
    };
    required.push('sections');
  }
  return { type: 'object', properties, required };
}

// ------------------------------------------------------------------ normalizadores

const asStr = (x: unknown): string => (typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x));
const asList = (x: unknown, max = 12): string[] => coerceBulletList(x, max);

/** Bedrock a veces devuelve un objeto anidado como string JSON. */
function asObj(x: unknown): Record<string, unknown> {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>;
  if (typeof x === 'string' && x.trim().startsWith('{')) {
    try { const o = JSON.parse(x); if (o && typeof o === 'object') return o; } catch { /* cae al vacío */ }
  }
  return {};
}

function asObjList(x: unknown): Record<string, unknown>[] {
  let v = x;
  if (typeof v === 'string' && v.trim().startsWith('[')) { try { v = JSON.parse(v); } catch { v = []; } }
  return Array.isArray(v) ? v.filter((o) => o && typeof o === 'object').map((o) => o as Record<string, unknown>) : [];
}

export function normalizeDraft(raw: unknown, shape: DraftShape): Draft {
  const o = asObj(raw);
  if (typeof o.headline !== 'string' || typeof o.paragraph !== 'string') {
    throw new Error('borrador sin headline o paragraph');
  }
  const d: Draft = { headline: o.headline.trim(), paragraph: o.paragraph.trim(), highlights: asList(o.highlights, 6) };
  if (shape.insights) {
    const ins = asObj(o.insights);
    d.insights = { negative: asList(ins.negative, 3), neutral: asList(ins.neutral, 3), positive: asList(ins.positive, 3) };
  }
  if (shape.comparison) d.comparison = asList(o.comparison, 6);
  if (shape.sections?.length) {
    const sec = asObj(o.sections);
    d.sections = Object.fromEntries(shape.sections.map((k): [string, DraftSection] => {
      const s = asObj(sec[k]);
      return [k, { narrative: asStr(s.narrative).trim(), points: asList(s.points, 4) }];
    }));
  }
  return d;
}

export function normalizeFindings(raw: unknown): Findings {
  const o = asObj(raw);
  const threads: FindingThread[] = asObjList(o.threads).map((t, i) => ({
    id: asStr(t.id) || `t${i + 1}`,
    what: asStr(t.what),
    evidence: asList(t.evidence, 40),
    kind: (THREAD_KINDS as string[]).includes(asStr(t.kind)) ? (t.kind as ThreadKind) : 'otro',
    origin_day: t.origin_day ? asStr(t.origin_day) : undefined,
    fact_ids: t.fact_ids ? asList(t.fact_ids, 40) : undefined,
    who_said: t.who_said ? asStr(t.who_said) : undefined,
  }));
  const wk = asObj(o.week);
  const items = (x: unknown): FindingItem[] => asObjList(x).map((it) => ({
    what: asStr(it.what),
    evidence: asList(it.evidence, 40),
    fact_ids: it.fact_ids ? asList(it.fact_ids, 40) : undefined,
    who_said: it.who_said ? asStr(it.who_said) : undefined,
    dates: it.dates ? asStr(it.dates) : undefined,
  }));
  return {
    threads,
    week: { negative: items(wk.negative), neutral: items(wk.neutral), positive: items(wk.positive) },
    tone_of_day: o.tone_of_day ? asStr(o.tone_of_day) : undefined,
    cautions: o.cautions ? asList(o.cautions, 20) : undefined,
  };
}

export function normalizeDefects(raw: unknown): QaDefect[] {
  const o = asObj(raw);
  return asObjList(o.defects).map((d) => ({
    where: asStr(d.where),
    quote: asStr(d.quote),
    type: (QA_DEFECT_TYPES as string[]).includes(asStr(d.type)) ? (d.type as QaDefectType) : 'otro',
    why: asStr(d.why),
    fix: asStr(d.fix),
  }));
}
