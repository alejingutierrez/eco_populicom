import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@eco/database';
import { mentions, municipalities, mentionMunicipalities } from '@eco/database';
import { sql, eq, and, gte, lte, count } from 'drizzle-orm';
import { closedWindowYmdInTZ, sourceMatchTerms } from '@eco/shared';
import { resolveAgencyId } from '@/lib/agency';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';

const TZ = 'America/Puerto_Rico';

// Mismo mapa de períodos que /api/eco-data, para que la ventana coincida.
const PERIOD_DAYS: Record<string, number> = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
  '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
  '24h': 1, '7d': 7, '30d': 30, '90d': 90,
};

const SLUG = /^[a-z0-9][a-z0-9\-]{0,60}$/;

const effectiveSentimentSql = sql<string | null>`COALESCE(${mentions.nlpSentiment}, ${mentions.bwSentiment})`;

/**
 * Condición SQL "esta mención pertenece a la fuente `source`", espejo de
 * sourceKey() vía @eco/shared. Captura variantes (instagram + instagram_public,
 * facebook + facebook_public, bluesky, tumblr…) por substring, no match exacto
 * — el mismo fix que eco-mentions. Ver packages/shared/src/sources.ts.
 */
function sourceCondition(source: string) {
  const { negate, terms } = sourceMatchTerms(source);
  if (terms.length === 0) return null;
  const col = sql`LOWER(COALESCE(${mentions.pageType}, ''))`;
  const parts = terms.map((t) =>
    t.op === 'like' ? sql`${col} LIKE ${t.value}` : sql`${col} = ${t.value}`,
  );
  const joined = sql.join(parts, sql` OR `);
  return negate ? sql`NOT (${joined})` : sql`(${joined})`;
}

function pill(s: string | null): 'positivo' | 'neutral' | 'negativo' {
  if (s === 'positivo' || s === 'positive') return 'positivo';
  if (s === 'negativo' || s === 'negative') return 'negativo';
  return 'neutral';
}

/**
 * GET /api/eco-geo — agregación por municipio FILTRADA por fuente/tópico/subtópico.
 *
 * /api/eco-data devuelve MUNICIPALITIES una sola vez al boot, sin filtros de
 * contenido. Esta ruta dedicada permite que la pantalla de Geografía re-consulte
 * la distribución del mapa cuando el usuario cambia fuente/tópico/subtópico, sin
 * re-ejecutar las ~15 secciones pesadas de eco-data.
 *
 * Devuelve EXACTAMENTE la misma forma que eco-data MUNICIPALITIES
 * ({ slug, name, region, count, nss, lat, lon, positivo, neutral, negativo }) y
 * usa los MISMOS filtros que el modal (eco-mentions): is_duplicate=false +
 * excluir 'baja' pertinencia + ventana cerrada. Así el dot del mapa y el total
 * del modal cuadran bajo cualquier combinación de filtros.
 *
 * Semántica de tópico: any-touch (cualquier mención que toque el tópico),
 * igual que el default de eco-mentions (topicMode=all), para que el conteo del
 * mapa coincida con el modal de drill-in que se abre al hacer click.
 * Subtópico se filtra por NOMBRE (no slug), igual que eco-mentions.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const db = getDb();

  const agencyId = await resolveAgencyId(searchParams);
  if (!agencyId) return NextResponse.json({ municipalities: [] });

  // Ventana: customRange (from/to) o preset (period). Mismos bordes AST (-04:00)
  // que eco-data para que el conteo cuadre con el resto del dashboard.
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  let since: Date;
  let until: Date;
  if (
    fromParam && toParam &&
    /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && /^\d{4}-\d{2}-\d{2}$/.test(toParam) &&
    fromParam <= toParam
  ) {
    since = new Date(`${fromParam}T00:00:00-04:00`);
    until = new Date(`${toParam}T23:59:59.999-04:00`);
  } else {
    const period = searchParams.get('period') || '1M';
    const days = PERIOD_DAYS[period] ?? 30;
    const w = closedWindowYmdInTZ(days, new Date(), TZ);
    since = new Date(`${w.startYmd}T00:00:00-04:00`);
    until = new Date(`${w.endYmd}T23:59:59.999-04:00`);
  }

  const conds = [
    eq(mentions.agencyId, agencyId),
    eq(mentions.isDuplicate, false),
    gte(mentions.publishedAt, since),
    lte(mentions.publishedAt, until),
    sql`(${mentions.nlpPertinence} IS NULL OR ${mentions.nlpPertinence} <> 'baja')`,
  ];

  const source = searchParams.get('source');
  if (source && source !== 'all') {
    const cond = sourceCondition(source);
    if (cond) conds.push(cond);
  }

  const topic = searchParams.get('topic');
  if (topic) {
    if (!SLUG.test(topic)) {
      return NextResponse.json({ municipalities: [], error: 'invalid topic' }, { status: 400 });
    }
    conds.push(sql`EXISTS (SELECT 1 FROM mention_topics mt JOIN topics t ON t.id = mt.topic_id WHERE mt.mention_id = ${mentions.id} AND t.slug = ${topic})`);
  }

  const subtopic = searchParams.get('subtopic');
  if (subtopic) {
    if (subtopic.length > 120) {
      return NextResponse.json({ municipalities: [], error: 'invalid subtopic' }, { status: 400 });
    }
    conds.push(sql`EXISTS (SELECT 1 FROM mention_topics mt JOIN subtopics st ON st.id = mt.subtopic_id WHERE mt.mention_id = ${mentions.id} AND st.name = ${subtopic})`);
  }

  try {
    const rows = await db
      .select({
        slug: municipalities.slug,
        name: municipalities.name,
        region: municipalities.region,
        lat: municipalities.latitude,
        lon: municipalities.longitude,
        s: effectiveSentimentSql,
        c: count(),
      })
      .from(mentionMunicipalities)
      .innerJoin(municipalities, eq(municipalities.id, mentionMunicipalities.municipalityId))
      .innerJoin(mentions, eq(mentions.id, mentionMunicipalities.mentionId))
      .where(and(...conds))
      .groupBy(
        municipalities.slug, municipalities.name, municipalities.region,
        municipalities.latitude, municipalities.longitude, effectiveSentimentSql,
      );

    const map = new Map<string, {
      slug: string; name: string; region: string;
      lat: number; lon: number;
      positivo: number; neutral: number; negativo: number; total: number;
    }>();
    for (const r of rows) {
      if (!map.has(r.slug)) {
        map.set(r.slug, {
          slug: r.slug, name: r.name, region: r.region,
          lat: Number(r.lat), lon: Number(r.lon),
          positivo: 0, neutral: 0, negativo: 0, total: 0,
        });
      }
      const e = map.get(r.slug)!;
      const k = pill(r.s);
      const c = Number(r.c);
      e[k] += c;
      e.total += c;
    }

    const municipalitiesOut = Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .map((m) => {
        const t = m.total || 1;
        const nss = Math.round(((m.positivo - m.negativo) / t) * 100) / 10;
        return {
          slug: m.slug, name: m.name, region: m.region,
          count: m.total, nss, lat: m.lat, lon: m.lon,
          positivo: m.positivo, neutral: m.neutral, negativo: m.negativo,
        };
      });

    return NextResponse.json({ municipalities: municipalitiesOut });
  } catch (err) {
    log.error('eco-geo', 'aggregation failed', { err: String(err) });
    return NextResponse.json({ municipalities: [], error: 'internal' }, { status: 500 });
  }
}
