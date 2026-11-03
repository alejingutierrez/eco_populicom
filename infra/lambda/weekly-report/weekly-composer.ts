/**
 * Correo SEMANAL con el motor de redacción (WP-7; spec interpretación v1,
 * secciones 10 y 11.2).
 *
 * Arma la entrada del motor (`ComposerInput`, perfil `weekly`) con las MISMAS
 * cifras que muestra el correo semanal: totales de la semana y de la previa,
 * los 4 indicadores compuestos tal como salen en las lecturas (escala pública
 * ya formateada), la tabla de tópicos (subieron, bajaron, nuevos y sin
 * menciones esta semana) y la composición de comentarios de las dos semanas.
 * Las cifras propias del semanal entran como `extraFacts` del paquete de
 * hechos: el motor no se toca.
 *
 * Nada de este módulo corre con `composer_mode = legacy`.
 */
import {
  commentShare,
  loadChannels,
  loadEmotions,
  loadMunicipalityPartition,
  prepareSamples,
  allSamples,
  stripTags,
  FACT_MIN_DELTA_BASE,
  type AnnotatedSampleSet,
  type ComposerInput,
  type DeltaDisplay,
  type Draft,
  type Fact,
  type PgClientLike,
  type SentimentReport,
} from '@eco/shared';
import { AGENCY_OWN_AUTHORS } from '../lib/mention-kind';
import type { Queryable } from '../lib/parent-resolver';
import { createPgComposerDataAccess, loadComposerSamples, MAIL_UNIVERSE, MAX_SAMPLES_PER_GROUP, namesWithDigits, type ParentResolutionStats } from './composer-data';
import { REPORT_TIMEZONE, trimGroups, type DailyComposeAgency, type DailyComposeWindow } from './daily-composer';

/** Cambio mínimo (menciones) para que un tópico cuente como «sube», «baja», «nuevo» o «sin menciones». */
export const MIN_TOPIC_MOVE = 3;
/** Tópicos por lista de movimientos que llegan al motor. */
export const MAX_TOPIC_MOVES = 3;

export interface WeeklyTopicCount {
  topic: string;
  total: number;
  negative: number;
}

/** Un indicador compuesto tal como lo ve el lector en las lecturas del correo. */
export interface WeeklyIndicator {
  key: 'crisis' | 'nss' | 'bhi' | 'polarization';
  label: string;
  /** Valor formateado de la semana («12%», «+11.5», «6.4 / 10»). null si no hay dato. */
  cur: string | null;
  /** Valor formateado de la semana previa. */
  prev: string | null;
  /** Delta semanal tal como lo pinta el correo («+5 pts», «−0.3»). */
  delta?: DeltaDisplay | null;
}

export interface TopicMove {
  topic: string;
  cur: number;
  prev: number;
}

export interface TopicMoves {
  up: TopicMove[];
  down: TopicMove[];
  fresh: TopicMove[];
  gone: TopicMove[];
}

/**
 * Movimientos de tópicos entre dos semanas (conteo completo por tópico
 * principal, el mismo de la tabla del correo):
 *   - up: con menciones las dos semanas y al menos MIN_TOPIC_MOVE más;
 *   - down: con menciones esta semana y al menos MIN_TOPIC_MOVE menos;
 *   - fresh: sin menciones la semana previa y al menos MIN_TOPIC_MOVE ahora;
 *   - gone: sin menciones esta semana y al menos MIN_TOPIC_MOVE la previa.
 * Orden: magnitud del cambio, luego nombre (estable).
 */
export function topicMoves(cur: WeeklyTopicCount[], prev: WeeklyTopicCount[], min = MIN_TOPIC_MOVE, max = MAX_TOPIC_MOVES): TopicMoves {
  const pm = new Map(prev.map((t) => [t.topic, t.total]));
  const cm = new Map(cur.map((t) => [t.topic, t.total]));
  const names = Array.from(new Set([...cur.map((t) => t.topic), ...prev.map((t) => t.topic)]));
  const all = names.map((topic) => ({ topic, cur: cm.get(topic) ?? 0, prev: pm.get(topic) ?? 0 }));
  const by = (f: (m: TopicMove) => number) => (a: TopicMove, b: TopicMove) => f(b) - f(a) || a.topic.localeCompare(b.topic);
  return {
    up: all.filter((m) => m.prev > 0 && m.cur - m.prev >= min).sort(by((m) => m.cur - m.prev)).slice(0, max),
    down: all.filter((m) => m.cur > 0 && m.prev - m.cur >= min).sort(by((m) => m.prev - m.cur)).slice(0, max),
    fresh: all.filter((m) => m.prev === 0 && m.cur >= min).sort(by((m) => m.cur)).slice(0, max),
    gone: all.filter((m) => m.cur === 0 && m.prev >= min).sort(by((m) => m.prev)).slice(0, max),
  };
}

/** Número de un valor ya formateado («+11.5», «−0.3», «12%», «6.4 / 10» → 6.4). null si no hay. */
export function numberFromDisplay(display: string | null | undefined): number | null {
  if (!display) return null;
  const m = display.replace(/−/g, '-').match(/[+-]?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** El mismo valor sin el signo inicial («+5 pts» → «5 pts», «−0.3» → «0.3»). */
function unsignedDisplay(display: string): string {
  return display.replace(/^[+\-−]\s*/, '');
}

const pctRound = (num: number, den: number) => Math.round((100 * num) / den);

function fact(id: string, value: number, display: string, label: string): Fact {
  return { id, value, display, label };
}

/**
 * Hechos propios del semanal (van como `extraFacts`; el paquete base del
 * motor ya trae week_*, prev_week_*, la serie, topic_1..5, fuentes,
 * municipios, emociones y la composición).
 *
 *   - Variaciones de la semana SIN signo: se REEMPLAZAN los week_*_delta_abs
 *     y week_*_delta_pct del paquete base (un extraFact con el mismo id gana)
 *     por su magnitud, con la dirección en la etiqueta. El correo dice
 *     «bajó 61 %», nunca «bajó -61 %» (doble signo visto en el diario). El
 *     porcentaje, como en el paquete base, solo con base previa ≥ minBase.
 *   - % de cada sentimiento en la semana previa (prev_week_*_pct).
 *   - Indicadores compuestos (ind_*): valor de la semana y de la previa con
 *     el MISMO texto que las lecturas del correo, y la variación sin signo con
 *     la dirección en la etiqueta. El valor numérico es el que aparece en el
 *     texto, para que el lint lo reconozca.
 *   - Tópicos: semana previa de topic_1..5 y movimientos (topic_up_*,
 *     topic_down_*, topic_new_*, topic_gone_*), también sin signo.
 */
export function buildWeeklyExtraFacts(opts: {
  totals: { negative: number; neutral: number; positive: number; total: number };
  prevTotals: { negative: number; neutral: number; positive: number; total: number };
  indicators: WeeklyIndicator[];
  topics: WeeklyTopicCount[];
  prevTopics: WeeklyTopicCount[];
  minBase?: number;
}): Fact[] {
  const minBase = opts.minBase ?? FACT_MIN_DELTA_BASE;
  const out: Fact[] = [];
  const keys: Array<['total' | 'negative' | 'neutral' | 'positive', string, string]> = [
    ['total', 'total', 'menciones'],
    ['negative', 'neg', 'negativas'],
    ['neutral', 'neu', 'neutrales'],
    ['positive', 'pos', 'positivas'],
  ];
  for (const [k, short, lab] of keys) {
    const cur = opts.totals[k];
    const prev = opts.prevTotals[k];
    const diff = cur - prev;
    const verb = diff > 0 ? 'di «subió», «más» o «aumentó»' : 'di «bajó», «menos» o «cayó»';
    out.push(fact(`week_${short}_delta_abs`, Math.abs(diff), `${Math.abs(diff)}`,
      diff === 0
        ? `${lab}: la misma cifra que el periodo previo`
        : `${lab} de ${diff > 0 ? 'MÁS' : 'MENOS'} que el periodo previo (sin signo; ${verb})`));
    if (prev >= minBase && prev > 0) {
      const p = Math.abs(Math.round((100 * diff) / prev));
      out.push(fact(`week_${short}_delta_pct`, p, `${p} %`,
        p === 0
          ? `variación % de ${lab} contra el periodo previo: sin cambio`
          : `% de ${diff > 0 ? 'AUMENTO' : 'CAÍDA'} de ${lab} contra el periodo previo (sin signo; ${verb})`));
    }
    if (k !== 'total' && opts.prevTotals.total > 0) {
      const p = pctRound(prev, opts.prevTotals.total);
      out.push(fact(`prev_week_${short}_pct`, p, `${p} %`, `% de ${lab} sobre el total del periodo previo`));
    }
  }

  for (const ind of opts.indicators) {
    const id = `ind_${ind.key}`;
    const cur = numberFromDisplay(ind.cur);
    if (ind.cur && cur !== null) out.push(fact(id, cur, ind.cur, `${ind.label} de la semana (indicador compuesto, tal como sale en el correo)`));
    const prev = numberFromDisplay(ind.prev);
    if (ind.prev && prev !== null) out.push(fact(`${id}_prev`, prev, ind.prev, `${ind.label} de la semana previa`));
    const d = ind.delta;
    const dv = numberFromDisplay(d?.value ?? null);
    if (d && d.hasBaseline && d.value && dv !== null) {
      out.push(fact(`${id}_delta`, Math.abs(dv), unsignedDisplay(d.value),
        dv === 0 ? `${ind.label}: sin cambio contra la semana previa` : `cuánto ${dv > 0 ? 'SUBIÓ' : 'BAJÓ'} ${ind.label} contra la semana previa (sin signo)`));
    }
    // «6.4 / 10»: el 10 de la escala no es una cifra sin fuente.
    if (ind.key === 'bhi' && (ind.cur || ind.prev)) out.push(fact('ind_bhi_scale', 10, '10', 'máximo de la escala de Salud de marca'));
  }

  const prevMap = new Map(opts.prevTopics.map((t) => [t.topic, t.total]));
  opts.topics.slice(0, 5).forEach((t, i) => {
    const p = prevMap.get(t.topic) ?? 0;
    out.push(fact(`topic_${i + 1}_prev`, p, `${p}`, `menciones del tópico «${t.topic}» la semana previa`));
  });

  const moves = topicMoves(opts.topics, opts.prevTopics);
  moves.up.forEach((m, i) => {
    const id = `topic_up_${i + 1}`;
    out.push(fact(id, m.cur, `${m.cur}`, `menciones esta semana del tópico «${m.topic}», que subió contra la semana previa`));
    out.push(fact(`${id}_prev`, m.prev, `${m.prev}`, `menciones la semana previa del tópico «${m.topic}»`));
    out.push(fact(`${id}_rise`, m.cur - m.prev, `${m.cur - m.prev}`, `menciones de más del tópico «${m.topic}» contra la semana previa (sin signo)`));
    if (m.prev >= minBase) {
      const p = pctRound(m.cur - m.prev, m.prev);
      out.push(fact(`${id}_rise_pct`, p, `${p} %`, `% de aumento del tópico «${m.topic}» contra la semana previa (sin signo)`));
    }
  });
  moves.down.forEach((m, i) => {
    const id = `topic_down_${i + 1}`;
    out.push(fact(id, m.cur, `${m.cur}`, `menciones esta semana del tópico «${m.topic}», que bajó contra la semana previa`));
    out.push(fact(`${id}_prev`, m.prev, `${m.prev}`, `menciones la semana previa del tópico «${m.topic}»`));
    out.push(fact(`${id}_drop`, m.prev - m.cur, `${m.prev - m.cur}`, `menciones de menos del tópico «${m.topic}» contra la semana previa (sin signo)`));
    if (m.prev >= minBase) {
      const p = pctRound(m.prev - m.cur, m.prev);
      out.push(fact(`${id}_drop_pct`, p, `${p} %`, `% de caída del tópico «${m.topic}» contra la semana previa (sin signo)`));
    }
  });
  moves.fresh.forEach((m, i) => {
    out.push(fact(`topic_new_${i + 1}`, m.cur, `${m.cur}`, `menciones esta semana del tópico «${m.topic}», que no tuvo menciones la semana previa`));
  });
  moves.gone.forEach((m, i) => {
    out.push(fact(`topic_gone_${i + 1}_prev`, m.prev, `${m.prev}`, `menciones la semana previa del tópico «${m.topic}», que no tuvo menciones esta semana`));
  });
  return out;
}

const COUNT_WORDS = ['ninguno', 'uno', 'dos', 'tres'];

/** «topic_up_1 «A», topic_up_2 «B»» para el contexto (sin cifras propias). */
function movesLine(prefix: string, list: TopicMove[], idOf: (i: number) => string): string {
  return list.map((m, i) => `${idOf(i)} «${m.topic}»`).join(', ') || prefix;
}

/** Contexto en texto para el motor (sin cifras propias: las cifras van por marcador). */
export function weeklyExtraContext(opts: { hasComments: boolean; moves: TopicMoves }): string {
  const m = opts.moves;
  const lines = [
    'Correo SEMANAL comparativo: la semana cerrada contra la semana previa (las dos de siete días calendario).',
    'INDICADORES COMPUESTOS: cítalos solo con sus marcadores ind_* (son números en la escala del correo: Riesgo de crisis y Polarización en %, Sentimiento neto con signo, Salud de marca sobre diez). No uses palabras de nivel como alerta, sano, crítico o débil: el correo muestra números. Si un indicador cambió poco o nada, no lo presentes como un cambio. No expliques por qué cambió un indicador ni digas que un cambio «refleja» algo, salvo que un hecho lo diga.',
    'VARIACIONES: week_*_delta_abs, week_*_delta_pct, ind_*_delta, *_rise y *_drop NO llevan signo: la dirección está en su etiqueta y la dice el verbo («bajó {{week_total_delta_pct}}», «{{week_neg_delta_abs}} negativas más»). Nunca pongas un signo + o − delante de un marcador.',
    'TÓPICOS: la tabla del correo cuenta cada mención (también las de pertinencia baja) en su tópico principal, así que los tópicos no suman los totales de menciones. Un tópico de topic_new_* no tuvo menciones la semana previa: es nuevo SOLO en esta comparación de dos semanas, no digas que «apareció por primera vez».',
    `Tópicos que SUBEN al menos tres menciones (${COUNT_WORDS[m.up.length] ?? m.up.length}): ${movesLine('ninguno', m.up, (i) => `topic_up_${i + 1}`)}.`,
    `Tópicos que BAJAN al menos tres menciones (${COUNT_WORDS[m.down.length] ?? m.down.length}): ${movesLine('ninguno', m.down, (i) => `topic_down_${i + 1}`)}.`,
    `Tópicos SIN menciones la semana previa: ${movesLine('ninguno', m.fresh, (i) => `topic_new_${i + 1}`)}. Tópicos SIN menciones esta semana: ${movesLine('ninguno', m.gone, (i) => `topic_gone_${i + 1}_prev`)}.`,
    'Con varias subidas o bajadas, no digas que un tópico fue «el único» en subir o bajar; las listas están limitadas a las tres más grandes.',
  ];
  if (opts.hasComments) {
    lines.push('COMPOSICIÓN: comment_share_week y comment_share_prev_week dicen qué parte de las menciones son comentarios de usuarios en publicaciones de redes de la agencia. Si cambió mucho, dilo en la comparación: los totales no comparan el mismo tipo de conversación.');
  } else {
    lines.push('COMPOSICIÓN: no hubo comentarios en publicaciones de redes de la agencia en ninguna de las dos semanas; no hables de comentarios en redes propias.');
  }
  return lines.join('\n');
}

export interface WeeklyComposerInputResult {
  input: ComposerInput;
  parentStats: ParentResolutionStats | null;
  contextError: string | null;
  share: { week: { total: number; comments: number }; prevWeek: { total: number; comments: number } };
  /** ¿Hubo comentarios en redes propias en alguna de las dos semanas? (chip y contexto). */
  hasComments: boolean;
}

/** ¿El chip de composición dice algo? Solo si alguna de las dos semanas redondea a más de 0 %. */
export function shareHasComments(share: WeeklyComposerInputResult['share']): boolean {
  const p = (c: { total: number; comments: number }) => (c.total > 0 ? Math.round((100 * c.comments) / c.total) : 0);
  return share.week.total > 0 && (p(share.week) > 0 || p(share.prevWeek) > 0);
}

/**
 * Entrada del motor para el semanal. Totales y serie salen de los MISMOS
 * `SentimentReport` de la semana y de la previa que pinta el correo; los
 * tópicos, de los conteos completos de la tabla; fuentes, municipios,
 * emociones y composición, con el universo del correo (`MAIL_UNIVERSE`) en
 * días PR. Muestras: solo las de la semana por sentimiento (el perfil
 * `weekly` no usa las del día). `withSamples: false` sirve para comparar las
 * cifras de una composición guardada contra las del envío.
 */
export async function buildWeeklyComposerInput(
  client: Queryable & PgClientLike,
  agency: DailyComposeAgency,
  window: DailyComposeWindow,
  data: {
    curReport: SentimentReport;
    prevReport: SentimentReport;
    indicators: WeeklyIndicator[];
    topics: WeeklyTopicCount[];
    prevTopics: WeeklyTopicCount[];
  },
  opts: { withSamples?: boolean } = {},
): Promise<WeeklyComposerInputResult> {
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
    const raw = await loadComposerSamples(client, agency.id, { startYmd, endYmd, dayYmd: endYmd }, { includeToday: false });
    const access = createPgComposerDataAccess(client, { id: agency.id, slug: agency.slug, name: agency.name });
    const prepared = await prepareSamples(access, raw, {
      timeZone: REPORT_TIMEZONE,
      agencyAuthors: [agency.name, ...(AGENCY_OWN_AUTHORS[agency.slug] ?? [])],
    });
    samples = trimGroups(prepared.samples, MAX_SAMPLES_PER_GROUP);
    contextError = prepared.contextError;
    parentStats = access.stats();
    names = namesWithDigits(raw);
    for (const s of allSamples(samples)) if (s.parent?.author && /\d/.test(s.parent.author)) names.push(s.parent.author);
  }

  const share = {
    week: { total: shareCur.total, comments: shareCur.comments },
    prevWeek: { total: sharePrev.total, comments: sharePrev.comments },
  };
  const hasComments = shareHasComments(share);
  const cur = data.curReport;
  const prev = data.prevReport;
  const moves = topicMoves(data.topics, data.prevTopics);
  const input: ComposerInput = {
    agency: { id: agency.id, name: agency.name, shortName: agency.shortName },
    window: { startYmd, endYmd, prevStartYmd, prevEndYmd, dayYmd: null, timeZone: REPORT_TIMEZONE },
    totals: cur.totals,
    prevTotals: prev.totals,
    dailySeries: cur.dailySeries.map((d) => ({ date: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive })),
    prevDailySeries: prev.dailySeries.map((d) => ({ date: d.date, negative: d.negative, neutral: d.neutral, positive: d.positive })),
    topics: data.topics.map((t) => ({ topic: t.topic, total: t.total, negative: t.negative })),
    sources: channels.map((c) => ({ source: c.label, mentions: c.total })),
    municipalities: munis.filter((m) => !m.isUnassigned).map((m) => ({ municipality: m.name, total: m.total, negative: m.negative })),
    emotions: emotions.rows.map((e) => ({ emotion: e.emotion, count: e.count })),
    composition: share,
    samples,
    extraFacts: buildWeeklyExtraFacts({ totals: cur.totals, prevTotals: prev.totals, indicators: data.indicators, topics: data.topics, prevTopics: data.prevTopics }),
    extraContext: weeklyExtraContext({ hasComments, moves }),
    nameWhitelist: Array.from(new Set([...names, ...data.topics.map((t) => t.topic), ...data.prevTopics.map((t) => t.topic)].filter((n) => /\d/.test(n)))),
  };
  return { input, parentStats, contextError, share, hasComments };
}

/** Texto del motor en la forma del render del semanal. El titular va en texto plano (el render lo escapa). */
export function draftToWeeklyText(d: Draft): {
  headline: string;
  paragraph: string;
  highlights: string[];
  comparison: string[];
  insights: { negative: string[]; neutral: string[]; positive: string[] };
} {
  const clean = (xs: unknown): string[] => (Array.isArray(xs) ? xs : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
  return {
    headline: stripTags(d.headline ?? '').replace(/\s+/g, ' ').trim(),
    paragraph: (d.paragraph ?? '').trim(),
    highlights: clean(d.highlights).slice(0, 4),
    comparison: clean(d.comparison).slice(0, 4),
    insights: {
      negative: clean(d.insights?.negative).slice(0, 2),
      neutral: clean(d.insights?.neutral).slice(0, 2),
      positive: clean(d.insights?.positive).slice(0, 2),
    },
  };
}
