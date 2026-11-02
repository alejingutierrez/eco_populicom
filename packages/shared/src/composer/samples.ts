/**
 * Muestras anotadas (spec 10.2): tipo de mención, autor o página, día de
 * escritura en hora PR y, en comentarios, la publicación original con su
 * fecha, su autor y los días que pasaron. Tope de 3 muestras por publicación
 * original con «+N comentarios más sobre esta publicación».
 *
 * El acceso a datos se INYECTA (`ComposerDataAccess`): el motor no depende de
 * pg. Port de `annotate` + `sample_line` del prototipo (agents.py).
 */
import { ymdInTimeZone } from '../dates';
import { formatLongDay } from '../format-period';
import type { AnnotatedParent, AnnotatedSample, AnnotatedSampleSet, MentionKind, SampleGroup } from './types';

export const DEFAULT_TIME_ZONE = 'America/Puerto_Rico';
/** Una publicación original con más de estos días convierte el comentario en reacción tardía. */
export const LATE_REACTION_DAYS = 2;
export const DEFAULT_MAX_PER_THREAD = 3;

/** Muestra tal como la arma el lambda (MentionSample + campos de la v1). */
export interface RawComposerSample {
  id: string;
  createdAt: string;
  text: string;
  sentiment?: string | null;
  topic?: string | null;
  author?: string | null;
  source?: string | null;
  url?: string | null;
  pageType?: string | null;
  pubType?: string | null;
  bwGuid?: string | null;
  /** En comentarios de FB/IG, `title` es el texto del post padre y `snippet` el comentario. */
  title?: string | null;
  snippet?: string | null;
  engagement?: number | null;
  mentionKind?: string | null;
  parentMentionId?: string | null;
  parentPublishedAt?: string | null;
  parentAuthor?: string | null;
  parentText?: string | null;
}

/** Contexto por mención que entrega la capa de datos (columnas de `mentions` y del padre). */
export interface SampleContext {
  bwGuid?: string | null;
  url?: string | null;
  pubType?: string | null;
  pageType?: string | null;
  author?: string | null;
  title?: string | null;
  snippet?: string | null;
  mentionKind?: string | null;
  parentMentionId?: string | null;
  parentPublishedAt?: string | null;
  parentAuthor?: string | null;
  parentText?: string | null;
}

/** Capa de datos inyectada. El lambda la implementa con pg; las pruebas, con un mapa. */
export interface ComposerDataAccess {
  loadSampleContext(ids: string[]): Promise<Record<string, SampleContext>>;
}

export interface RawSampleGroups {
  today?: RawComposerSample[];
  negative?: RawComposerSample[];
  neutral?: RawComposerSample[];
  positive?: RawComposerSample[];
}

export interface AnnotateOptions {
  timeZone?: string;
  /** Máximo de muestras por publicación original y grupo (0 = sin tope). */
  maxPerThread?: number;
  /** Autores o páginas de la propia agencia (para marcar `agency_post`). */
  agencyAuthors?: string[];
}

export const KIND_LABELS: Record<MentionKind, string> = {
  comment: 'comentario de un usuario en una publicación de la agencia',
  article: 'nota de prensa o blog',
  agency_post: 'publicación propia de la agencia',
  third_party_post: 'publicación de un tercero en redes',
  social_post: 'publicación en redes',
};

const GROUP_PREFIX: Record<SampleGroup, string> = { today: 'D', negative: 'N', neutral: 'E', positive: 'P' };
const GROUPS: SampleGroup[] = ['today', 'negative', 'neutral', 'positive'];
const MENTION_KINDS = new Set<MentionKind>(['article', 'agency_post', 'comment', 'third_party_post', 'social_post']);

/**
 * Tipo de mención. Usa `mention_kind` si la fila ya lo tiene (WP-2); si no,
 * la misma heurística del prototipo: URL con `#channels_comment` o GUID de IG
 * con `#` es comentario; page_type news/blog/forum es nota de prensa.
 */
export function deriveSampleKind(s: RawComposerSample & SampleContext, agencyAuthors: string[] = []): MentionKind {
  const explicit = (s.mentionKind ?? '').trim() as MentionKind;
  if (MENTION_KINDS.has(explicit)) return explicit;
  const url = s.url ?? '';
  const guid = s.bwGuid ?? '';
  const pub = (s.pubType ?? '').toUpperCase();
  if (url.includes('#channels_comment') || (guid.includes('#') && pub === 'INSTAGRAM_GRAPH_BUSINESS')) return 'comment';
  const pt = (s.pageType ?? '').toLowerCase();
  if (pt === 'news' || pt === 'blog' || pt === 'forum') return 'article';
  const author = (s.author ?? '').trim().toLowerCase();
  if (author && agencyAuthors.some((a) => a.trim().toLowerCase() === author)) return 'agency_post';
  return 'social_post';
}

function clip(s: string | null | undefined, n: number): string {
  return (s ?? '').slice(0, n);
}

function dayOf(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : ymdInTimeZone(d, tz);
}

/** Anota una muestra cruda con su contexto (sin sid; se numeran después del tope). */
export function annotateOne(raw: RawComposerSample, group: SampleGroup, ctx: SampleContext = {}, opts: AnnotateOptions = {}): AnnotatedSample {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const m = { ...raw, ...Object.fromEntries(Object.entries(ctx).filter(([, v]) => v !== undefined && v !== null)) } as RawComposerSample & SampleContext;
  const kind = deriveSampleKind(m, opts.agencyAuthors);
  const isComment = kind === 'comment';
  const dayYmd = dayOf(raw.createdAt, tz);
  let parent: AnnotatedParent | null = null;
  let text: string;
  if (isComment) {
    const pText = m.parentText ?? (m.title && m.title !== m.snippet ? m.title : null);
    const pPub = m.parentPublishedAt ?? null;
    const pDay = pPub ? dayOf(pPub, tz) : null;
    const age = pPub ? Math.round(((new Date(raw.createdAt).getTime() - new Date(pPub).getTime()) / 86_400_000) * 10) / 10 : null;
    const key = m.parentMentionId ?? (pText || pDay ? `${pDay ?? '?'}|${(pText ?? '').slice(0, 80)}|${m.parentAuthor ?? ''}` : `solo:${raw.id}`);
    parent = pPub || pText || m.parentAuthor
      ? {
          key,
          text: pText ? clip(pText, 220) : null,
          author: m.parentAuthor ?? null,
          publishedAt: pPub,
          dayYmd: pDay,
          dayLabel: pDay ? formatLongDay(pDay) : null,
          ageDays: age !== null && Number.isFinite(age) ? age : null,
        }
      : null;
    text = clip(m.snippet || raw.text, 320);
  } else {
    text = clip(raw.text, 420);
  }
  return {
    sid: '',
    id: raw.id,
    group,
    kind,
    kindLabel: KIND_LABELS[kind],
    isComment,
    author: m.author ?? null,
    source: raw.source ?? null,
    sentiment: raw.sentiment ?? null,
    topic: raw.topic ?? null,
    createdAt: raw.createdAt,
    dayYmd,
    dayLabel: formatLongDay(dayYmd),
    text,
    parent,
    lateReaction: !!(parent && parent.ageDays !== null && parent.ageDays > LATE_REACTION_DAYS),
    url: m.url ?? null,
    engagement: raw.engagement ?? null,
  };
}

/**
 * Tope por hilo y numeración. Por grupo, como máximo `maxPerThread` muestras
 * por publicación original; la última conservada lleva «+N comentarios más».
 * Después numera D1.., N1.., E1.., P1.. en el orden de entrada.
 */
export function capAndNumber(groups: Record<SampleGroup, AnnotatedSample[]>, maxPerThread = DEFAULT_MAX_PER_THREAD): AnnotatedSampleSet {
  const out: AnnotatedSampleSet = {
    today: [], negative: [], neutral: [], positive: [],
    droppedByThreadCap: { today: 0, negative: 0, neutral: 0, positive: 0 },
  };
  for (const g of GROUPS) {
    const list = groups[g] ?? [];
    const kept: AnnotatedSample[] = [];
    const perThread = new Map<string, { count: number; last: AnnotatedSample }>();
    for (const s0 of list) {
      const s = { ...s0, group: g, moreInThread: undefined };
      const key = s.isComment && s.parent ? s.parent.key : null;
      if (key && maxPerThread > 0) {
        const cur = perThread.get(key);
        if (cur && cur.count >= maxPerThread) {
          cur.last.moreInThread = (cur.last.moreInThread ?? 0) + 1;
          out.droppedByThreadCap[g] += 1;
          continue;
        }
        if (cur) { cur.count += 1; cur.last = s; } else perThread.set(key, { count: 1, last: s });
      }
      kept.push(s);
    }
    // `last` es siempre la última conservada del hilo: ahí queda el «+N».
    kept.forEach((s, i) => { s.sid = `${GROUP_PREFIX[g]}${i + 1}`; });
    out[g] = kept;
  }
  return out;
}

/** Anota grupos de muestras crudas con un contexto ya cargado. Pura. */
export function annotateSamples(raw: RawSampleGroups, context: Record<string, SampleContext> = {}, opts: AnnotateOptions = {}): AnnotatedSampleSet {
  const groups = Object.fromEntries(
    GROUPS.map((g) => [g, (raw[g] ?? []).map((s) => annotateOne(s, g, context[s.id] ?? {}, opts))]),
  ) as Record<SampleGroup, AnnotatedSample[]>;
  return capAndNumber(groups, opts.maxPerThread ?? DEFAULT_MAX_PER_THREAD);
}

/** Carga el contexto con la capa inyectada y anota. Si la carga falla, anota sin contexto. */
export async function prepareSamples(
  data: ComposerDataAccess | null | undefined,
  raw: RawSampleGroups,
  opts: AnnotateOptions = {},
): Promise<{ samples: AnnotatedSampleSet; contextError: string | null }> {
  const ids = Array.from(new Set(GROUPS.flatMap((g) => (raw[g] ?? []).map((s) => s.id))));
  let ctx: Record<string, SampleContext> = {};
  let contextError: string | null = null;
  if (data && ids.length > 0) {
    try {
      ctx = await data.loadSampleContext(ids);
    } catch (err) {
      contextError = (err as Error)?.message ?? String(err);
    }
  }
  return { samples: annotateSamples(raw, ctx, opts), contextError };
}

/** Línea de una muestra en el prompt (port de `sample_line`). */
export function sampleLine(a: AnnotatedSample): string {
  let head = `[${a.sid}] ${a.kindLabel}`;
  if (a.author) head += ` | autor/página: ${a.author}`;
  head += ` | escrito el ${a.dayLabel}`;
  const tail = ` | sentimiento ECO: ${a.sentiment ?? 'n/d'} | tópico: ${a.topic ?? 'n/d'}`;
  const more = a.moreInThread ? `\n    (+${a.moreInThread} comentarios más sobre esta publicación en esta lista)` : '';
  if (a.isComment) {
    if (a.parent?.dayLabel) {
      head += ` | PUBLICACIÓN ORIGINAL de ${a.parent.author || 'la agencia'} del ${a.parent.dayLabel}`;
      if (a.parent.ageDays !== null) head += ` (el comentario llegó ${a.parent.ageDays} días después)`;
      if (a.lateReaction) head += ' | REACCIÓN TARDÍA';
    } else {
      head += ' | publicación original de FECHA DESCONOCIDA (no la cuentes como noticia del día)';
    }
    return `${head}${tail}\n    publicación: ${a.parent?.text ?? ''}\n    comentario: ${a.text}${more}`;
  }
  return `${head}${tail}\n    texto: ${a.text}${more}`;
}

export interface SamplesBlockOptions {
  includeToday?: boolean;
  windowDays?: number;
}

/** Bloque de muestras del prompt (día resumido + muestras del periodo por sentimiento). */
export function samplesBlock(set: AnnotatedSampleSet, opts: SamplesBlockOptions = {}): string {
  const n = opts.windowDays ?? 7;
  const parts: string[] = [];
  if (opts.includeToday !== false && set.today.length > 0) {
    parts.push('MENCIONES MÁS RECIENTES DEL DÍA RESUMIDO:\n' + set.today.map(sampleLine).join('\n'));
  }
  const labels: Array<[keyof AnnotatedSampleSet, string]> = [['negative', 'NEGATIVAS'], ['neutral', 'NEUTRALES'], ['positive', 'POSITIVAS']];
  for (const [k, lab] of labels) {
    const list = set[k] as AnnotatedSample[];
    if (list.length === 0) continue;
    parts.push(`MENCIONES ${lab} DE LOS ${n} DÍAS (las de más engagement):\n` + list.map(sampleLine).join('\n'));
  }
  return parts.join('\n\n') || '(sin muestras)';
}

/** Todas las muestras del conjunto, en orden de grupo. */
export function allSamples(set: AnnotatedSampleSet): AnnotatedSample[] {
  return [...set.today, ...set.negative, ...set.neutral, ...set.positive];
}
