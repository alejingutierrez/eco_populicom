/**
 * Paquete de hechos (etapa 0 del motor de redacción, spec interpretación v1,
 * sección 10.2): todas las cifras que un texto puede mostrar, calculadas por
 * código sobre UN solo universo (universe.ts, estricto: alta/media, NULL
 * fuera) y con las mismas fronteras de día PR.
 *
 * Qué arregla frente al correo de hoy (`buildAggregates` del lambda
 * eco-weekly-report): los agregados de fuentes, municipios, autores y
 * emociones se calculaban SIN filtro de pertinencia (DDEC 25-31 oct: fuentes
 * sumaban 795 contra un total de 647) y con `published_at >= $::date` (día UTC,
 * no PR). Aquí:
 *
 *  - totales, serie diaria, tópicos, fuentes y municipios son PARTICIONES del
 *    mismo universo: cada una suma EXACTAMENTE `coverage.inUniverse`
 *    (`checkFactsConsistency` lo verifica);
 *  - autores y emociones no son particiones (top-N; una mención puede traer
 *    varias emociones): se entregan con su resto explícito;
 *  - variaciones con base mínima (`minBaseDelta`) y composición
 *    (`commentShare`) listas para convertirse en marcadores `{{id}}`.
 *
 * Los consumidores (WP-6 correo diario, WP-8 Overview/Scorecard, WP-9a API)
 * llaman a `buildUniverseFacts`. No toca el comportamiento de las funciones
 * existentes: usa las mismas con `{ strictUniverse: true }`.
 */

import { pertinentUniverseSql, universeFilterSql, type UniverseCoverage, type UniverseOptions } from '../universe';
import { prWindowSql } from './pr-range';
import {
  buildSentimentReport,
  normalizeSentiment,
  type PgClientLike,
  type SentimentReport,
  type SentimentTotals,
  type TopicTableRow,
} from './sentiment-report';
import { loadAuthors, loadChannels, loadEmotions, loadPlaces, type AuthorRow, type ChannelRow, type EmotionRow, type PlaceRow, type RegionRow } from './report-detail';
import { commentShare, minBaseDelta, type BaseDelta, type CommentShare } from './composition';

/** Universo estricto de v1 (P1). Los hechos NUNCA usan el histórico. */
export const FACTS_UNIVERSE: UniverseOptions = { strictUniverse: true };

export interface FactsWindow {
  /** Días calendario PR inclusivos. */
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
}

// ============================================================
// Cobertura del universo (qué entra y qué se queda fuera)
// ============================================================

/**
 * Cuántas filas de la ventana entran al universo y cuántas quedan fuera y
 * por qué (baja, pendientes de NLP, duplicadas). Las pendientes son las que
 * P1 «cuenta aparte» y las que explican cualquier diferencia contra el
 * universo histórico (`NULL o <> 'baja'`) en una ventana reciente.
 */
export async function loadUniverseCoverage(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
): Promise<UniverseCoverage> {
  const r = await client.query<{
    in_universe: number | string; low: number | string; pending: number | string; duplicates: number | string;
  }>(
    `SELECT COUNT(*) FILTER (WHERE ${pertinentUniverseSql('m.')})::int AS in_universe,
            COUNT(*) FILTER (WHERE m.is_duplicate = false AND m.nlp_pertinence = 'baja')::int AS low,
            COUNT(*) FILTER (WHERE m.is_duplicate = false AND m.nlp_pertinence IS NULL)::int AS pending,
            COUNT(*) FILTER (WHERE m.is_duplicate = true)::int AS duplicates
       FROM mentions m
      WHERE m.agency_id = $1
        ${prWindowSql('m.')}`,
    [agencyId, startYmd, endYmd],
  );
  const row = r.rows[0];
  return {
    inUniverse: Number(row?.in_universe ?? 0),
    low: Number(row?.low ?? 0),
    pending: Number(row?.pending ?? 0),
    duplicates: Number(row?.duplicates ?? 0),
  };
}

// ============================================================
// Municipios: partición (cada mención bajo UN municipio o «Sin municipio»)
// ============================================================

export const NO_MUNICIPALITY = 'Sin municipio';

export interface MunicipalityFact {
  /** Nombre del municipio, o `NO_MUNICIPALITY` para menciones sin geografía. */
  name: string;
  region: string;
  total: number;
  negative: number;
  neutral: number;
  positive: number;
  /** True en la fila de menciones sin municipio asignado. */
  isUnassigned?: boolean;
}

interface MunicipalityRaw {
  name: string | null;
  region: string | null;
  s: string | null;
  c: number | string;
}

/**
 * Pliega filas `(municipio, sentimiento, n)` en una partición ordenada por
 * volumen, con «Sin municipio» al final. Pura: la prueba la ejercita con
 * datos reales sin base de datos.
 */
export function foldMunicipalityRows(rows: MunicipalityRaw[]): MunicipalityFact[] {
  const byName = new Map<string, MunicipalityFact>();
  for (const row of rows) {
    const unassigned = row.name == null;
    const name = unassigned ? NO_MUNICIPALITY : row.name!;
    let bucket = byName.get(name);
    if (!bucket) {
      bucket = {
        name,
        region: unassigned ? '' : (row.region ?? '').trim() || 'Sin región',
        total: 0, negative: 0, neutral: 0, positive: 0,
        ...(unassigned ? { isUnassigned: true } : {}),
      };
      byName.set(name, bucket);
    }
    const c = Number(row.c);
    bucket.total += c;
    const s = normalizeSentiment(row.s);
    if (s) bucket[s] += c;
  }
  const all = Array.from(byName.values());
  const assigned = all.filter((m) => !m.isUnassigned).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const unassigned = all.filter((m) => m.isUnassigned);
  return [...assigned, ...unassigned];
}

/**
 * Municipios como PARTICIÓN del universo: una mención con varios municipios
 * cuenta bajo el de menor id (determinista); las que no tienen, bajo
 * «Sin municipio». La suma de `total` es el tamaño del universo. Para «cuántas
 * menciones tocan cada municipio» (solapadas) usar `loadPlaces`.
 */
export async function loadMunicipalityPartition(
  client: PgClientLike,
  agencyId: string,
  startYmd: string,
  endYmd: string,
  opts: UniverseOptions = FACTS_UNIVERSE,
): Promise<MunicipalityFact[]> {
  const r = await client.query<MunicipalityRaw>(
    `SELECT mu.name AS name,
            mu.region AS region,
            COALESCE(m.nlp_sentiment, m.bw_sentiment) AS s,
            COUNT(*)::int AS c
       FROM mentions m
       LEFT JOIN LATERAL (
         SELECT mm.municipality_id FROM mention_municipalities mm
          WHERE mm.mention_id = m.id
          ORDER BY mm.municipality_id ASC LIMIT 1
       ) pm ON true
       LEFT JOIN municipalities mu ON mu.id = pm.municipality_id
      WHERE m.agency_id = $1
        ${prWindowSql('m.')}
        ${universeFilterSql(opts, 'm.')}
      GROUP BY mu.name, mu.region, COALESCE(m.nlp_sentiment, m.bw_sentiment)`,
    [agencyId, startYmd, endYmd],
  );
  return foldMunicipalityRows(r.rows);
}

// ============================================================
// Paquete
// ============================================================

export interface FactsDeltas {
  total: BaseDelta;
  negative: BaseDelta;
  neutral: BaseDelta;
  positive: BaseDelta;
}

export interface UniverseFacts {
  window: FactsWindow;
  /** Qué entra y qué se queda fuera (ventana actual). */
  coverage: UniverseCoverage;
  totals: SentimentTotals;
  prevTotals: SentimentTotals;
  /** Variación semana vs previa con base mínima (porcentaje solo si prev ≥ 30). */
  deltas: FactsDeltas;
  /** Serie diaria en días PR, del universo estricto. */
  dailySeries: SentimentReport['dailySeries'];
  /** Tópicos (partición: top 7 + «Otros» + «Sin clasificar»). */
  topics: TopicTableRow[];
  /** Fuentes por canal (partición completa). */
  sources: ChannelRow[];
  /** Municipios como partición (incluye «Sin municipio»). */
  municipalities: MunicipalityFact[];
  /** Municipios y regiones con menciones SOLAPADAS (no suman al total). */
  places: { municipalities: PlaceRow[]; regions: RegionRow[] };
  /** Autores top-N; `restMentions` = menciones del universo fuera de ese top (incluye sin autor). */
  authors: { rows: AuthorRow[]; restMentions: number };
  /** Emociones (una mención puede traer varias): `tagged` = etiquetas contadas. */
  emotions: { rows: EmotionRow[]; tagged: number };
  /** Composición: comentarios de usuarios en redes de la agencia. */
  commentShare: CommentShare;
  prevCommentShare: CommentShare;
}

export interface BuildFactsOptions {
  /** Autores a listar (default 8, como el correo). */
  authorLimit?: number;
}

/**
 * Calcula el paquete de hechos de una agencia y ventana. Todas las queries
 * corren en paralelo sobre el MISMO universo estricto y la misma ventana de
 * días PR; ninguna escribe.
 */
export async function buildUniverseFacts(
  client: PgClientLike,
  agencyId: string,
  window: FactsWindow,
  options: BuildFactsOptions = {},
): Promise<UniverseFacts> {
  const { startYmd, endYmd, prevStartYmd, prevEndYmd } = window;
  const authorLimit = options.authorLimit ?? 8;
  const [report, coverage, sources, municipalities, places, authors, emotions, cShare, prevCShare] = await Promise.all([
    buildSentimentReport(client, agencyId, startYmd, endYmd, prevStartYmd, prevEndYmd, FACTS_UNIVERSE),
    loadUniverseCoverage(client, agencyId, startYmd, endYmd),
    loadChannels(client, agencyId, startYmd, endYmd, FACTS_UNIVERSE),
    loadMunicipalityPartition(client, agencyId, startYmd, endYmd, FACTS_UNIVERSE),
    loadPlaces(client, agencyId, startYmd, endYmd, FACTS_UNIVERSE),
    loadAuthors(client, agencyId, startYmd, endYmd, authorLimit, FACTS_UNIVERSE),
    loadEmotions(client, agencyId, startYmd, endYmd, FACTS_UNIVERSE),
    commentShare(client, agencyId, { startYmd, endYmd }, FACTS_UNIVERSE),
    commentShare(client, agencyId, { startYmd: prevStartYmd, endYmd: prevEndYmd }, FACTS_UNIVERSE),
  ]);

  const authorMentions = authors.reduce((s, a) => s + a.total, 0);
  return {
    window,
    coverage,
    totals: report.totals,
    prevTotals: report.prevTotals,
    deltas: {
      total: minBaseDelta(report.prevTotals.total, report.totals.total),
      negative: minBaseDelta(report.prevTotals.negative, report.totals.negative),
      neutral: minBaseDelta(report.prevTotals.neutral, report.totals.neutral),
      positive: minBaseDelta(report.prevTotals.positive, report.totals.positive),
    },
    dailySeries: report.dailySeries,
    topics: report.topicsTable,
    sources,
    municipalities,
    places,
    authors: { rows: authors, restMentions: Math.max(0, coverage.inUniverse - authorMentions) },
    emotions: { rows: emotions.rows, tagged: emotions.tagged },
    commentShare: cShare,
    prevCommentShare: prevCShare,
  };
}

// ============================================================
// Invariante: todo suma el universo
// ============================================================

export interface FactsConsistencyIssue {
  what: string;
  expected: number;
  actual: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Verifica que las particiones del paquete (serie diaria, tópicos, fuentes,
 * municipios) y los totales por sentimiento sumen EXACTAMENTE el universo
 * (`coverage.inUniverse`). Devuelve la lista de violaciones (vacía = sano):
 * el lambda puede loguearla o abortar el envío; la prueba la exige vacía.
 *
 * Una diferencia entre `totals.total` y `inUniverse` significa menciones del
 * universo sin sentimiento (ni NLP ni Brandwatch): se reporta, no se oculta.
 */
export function checkFactsConsistency(f: Pick<UniverseFacts, 'coverage' | 'totals' | 'dailySeries' | 'topics' | 'sources' | 'municipalities'>): FactsConsistencyIssue[] {
  const expected = f.coverage.inUniverse;
  const checks: Array<[string, number]> = [
    ['totals.total (neg+neu+pos)', f.totals.total],
    ['sum(dailySeries)', sum(f.dailySeries.map((d) => d.negative + d.neutral + d.positive))],
    ['sum(topics.total)', sum(f.topics.map((t) => t.total))],
    ['sum(sources.total)', sum(f.sources.map((s) => s.total))],
    ['sum(municipalities.total)', sum(f.municipalities.map((m) => m.total))],
  ];
  return checks
    .filter(([, actual]) => actual !== expected)
    .map(([what, actual]) => ({ what, expected, actual }));
}
