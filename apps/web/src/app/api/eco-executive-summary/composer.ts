/**
 * Resumen ejecutivo del Scorecard con el motor de redacción, perfil
 * `scorecard` (WP-8; spec 10.6 y 11.4): las tres secciones (signal, emerging,
 * crisis) salen de UNA pasada del redactor, con analista, QA y corrector, y
 * cifras solo por marcador. Este módulo es puro (sin DB ni SDK): la ruta le
 * pasa el reporte, las muestras ya anotadas y el cliente LLM.
 *
 * La salida conserva la forma `ExecutiveSummaryOutput` que ya guarda
 * `executive_summaries_cache.payload` (la ruta y el SPA no cambian); el
 * motor añade `composer_version` y `composition` dentro del mismo JSONB
 * (la tabla no tiene columnas propias para eso).
 */
import {
  compose,
  COMPOSER_MODEL_OPUS,
  COMPOSER_MODEL_SONNET,
  COMPOSER_VERSION,
  type ComposeResult,
  type ComposerInput,
  type ComposerLlm,
  type ExecutiveSummaryOutput,
  type RoleModels,
} from '@eco/shared';

/**
 * Modelos del Scorecard. La ruta es síncrona (maxDuration 60 s): Sonnet en
 * analista, redactor y corrector; el QA con Opus para que revise una familia
 * distinta de la que redacta (spec 10.1).
 */
export const SCORECARD_MODELS: Partial<RoleModels> = {
  analyst: COMPOSER_MODEL_SONNET,
  writer: COMPOSER_MODEL_SONNET,
  qa: COMPOSER_MODEL_OPUS,
  corrector: COMPOSER_MODEL_SONNET,
};

export interface ScorecardTopic {
  name: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  /** Crecimiento segunda mitad vs primera mitad (null = sin base). */
  deltaPct: number | null;
}

export interface ScorecardInputArgs {
  agencyId: string;
  agencyName: string;
  shortName: string;
  periodLabel: string;
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
  totals: ComposerInput['totals'];
  prevTotals: ComposerInput['totals'];
  dailySeries: ComposerInput['dailySeries'];
  topics: ScorecardTopic[];
  municipalities: Array<{ name: string; count: number }>;
  authors: Array<{ name: string; mentions: number }>;
  samples: ComposerInput['samples'];
  commentShare?: { comments: number; total: number } | null;
  prevCommentShare?: { comments: number; total: number } | null;
}

export function scorecardComposerInput(a: ScorecardInputArgs): ComposerInput {
  const growth = a.topics
    .filter((t) => t.deltaPct != null)
    .slice(0, 5)
    .map((t, i) => ({ id: `topic_growth_${i + 1}`, value: t.deltaPct as number, display: `${(t.deltaPct as number) > 0 ? '+' : ''}${t.deltaPct} %`, label: `crecimiento de «${t.name}» en la segunda mitad del periodo contra la primera` }));
  const authors = a.authors.slice(0, 5).map((x, i) => ({ id: `author_${i + 1}`, value: x.mentions, display: `${x.mentions}`, label: `menciones de «${x.name}»` }));
  return {
    agency: { id: a.agencyId, name: a.agencyName, shortName: a.shortName },
    window: { startYmd: a.startYmd, endYmd: a.endYmd, prevStartYmd: a.prevStartYmd, prevEndYmd: a.prevEndYmd, timeZone: 'America/Puerto_Rico' },
    totals: a.totals,
    prevTotals: a.prevTotals,
    dailySeries: a.dailySeries,
    topics: a.topics.map((t) => ({ topic: t.name, total: t.total, negative: t.negative, neutral: t.neutral, positive: t.positive })),
    municipalities: a.municipalities.map((m) => ({ municipality: m.name, total: m.count })),
    composition: a.commentShare ? { week: a.commentShare, prevWeek: a.prevCommentShare ?? null } : null,
    samples: a.samples,
    extraFacts: [...growth, ...authors],
    extraContext: `PERIODO SELECCIONADO EN EL DASHBOARD (cítalo literal): ${a.periodLabel}.`,
    nameWhitelist: [...a.authors.map((x) => x.name), ...a.municipalities.map((m) => m.name)],
  };
}

const sanitize = (html: string): string => String(html ?? '').replace(/<(?!\/?strong\b)[^>]*>/gi, '').trim();

function tone(t: ScorecardTopic): string {
  if (t.positive > t.negative + t.total * 0.08) return 'Positiva';
  if (t.negative > t.positive + t.total * 0.08) return 'Negativa';
  return 'Mixta';
}

/**
 * Señal dominante y acción de cada modo, por código (el motor no las
 * escribe): el tópico con más menciones (signal), el que más creció
 * (emerging) y el que más negativas tiene (crisis). Mismo formato que el
 * briefing por reglas («Tópico · Tono», «Seguir Tópico →»), que el SPA parte
 * por « · » para abrir el tópico.
 */
export function deterministicSignals(topics: ScorecardTopic[]): Record<'signal' | 'emerging' | 'crisis', { dominant: string; action: string }> {
  const none = { dominant: 'Sin señal dominante · Neutral', action: 'Explorar tópicos activos →' };
  const pick = (t: ScorecardTopic | undefined) => (t ? { dominant: `${t.name} · ${tone(t)}`, action: `Seguir ${t.name} →` } : none);
  const byTotal = [...topics].sort((a, b) => b.total - a.total);
  const byGrowth = topics.filter((t) => t.deltaPct != null && t.deltaPct > 0 && t.total >= 5).sort((a, b) => (b.deltaPct as number) - (a.deltaPct as number));
  const byNeg = topics.filter((t) => t.negative > 0).sort((a, b) => b.negative - a.negative);
  return { signal: pick(byTotal[0]), emerging: pick(byGrowth[0]), crisis: pick(byNeg[0]) };
}

export type ComposedExecutiveSummary = ExecutiveSummaryOutput & {
  composer_version: string;
  composition: unknown;
};

/** Borrador del motor → `ExecutiveSummaryOutput` (+ versión y composición). */
export function executiveSummaryFromComposition(r: ComposeResult, topics: ScorecardTopic[]): ComposedExecutiveSummary {
  const sec = r.final.sections ?? {};
  const sig = deterministicSignals(topics);
  const mode = (k: 'signal' | 'emerging' | 'crisis') => {
    const s = sec[k] ?? { narrative: '', points: [] };
    // La sección vacía (red de seguridad) cae al párrafo del periodo: el SPA
    // no muestra un bloque en blanco.
    const narrative = sanitize(s.narrative) || (k === 'signal' ? sanitize(r.final.paragraph) : '');
    return { narrative, points: (s.points ?? []).map(sanitize).filter(Boolean).slice(0, 2) };
  };
  const s = mode('signal');
  const e = mode('emerging');
  const c = mode('crisis');
  return {
    signal_narrative: s.narrative,
    signal_points: s.points,
    signal_dominant: sig.signal.dominant,
    signal_action: sig.signal.action,
    emerging_narrative: e.narrative,
    emerging_points: e.points,
    emerging_dominant: sig.emerging.dominant,
    emerging_action: sig.emerging.action,
    crisis_narrative: c.narrative,
    crisis_points: c.points,
    crisis_dominant: sig.crisis.dominant,
    crisis_action: sig.crisis.action,
    composer_version: COMPOSER_VERSION,
    composition: r.composition,
  };
}

export async function composeScorecard(input: ComposerInput, llm: ComposerLlm | null, log?: (m: string) => void): Promise<ComposeResult> {
  return compose('scorecard', input, { llm, models: SCORECARD_MODELS, retries: 2, backoffMs: 1500, log });
}
