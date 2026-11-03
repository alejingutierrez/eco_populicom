/**
 * Correo diario con el motor de redacción (WP-6; spec interpretación v1,
 * secciones 10 y 11.1).
 *
 * Aquí se arma la entrada del motor (`ComposerInput`) con las MISMAS cifras
 * que muestra el correo, se corre `compose('daily', …)` con plazo, y se decide
 * si una composición guardada (anticipada) sigue valiendo en el momento del
 * envío. El render y el envío siguen en `index.ts`.
 *
 * Nada de este módulo corre con `composer_mode = legacy`.
 */
import {
  allSamples,
  buildFactPackage,
  buildLintContext,
  commentShare,
  compose,
  fillDraft,
  loadChannels,
  loadEmotions,
  loadMunicipalityPartition,
  prepareSamples,
  safetyNet,
  stripTags,
  type AnnotatedSampleSet,
  type ComposeOptions,
  type ComposeResult,
  type Composition,
  type ComposerInput,
  type ComposerLlm,
  type Draft,
  type PgClientLike,
  type SentimentReport,
} from '@eco/shared';
import { AGENCY_OWN_AUTHORS } from '../lib/mention-kind';
import type { Queryable } from '../lib/parent-resolver';
import {
  createPgComposerDataAccess,
  loadComposerSamples,
  MAIL_UNIVERSE,
  MAX_SAMPLES_PER_GROUP,
  namesWithDigits,
  type ParentResolutionStats,
} from './composer-data';
import { markerIds, withinDriftTolerance, type StoredState } from './composer-mode';
import type { StoredComposition } from './compositions-store';

export const REPORT_TIMEZONE = 'America/Puerto_Rico';

export interface DailyComposeAgency {
  id: string;
  slug: string;
  name: string;
  shortName: string;
}

export interface DailyComposeWindow {
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
}

export interface DailyComposerInputResult {
  input: ComposerInput;
  /** Cómo se resolvieron los padres de los comentarios de las muestras. */
  parentStats: ParentResolutionStats | null;
  contextError: string | null;
  /** Composición de la semana y de la previa (comentarios de usuarios en redes propias). */
  share: { week: { total: number; comments: number }; prevWeek: { total: number; comments: number } };
}

/**
 * Recorta cada grupo, ya topado por hilo y numerado, a N muestras. Los sids
 * siguen siendo consecutivos (D1..DN) porque se corta por el final.
 */
export function trimGroups(set: AnnotatedSampleSet, max: number): AnnotatedSampleSet {
  return {
    ...set,
    today: set.today.slice(0, max),
    negative: set.negative.slice(0, max),
    neutral: set.neutral.slice(0, max),
    positive: set.positive.slice(0, max),
  };
}

/**
 * Entrada del motor para el diario. Totales, serie y tópicos salen del MISMO
 * `SentimentReport` que pinta el correo; fuentes, municipios, emociones y la
 * composición se cuentan con el mismo universo (`MAIL_UNIVERSE`) y en días PR.
 * Con `withSamples: false` no carga muestras (sirve para comparar cifras de
 * una composición guardada contra las del envío).
 */
export async function buildDailyComposerInput(
  client: Queryable & PgClientLike,
  agency: DailyComposeAgency,
  window: DailyComposeWindow,
  report: SentimentReport,
  opts: { withSamples?: boolean } = {},
): Promise<DailyComposerInputResult> {
  const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;
  const pg = client as PgClientLike;
  const [channels, munis, emotions, shareCur, sharePrev] = await Promise.all([
    loadChannels(pg, agency.id, startYmd, endYmd, MAIL_UNIVERSE),
    loadMunicipalityPartition(pg, agency.id, startYmd, endYmd, MAIL_UNIVERSE),
    loadEmotions(pg, agency.id, startYmd, endYmd, MAIL_UNIVERSE),
    commentShare(pg, agency.id, { startYmd, endYmd }, MAIL_UNIVERSE),
    commentShare(pg, agency.id, { startYmd: prevStartYmd, endYmd: prevEndYmd }, MAIL_UNIVERSE),
  ]);

  let samples: AnnotatedSampleSet = { today: [], negative: [], neutral: [], positive: [], droppedByThreadCap: { today: 0, negative: 0, neutral: 0, positive: 0 } };
  let parentStats: ParentResolutionStats | null = null;
  let contextError: string | null = null;
  let names: string[] = [];
  if (opts.withSamples !== false) {
    const raw = await loadComposerSamples(client, agency.id, { startYmd, endYmd, dayYmd: endYmd });
    const data = createPgComposerDataAccess(client, { id: agency.id, slug: agency.slug, name: agency.name });
    const prepared = await prepareSamples(data, raw, {
      timeZone: REPORT_TIMEZONE,
      agencyAuthors: [agency.name, ...(AGENCY_OWN_AUTHORS[agency.slug] ?? [])],
    });
    samples = trimGroups(prepared.samples, MAX_SAMPLES_PER_GROUP);
    contextError = prepared.contextError;
    parentStats = data.stats();
    names = namesWithDigits(raw);
    for (const s of allSamples(samples)) if (s.parent?.author && /\d/.test(s.parent.author)) names.push(s.parent.author);
  }

  const share = {
    week: { total: shareCur.total, comments: shareCur.comments },
    prevWeek: { total: sharePrev.total, comments: sharePrev.comments },
  };
  const input: ComposerInput = {
    agency: { id: agency.id, name: agency.name, shortName: agency.shortName },
    window: { startYmd, endYmd, prevStartYmd, prevEndYmd, dayYmd: endYmd, timeZone: REPORT_TIMEZONE },
    totals: report.totals,
    prevTotals: report.prevTotals,
    deltaVsPrev: report.deltaVsPrev,
    dailySeries: report.dailySeries.map((d) => ({ date: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive })),
    topics: report.topicsTable
      .filter((t) => !t.isOther && !t.isUnclassified)
      .map((t) => ({ topic: t.topic, total: t.total, negative: t.negative, neutral: t.neutral, positive: t.positive })),
    sources: channels.map((c) => ({ source: c.label, mentions: c.total })),
    municipalities: munis.filter((m) => !m.isUnassigned).map((m) => ({ municipality: m.name, total: m.total, negative: m.negative })),
    emotions: emotions.rows.map((e) => ({ emotion: e.emotion, count: e.count })),
    composition: share,
    samples,
    nameWhitelist: Array.from(new Set(names)),
  };
  return { input, parentStats, contextError, share };
}

/** Resultado de `composeWithDeadline`: `null` si el motor no terminó a tiempo. */
export interface TimedCompose {
  result: ComposeResult | null;
  timedOut: boolean;
  seconds: number;
}

/**
 * `compose(profile)` con plazo (`daily` por defecto; el semanal pasa
 * `weekly`, WP-7). El motor nunca lanza, pero puede tardar (3 roles Opus + QA
 * Sonnet, reintentos): si pasa el plazo, se devuelve `timedOut` y el caller
 * envía el texto legacy. La promesa del motor sigue corriendo en segundo
 * plano y se descarta.
 */
export async function composeWithDeadline(
  input: ComposerInput,
  opts: { llm: ComposerLlm | null; dryRun: boolean; deadlineMs: number; log?: (m: string) => void; compose?: typeof compose; options?: Partial<ComposeOptions>; profile?: 'daily' | 'weekly' },
): Promise<TimedCompose> {
  const t0 = Date.now();
  const run = (opts.compose ?? compose)(opts.profile ?? 'daily', input, { llm: opts.llm, dryRun: opts.dryRun, log: opts.log, ...(opts.options ?? {}) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, opts.deadlineMs)); });
  try {
    const result = await Promise.race([run, timeout]);
    return { result, timedOut: result === null, seconds: (Date.now() - t0) / 1000 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** ¿El texto del motor sirve para enviarse? (el redactor produjo texto; no es el determinista). */
export function isSendableComposition(c: Pick<Composition, 'draft1Raw' | 'final'> | null | undefined): boolean {
  return !!(c && c.draft1Raw && c.final && typeof c.final.headline === 'string' && c.final.headline.trim().length > 0);
}

export interface StoredEvaluation {
  state: StoredState;
  /** Texto a enviar si `state` es fresh o refreshable. */
  final: Draft | null;
  /** Cifras citadas que cambiaron: id → [guardada, actual]. */
  changed: Record<string, [number | null, number | null]>;
  reason: string;
}

/**
 * Compara la composición guardada con los datos del envío.
 *   - `missing`: no hay, está degradada o es de otra ventana.
 *   - `fresh`: todas las cifras que cita el texto (marcadores `{{id}}` de los
 *     borradores) siguen iguales → se envía tal cual.
 *   - `refreshable`: alguna cambió poco (llegadas tardías) → se re-rellenan los
 *     marcadores con las cifras de ahora y se vuelve a pasar la red de
 *     seguridad (código, sin modelo).
 *   - `stale`: alguna cambió demasiado o ya no existe → recomponer.
 */
export function evaluateStoredComposition(
  stored: StoredComposition | null,
  fresh: ComposerInput,
  window: DailyComposeWindow,
  /** `day` para el diario, `period` para el semanal (WP-7): alcance de la red de seguridad. */
  scope: 'day' | 'period' = 'day',
): StoredEvaluation {
  const none = (reason: string): StoredEvaluation => ({ state: 'missing', final: null, changed: {}, reason });
  if (!stored) return none('sin composición guardada');
  const c = stored.composition;
  if (stored.status !== 'complete' || !isSendableComposition(c)) return none(`composición guardada ${stored.status}`);
  if (c.window?.startYmd !== window.startYmd || c.window?.endYmd !== window.endYmd) {
    return none(`composición guardada de otra ventana (${c.window?.startYmd}..${c.window?.endYmd})`);
  }
  const pkg = buildFactPackage(fresh);
  const used = markerIds([c.draft1Raw, c.draft2Raw]);
  const changed: StoredEvaluation['changed'] = {};
  let stale = false;
  for (const id of used) {
    const before = c.facts?.[id]?.value;
    const now = pkg.facts[id]?.value;
    if (before === undefined) continue; // marcador inválido ya tratado por la red de seguridad
    if (now === undefined) { changed[id] = [before, null]; stale = true; continue; }
    if (now !== before) {
      changed[id] = [before, now];
      if (!withinDriftTolerance(before, now)) stale = true;
    }
  }
  if (stale) return { state: 'stale', final: null, changed, reason: 'cifras citadas cambiaron más de la tolerancia' };
  if (Object.keys(changed).length === 0) return { state: 'fresh', final: c.final, changed, reason: 'cifras citadas sin cambios' };

  // Re-relleno por código: el borrador elegido (corrector o redactor, con el
  // titular revertido si la red lo revirtió) + cifras de ahora + red de seguridad.
  const reverted = (c.safetyNetLog ?? []).some((e) => e.action === 'titular_revertido');
  const base = (c.draft2Raw ?? c.draft1Raw) as Draft;
  const chosen: Draft = reverted && c.draft1Raw ? { ...base, headline: c.draft1Raw.headline } : base;
  const samples = (c.samples ?? fresh.samples) as AnnotatedSampleSet;
  const names = Array.from(new Set([
    ...(fresh.nameWhitelist ?? []),
    ...allSamples(samples).flatMap((s) => [s.author, s.source, s.parent?.author]).filter((n): n is string => !!n && /\d/.test(n)),
  ]));
  const lintCtx = buildLintContext(pkg, samples, names);
  const filled = fillDraft(chosen, pkg.facts, { keepInvalid: true }).filled;
  const net = safetyNet(filled, pkg, lintCtx, scope);
  return { state: 'refreshable', final: net.draft, changed, reason: 'cifras citadas re-rellenadas' };
}

/** Texto del motor en la forma del render del diario. El titular va en texto plano (el render lo escapa). */
export function draftToDailyText(d: Draft): {
  headline: string;
  paragraph: string;
  highlights: string[];
  insights: { negative: string[]; neutral: string[]; positive: string[] };
} {
  const clean = (xs: unknown): string[] => (Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
  return {
    headline: stripTags(d.headline ?? '').replace(/\s+/g, ' ').trim(),
    paragraph: (d.paragraph ?? '').trim(),
    highlights: clean(d.highlights).slice(0, 4),
    insights: {
      negative: clean(d.insights?.negative).slice(0, 2),
      neutral: clean(d.insights?.neutral).slice(0, 2),
      positive: clean(d.insights?.positive).slice(0, 2),
    },
  };
}

/** Bloque `delivery` que se añade a la composición archivada en report_send_log. */
export interface DeliveryRecord {
  /** Correo al que pertenece el envío (el semanal se distingue en report_send_log por template_key). */
  reportType?: 'daily' | 'weekly';
  mode: 'shadow' | 'agentic';
  /** De dónde salió el texto ENVIADO. */
  sentText: 'composer' | 'legacy';
  /** De dónde salió la composición archivada. */
  compositionSource: 'stored' | 'stored_refreshed' | 'composed_now' | 'none';
  reason: string;
  changedFacts?: Record<string, [number | null, number | null]>;
  composeSeconds?: number;
  /** Texto legacy enviado (shadow o caída a legacy), para comparar en la sombra. */
  legacyText?: { headline: string; paragraph: string; highlights: string[]; insights: { negative: string[]; neutral: string[]; positive: string[] } };
  parentStats?: ParentResolutionStats | null;
  contextError?: string | null;
  errors?: string[];
}
