/**
 * eco-ai-tasks con el motor de redacción (WP-8; spec interpretación v1,
 * secciones 10.6 y 11.4).
 *
 * Tres superficies pasan por `compose()` cuando la agencia está en la bandera
 * `COMPOSER_WEB_AGENCIES` (slugs separados por coma; vacía = comportamiento
 * actual, byte a byte):
 *
 *   - `period-insights` (lede e insights del Overview) → perfil `overview`
 *     (motor completo: analista, redactor, QA, corrector). La composición
 *     completa se archiva en `overview_period_insights.composition`.
 *   - `metric-insight` (insight cacheado de una métrica) → perfil ligero.
 *     Se archiva en `metric_insights_cache.composition`.
 *   - `topic-descriptions` (descripción de 30 días en `topics.description`)
 *     → perfil ligero. `topics` no tiene columna de composición: va al log.
 *
 * Las cifras del texto salen SIEMPRE de un marcador `{{id}}` del paquete de
 * hechos; el lint y la red de seguridad del motor quitan lo que no se pueda
 * verificar (vetados, cifras sin fuente). Este módulo no toca la base: recibe
 * los agregados que el lambda ya calcula (mismo universo que el dashboard) y
 * devuelve textos + composición.
 */
import {
  compose,
  COMPOSER_PROFILES,
  COMPOSER_VERSION,
  COMPOSER_MODEL_OPUS,
  COMPOSER_MODEL_SONNET,
  COMPOSER_WEB_SYSTEM_BASE,
  COMPOSER_TEAM_RULES,
  prepareSamples,
  findVetoed,
  formatMetric,
  formatDelta,
  toBhi10,
  type ComposeOptions,
  type ComposeResult,
  type ComposerDataAccess,
  type ComposerInput,
  type ComposerLlm,
  type ComposerProfile,
  type Draft,
  type Fact,
  type MentionSample,
  type RawComposerSample,
  type RoleModels,
  type SampleContext,
  type WeeklyAggregates,
  type MetricKey,
  type BandedMetricKey,
} from '@eco/shared';

// ============================================================
// Bandera por agencia
// ============================================================

/** Slugs de la bandera (minúsculas, sin vacíos). `*` = todas las agencias. */
export function parseComposerAgencies(raw: string | null | undefined): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * ¿Esta agencia usa el motor? `override` (booleano del payload, lo manda la
 * ruta web que disparó la generación) gana sobre la variable de entorno: así
 * la web y el lambda no pueden discrepar sobre la versión esperada de la fila
 * y entrar en un bucle de recálculo.
 */
export function composerEnabledFor(
  slug: string,
  opts: { override?: boolean | null; env?: string | null } = {},
): boolean {
  if (typeof opts.override === 'boolean') return opts.override;
  const set = parseComposerAgencies(opts.env === undefined ? process.env.COMPOSER_WEB_AGENCIES : opts.env);
  return set.has('*') || set.has(String(slug ?? '').toLowerCase());
}

export { COMPOSER_VERSION };

/**
 * Ventana máxima con motor. El paquete de hechos lista 3 cifras por día de la
 * serie: con 1A (365 días) serían ~1,100 líneas por llamada (lento y caro).
 * Las ventanas más largas siguen por el camino actual.
 */
export const MAX_COMPOSER_WINDOW_DAYS = 92;

export function windowDaysYmd(startYmd: string, endYmd: string): number {
  return Math.round((Date.parse(`${endYmd}T00:00:00Z`) - Date.parse(`${startYmd}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Bandera + ventana: ¿esta generación va por el motor? */
export function useComposerFor(
  slug: string,
  startYmd: string,
  endYmd: string,
  opts: { override?: boolean | null; env?: string | null } = {},
): boolean {
  return composerEnabledFor(slug, opts) && windowDaysYmd(startYmd, endYmd) <= MAX_COMPOSER_WINDOW_DAYS;
}

// ============================================================
// Modelos por superficie
// ============================================================

/** Overview: el motor completo con los modelos del laboratorio (Opus redacta, Sonnet revisa). */
export const OVERVIEW_MODELS: Partial<RoleModels> = {};
/** Perfil ligero (métrica cacheada, tópicos): Sonnet en redactor y corrector. */
export const LIGHT_MODELS: Partial<RoleModels> = { writer: COMPOSER_MODEL_SONNET, corrector: COMPOSER_MODEL_SONNET };

// ============================================================
// Muestras: capa de datos inyectada (pg)
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/**
 * Contexto de las muestras en UNA consulta: tipo, GUID/URL y, para
 * comentarios, la publicación original. El padre sale de
 * `parent_mention_id` (WP-2) o, si aún no está poblado, de las mismas reglas
 * que `lib/parent-resolver.ts` (FB: GUID `<page>_<post>`; IG: GUID
 * `<shortcode>`), acotadas a la agencia y a 60 días antes del comentario.
 * Solo lee filas por id: no cuenta menciones ni aplica el universo.
 */
export const SAMPLE_CONTEXT_SQL = `
SELECT m.id, m.bw_guid, m.url, m.pub_type, m.page_type, m.author, m.title, m.snippet,
       m.mention_kind, m.parent_mention_id, m.parent_published_at,
       p.id AS p_id, p.published_at AS p_published_at, p.author AS p_author,
       COALESCE(NULLIF(p.title, ''), p.snippet) AS p_text
  FROM mentions m
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN strpos(COALESCE(m.url, ''), '#channels_comment') > 0
           THEN COALESCE(substring(m.bw_guid from '^(\\d+)_\\d+$'),
                         substring(m.url from 'facebook\\.com/(\\d+)#channels_comment_\\d+'))
      END AS fb_post,
      CASE WHEN upper(COALESCE(m.pub_type, '')) = 'INSTAGRAM_GRAPH_BUSINESS'
                AND strpos(COALESCE(m.bw_guid, ''), '#') > 0
           THEN split_part(m.bw_guid, '#', 1)
      END AS ig_code
  ) k
  LEFT JOIN LATERAL (
    SELECT q.id, q.published_at, q.author, q.title, q.snippet FROM (
      SELECT pm.id, pm.published_at, pm.author, pm.title, pm.snippet, 1 AS prio
        FROM mentions pm
       WHERE m.parent_mention_id IS NOT NULL AND pm.id = m.parent_mention_id
      UNION ALL
      SELECT pm.id, pm.published_at, pm.author, pm.title, pm.snippet, 2 AS prio
        FROM mentions pm
       WHERE m.parent_mention_id IS NULL AND k.fb_post IS NOT NULL
         AND pm.agency_id = m.agency_id
         AND pm.bw_guid LIKE '%\\_' || k.fb_post
         AND (pm.url IS NULL OR pm.url NOT LIKE '%#channels\\_comment%')
         AND pm.published_at BETWEEN m.published_at - INTERVAL '60 days' AND m.published_at + INTERVAL '1 day'
      UNION ALL
      SELECT pm.id, pm.published_at, pm.author, pm.title, pm.snippet, 3 AS prio
        FROM mentions pm
       WHERE m.parent_mention_id IS NULL AND k.ig_code IS NOT NULL
         AND pm.agency_id = m.agency_id
         AND pm.bw_guid = k.ig_code
         AND pm.published_at BETWEEN m.published_at - INTERVAL '60 days' AND m.published_at + INTERVAL '1 day'
    ) q
    ORDER BY q.prio, q.published_at DESC
    LIMIT 1
  ) p ON true
 WHERE m.agency_id = $1 AND m.id = ANY($2::uuid[])`;

const isoOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Fila de SAMPLE_CONTEXT_SQL → contexto del motor. Exportada para pruebas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sampleContextFromRow(r: any): SampleContext {
  return {
    bwGuid: r.bw_guid ?? null,
    url: r.url ?? null,
    pubType: r.pub_type ?? null,
    pageType: r.page_type ?? null,
    author: r.author ?? null,
    title: r.title ?? null,
    snippet: r.snippet ?? null,
    mentionKind: r.mention_kind ?? null,
    parentMentionId: r.parent_mention_id ?? r.p_id ?? null,
    parentPublishedAt: isoOrNull(r.parent_published_at) ?? isoOrNull(r.p_published_at),
    parentAuthor: r.p_author ?? null,
    parentText: r.p_text ? String(r.p_text).replace(/\s+/g, ' ').trim() : null,
  };
}

export function createPgComposerDataAccess(client: Queryable, agencyId: string): ComposerDataAccess {
  return {
    async loadSampleContext(ids: string[]) {
      if (ids.length === 0) return {};
      const { rows } = await client.query(SAMPLE_CONTEXT_SQL, [agencyId, ids]);
      const out: Record<string, SampleContext> = {};
      for (const r of rows) out[String(r.id)] = sampleContextFromRow(r);
      return out;
    },
  };
}

/** MentionSample (prompts legacy) → muestra cruda del motor. */
export function toRawSample(s: MentionSample): RawComposerSample {
  return {
    id: s.id,
    createdAt: s.createdAt,
    text: s.text,
    sentiment: s.sentiment,
    topic: s.topic ?? null,
    author: s.author ?? null,
    source: s.source ?? null,
    url: s.url ?? null,
    pageType: s.pageType ?? null,
    engagement: s.engagement ?? null,
  };
}

// ============================================================
// Entrada del motor desde los agregados del lambda
// ============================================================

export interface PeriodComposerInputOptions {
  agencyId: string;
  agencyName: string;
  shortName: string;
  prevStartYmd: string;
  prevEndYmd: string;
  prevTotals?: { negative: number; neutral: number; positive: number; total: number } | null;
  commentShare?: { comments: number; total: number } | null;
  prevCommentShare?: { comments: number; total: number } | null;
}

/**
 * `WeeklyAggregates` (mismo universo y mismas cifras que el dashboard) →
 * entrada del motor para un PERIODO. Las muestras se anotan aparte
 * (`prepareSamples`) y se pasan en `samples`.
 */
export function periodComposerInput(
  agg: WeeklyAggregates,
  opts: PeriodComposerInputOptions,
  samples: ComposerInput['samples'],
): ComposerInput {
  return {
    agency: { id: opts.agencyId, name: opts.agencyName, shortName: opts.shortName },
    window: {
      startYmd: agg.periodStart,
      endYmd: agg.periodEnd,
      prevStartYmd: opts.prevStartYmd,
      prevEndYmd: opts.prevEndYmd,
      timeZone: 'America/Puerto_Rico',
    },
    totals: agg.totals,
    prevTotals: opts.prevTotals ?? null,
    deltaVsPrev: agg.deltaVsPrevWeek,
    dailySeries: agg.dailySeries,
    topics: agg.byTopic.map((t) => ({ topic: t.topic, total: t.total, negative: t.negative, neutral: t.neutral, positive: t.positive })),
    sources: agg.topSources ?? [],
    municipalities: agg.byMunicipality,
    emotions: agg.topEmotions ?? [],
    composition: opts.commentShare
      ? { week: opts.commentShare, prevWeek: opts.prevCommentShare ?? null }
      : null,
    samples,
  };
}

/** Grupos de muestras del periodo (las de `loadSamples`) anotados con tipo, padre y fecha. */
export async function annotatePeriodSamples(
  data: ComposerDataAccess,
  raw: { negative: MentionSample[]; neutral: MentionSample[]; positive: MentionSample[] },
  agencyAuthors: string[],
) {
  return prepareSamples(data, {
    negative: raw.negative.map(toRawSample),
    neutral: raw.neutral.map(toRawSample),
    positive: raw.positive.map(toRawSample),
  }, { agencyAuthors });
}

// ============================================================
// Overview (lede + insights)
// ============================================================

const sanitizeStrongOnly = (html: string): string => String(html ?? '').replace(/<(?!\/?strong\b)[^>]*>/gi, '');
const stripTags = (s: string): string => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export interface OverviewTexts {
  dailySummary: string | null;
  headline: string | null;
  highlights: string[];
  insights: { negative: string[]; neutral: string[]; positive: string[] };
}

/**
 * Borrador final del motor → columnas de `overview_period_insights`, con los
 * mismos topes y saneado que el camino legacy (3 insights por sentimiento,
 * 4 viñetas, solo `<strong>`, titular sin etiquetas ni punto final).
 */
export function overviewTextsFromDraft(d: Draft): OverviewTexts {
  const summary = sanitizeStrongOnly(String(d.paragraph ?? '').trim()).slice(0, 1400);
  const headline = stripTags(d.headline ?? '').replace(/\.$/, '').slice(0, 200);
  const items = (xs: string[] | undefined, n: number) =>
    (xs ?? []).map((x) => sanitizeStrongOnly(String(x ?? '').trim())).filter(Boolean).slice(0, n).map((x) => x.slice(0, 400));
  return {
    dailySummary: summary.length > 0 ? summary : null,
    headline: headline || null,
    highlights: items(d.highlights, 4),
    insights: {
      negative: items(d.insights?.negative, 3),
      neutral: items(d.insights?.neutral, 3),
      positive: items(d.insights?.positive, 3),
    },
  };
}

export async function composeOverview(
  input: ComposerInput,
  opts: { llm: ComposerLlm | null; dryRun: boolean; log?: (m: string) => void; models?: Partial<RoleModels> },
): Promise<ComposeResult> {
  const o: ComposeOptions = { llm: opts.llm, dryRun: opts.dryRun, models: opts.models ?? OVERVIEW_MODELS, log: opts.log };
  return compose('overview', input, o);
}

// ---- Rótulos de picos y foto (una llamada corta, con las reglas del equipo)

export const PEAKS_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    peak_labels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD del día pico, tal como viene en el prompt.' },
          label: { type: 'string', description: '3 a 7 palabras literales que nombran qué pasó ese día, sin cifras.' },
        },
        required: ['date', 'label'],
      },
    },
    hero_index: { type: 'integer', description: 'Número de la nota candidata cuya foto mejor ilustra el titular. Omitir si no hay candidatas.' },
  },
  required: ['peak_labels'],
};

export interface PeakForLabel {
  date: string;
  total: number;
  negative: number;
  samples: MentionSample[];
}

export function buildPeaksPrompt(
  headline: string,
  peaks: PeakForLabel[],
  candidates: Array<{ day: string; source: string; title: string | null }>,
): string {
  const lines: string[] = [`TITULAR DEL PERIODO (ya validado): ${headline}`, ''];
  if (peaks.length > 0) {
    lines.push('DÍAS PICO (rotula cada uno con lo que pasó ESE día según sus muestras):');
    for (const p of peaks) {
      lines.push(`- ${p.date}:`);
      for (const s of p.samples.slice(0, 6)) lines.push(`    · ${(s.author ? `${s.author}: ` : '')}${String(s.text ?? '').slice(0, 220)}`);
    }
    lines.push('');
  }
  if (candidates.length > 0) {
    lines.push('NOTAS CANDIDATAS A FOTO (elige el número de la que mejor ilustra el titular):');
    candidates.forEach((c, i) => lines.push(`${i}. ${c.day} · ${c.source} · ${String(c.title ?? '').slice(0, 160)}`));
    lines.push('');
  }
  lines.push('Cada rótulo: 3 a 7 palabras, sujeto y verbo literal o un sustantivo del hecho, sin cifras, sin figuras ni verbos de fuerza. Responde con la herramienta.');
  return lines.join('\n');
}

export const PEAKS_SYSTEM = /* @__PURE__ */ `${COMPOSER_WEB_SYSTEM_BASE}\n\n${COMPOSER_TEAM_RULES}\n\nTu rol: ROTULADOR. Nombras qué pasó en cada día pico con palabras literales de las muestras.`;

/**
 * Normaliza la salida de la llamada de picos: solo fechas listadas, rótulo
 * sin etiquetas, sin cifras y sin vetados (un rótulo con vetado se descarta:
 * la tendencia queda sin rótulo ese día en vez de llevar una figura).
 */
export function normalizePeakLabels(
  raw: unknown,
  peakDates: Set<string>,
  nCandidates: number,
): { labels: Array<{ date: string; label: string }>; heroIndex: number | null; dropped: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (raw ?? {}) as any;
  const dropped: string[] = [];
  const labels = (Array.isArray(r.peak_labels) ? r.peak_labels : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => ({ date: String(x?.date ?? ''), label: stripTags(String(x?.label ?? '')).replace(/\.$/, '').slice(0, 70) }))
    .filter((x: { date: string; label: string }) => {
      if (!peakDates.has(x.date) || x.label.length === 0) return false;
      if (findVetoed(x.label).length > 0 || /\d/.test(x.label)) { dropped.push(x.label); return false; }
      return true;
    });
  const hi = Number(r.hero_index);
  const heroIndex = Number.isInteger(hi) && hi >= 0 && hi < nCandidates ? hi : null;
  return { labels, heroIndex, dropped };
}

// ============================================================
// Perfil ligero: métrica cacheada y descripción de tópico
// ============================================================

const EMPTY_SAMPLES = (): ComposerInput['samples'] => ({
  today: [], negative: [], neutral: [], positive: [],
  droppedByThreadCap: { today: 0, negative: 0, neutral: 0, positive: 0 },
});

const METRIC_NAMES: Record<MetricKey, string> = {
  nss: 'sentimiento neto (NSS)',
  crisis: 'riesgo de crisis',
  volume: 'volumen de menciones',
  bhi: 'salud de marca (BHI)',
  polarization: 'polarización',
};

/** Perfil ligero para la métrica: misma forma, tarea específica. */
export const METRIC_LIGHT_PROFILE: ComposerProfile = {
  ...COMPOSER_PROFILES.light,
  writerTask: `

TAREA (rol REDACTOR): explica POR QUÉ la métrica tiene el valor que tiene en este periodo, en UNA sola pasada:
- headline: una línea con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo.
- paragraph: 2 o 3 oraciones. Cita el valor y la banda tal como vienen (el valor solo con su marcador; la banda con la palabra del contexto). Explica qué tópicos o voces lo explican, con sus marcadores. No expliques la fórmula.
- highlights: lista vacía.
Responde con la herramienta.`,
};

/** Perfil ligero para tópicos: 3 a 5 oraciones de QUÉ se habla. */
export const TOPIC_LIGHT_PROFILE: ComposerProfile = {
  ...COMPOSER_PROFILES.light,
  writerTask: `

TAREA (rol REDACTOR): describe DE QUÉ se habla en este tópico durante el periodo, en UNA sola pasada:
- headline: una línea con sujeto y verbo literal, máximo 16 palabras, sin cifras ni dramatismo.
- paragraph: 3 a 5 oraciones con los asuntos concretos de las muestras (qué se pidió, criticó, anunció o informó y quién lo dijo). Cifras solo con marcadores {{id}}.
- highlights: lista vacía.
Responde con la herramienta.`,
};

/** Valor de la métrica en la escala que ve el usuario (la misma de las tarjetas). */
export function metricValueFact(metric: MetricKey, raw: number | null): Fact[] {
  if (raw == null || !Number.isFinite(raw)) return [];
  if (metric === 'volume') return [{ id: 'kpi_value', value: raw, display: `${raw}`, label: 'menciones del periodo (valor de la métrica)' }];
  const d = formatMetric(metric as BandedMetricKey, raw);
  if (metric === 'crisis') {
    const v = Math.round(raw * 100);
    return [{ id: 'kpi_value', value: v, display: `${v} %`, label: `riesgo de crisis (0 a 100); banda ${d.word}` }];
  }
  if (metric === 'bhi') {
    const v = Math.round(toBhi10(raw) * 10) / 10;
    return [
      { id: 'kpi_value', value: v, display: `${v}`, label: `salud de marca en escala de 1 a 10; banda ${d.word}` },
      { id: 'kpi_scale_max', value: 10, display: '10', label: 'máximo de la escala de salud de marca' },
    ];
  }
  if (metric === 'polarization') {
    const v = Math.round(raw);
    return [{ id: 'kpi_value', value: v, display: `${v} %`, label: `polarización (0 a 100); banda ${d.word}` }];
  }
  const v = Math.round(raw * 10) / 10;
  return [{ id: 'kpi_value', value: v, display: v > 0 ? `+${v}` : `${v}`, label: `sentimiento neto (−100 a 100); banda ${d.word}` }];
}

export interface MetricLightInputArgs {
  agencyId: string;
  agencyName: string;
  shortName: string;
  metric: MetricKey;
  periodStart: string;
  periodEnd: string;
  value: number | null;
  /** Totales por sentimiento del periodo y del previo (universo del dashboard). */
  totals: { negative: number; neutral: number; positive: number; total: number };
  prevTotals?: { negative: number; neutral: number; positive: number; total: number } | null;
  /** Serie diaria del periodo (fija la ventana y las fechas permitidas). */
  dailySeries: Array<{ date: string; negative: number; neutral: number; positive: number }>;
  topTopics: Array<{ topic: string; total: number; negative: number; positive: number }>;
  topAuthors: Array<{ author: string; mentions: number }>;
  topMunicipalities: Array<{ municipality: string; total: number; negative: number }>;
}

/** Entrada del perfil ligero para `metric-insight` (sin muestras: hechos + contexto). */
export function metricLightInput(a: MetricLightInputArgs): ComposerInput {
  const band = a.value != null && a.metric !== 'volume' ? formatMetric(a.metric as BandedMetricKey, a.value).word : null;
  const extraFacts: Fact[] = [...metricValueFact(a.metric, a.value)];
  a.topAuthors.slice(0, 3).forEach((x, i) => extraFacts.push({ id: `author_${i + 1}`, value: x.mentions, display: `${x.mentions}`, label: `menciones de «${x.author}»` }));
  const ctx = [
    `MÉTRICA: ${METRIC_NAMES[a.metric]}.`,
    band ? `BANDA (calculada por el código; cítala tal cual): ${band}.` : null,
    a.topAuthors.length ? `VOCES CON MÁS MENCIONES: ${a.topAuthors.slice(0, 3).map((x) => x.author).join('; ')}.` : null,
  ].filter(Boolean).join('\n');
  return {
    agency: { id: a.agencyId, name: a.agencyName, shortName: a.shortName },
    window: { startYmd: a.periodStart, endYmd: a.periodEnd, timeZone: 'America/Puerto_Rico' },
    totals: a.totals,
    prevTotals: a.prevTotals ?? null,
    dailySeries: a.dailySeries,
    topics: a.topTopics.map((t) => ({ topic: t.topic, total: t.total, negative: t.negative, positive: t.positive })),
    municipalities: a.topMunicipalities,
    samples: EMPTY_SAMPLES(),
    extraFacts,
    extraContext: ctx,
    nameWhitelist: a.topAuthors.map((x) => x.author),
  };
}

/** Texto final del perfil ligero: el párrafo (solo `<strong>`), con el tope legacy. */
export function lightParagraph(d: Draft, max = 1400): string {
  return sanitizeStrongOnly(String(d.paragraph ?? '').trim()).slice(0, max);
}

export async function composeLight(
  profile: ComposerProfile,
  input: ComposerInput,
  opts: { llm: ComposerLlm | null; dryRun: boolean; log?: (m: string) => void; models?: Partial<RoleModels> },
): Promise<ComposeResult> {
  return compose(profile, input, { llm: opts.llm, dryRun: opts.dryRun, models: opts.models ?? LIGHT_MODELS, log: opts.log, retries: 2, backoffMs: 1500 });
}

// ---- Tópicos (lambda, 30 días)

export interface TopicLightArgs {
  agencyId: string;
  agencyName: string;
  shortName: string;
  topicName: string;
  periodStart: string;
  periodEnd: string;
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  topSubtopics: Array<{ name: string; count: number }>;
  topMunicipalities: Array<{ name: string; count: number }>;
  /** Serie diaria del tópico (fija la ventana y las fechas permitidas). */
  dailySeries: Array<{ date: string; negative: number; neutral: number; positive: number }>;
}

/** Entrada del perfil ligero para la descripción de un tópico. */
export function topicLightInput(a: TopicLightArgs, samples: ComposerInput['samples']): ComposerInput {
  const extraFacts: Fact[] = a.topSubtopics.slice(0, 5).map((s, i) => ({
    id: `subtopic_${i + 1}`, value: s.count, display: `${s.count}`, label: `menciones del subtópico «${s.name}»`,
  }));
  return {
    agency: { id: a.agencyId, name: a.agencyName, shortName: a.shortName },
    window: { startYmd: a.periodStart, endYmd: a.periodEnd, timeZone: 'America/Puerto_Rico' },
    totals: { negative: a.negative, neutral: a.neutral, positive: a.positive, total: a.total },
    dailySeries: a.dailySeries,
    municipalities: a.topMunicipalities.map((m) => ({ municipality: m.name, total: m.count })),
    samples,
    extraFacts,
    extraContext: `TÓPICO: ${a.topicName}. Las cifras de los hechos son del tópico, no de toda la agencia.`,
  };
}

/** Archivo compacto para el log cuando la tabla no tiene columna de composición. */
export function compositionSummary(r: ComposeResult): Record<string, unknown> {
  const c = r.composition;
  return {
    composerVersion: c.composerVersion,
    promptVersion: c.promptVersion,
    profile: c.profile,
    degraded: c.degraded,
    errors: c.errors,
    stageSeconds: c.stageSeconds,
    models: c.models,
    safetyNet: c.safetyNetLog.map((e) => ({ action: e.action, where: e.where })),
    residual: c.residualCodeProblems.length,
  };
}

/** Opus/Sonnet re-exportados para los scripts de QA. */
export const MODELS = { opus: COMPOSER_MODEL_OPUS, sonnet: COMPOSER_MODEL_SONNET };
export { formatDelta };
