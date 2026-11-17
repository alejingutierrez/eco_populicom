/**
 * INT-01 · WP-5 — el bloque «Asuntos abiertos» y el nivel sostenido del
 * Overview. Es el MISMO cálculo del Diario y del Semanal: las mismas funciones
 * de `@eco/shared` (`loadOpenIssues`, `buildSustainedLevel`), la misma fecha
 * (el último día cerrado, ayer en Puerto Rico) y el mismo universo del correo.
 * Aquí solo se arma la respuesta del endpoint.
 *
 * Los textos de cada fila (etapa, voz, nivel) los escriben las funciones que
 * pintan el correo, para que el Overview diga lo mismo con las mismas
 * palabras; la SPA no redacta nada. `facts` son los hechos `level_*` e
 * `issue_*` tal como entran al paquete del redactor: comparar esa lista con la
 * composición guardada del Diario del mismo día es la prueba de que los dos
 * muestran el mismo bloque (`scripts/int-01-overview-vs-mail.ts`).
 */
import {
  buildSustainedLevel,
  formatShortDay,
  interpretationMethodologyNote,
  issueStageText,
  issueVoiceText,
  loadDailySentimentSeries,
  loadOpenIssues,
  openIssueFacts,
  sustainedLevelFacts,
  sustainedLevelText,
  sustainedSeriesStart,
  OPEN_ISSUE_MAX,
  type OpenIssue,
  type OpenIssuesResult,
  type PgClientLike,
  type SustainedLevel,
  type SustainedWindow,
  type UniverseOptions,
} from '@eco/shared';

/**
 * Universo del bloque: el del correo (`MAIL_UNIVERSE` del lambda
 * `eco-weekly-report`), no el de la bandera `UNIVERSE_STRICT_AGENCIES` del
 * resto del dashboard. Si el correo cambia de universo, cambia aquí también.
 */
export const OVERVIEW_ISSUES_UNIVERSE: UniverseOptions = { strictUniverse: false };

export interface OverviewLevelWindow {
  days: number;
  startYmd: string;
  endYmd: string;
  total: number;
  enoughBase: boolean;
  negPct: number | null;
  nss: number | null;
  /** El % negativo está en el umbral o por encima. */
  overNegPct: boolean | null;
}

export interface OverviewIssueRow {
  id: string;
  name: string;
  /** La narrativa más activa de la semana, si no es la que da nombre al asunto. */
  lead: { id: string; name: string } | null;
  /** Narrativas del asunto, la más activa primero: a cuál lleva el enlace a Narrativas. */
  narrativeIds: string[];
  daysOpen: number;
  openSince: string;
  /** «desde el 28 sep» / «desde el 28 sep · reabierto». */
  sinceText: string;
  reopened: boolean;
  stage: OpenIssue['stage'];
  week: number;
  prevWeek: number;
  negPct: number;
  /** El % de negativas del asunto está en el umbral del nivel o por encima. */
  negOver: boolean;
  /** «sube · 121 en 7 días · 57 en los 7 previos» (el texto del correo). */
  stageText: string;
  /** «Jay Fonseca · 33% de las interacciones · 87 voces» (el texto del correo). */
  voiceText: string;
  voices: number;
}

export interface OverviewOpenIssuesPayload {
  /** Último día cerrado (YYYY-MM-DD, día de Puerto Rico): la fecha F del correo. */
  asOf: string;
  agency: { slug: string; name: string | null; short: string } | null;
  level: {
    d14: OverviewLevelWindow;
    d28: OverviewLevelWindow;
    thresholds: { negPct: number; nss: number; minBase: number };
    sustained: boolean | null;
    /** La línea del correo, en texto plano. */
    text: string;
  } | null;
  issues: OverviewIssueRow[];
  /** Asuntos que cumplen la definición de abierto (los mostrados incluidos). */
  openCount: number;
  coverage: { weekTotal: number; inIssues: number; pct: number | null } | null;
  windows: OpenIssuesResult['windows'] | null;
  thresholds: OpenIssuesResult['thresholds'] | null;
  /** Hechos `level_*` e `issue_*`, los mismos del paquete del redactor del correo. */
  facts: Array<{ id: string; value: number; display: string }>;
  /** Nota de metodología del correo. */
  methodology: string;
  /** Por qué falta el nivel o los asuntos (el bloque sale sin esa parte). */
  errors: string[];
}

export interface OverviewInterpretation {
  sustainedLevel: SustainedLevel | null;
  openIssues: OpenIssuesResult | null;
  errors: string[];
}

/**
 * Nivel sostenido y asuntos abiertos al día `endYmd`. Igual que
 * `loadInterpretationData` del lambda de correos: cada carga falla por
 * separado y nunca lanza.
 */
export async function loadOverviewInterpretation(
  client: PgClientLike,
  agencyId: string,
  endYmd: string,
): Promise<OverviewInterpretation> {
  const errors: string[] = [];
  const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
  const [sustainedLevel, openIssues] = await Promise.all([
    loadDailySentimentSeries(client, agencyId, sustainedSeriesStart(endYmd), endYmd, OVERVIEW_ISSUES_UNIVERSE)
      .then((series) => buildSustainedLevel(series, endYmd))
      .catch((e) => { errors.push(`nivel sostenido: ${msg(e)}`); return null; }),
    loadOpenIssues(client, agencyId, endYmd, OVERVIEW_ISSUES_UNIVERSE)
      .catch((e) => { errors.push(`asuntos abiertos: ${msg(e)}`); return null; }),
  ]);
  return { sustainedLevel, openIssues, errors };
}

function levelWindow(w: SustainedWindow): OverviewLevelWindow {
  return {
    days: w.days, startYmd: w.startYmd, endYmd: w.endYmd, total: w.total,
    enoughBase: w.enoughBase, negPct: w.negPct, nss: w.nss, overNegPct: w.overNegPct,
  };
}

function issueRow(i: OpenIssue, negThreshold: number): OverviewIssueRow {
  // El enlace a Narrativas abre la narrativa más activa de la semana; si esa no
  // está en la página, la que da nombre al asunto y luego el resto.
  const order = [i.lead?.id, i.id, ...i.narrativeIds].filter((x): x is string => !!x);
  return {
    id: i.id,
    name: i.name,
    lead: i.lead ? { id: i.lead.id, name: i.lead.name } : null,
    narrativeIds: [...new Set(order)],
    daysOpen: i.daysOpen,
    openSince: i.openSince,
    sinceText: `desde el ${formatShortDay(i.openSince)}${i.reopened ? ' · reabierto' : ''}`,
    reopened: i.reopened,
    stage: i.stage,
    week: i.week,
    prevWeek: i.prevWeek,
    negPct: i.negPct,
    negOver: i.negPct >= negThreshold,
    stageText: issueStageText(i),
    voiceText: issueVoiceText(i),
    voices: i.voices,
  };
}

/** Respuesta del endpoint a partir de lo cargado. Pura. */
export function buildOverviewOpenIssuesPayload(data: OverviewInterpretation, endYmd: string): OverviewOpenIssuesPayload {
  const { sustainedLevel: level, openIssues: issues } = data;
  const negThreshold = level?.thresholds.negPct ?? 30;
  const facts = [...sustainedLevelFacts(level), ...openIssueFacts(issues)]
    .map((f) => ({ id: f.id, value: f.value, display: f.display }));
  return {
    asOf: endYmd,
    agency: issues ? { slug: issues.agency.slug, name: issues.agency.name, short: issues.agency.short } : null,
    level: level ? {
      d14: levelWindow(level.d14),
      d28: levelWindow(level.d28),
      thresholds: level.thresholds,
      sustained: level.sustained,
      text: sustainedLevelText(level),
    } : null,
    issues: (issues?.issues ?? []).slice(0, OPEN_ISSUE_MAX).map((i) => issueRow(i, negThreshold)),
    openCount: issues?.openCount ?? 0,
    coverage: issues?.coverage ?? null,
    windows: issues?.windows ?? null,
    thresholds: issues?.thresholds ?? null,
    facts,
    methodology: interpretationMethodologyNote(level, issues),
    errors: data.errors,
  };
}

/** Carga y arma la respuesta en un paso. */
export async function computeOverviewOpenIssues(
  client: PgClientLike,
  agencyId: string,
  endYmd: string,
): Promise<OverviewOpenIssuesPayload> {
  return buildOverviewOpenIssuesPayload(await loadOverviewInterpretation(client, agencyId, endYmd), endYmd);
}
