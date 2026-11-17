/**
 * Asuntos abiertos (INT-01, spec secciones 2.1 a 2.6): qué asuntos siguen
 * vivos a una fecha, desde cuándo, en qué etapa y qué voz los empuja. Lo usan
 * el correo (Diario y Semanal) y el Overview con la MISMA función y la misma
 * fecha, para que el bloque diga lo mismo en los tres sitios.
 *
 * Un asunto es un grupo de narrativas del mismo caso, o una narrativa suelta.
 * El agrupador parte un mismo caso en muchas narrativas (DF, 17 al
 * 23-oct-2026: más de 20 narrativas eran el asunto de la secretaria Roig);
 * contadas una por una, el bloque mostraría tres pedazos del mismo caso con
 * pocos días cada uno.
 *
 * La arista entre dos narrativas es la de la página Narrativas
 * (`isStoryEdge`), pero el grupo NO es la componente conexa de `groupStories`:
 * con narrativas pequeñas en juego, la cadena une casos distintos
 * (Gobernadora, 15-nov-2026: el asunto Roig quedaba unido a la reforma
 * judicial y a la de permisos a través de «Rivera Schatz»; DDEC, 23-oct: las
 * misiones comerciales con las rutas municipales). Aquí el grupo se arma
 * alrededor de la narrativa mayor: entran las que tienen arista directa con
 * ella y, después, las que tienen arista con al menos
 * `OPEN_ISSUE_MIN_LINKS` narrativas ya dentro. Al final, un grupo menor se une
 * a uno mayor si al menos la mitad de sus narrativas tiene arista con él (en
 * DF, la demanda de Coccoloba contra Roig quedaba como segundo asunto).
 * Medido con las tres agencias al 23-oct y al 15-nov: Gobernadora separa
 * Roig de la reforma judicial y DF queda con un solo asunto Roig. En DDEC las
 * misiones comerciales siguen unidas al resumen «Semana en Desarrollo», que
 * las reseña: es contenido propio y se aceptó.
 *
 * Todo se calcula a la fecha `endYmd` a partir de las menciones: no se lee
 * `narratives.status`, que es el estado de HOY y no sirve para regenerar un
 * correo pasado.
 *
 * Función pura; `loadOpenIssuesInput` (abajo) trae las filas.
 */
import type { PgClientLike } from '../aggregations/sentiment-report';
import { addDaysYmd } from '../dates';
import { AGENCY_ARTICLE_LABEL, AGENCY_SHORT_LABEL } from '../narrative-signals';
import { universeFilterSql, type UniverseOptions } from '../universe';
import {
  cajonStats, dayMs, daysBetween, distinctiveTerms, findDuplicates, isStoryEdge, peak14, processRows,
  type NarrMeta, type NarrRow, type RawMentionRow, type SimPair, type StoryCandidate,
} from './story-rules';

// ---------------------------------------------------------------------------
// Constantes (spec INT-01, sección 2)
// ---------------------------------------------------------------------------

/** Menciones en los 7 días para que un asunto cuente como abierto. */
export const OPEN_ISSUE_MIN_WEEK = 5;
/** Debe tener al menos una mención en estos últimos días. */
export const OPEN_ISSUE_RECENT_DAYS = 3;
/** Días seguidos sin menciones que cierran un asunto: lo posterior es un tramo nuevo. */
export const OPEN_ISSUE_GAP_DAYS = 14;
/** Asuntos que muestra el bloque. */
export const OPEN_ISSUE_MAX = 3;
/** Un tramo de hasta estos días es un asunto «nuevo». */
export const OPEN_ISSUE_NEW_DAYS = 3;
/** Etapa «sube» / «baja»: razón contra los 7 días previos y cambio mínimo en menciones. */
export const OPEN_ISSUE_RISE_RATIO = 1.25;
export const OPEN_ISSUE_FALL_RATIO = 0.75;
export const OPEN_ISSUE_MIN_MOVE = 5;
/** Sin interacciones, una voz necesita estas menciones para nombrarse como principal. */
export const OPEN_ISSUE_VOICE_MIN_MENTIONS = 3;
/** Aristas con narrativas ya dentro del grupo que necesita una narrativa sin arista directa con la mayor. */
export const OPEN_ISSUE_MIN_LINKS = 2;
/** Dos grupos se unen si al menos esta parte de las narrativas del menor tiene arista con el mayor. */
export const OPEN_ISSUE_MERGE_SHARE = 0.5;
/** Una voz se elige por interacciones solo si tiene al menos estas y este % de las del asunto. */
export const OPEN_ISSUE_VOICE_MIN_INTERACTIONS = 10;
export const OPEN_ISSUE_VOICE_MIN_SHARE_PCT = 10;
/**
 * Una voz que no es un medio solo se nombra si tiene al menos estas
 * interacciones en la semana: quien comenta tres veces en una publicación de
 * la agencia es una persona particular y no va con nombre en un correo.
 */
export const OPEN_ISSUE_VOICE_PUBLIC_MIN_INTERACTIONS = 100;
/** Días hacia atrás (además de la semana) en que una narrativa puede sumarse a un asunto abierto. */
export const OPEN_ISSUE_LOOKBACK_DAYS = 28;
/** Una narrativa sin menciones en la semana solo se suma a un asunto si tuvo al menos estas en su vida. */
export const OPEN_ISSUE_MIN_LIFE_OFFWEEK = 5;

export type OpenIssueStage = 'new' | 'rising' | 'falling' | 'steady';

export interface OpenIssueVoice {
  key: string;
  label: string;
  /** Con qué se eligió: interacciones (likes + comentarios + compartidos) o, si el asunto no tiene, menciones. */
  basis: 'interactions' | 'mentions';
  /** Interacciones o menciones de la voz en los 7 días. */
  value: number;
  /** Interacciones o menciones del asunto en los 7 días (todas las voces). */
  total: number;
  /** `value` ÷ `total`, en % redondeado. */
  sharePct: number;
  /** Menciones de la voz en los 7 días (con cualquiera de las dos bases). */
  mentions: number;
  /** La voz es un medio (nota de prensa o cuenta de un medio en redes). */
  media: boolean;
}

export interface OpenIssue {
  id: string;
  name: string;
  /**
   * La narrativa del grupo con más menciones esta semana, si no es la que da
   * nombre al asunto (que es la mayor de toda la vida, para que el nombre no
   * cambie de un día a otro). null si coinciden o el asunto es una sola.
   */
  lead: { id: string; name: string; week: number } | null;
  narrativeIds: string[];
  /** Menciones en los 7 días que terminan en la fecha, y en los 7 previos. */
  week: number;
  prevWeek: number;
  negWeek: number;
  posWeek: number;
  /** % de negativas sobre las menciones de la semana, redondeado. */
  negPct: number;
  /** Primer día del tramo actual y primera mención histórica del asunto. */
  openSince: string;
  firstEverDay: string;
  /** Días naturales del tramo actual, contando los dos extremos. */
  daysOpen: number;
  /** El tramo actual no es el primero: el asunto volvió tras 14 días o más sin menciones. */
  reopened: boolean;
  lastDay: string;
  stage: OpenIssueStage;
  /** Voz ajena a la agencia que más lo empuja; null = sin voz dominante. */
  voice: OpenIssueVoice | null;
  /** Voces distintas en los 7 días (incluye las cuentas de la agencia). */
  voices: number;
  /** Orden del bloque: menciones + negativas de la semana (una negativa cuenta doble). */
  score: number;
}

export interface OpenIssuesInput {
  agency: { slug: string; name: string | null };
  /** Último día cerrado del reporte (YYYY-MM-DD, día de Puerto Rico). */
  endYmd: string;
  /** Menciones de toda la vida de las narrativas candidatas (universo ya filtrado). */
  rows: RawMentionRow[];
  metas: NarrMeta[];
  /** Nombre y keywords de TODAS las narrativas de la agencia (frecuencia de términos). */
  agencyNames: { name: string; keywords: string[] | null }[];
  pairs: SimPair[];
  /** Menciones del universo en los 7 días (estén o no en una narrativa). */
  weekTotal: number;
}

export interface OpenIssuesResult {
  agency: { slug: string; name: string | null; short: string; article: string };
  asOf: string;
  windows: { week: { from: string; to: string }; prevWeek: { from: string; to: string } };
  /** Los asuntos que muestra el bloque (hasta `OPEN_ISSUE_MAX`), ya ordenados. */
  issues: OpenIssue[];
  /** Cuántos asuntos cumplen la definición de abierto (los mostrados incluidos). */
  openCount: number;
  /** Cobertura: menciones de la semana que pertenecen a un asunto (sin cajones) sobre el total. */
  coverage: { weekTotal: number; inIssues: number; pct: number | null };
  thresholds: { minWeek: number; recentDays: number; gapDays: number; max: number };
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

const toMs = (v: Date | string | null | undefined): number | null => {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Etapa a partir de los conteos (spec 2.4). Exportada para pruebas. */
export function openIssueStage(week: number, prevWeek: number, daysOpen: number): OpenIssueStage {
  if (daysOpen <= OPEN_ISSUE_NEW_DAYS) return 'new';
  if (week >= OPEN_ISSUE_RISE_RATIO * prevWeek && week - prevWeek >= OPEN_ISSUE_MIN_MOVE) return 'rising';
  if (week <= OPEN_ISSUE_FALL_RATIO * prevWeek && prevWeek - week >= OPEN_ISSUE_MIN_MOVE) return 'falling';
  return 'steady';
}

/**
 * Primer día del tramo actual: se retrocede desde el último día con menciones
 * mientras el hueco entre días consecutivos con menciones no pase de
 * `OPEN_ISSUE_GAP_DAYS` días SIN menciones. Exportada para pruebas.
 */
export function currentRunStart(days: string[], gapDays = OPEN_ISSUE_GAP_DAYS): string | null {
  const ds = [...new Set(days)].sort();
  if (!ds.length) return null;
  let start = ds[ds.length - 1];
  for (let i = ds.length - 1; i > 0; i--) {
    // Días sin menciones entre dos días con menciones.
    if (daysBetween(ds[i - 1], ds[i]) - 1 > gapDays) break;
    start = ds[i - 1];
  }
  return start;
}

/** Voz principal de las menciones de la semana (spec 2.5). Exportada para pruebas. */
export function principalVoice(weekRows: NarrRow[], voiceLabels: Record<string, string>): { voice: OpenIssueVoice | null; voices: number } {
  const inter = new Map<string, number>(), count = new Map<string, number>();
  const media = new Set<string>();
  const all = new Set<string>();
  let totalInter = 0;
  for (const r of weekRows) {
    all.add(r.voice);
    totalInter += r.inter;
    if (r.own) continue;
    if (r.media) media.add(r.voice);
    inter.set(r.voice, (inter.get(r.voice) ?? 0) + r.inter);
    count.set(r.voice, (count.get(r.voice) ?? 0) + 1);
  }
  const voices = all.size;
  if (!count.size) return { voice: null, voices };
  const pick = (m: Map<string, number>) => [...m.entries()]
    .sort((a, b) => b[1] - a[1] || (count.get(b[0]) ?? 0) - (count.get(a[0]) ?? 0) || a[0].localeCompare(b[0]))[0];
  // Por interacciones solo si la voz pesa de verdad: 1 «me gusta» en un
  // comentario no es «la voz que más lo empuja» (DDEC, 15-nov-2026: una
  // persona con 1 interacción salía con el 100 %).
  // Y con nombre solo un medio o una cuenta con alcance: nunca una persona
  // particular que comenta (DDEC, 23-oct-2026: salía por 4 comentarios).
  const nameable = (key: string) => media.has(key) || (inter.get(key) ?? 0) >= OPEN_ISSUE_VOICE_PUBLIC_MIN_INTERACTIONS;
  const topInter = pick(new Map([...inter].filter(([k]) => nameable(k))));
  if (topInter && topInter[1] >= OPEN_ISSUE_VOICE_MIN_INTERACTIONS
    && (100 * topInter[1]) / totalInter >= OPEN_ISSUE_VOICE_MIN_SHARE_PCT) {
    const [key, value] = topInter;
    return {
      voice: {
        key, label: voiceLabels[key] ?? key, basis: 'interactions', value, total: totalInter,
        sharePct: Math.round((100 * value) / totalInter), mentions: count.get(key) ?? 0, media: media.has(key),
      },
      voices,
    };
  }
  const topCount = pick(new Map([...count].filter(([k]) => nameable(k))));
  if (!topCount || topCount[1] < OPEN_ISSUE_VOICE_MIN_MENTIONS) return { voice: null, voices };
  const [key, value] = topCount;
  return {
    voice: {
      key, label: voiceLabels[key] ?? key, basis: 'mentions', value, total: weekRows.length,
      sharePct: Math.round((100 * value) / weekRows.length), mentions: value, media: media.has(key),
    },
    voices,
  };
}

const bySize = <T extends StoryCandidate>(a: T, b: T) => b.size - a.size || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Agrupa narrativas en asuntos alrededor de la mayor (ver cabecera). Devuelve
 * los grupos con sus miembros de mayor a menor; el primero da el nombre.
 * Un grupo menor se une a uno mayor si la mitad de sus narrativas lo toca.
 * Un posible duplicado (`findDuplicates`) que quedó suelto se suma al grupo de
 * su narrativa mayor. Exportada para pruebas.
 */
export function groupIssues<T extends StoryCandidate>(cands: T[], pairs: SimPair[], terms: Map<string, Set<string>>): T[][] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); };
  for (const p of pairs) {
    const A = byId.get(p.a), B = byId.get(p.b);
    if (!A || !B || A.id === B.id || !isStoryEdge(A, B, p.sim, terms)) continue;
    link(A.id, B.id);
    link(B.id, A.id);
  }
  const ordered = [...cands].sort(bySize);
  const groupOf = new Map<string, number>();
  const groups: T[][] = [];
  for (const anchor of ordered) {
    if (groupOf.has(anchor.id)) continue;
    const gi = groups.length;
    const members = new Set<string>([anchor.id]);
    groupOf.set(anchor.id, gi);
    for (const o of ordered) {
      if (!groupOf.has(o.id) && adj.get(anchor.id)?.has(o.id)) { members.add(o.id); groupOf.set(o.id, gi); }
    }
    for (let grew = true; grew;) {
      grew = false;
      for (const o of ordered) {
        if (groupOf.has(o.id)) continue;
        let links = 0;
        for (const x of adj.get(o.id) ?? []) if (members.has(x)) links++;
        if (links >= OPEN_ISSUE_MIN_LINKS) { members.add(o.id); groupOf.set(o.id, gi); grew = true; }
      }
    }
    groups.push(ordered.filter((c) => members.has(c.id)));
  }
  // Grupos del mismo caso que quedaron separados: el menor se suma al mayor si
  // al menos la mitad de sus narrativas (y al menos 2 aristas) tocan al mayor.
  for (let gi = groups.length - 1; gi > 0; gi--) {
    const small = groups[gi];
    if (!small.length) continue;
    let best = -1, bestTouch = 0;
    for (let gj = 0; gj < gi; gj++) {
      if (!groups[gj].length) continue;
      const ids = new Set(groups[gj].map((c) => c.id));
      let touch = 0, edges = 0;
      for (const c of small) {
        let n = 0;
        for (const x of adj.get(c.id) ?? []) if (ids.has(x)) n++;
        if (n > 0) touch++;
        edges += n;
      }
      if (edges >= OPEN_ISSUE_MIN_LINKS && touch >= OPEN_ISSUE_MERGE_SHARE * small.length && touch > bestTouch) { best = gj; bestTouch = touch; }
    }
    if (best < 0) continue;
    for (const c of small) groupOf.set(c.id, best);
    groups[best] = [...groups[best], ...small].sort(bySize);
    groups[gi] = [];
  }
  // Duplicados: la menor, si quedó sola, se suma al grupo de la mayor.
  for (const [small, big] of findDuplicates(cands, pairs)) {
    const gs = groupOf.get(small), gb = groupOf.get(big.id);
    if (gs === undefined || gb === undefined || gs === gb || groups[gs].length !== 1) continue;
    groups[gb] = [...groups[gb], ...groups[gs]].sort(bySize);
    groups[gs] = [];
    groupOf.set(small, gb);
  }
  return groups.filter((g) => g.length > 0);
}

/** Arma el bloque de asuntos abiertos a la fecha `input.endYmd`. */
export function buildOpenIssues(input: OpenIssuesInput): OpenIssuesResult {
  const { endYmd } = input;
  const weekFrom = addDaysYmd(endYmd, -6), prevTo = addDaysYmd(endYmd, -7), prevFrom = addDaysYmd(endYmd, -13);
  const recentFrom = addDaysYmd(endYmd, -(OPEN_ISSUE_RECENT_DAYS - 1));

  const { byNarr, voiceLabels } = processRows(input.rows, {
    agencySlug: input.agency.slug, agencyName: input.agency.name, endYmd,
  });
  const metaById = new Map(input.metas.map((m) => [m.id, m]));

  // Candidatas: sin cajones; con menciones en la semana o, si no, con vida suficiente.
  interface Cand extends StoryCandidate { rows: NarrRow[]; weekN: number }
  const cands: Cand[] = [];
  for (const [nid, rows] of byNarr) {
    const meta = metaById.get(nid);
    if (!meta || !rows.length) continue;
    if (cajonStats(rows).isCajon) continue;
    const weekN = rows.filter((r) => r.day >= weekFrom && r.day <= endYmd).length;
    if (weekN === 0 && rows.length < OPEN_ISSUE_MIN_LIFE_OFFWEEK) continue;
    const firstDay = rows[0].day, lastDay = rows[rows.length - 1].day;
    // La vida se mide a la fecha: `last_mention_at` puede ser posterior a `endYmd`.
    const lastMs = Math.min(toMs(meta.last_mention_at) ?? dayMs(lastDay), dayMs(addDaysYmd(endYmd, 1)));
    cands.push({
      id: nid,
      name: meta.name,
      keywords: meta.keywords ?? [],
      bornMs: toMs(meta.born_at) ?? dayMs(firstDay),
      lastMs: Math.max(lastMs, dayMs(lastDay)),
      peakStart: peak14(rows.map((r) => r.day)).start,
      size: rows.length,
      life: rows.length,
      ownedShare: rows.filter((r) => r.owned).length / rows.length,
      rows,
      weekN,
    });
  }

  const groups = groupIssues(cands, input.pairs, distinctiveTerms(cands, input.agencyNames));

  const open: OpenIssue[] = [];
  let inIssues = 0;
  for (const members of groups) {
    const rows = members.flatMap((m) => m.rows);
    const weekRows = rows.filter((r) => r.day >= weekFrom && r.day <= endYmd);
    const week = weekRows.length;
    inIssues += week;
    if (week < OPEN_ISSUE_MIN_WEEK) continue;
    if (!weekRows.some((r) => r.day >= recentFrom)) continue;
    const days = rows.map((r) => r.day).sort();
    const openSince = currentRunStart(days)!;
    const firstEverDay = days[0];
    const daysOpen = daysBetween(openSince, endYmd) + 1;
    const prevWeek = rows.filter((r) => r.day >= prevFrom && r.day <= prevTo).length;
    const negWeek = weekRows.filter((r) => r.sentiment === 'n').length;
    const posWeek = weekRows.filter((r) => r.sentiment === 'p').length;
    const { voice, voices } = principalVoice(weekRows, voiceLabels);
    const biggest = members[0];
    const weekOf = (m: Cand) => m.weekN;
    const lead = [...members].sort((a, b) => weekOf(b) - weekOf(a) || b.size - a.size || a.id.localeCompare(b.id))[0];
    open.push({
      id: members.length > 1 ? `issue-${biggest.id}` : biggest.id,
      name: biggest.name,
      lead: lead.id !== biggest.id ? { id: lead.id, name: lead.name, week: lead.weekN } : null,
      narrativeIds: members.map((m) => m.id),
      week, prevWeek, negWeek, posWeek,
      negPct: Math.round((100 * negWeek) / week),
      openSince, firstEverDay, daysOpen,
      reopened: openSince !== firstEverDay,
      lastDay: days[days.length - 1],
      stage: openIssueStage(week, prevWeek, daysOpen),
      voice, voices,
      score: week + negWeek,
    });
  }
  open.sort((a, b) => b.score - a.score || b.daysOpen - a.daysOpen || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const weekTotal = Math.max(0, Number(input.weekTotal) || 0);
  return {
    agency: {
      ...input.agency,
      short: AGENCY_SHORT_LABEL[input.agency.slug] ?? (input.agency.slug || '').toUpperCase(),
      article: AGENCY_ARTICLE_LABEL[input.agency.slug] ?? `la agencia ${(input.agency.slug || '').toUpperCase()}`,
    },
    asOf: endYmd,
    windows: { week: { from: weekFrom, to: endYmd }, prevWeek: { from: prevFrom, to: prevTo } },
    issues: open.slice(0, OPEN_ISSUE_MAX),
    openCount: open.length,
    coverage: { weekTotal, inIssues, pct: weekTotal > 0 ? Math.min(100, Math.round((100 * inIssues) / weekTotal)) : null },
    thresholds: { minWeek: OPEN_ISSUE_MIN_WEEK, recentDays: OPEN_ISSUE_RECENT_DAYS, gapDays: OPEN_ISSUE_GAP_DAYS, max: OPEN_ISSUE_MAX },
  };
}

// ---------------------------------------------------------------------------
// Carga (pg)
// ---------------------------------------------------------------------------

const TZ = 'America/Puerto_Rico';

// Narrativas con al menos una mención del universo en la ventana de candidatas
// (la semana y los días previos en que una narrativa aún puede pertenecer al
// asunto), y TODAS sus menciones hasta la fecha: el tramo, el cajón y el pico
// de 14 días se miden sobre la vida entera. Mismo universo y misma regla de
// asignación principal que /api/narrative/overview.
const rowsSql = (opts?: UniverseOptions) => `
WITH touch AS (
  SELECT DISTINCT nm.narrative_id
    FROM narrative_mentions nm
    JOIN narratives n ON n.id = nm.narrative_id
    JOIN mentions m ON m.id = nm.mention_id
   WHERE n.agency_id = $1 AND n.merged_into_id IS NULL AND m.agency_id = $1
     AND nm.is_primary = true
     ${universeFilterSql(opts, 'm.')}
     AND m.published_at >= $2::timestamptz
     AND m.published_at < $3::timestamptz
)
SELECT nm.narrative_id AS nid, m.id, m.published_at, m.url, m.title, m.page_type,
       m.author, m.author_fullname, m.domain,
       COALESCE(m.nlp_sentiment, m.bw_sentiment) AS sentiment,
       (COALESCE(m.likes, 0) + COALESCE(m.comments, 0) + COALESCE(m.shares, 0)) AS inter
  FROM touch t
  JOIN narrative_mentions nm ON nm.narrative_id = t.narrative_id
  JOIN mentions m ON m.id = nm.mention_id
 WHERE nm.is_primary = true AND m.agency_id = $1
   ${universeFilterSql(opts, 'm.')}
   AND m.published_at < $3::timestamptz`;

// Menciones del universo en la semana, por día efectivo («solo fecha» = fecha UTC).
const weekTotalSql = (opts?: UniverseOptions) => `
SELECT COUNT(*)::int AS total
  FROM (
    SELECT to_char(CASE WHEN (m.published_at AT TIME ZONE 'UTC')::time = '00:00'
                        THEN (m.published_at AT TIME ZONE 'UTC')::date
                        ELSE (m.published_at AT TIME ZONE '${TZ}')::date END, 'YYYY-MM-DD') AS day
      FROM mentions m
     WHERE m.agency_id = $1
       ${universeFilterSql(opts, 'm.')}
       AND m.published_at >= $2::timestamptz
       AND m.published_at < $3::timestamptz
  ) z
 WHERE day BETWEEN $4 AND $5`;

const PAIRS_SQL = `
SELECT a.id AS a, b.id AS b, (1 - (a.centroid <=> b.centroid))::float8 AS sim
  FROM narratives a
  JOIN narratives b ON a.id < b.id
 WHERE a.id = ANY($1::uuid[]) AND b.id = ANY($1::uuid[])
   AND a.agency_id = $2 AND b.agency_id = $2
   AND a.centroid IS NOT NULL AND b.centroid IS NOT NULL
   AND 1 - (a.centroid <=> b.centroid) >= 0.44`;

/**
 * Trae lo que `buildOpenIssues` necesita. Solo lectura. Sirve igual al lambda
 * de correos (cliente pg) y a la web (pool).
 */
export async function loadOpenIssuesInput(
  client: PgClientLike,
  agencyId: string,
  endYmd: string,
  opts?: UniverseOptions,
): Promise<OpenIssuesInput> {
  const weekFrom = addDaysYmd(endYmd, -6);
  // Bordes holgados: una «solo fecha» del primer día está a las 00:00Z; la
  // última mención con hora del día final, antes de las 04:00Z del siguiente.
  const hi = `${addDaysYmd(endYmd, 1)}T04:00:00Z`;
  const candLo = `${addDaysYmd(weekFrom, -OPEN_ISSUE_LOOKBACK_DAYS)}T00:00:00Z`;
  const weekLo = `${weekFrom}T00:00:00Z`;

  const [agencyRes, rowsRes, metaRes, totalRes] = await Promise.all([
    client.query<{ slug: string; name: string | null }>('SELECT slug, name FROM agencies WHERE id = $1', [agencyId]),
    client.query<RawMentionRow>(rowsSql(opts), [agencyId, candLo, hi]),
    client.query<NarrMeta>(
      `SELECT id, name, summary, keywords, status, born_at, last_mention_at, created_at
         FROM narratives WHERE agency_id = $1 AND merged_into_id IS NULL`, [agencyId]),
    client.query<{ total: number | string }>(weekTotalSql(opts), [agencyId, weekLo, hi, weekFrom, endYmd]),
  ]);
  const ids = [...new Set(rowsRes.rows.map((r) => r.nid))];
  const pairsRes = ids.length > 1
    ? await client.query<{ a: string; b: string; sim: number | string }>(PAIRS_SQL, [ids, agencyId])
    : { rows: [] as { a: string; b: string; sim: number | string }[] };
  const touched = new Set(ids);
  const agency = agencyRes.rows[0] ?? { slug: '', name: null };
  return {
    agency: { slug: agency.slug, name: agency.name },
    endYmd,
    rows: rowsRes.rows,
    metas: metaRes.rows.filter((m) => touched.has(m.id)),
    agencyNames: metaRes.rows.map((m) => ({ name: m.name, keywords: m.keywords })),
    pairs: pairsRes.rows.map((p) => ({ a: p.a, b: p.b, sim: Number(p.sim) })),
    weekTotal: Number(totalRes.rows[0]?.total ?? 0),
  };
}

/** Carga y calcula en un paso. */
export async function loadOpenIssues(
  client: PgClientLike,
  agencyId: string,
  endYmd: string,
  opts?: UniverseOptions,
): Promise<OpenIssuesResult> {
  return buildOpenIssues(await loadOpenIssuesInput(client, agencyId, endYmd, opts));
}
