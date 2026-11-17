/**
 * Página Narrativas (oct-2026): todo lo que se calcula a partir de las
 * menciones vive aquí, en funciones puras, para que la serie (01), el tablero
 * (02), la propagación (03) y el mapa (04) cuenten exactamente lo mismo y para
 * poder probarlo sin base de datos. Las rutas solo traen filas.
 *
 * Las reglas de historias, cajón y posible duplicado se calibraron contra
 * datos de prod (DDEC top-40: precisión 1.00, recobertura 0.98; Gobernadora
 * top-80: 1.00 / 0.83). Los umbrales tienen poco margen —con un coseno bajo de
 * 0.47 en vez de 0.44 la saga Negrón·Domenech se parte—, así que no se tocan
 * sin volver a calibrar.
 */

import {
  AGENCY_ARTICLE_LABEL, AGENCY_SHORT_LABEL, addDaysYmd, articleKey, channelOf, decodeEntities, foldText, isMediaMention, isNegativeShare,
  isOwnVoice, isTagPage, mentionWhen, NARRATIVE_TZ, originOf, usableAuthor, voiceKey, VOICE_LABELS, ymdInTimeZone,
  type NarrativeOrigin,
} from '@eco/shared';

// ---------------------------------------------------------------------------
// Constantes de la página
// ---------------------------------------------------------------------------

/** Días de la serie de historias (01). */
export const SERIES_DAYS = 30;
/** Semanas del mapa (04): la semana en curso y las 25 anteriores. */
export const MAP_WEEKS = 26;
/** Narrativas vivas y terminadas que entran a la serie. */
export const SERIES_LIVE_N = 6;
export const SERIES_ENDED_N = 2;
/** Una terminada entra a la serie solo si tuvo al menos 3 menciones en esos 30 días (1 o 2 no se ven). */
export const SERIES_ENDED_MIN = 3;
/** Un carril del mapa necesita 15 menciones en las 26 semanas (salvo que esté en la serie o viva). */
export const MAP_MIN_N = 15;
/** Carriles que el mapa muestra antes de «Ver todas». */
export const MAP_CORE_MAX = 40;

const LIVE_STATUSES = new Set(['emerging', 'active', 'peaking', 'revived', 'declining']);
export type BoardColumn = 'emerging' | 'active' | 'declining';
const COLUMN_OF: Record<string, BoardColumn> = {
  emerging: 'emerging', active: 'active', peaking: 'active', revived: 'active', declining: 'declining',
};

import {
  CAJON_MAX_PEAK14_SHARE, CAJON_MIN_WEEKS, DUP_C1, DUP_C2, DUP_MIN_N, GENERIC_KW, GENERIC_NAME, OWNED_PAGE_TYPES, STORY_COS_HI, STORY_COS_LO, STORY_MAX_LIFE_GAP_D, STORY_MAX_PEAK_DIST_D, cajonStats, dayMs, daysBetween, distinctiveTerms, findDuplicates, firstMention, groupStories, mondayOf, nameTokens, peak14, processRows, rowOrder,
  type NarrMeta, type NarrRow, type RawMentionRow, type RowContext, type SimPair, type Story, type StoryCandidate,
} from '@eco/shared';

// Las reglas de historias, cajón, duplicado y filas viven en `@eco/shared`
// (INT-01: las usa también el correo). Se re-exportan para no cambiar a quien
// las importaba de aquí.
export {
  CAJON_MAX_PEAK14_SHARE, CAJON_MIN_WEEKS, DUP_C1, DUP_C2, DUP_MIN_N, GENERIC_KW, GENERIC_NAME, OWNED_PAGE_TYPES, STORY_COS_HI, STORY_COS_LO, STORY_MAX_LIFE_GAP_D, STORY_MAX_PEAK_DIST_D, cajonStats, dayMs, daysBetween, distinctiveTerms, findDuplicates, firstMention, groupStories, mondayOf, nameTokens, peak14, processRows, rowOrder,
} from '@eco/shared';
export type {
  NarrMeta, NarrRow, RawMentionRow, RowContext, SimPair, Story, StoryCandidate,
} from '@eco/shared';

// ---------------------------------------------------------------------------
// Agregado de la página
// ---------------------------------------------------------------------------

export interface OverviewNarrative {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  column: BoardColumn | null;
  createdDay: string | null;
  bornDay: string;
  lastDay: string;
  origin: NarrativeOrigin;
  starter: string;
  starterTime: string | null;
  /** Menciones de toda la vida (universo de la página, deduplicadas). */
  life: number;
  d30: number[];
  m30: number;
  m7: number;
  m7p: number;
  neg7: number;
  pos7: number;
  press7: number;
  voices7: number;
  /** Menciones por semana del mapa, de la más antigua a la más reciente. */
  w: number[];
  wn: number[];
  n180: number;
  storyId: string | null;
  dupOf: { id: string; name: string } | null;
  inSeries: boolean;
  inBoard: boolean;
  inMap: boolean;
  inMapCore: boolean;
}

export interface OverviewInput {
  agency: { slug: string; name: string | null };
  endYmd: string;
  rows: RawMentionRow[];
  metas: NarrMeta[];
  /** Nombre y keywords de TODAS las narrativas vivas de la agencia (frecuencia de términos). */
  agencyNames: { name: string; keywords: string[] | null }[];
  pairs: SimPair[];
  /** Menciones del universo por día (todas, estén o no en una narrativa). */
  contextDays: { day: string; total: number; in_narr: number }[];
  statusCounts: { status: string; n: number; first_born: Date | string | null }[];
}

export interface OverviewPayload {
  /** `short`: cómo se nombra a la agencia cuando ella inició una narrativa («DDEC»); `article`, con artículo («el DDEC»). */
  agency: { slug: string; name: string | null; short: string; article: string };
  asOf: string;
  windows: {
    series: { from: string; to: string; days: string[] };
    week: { from: string; to: string };
    prevWeek: { from: string; to: string };
    map: { from: string; to: string; weeks: string[]; partialDays: number | null };
  };
  narratives: OverviewNarrative[];
  series: string[];
  board: Record<BoardColumn, string[]>;
  lanes: string[];
  stories: Story[];
  context: { week: string; total: number; inNarr: number }[];
  alertId: string | null;
  cajones: { id: string; name: string; life: number; bornDay: string }[];
  counts: { live: number; dormant: number; dormantSince: string | null };
}

const toMs = (v: Date | string | null | undefined): number | null => {
  if (v == null) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};
/** Día en hora de Puerto Rico de un instante (detección, primera narrativa). */
const toYmd = (v: Date | string | null | undefined): string | null => {
  const t = toMs(v);
  return t == null ? null : ymdInTimeZone(new Date(t), NARRATIVE_TZ);
};

/** Arma el payload de /api/narrative/overview. */
export function buildOverview(input: OverviewInput): OverviewPayload {
  const { endYmd } = input;
  const seriesFrom = addDaysYmd(endYmd, -(SERIES_DAYS - 1));
  const seriesDays = Array.from({ length: SERIES_DAYS }, (_, i) => addDaysYmd(seriesFrom, i));
  const weekFrom = addDaysYmd(endYmd, -6), prevTo = addDaysYmd(endYmd, -7), prevFrom = addDaysYmd(endYmd, -13);
  const lastMonday = mondayOf(endYmd);
  const weeks = Array.from({ length: MAP_WEEKS }, (_, i) => addDaysYmd(lastMonday, -7 * (MAP_WEEKS - 1 - i)));
  const mapFrom = weeks[0];
  const partial = daysBetween(lastMonday, endYmd) + 1;

  const { byNarr, voiceLabels } = processRows(input.rows, {
    agencySlug: input.agency.slug, agencyName: input.agency.name, endYmd,
  });
  const metaById = new Map(input.metas.map((m) => [m.id, m]));
  const seriesIdx = new Map(seriesDays.map((d, i) => [d, i]));

  interface Work extends OverviewNarrative { cajon: boolean; peakStart: string | null; ownedShare: number; meta: NarrMeta }
  const work: Work[] = [];
  const cajones: OverviewPayload['cajones'] = [];
  for (const [nid, rows] of byNarr) {
    const meta = metaById.get(nid);
    if (!meta || !rows.length) continue;
    const first = firstMention(rows)!;
    const caj = cajonStats(rows);
    const d30 = seriesDays.map(() => 0);
    const w = weeks.map(() => 0), wn = weeks.map(() => 0);
    let m7 = 0, m7p = 0, neg7 = 0, pos7 = 0, press7 = 0, owned = 0;
    const voices7 = new Set<string>();
    for (const r of rows) {
      if (r.owned) owned++;
      const si = seriesIdx.get(r.day);
      if (si !== undefined) d30[si]++;
      if (r.day >= weekFrom && r.day <= endYmd) {
        m7++; voices7.add(r.voice);
        if (r.sentiment === 'n') neg7++;
        if (r.sentiment === 'p') pos7++;
        if (r.media) press7++;
      } else if (r.day >= prevFrom && r.day <= prevTo) m7p++;
      if (r.day >= mapFrom) {
        const wi = Math.floor(daysBetween(mapFrom, r.day) / 7);
        if (wi >= 0 && wi < MAP_WEEKS) { w[wi]++; if (r.sentiment === 'n') wn[wi]++; }
      }
    }
    const lastDay = rows[rows.length - 1].day;
    if (caj.isCajon) {
      cajones.push({ id: nid, name: meta.name, life: rows.length, bornDay: first.day });
      continue;
    }
    // Sin menciones en la semana de referencia no está naciendo ni activa,
    // diga lo que diga el estado guardado: los backfills de DF (Bunker 16-oct,
    // BW 22-oct) dejaron narrativas en «emerging» con la última mención en
    // septiembre (QA 23-oct: 12 de 29 «Naciendo», 7 de 15 «Activas»).
    const stale = lastDay < weekFrom && (COLUMN_OF[meta.status] === 'emerging' || COLUMN_OF[meta.status] === 'active');
    const status = stale ? 'declining' : meta.status;
    work.push({
      id: nid,
      name: meta.name,
      summary: meta.summary,
      status,
      column: COLUMN_OF[status] ?? null,
      createdDay: toYmd(meta.created_at),
      bornDay: first.day,
      lastDay,
      origin: originOf({
        key: first.voice, pageType: first.pageType, displayName: first.display,
        agencySlug: input.agency.slug, agencyName: input.agency.name,
      }),
      starter: voiceLabels[first.voice] ?? first.voice,
      starterTime: first.time,
      life: rows.length,
      d30, m30: d30.reduce((a, b) => a + b, 0),
      m7, m7p, neg7, pos7, press7, voices7: voices7.size,
      w, wn, n180: w.reduce((a, b) => a + b, 0),
      storyId: null, dupOf: null,
      inSeries: false, inBoard: false, inMap: false, inMapCore: false,
      cajon: false,
      peakStart: peak14(rows.map((r) => r.day)).start,
      ownedShare: owned / rows.length,
      meta,
    });
  }

  const byId = new Map(work.map((n) => [n.id, n]));

  // 02 · Tablero: las vivas (naciendo, activas, apagándose).
  const live = work.filter((n) => LIVE_STATUSES.has(n.status) && n.column);
  const board: Record<BoardColumn, string[]> = { emerging: [], active: [], declining: [] };
  for (const n of [...live].sort((a, b) => b.m7 - a.m7 || b.life - a.life || a.name.localeCompare(b.name))) {
    board[n.column!].push(n.id);
    n.inBoard = true;
  }

  // 01 · Serie: las 6 vivas con más menciones en 30 días y las 2 que terminaron más recientemente.
  const seriesLive = live.filter((n) => n.m30 > 0)
    .sort((a, b) => b.m30 - a.m30 || b.life - a.life || a.name.localeCompare(b.name)).slice(0, SERIES_LIVE_N);
  const seriesEnded = work.filter((n) => n.status === 'dormant' && n.m30 >= SERIES_ENDED_MIN)
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.life - a.life || a.name.localeCompare(b.name))
    .slice(0, SERIES_ENDED_N);
  const series = [...seriesLive, ...seriesEnded].map((n) => n.id);
  for (const id of series) byId.get(id)!.inSeries = true;

  // Alerta: nace una narrativa que no inició la agencia, con negativas y ≥ 8 menciones en 7 días.
  const alert = live.filter((n) => n.column === 'emerging' && n.origin !== 'propia' && n.neg7 > 0 && n.m7 >= 8)
    .sort((a, b) => b.m7 - a.m7 || b.neg7 - a.neg7)[0];

  // 04 · Mapa: 15+ menciones en las 26 semanas, más las de la serie y el tablero.
  // La vista inicial (`inMapCore`) lleva la serie y la alerta y se completa con
  // las más grandes hasta 40; el SPA añade la elegida si quedó fuera.
  const lastWeekIdx = (n: Work) => n.w.reduce((m, c, i) => (c ? i : m), -1);
  const laneNarrs = work.filter((n) => n.n180 > 0 && (n.n180 >= MAP_MIN_N || n.inSeries || n.inBoard))
    .sort((a, b) => lastWeekIdx(b) - lastWeekIdx(a) || b.n180 - a.n180 || a.name.localeCompare(b.name));
  for (const n of laneNarrs) n.inMap = true;
  const core = new Set(laneNarrs.filter((n) => n.inSeries || n.id === alert?.id).map((n) => n.id));
  for (const n of [...laneNarrs].sort((a, b) => b.n180 - a.n180 || a.name.localeCompare(b.name))) {
    if (core.size >= MAP_CORE_MAX) break;
    core.add(n.id);
  }
  for (const n of laneNarrs) n.inMapCore = core.has(n.id);
  const lanes = laneNarrs.map((n) => n.id);

  // Contexto del mapa: todas las menciones de la agencia por semana.
  const ctx = weeks.map((wk) => ({ week: wk, total: 0, inNarr: 0 }));
  for (const c of input.contextDays) {
    if (c.day < mapFrom || c.day > endYmd) continue;
    const wi = Math.floor(daysBetween(mapFrom, c.day) / 7);
    if (wi < 0 || wi >= MAP_WEEKS) continue;
    ctx[wi].total += Number(c.total) || 0;
    ctx[wi].inNarr += Number(c.in_narr) || 0;
  }

  // Historias y duplicados SOLO entre las narrativas de la página (sin
  // cajones), como en la calibración (top 40-80 por menciones): con todas las
  // que tocan el mapa, narrativas diminutas y ocultas encadenaban historias
  // sin relación (Trump Accounts → resolución → estadidad).
  const included = work.filter((n) => n.inSeries || n.inBoard || n.inMap);
  const cands: StoryCandidate[] = included.map((n) => ({
    id: n.id,
    name: n.name,
    keywords: n.meta.keywords ?? [],
    bornMs: toMs(n.meta.born_at) ?? dayMs(n.bornDay),
    lastMs: toMs(n.meta.last_mention_at) ?? dayMs(n.lastDay),
    peakStart: n.peakStart,
    size: n.n180,
    life: n.life,
    ownedShare: n.ownedShare,
  }));
  const terms = distinctiveTerms(cands, input.agencyNames);
  const shownStories = groupStories(cands, input.pairs, terms);
  for (const st of shownStories) for (const id of st.memberIds) byId.get(id)!.storyId = st.id;
  const dups = findDuplicates(cands, input.pairs);
  for (const n of included) {
    const d = dups.get(n.id);
    if (d && byId.has(d.id)) n.dupOf = { id: d.id, name: byId.get(d.id)!.name };
  }
  const dormantRow = input.statusCounts.find((s) => s.status === 'dormant');

  return {
    agency: {
      ...input.agency,
      short: AGENCY_SHORT_LABEL[input.agency.slug] ?? (input.agency.slug || '').toUpperCase(),
      article: AGENCY_ARTICLE_LABEL[input.agency.slug] ?? `la agencia ${(input.agency.slug || '').toUpperCase()}`,
    },
    asOf: endYmd,
    windows: {
      series: { from: seriesFrom, to: endYmd, days: seriesDays },
      week: { from: weekFrom, to: endYmd },
      prevWeek: { from: prevFrom, to: prevTo },
      map: { from: mapFrom, to: endYmd, weeks, partialDays: partial < 7 ? partial : null },
    },
    narratives: included.map(({ cajon: _c, peakStart: _p, ownedShare: _o, meta: _m, ...pub }) => pub),
    series,
    board,
    lanes,
    stories: shownStories,
    context: ctx,
    alertId: alert?.id ?? null,
    cajones: cajones.sort((a, b) => b.life - a.life),
    counts: {
      live: live.length,
      dormant: Number(dormantRow?.n ?? 0),
      dormantSince: toYmd(dormantRow?.first_born ?? null),
    },
  };
}

// ---------------------------------------------------------------------------
// Propagación (03)
// ---------------------------------------------------------------------------

export interface PropagationRow {
  d: string;
  t: string | null;
  c: 0 | 1 | 2 | 3;
  s: 'n' | 'p' | 'u';
  e: number;
  v: string;
  m: 0 | 1;
  j: 0 | 1;
  o: 0 | 1;
  ti: string | null;
  u: string | null;
}

/** Filas compactas de una narrativa para la propagación. */
export function propagationRows(rows: NarrRow[]): PropagationRow[] {
  return rows.map((r) => ({
    d: r.day, t: r.time, c: r.channel, s: r.sentiment, e: r.inter, v: r.voice,
    m: r.media ? 1 : 0, j: r.tag ? 1 : 0, o: r.own ? 1 : 0, ti: r.title,
    u: r.url && /^https?:\/\//i.test(r.url) ? r.url : null,
  }));
}
