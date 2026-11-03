/**
 * Bandera del universo pertinente por agencia (WP-9a, spec interpretación v1
 * sección 8).
 *
 * `UNIVERSE_STRICT_AGENCIES` es una lista de slugs separados por coma (p. ej.
 * `ddecpr,df`). Para esas agencias TODAS las rutas de datos cuentan sobre el
 * universo estricto de `@eco/shared` (`is_duplicate = false AND
 * nlp_pertinence IN ('alta','media')`, NULL fuera). Con la variable VACÍA o sin
 * definir —el estado de hoy— el universo es el histórico (`NULL o <> 'baja'`) y
 * el SQL de cada ruta es idéntico al de antes de v1 (lo prueba
 * `contracts/universe-routes.test.ts` con un cliente espía).
 *
 * `*` activa el universo estricto para todas las agencias (el día del
 * despliegue general, cuando el backfill de la rúbrica v2 esté completo).
 *
 * El valor se lee en CADA petición (no al cargar el módulo): cambiar la
 * variable de entorno del servicio basta, sin redeploy del código.
 */
import { sql, type SQL } from 'drizzle-orm';
import { getPool } from '@eco/database';
import { pertinentUniverseSql, type UniverseOptions } from '@eco/shared';

export const UNIVERSE_ENV = 'UNIVERSE_STRICT_AGENCIES';

export interface StrictAgencies {
  /** `*`: todas las agencias. */
  all: boolean;
  slugs: ReadonlySet<string>;
}

/** Parsea la variable: slugs en minúsculas, sin espacios; vacía → ninguna. */
export function parseStrictAgencies(raw: string | null | undefined = process.env[UNIVERSE_ENV]): StrictAgencies {
  const parts = String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { all: parts.includes('*'), slugs: new Set(parts.filter((p) => p !== '*')) };
}

/** ¿Hay alguna agencia con universo estricto? Atajo para no consultar el slug de más. */
export function anyStrictAgency(raw?: string | null): boolean {
  const cfg = parseStrictAgencies(raw === undefined ? process.env[UNIVERSE_ENV] : raw);
  return cfg.all || cfg.slugs.size > 0;
}

export function isStrictForSlug(slug: string | null | undefined, raw?: string | null): boolean {
  const cfg = parseStrictAgencies(raw === undefined ? process.env[UNIVERSE_ENV] : raw);
  if (cfg.all) return true;
  return !!slug && cfg.slugs.has(slug.trim().toLowerCase());
}

/**
 * Opciones de universo para los agregados de `@eco/shared`. Vacías (`{}`) con
 * la bandera apagada: `universeFilterSql({})` es el predicado histórico, el
 * mismo que `undefined`.
 */
export function universeOptsForSlug(slug: string | null | undefined, raw?: string | null): UniverseOptions {
  return isStrictForSlug(slug, raw) ? { strictUniverse: true } : {};
}

// id → slug de la agencia (no cambia). Con la bandera apagada no se consulta.
const slugCache = new Map<string, string | null>();

interface SlugLookup { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ slug?: string | null }> }> }

/**
 * Opciones de universo para una agencia por id. Con la bandera vacía responde
 * sin tocar la base (cero consultas nuevas → SQL de la ruta idéntico al
 * histórico). Con bandera, resuelve el slug UNA vez por proceso.
 */
export async function universeOptsForAgencyId(
  agencyId: string,
  lookup?: SlugLookup,
  raw?: string | null,
): Promise<UniverseOptions> {
  const env = raw === undefined ? process.env[UNIVERSE_ENV] : raw;
  if (!anyStrictAgency(env)) return {};
  if (parseStrictAgencies(env).all) return { strictUniverse: true };
  let slug = slugCache.get(agencyId);
  if (slug === undefined) {
    const client = lookup ?? (getPool() as unknown as SlugLookup);
    const r = await client.query('SELECT slug FROM agencies WHERE id = $1 LIMIT 1', [agencyId]);
    slug = r.rows[0]?.slug ?? null;
    slugCache.set(agencyId, slug);
  }
  return universeOptsForSlug(slug, env);
}

/** Solo para pruebas. */
export function clearUniverseSlugCache(): void {
  slugCache.clear();
}

/**
 * Condición Drizzle del universo ESTRICTO sobre la tabla `mentions` (sin
 * alias). `null` con la bandera apagada: el llamante conserva entonces sus
 * condiciones históricas tal cual (así el SQL no cambia ni un carácter).
 */
export function strictUniverseCond(opts: UniverseOptions | undefined): SQL | null {
  return opts?.strictUniverse ? sql.raw(pertinentUniverseSql('mentions.')) : null;
}

/**
 * Para rutas que hoy NO filtran pertinencia (detalle de narrativas): un
 * fragmento `AND …` solo con la bandera encendida; vacío si no, de modo que el
 * SQL histórico no cambia.
 */
export function strictOnlyPertinenceSql(opts: UniverseOptions | undefined, alias = ''): string {
  return opts?.strictUniverse ? `AND ${pertinentUniverseSql(alias)}` : '';
}

/**
 * Etiqueta del universo que se muestra junto a la lista (spec 8 y 11.5): lo que
 * dice el toggle «incluir pertinencia baja». El universo estricto (que además
 * deja fuera las menciones aún sin clasificar) se declara aparte en `strict`.
 */
export function universeLabel(opts: UniverseOptions | undefined, includeLow: boolean): string {
  if (includeLow) return 'todas las pertinencias';
  return 'sin pertinencia baja';
}
