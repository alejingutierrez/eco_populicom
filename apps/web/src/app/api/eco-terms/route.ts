/**
 * GET /api/eco-terms — términos para la nube de palabras de Menciones.
 *
 * Dos modos:
 *   · `mode=frequent`    — DF crudo (cuántas menciones contienen el término).
 *   · `mode=distinctive` — log-odds ratio con prior de Dirichlet informativo
 *     (Monroe, Colaresi & Quinn 2008), el estándar para "qué distingue a este
 *     periodo". Es el DEFAULT, porque la frecuencia cruda sobre este corpus
 *     devuelve los términos del propio boolean de Brandwatch: medido en
 *     producción para gobernadora a 365 días, los seis primeros son
 *     gonzález / jenniffer / gobernadora / colón / puerto / rico.
 *
 * Rendimiento medido en producción: el 90% del coste es PARSEAR el texto, no
 * agregar. Con el tsvector ya calculado, `unnest + GROUP BY` sobre 1.26 M
 * lexemas cuesta <1 s; parsear en caliente tarda 34 s para 2,290 menciones.
 * Por eso hay dos rutas:
 *   · si existe `mention_terms` (índice invertido), se lee de ahí — rápido;
 *   · si no existe, se calcula al vuelo con `to_tsvector` y se acota la ventana,
 *     para que la función SIRVA sin depender de una migración.
 *
 * El scope usa EXACTAMENTE el mismo predicado que `/api/eco-mentions`: si la
 * nube y la lista contaran distinto sería el hallazgo F9 otra vez (dos fuentes
 * rivales para el mismo número), que es el defecto que más credibilidad cuesta.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@eco/database';
import { agencies } from '@eco/database';
import { getDb } from '@eco/database';
import { eq } from 'drizzle-orm';
import { resolveAgencyId } from '@/lib/agency';
import { consume, clientKey } from '@/lib/rate-limit';
import { createLogger } from '@/lib/logger';
import { stopSurfacesFor, STOP_STEMS } from '@/lib/wordcloud/stopwords';

export const dynamic = 'force-dynamic';

const log = createLogger('eco-terms');

const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '1M': 30, '3M': 90, '6M': 180, '1A': 365, Max: 3650,
};

type Row = {
  term: string;
  display: string;
  df: number;
  score: number;
  pos: number;
  neu: number;
  neg: number;
  first_seen: string | null;
};

/** ¿Existe el índice invertido? Determina la ruta rápida vs. la de respaldo. */
async function hasTermsTable(pool: ReturnType<typeof getPool>): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'mention_terms' LIMIT 1`,
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const rl = consume('eco-terms:' + clientKey(request), { limit: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfter / 1000)) } },
    );
  }
  const started = Date.now();
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('mode') === 'frequent' ? 'frequent' : 'distinctive';
  const limit = Math.min(120, Math.max(10, Number(searchParams.get('limit') ?? '60')));
  const periodKey = searchParams.get('period') ?? '7D';
  const days = PERIOD_DAYS[periodKey] ?? 7;

  const db = getDb();
  let agencyId = await resolveAgencyId(searchParams);
  let agencySlug: string | null = null;
  if (!agencyId) {
    const [first] = await db
      .select({ id: agencies.id, slug: agencies.slug })
      .from(agencies)
      .where(eq(agencies.isActive, true))
      .limit(1);
    agencyId = first?.id ?? null;
    agencySlug = first?.slug ?? null;
  } else {
    const [row] = await db.select({ slug: agencies.slug }).from(agencies).where(eq(agencies.id, agencyId)).limit(1);
    agencySlug = row?.slug ?? null;
  }
  if (!agencyId) {
    return NextResponse.json({ terms: [], mode, refMode: null, total: 0 });
  }

  // ---- filtros de contenido: los MISMOS nombres de param que /api/eco-mentions
  const q = (searchParams.get('q') ?? '').trim();
  const sentiment = searchParams.get('sentiment') ?? '';
  const source = searchParams.get('source') ?? '';
  const topic = searchParams.get('topic') ?? '';
  const emotion = searchParams.get('emotion') ?? '';
  const municipality = searchParams.get('municipality') ?? '';

  // `refMode`: cuando hay un filtro de contenido, la referencia correcta son los
  // "hermanos" (mismo periodo, sin ese filtro) — responde "¿de qué se habla
  // cuando se habla de esto?". Sin filtros, la referencia es la ventana anterior
  // — responde "¿qué es nuevo?".
  const hasContentFilter = !!(q || sentiment || source || topic || emotion || municipality);
  const refMode: 'prev' | 'siblings' = hasContentFilter ? 'siblings' : 'prev';

  const pool = getPool();
  const stopSurfaces = stopSurfacesFor(agencySlug);

  const params: unknown[] = [];
  const P = (v: unknown) => `$${params.push(v)}`;

  const agencyP = P(agencyId);
  const daysP = P(days);

  // Condiciones de contenido, compartidas por scope y por la referencia
  // `siblings` (que las omite todas menos el periodo).
  const contentConds: string[] = [];
  if (sentiment === 'positivo' || sentiment === 'negativo') {
    contentConds.push(
      `COALESCE(m.nlp_sentiment, m.bw_sentiment) IN (${P(sentiment)}, ${P(sentiment === 'positivo' ? 'positive' : 'negative')})`,
    );
  } else if (sentiment === 'neutral') {
    contentConds.push(
      `(COALESCE(m.nlp_sentiment, m.bw_sentiment) IS NULL
         OR COALESCE(m.nlp_sentiment, m.bw_sentiment) NOT IN ('positivo','positive','negativo','negative'))`,
    );
  }
  if (source && source !== 'all') contentConds.push(`m.page_type = ${P(source)}`);
  if (municipality) {
    contentConds.push(`EXISTS (
      SELECT 1 FROM mention_municipalities mm
        JOIN municipalities mu ON mu.id = mm.municipality_id
       WHERE mm.mention_id = m.id AND mu.slug = ${P(municipality)})`);
  }
  if (topic) {
    contentConds.push(`EXISTS (
      SELECT 1 FROM mention_topics mt2 JOIN topics t2 ON t2.id = mt2.topic_id
       WHERE mt2.mention_id = m.id AND t2.slug = ${P(topic)})`);
  }
  if (emotion) contentConds.push(`m.nlp_emotions @> ${P(JSON.stringify([emotion.toLowerCase()]))}::jsonb`);
  if (q) {
    const like = `%${q}%`;
    contentConds.push(`(m.title ILIKE ${P(like)} OR m.snippet ILIKE ${P(like)})`);
  }

  const baseConds = [
    `m.agency_id = ${agencyP}::uuid`,
    'm.is_duplicate = false',
    `(m.nlp_pertinence IS NULL OR m.nlp_pertinence <> 'baja')`,
  ];
  const windowScope = `m.published_at >= NOW() - (${daysP} || ' days')::interval`;
  // Referencia: la ventana inmediatamente anterior, de 3x la longitud, acotada
  // a [30, 180] días para que un periodo de 1D no compare contra 3 días de ruido
  // ni un periodo de 1A contra una década.
  const refDays = Math.min(180, Math.max(30, days * 3));
  const refDaysP = P(refDays);
  const windowRefPrev = `m.published_at >= NOW() - ((${daysP} + ${refDaysP}) || ' days')::interval
                          AND m.published_at < NOW() - (${daysP} || ' days')::interval`;

  const scopeWhere = [...baseConds, windowScope, ...contentConds].join(' AND ');
  const refWhere = refMode === 'prev'
    ? [...baseConds, windowRefPrev, ...contentConds].join(' AND ')
    : [...baseConds, windowScope].join(' AND '); // siblings: mismo periodo, sin filtros de contenido

  const fast = await hasTermsTable(pool);
  // Fuente del tsvector. La ruta rápida lee la columna materializada; la de
  // respaldo la calcula al vuelo con los mismos pesos (A=título, B=snippet,
  // C=resumen) para que el ranking no cambie según la ruta.
  const TSV = fast
    ? 'mt.tsv'
    : `(setweight(to_tsvector('spanish', COALESCE(m.title, '')), 'A')
        || setweight(to_tsvector('spanish', COALESCE(m.snippet, '')), 'B')
        || setweight(to_tsvector('spanish', COALESCE(m.nlp_summary, '')), 'C'))`;
  const JOIN = fast ? 'JOIN mention_terms mt ON mt.mention_id = m.id' : '';

  const stopP = P(stopSurfaces);
  const stemP = P(STOP_STEMS);
  const limitP = P(limit);

  // minDf: evita que un término que aparece 2 veces encabece "distinctive" sólo
  // por ser rarísimo antes. Escala con el tamaño del scope.
  const sql = `
WITH stop AS (
  SELECT DISTINCT s FROM (
    SELECT (ts_lexize('spanish_stem', w))[1] AS s FROM unnest(${stopP}::text[]) w
    UNION ALL SELECT w FROM unnest(${stemP}::text[]) w
  ) u WHERE s IS NOT NULL
),
scope AS (
  SELECT m.id, ${TSV} AS tsv,
         m.title AS title_txt, m.snippet AS snippet_txt,
         CASE WHEN COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('positivo','positive')  THEN  1
              WHEN COALESCE(m.nlp_sentiment, m.bw_sentiment) IN ('negativo','negative') THEN -1
              ELSE 0 END AS spol,
         m.published_at
    FROM mentions m ${JOIN}
   WHERE ${scopeWhere}
),
ref AS (
  SELECT m.id, ${TSV} AS tsv
    FROM mentions m ${JOIN}
   WHERE ${refWhere}
),
scope_n AS (SELECT COUNT(*)::float AS n FROM scope),
st AS (
  SELECT w.lexeme AS term,
         COUNT(*)::int AS df,
         SUM(CASE WHEN s.spol = 1 THEN 1 ELSE 0 END)::int AS pos,
         SUM(CASE WHEN s.spol = 0 THEN 1 ELSE 0 END)::int AS neu,
         SUM(CASE WHEN s.spol = -1 THEN 1 ELSE 0 END)::int AS neg,
         MIN(s.published_at)::date::text AS first_seen
    FROM scope s, unnest(s.tsv) w
   WHERE length(w.lexeme) >= 3
     AND w.lexeme !~ '^[0-9]+$'
     AND w.lexeme NOT IN (SELECT s FROM stop)
   GROUP BY w.lexeme
),
rt AS (
  SELECT w.lexeme AS term, COUNT(*)::int AS df
    FROM ref r, unnest(r.tsv) w
   WHERE length(w.lexeme) >= 3
     AND w.lexeme !~ '^[0-9]+$'
     AND w.lexeme NOT IN (SELECT s FROM stop)
   GROUP BY w.lexeme
),
tot AS (SELECT (SELECT COALESCE(SUM(df),0) FROM st) AS nt, (SELECT COALESCE(SUM(df),0) FROM rt) AS nr),
-- Forma de SUPERFICIE por tallo. El stemmer español devuelve "manufactur",
-- "permis", "abonad": tallos, no palabras. Mostrarlos al usuario es inaceptable
-- en un producto de gobierno. Aquí se recuperan las palabras reales del texto,
-- se agrupan por su tallo y se elige la más frecuente como forma de display.
words AS (
  SELECT lower(wd) AS surface, (ts_lexize('spanish_stem', lower(wd)))[1] AS stem
    FROM scope s,
         regexp_matches(
           COALESCE(s.title_txt, '') || ' ' || COALESCE(s.snippet_txt, ''),
           '[[:alpha:]ÁÉÍÓÚÜÑáéíóúüñ]{3,}', 'g'
         ) AS m(arr), unnest(m.arr) AS wd
),
surf AS (
  SELECT stem, surface, COUNT(*) AS c,
         ROW_NUMBER() OVER (PARTITION BY stem ORDER BY COUNT(*) DESC, length(surface) ASC, surface ASC) AS rn
    FROM words
   WHERE stem IS NOT NULL
   GROUP BY stem, surface
)
SELECT st.term,
       st.df,
       st.pos, st.neu, st.neg,
       st.first_seen,
       CASE WHEN ${P(mode)} = 'frequent' THEN st.df::float
            ELSE (
              -- log-odds con prior de Dirichlet informativo (a0 = 500)
              ( ln( (st.df + (500.0 * (st.df + COALESCE(rt.df,0)) / GREATEST(tot.nt + tot.nr, 1)))
                    / GREATEST(tot.nt + 500.0 - st.df - (500.0 * (st.df + COALESCE(rt.df,0)) / GREATEST(tot.nt + tot.nr, 1)), 1) )
              - ln( (COALESCE(rt.df,0) + (500.0 * (st.df + COALESCE(rt.df,0)) / GREATEST(tot.nt + tot.nr, 1)))
                    / GREATEST(tot.nr + 500.0 - COALESCE(rt.df,0) - (500.0 * (st.df + COALESCE(rt.df,0)) / GREATEST(tot.nt + tot.nr, 1)), 1) ) )
              / sqrt( 1.0/GREATEST(st.df + (500.0 * (st.df + COALESCE(rt.df,0)) / GREATEST(tot.nt + tot.nr, 1)), 0.5)
                    + 1.0/GREATEST(COALESCE(rt.df,0) + (500.0 * (st.df + COALESCE(rt.df,0)) / GREATEST(tot.nt + tot.nr, 1)), 0.5) )
            )
       END AS score,
       COALESCE(rt.df, 0) AS ref_df,
       COALESCE(sf.surface, st.term) AS display
  FROM st
  LEFT JOIN rt ON rt.term = st.term
  LEFT JOIN surf sf ON sf.stem = st.term AND sf.rn = 1
  CROSS JOIN tot
 WHERE st.df >= GREATEST(3, CEIL(0.004 * (SELECT n FROM scope_n)))
 ORDER BY score DESC NULLS LAST, st.df DESC
 LIMIT ${limitP}`;

  try {
    const res = await pool.query<Row & { ref_df: number }>(sql, params as never[]);
    const terms = res.rows.map((r) => {
      const df = Number(r.df) || 0;
      const pos = Number(r.pos) || 0;
      const neg = Number(r.neg) || 0;
      // Sentimiento del término: sólo se declara con una base mínima. Por debajo
      // de 5 menciones el signo es ruido y se devuelve `null`, para que la UI lo
      // pinte neutro en vez de afirmar algo que no puede sostener.
      const polarity = df >= 5 ? Math.round(((pos - neg) / df) * 100) / 100 : null;
      return {
        // `term` = el tallo, que es lo que se manda al filtro (para que
        // "permiso" y "permisos" coincidan). `display` = la palabra real que ve
        // el usuario.
        term: r.display || r.term,
        stem: r.term,
        df,
        score: Number(r.score) || 0,
        sentiment: { pos, neu: Number(r.neu) || 0, neg },
        polarity,
        // Novedad: no existía en la ventana de referencia. Es la señal más útil
        // para el cliente ("¿qué apareció esta semana?").
        isNew: refMode === 'prev' && Number(r.ref_df) === 0,
        firstSeen: r.first_seen,
      };
    });
    const out = NextResponse.json({
      terms,
      mode,
      refMode,
      refDays: refMode === 'prev' ? refDays : days,
      total: terms.length,
      // Se declara la ruta usada: sin `mention_terms` la ventana grande es lenta,
      // y el cliente merece saber por qué.
      source: fast ? 'mention_terms' : 'on-the-fly',
    });
    out.headers.set('Cache-Control', 'no-store');
    return out;
  } catch (err) {
    log.error('eco-terms', 'query failed', { msg: (err as Error).message });
    return NextResponse.json({ error: 'eco-terms error', message: (err as Error).message }, { status: 500 });
  } finally {
    log.info('eco-terms', 'request complete', { latencyMs: Date.now() - started, mode, fast });
  }
}
