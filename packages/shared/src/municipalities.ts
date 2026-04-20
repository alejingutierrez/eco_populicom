// ============================================================
// ECO Platform — 78 Municipalities of Puerto Rico
// ============================================================

export interface MunicipalityDef {
  slug: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  population: number;
}

export const MUNICIPALITIES: MunicipalityDef[] = [
  // Metro
  { slug: 'san-juan', name: 'San Juan', region: 'Metro', latitude: 18.4655, longitude: -66.1057, population: 318441 },
  { slug: 'bayamon', name: 'Bayamón', region: 'Metro', latitude: 18.3985, longitude: -66.1553, population: 170110 },
  { slug: 'carolina', name: 'Carolina', region: 'Metro', latitude: 18.3811, longitude: -65.9574, population: 146984 },
  { slug: 'guaynabo', name: 'Guaynabo', region: 'Metro', latitude: 18.3566, longitude: -66.1108, population: 89780 },
  { slug: 'trujillo-alto', name: 'Trujillo Alto', region: 'Metro', latitude: 18.3547, longitude: -66.0074, population: 67740 },
  { slug: 'catano', name: 'Cataño', region: 'Metro', latitude: 18.4414, longitude: -66.1181, population: 24888 },
  { slug: 'toa-baja', name: 'Toa Baja', region: 'Metro', latitude: 18.4442, longitude: -66.2546, population: 75204 },
  { slug: 'toa-alta', name: 'Toa Alta', region: 'Metro', latitude: 18.3882, longitude: -66.2484, population: 68025 },
  // Norte
  { slug: 'arecibo', name: 'Arecibo', region: 'Norte', latitude: 18.4725, longitude: -66.7157, population: 87242 },
  { slug: 'manati', name: 'Manatí', region: 'Norte', latitude: 18.4319, longitude: -66.4835, population: 38692 },
  { slug: 'vega-baja', name: 'Vega Baja', region: 'Norte', latitude: 18.4443, longitude: -66.3907, population: 54414 },
  { slug: 'vega-alta', name: 'Vega Alta', region: 'Norte', latitude: 18.4123, longitude: -66.3312, population: 37910 },
  { slug: 'dorado', name: 'Dorado', region: 'Norte', latitude: 18.4589, longitude: -66.2678, population: 37688 },
  { slug: 'barceloneta', name: 'Barceloneta', region: 'Norte', latitude: 18.4512, longitude: -66.5385, population: 22322 },
  { slug: 'camuy', name: 'Camuy', region: 'Norte', latitude: 18.4839, longitude: -66.8449, population: 30466 },
  { slug: 'hatillo', name: 'Hatillo', region: 'Norte', latitude: 18.4866, longitude: -66.7883, population: 37945 },
  { slug: 'quebradillas', name: 'Quebradillas', region: 'Norte', latitude: 18.4729, longitude: -66.9386, population: 23423 },
  { slug: 'isabela', name: 'Isabela', region: 'Norte', latitude: 18.5000, longitude: -67.0244, population: 42420 },
  { slug: 'loiza', name: 'Loíza', region: 'Norte', latitude: 18.4313, longitude: -65.8783, population: 24553 },
  { slug: 'rio-grande', name: 'Río Grande', region: 'Norte', latitude: 18.3802, longitude: -65.8314, population: 48025 },
  { slug: 'luquillo', name: 'Luquillo', region: 'Norte', latitude: 18.3726, longitude: -65.7165, population: 18547 },
  // Este
  { slug: 'caguas', name: 'Caguas', region: 'Este', latitude: 18.2388, longitude: -66.0486, population: 127244 },
  { slug: 'humacao', name: 'Humacao', region: 'Este', latitude: 18.1497, longitude: -65.8198, population: 50896 },
  { slug: 'fajardo', name: 'Fajardo', region: 'Este', latitude: 18.3258, longitude: -65.6525, population: 32240 },
  { slug: 'juncos', name: 'Juncos', region: 'Este', latitude: 18.2276, longitude: -65.9211, population: 37165 },
  { slug: 'las-piedras', name: 'Las Piedras', region: 'Este', latitude: 18.1831, longitude: -65.8666, population: 36110 },
  { slug: 'gurabo', name: 'Gurabo', region: 'Este', latitude: 18.2542, longitude: -65.9730, population: 45369 },
  { slug: 'san-lorenzo', name: 'San Lorenzo', region: 'Este', latitude: 18.1895, longitude: -65.9607, population: 37873 },
  { slug: 'naguabo', name: 'Naguabo', region: 'Este', latitude: 18.2115, longitude: -65.7347, population: 25718 },
  { slug: 'yabucoa', name: 'Yabucoa', region: 'Este', latitude: 18.0507, longitude: -65.8792, population: 32282 },
  { slug: 'ceiba', name: 'Ceiba', region: 'Este', latitude: 18.2632, longitude: -65.6487, population: 11853 },
  { slug: 'culebra', name: 'Culebra', region: 'Este', latitude: 18.3103, longitude: -65.3028, population: 1714 },
  { slug: 'vieques', name: 'Vieques', region: 'Este', latitude: 18.1263, longitude: -65.4401, population: 8249 },
  { slug: 'aguas-buenas', name: 'Aguas Buenas', region: 'Este', latitude: 18.2570, longitude: -66.1021, population: 25314 },
  { slug: 'cidra', name: 'Cidra', region: 'Este', latitude: 18.1759, longitude: -66.1612, population: 38307 },
  { slug: 'cayey', name: 'Cayey', region: 'Este', latitude: 18.1119, longitude: -66.1660, population: 44015 },
  { slug: 'maunabo', name: 'Maunabo', region: 'Este', latitude: 18.0072, longitude: -65.8992, population: 10679 },
  { slug: 'patillas', name: 'Patillas', region: 'Este', latitude: 18.0038, longitude: -65.9966, population: 16468 },
  // Oeste
  { slug: 'mayaguez', name: 'Mayagüez', region: 'Oeste', latitude: 18.2013, longitude: -67.1397, population: 71083 },
  { slug: 'aguadilla', name: 'Aguadilla', region: 'Oeste', latitude: 18.4274, longitude: -67.1541, population: 54166 },
  { slug: 'cabo-rojo', name: 'Cabo Rojo', region: 'Oeste', latitude: 18.0866, longitude: -67.1457, population: 46024 },
  { slug: 'san-german', name: 'San Germán', region: 'Oeste', latitude: 18.0831, longitude: -67.0359, population: 30227 },
  { slug: 'anasco', name: 'Añasco', region: 'Oeste', latitude: 18.2828, longitude: -67.1395, population: 26322 },
  { slug: 'rincon', name: 'Rincón', region: 'Oeste', latitude: 18.3402, longitude: -67.2499, population: 14293 },
  { slug: 'aguada', name: 'Aguada', region: 'Oeste', latitude: 18.3793, longitude: -67.1876, population: 37516 },
  { slug: 'moca', name: 'Moca', region: 'Oeste', latitude: 18.3949, longitude: -67.1131, population: 36019 },
  { slug: 'san-sebastian', name: 'San Sebastián', region: 'Oeste', latitude: 18.3367, longitude: -66.9904, population: 36249 },
  { slug: 'las-marias', name: 'Las Marías', region: 'Oeste', latitude: 18.2518, longitude: -66.9910, population: 8606 },
  { slug: 'hormigueros', name: 'Hormigueros', region: 'Oeste', latitude: 18.1395, longitude: -67.1270, population: 15806 },
  { slug: 'lajas', name: 'Lajas', region: 'Oeste', latitude: 18.0498, longitude: -67.0591, population: 23315 },
  { slug: 'sabana-grande', name: 'Sabana Grande', region: 'Oeste', latitude: 18.0786, longitude: -66.9608, population: 22284 },
  { slug: 'maricao', name: 'Maricao', region: 'Oeste', latitude: 18.1808, longitude: -66.9800, population: 5318 },
  // Sur
  { slug: 'ponce', name: 'Ponce', region: 'Sur', latitude: 18.0111, longitude: -66.6141, population: 132502 },
  { slug: 'guayama', name: 'Guayama', region: 'Sur', latitude: 17.9843, longitude: -66.1117, population: 37685 },
  { slug: 'juana-diaz', name: 'Juana Díaz', region: 'Sur', latitude: 18.0535, longitude: -66.5065, population: 44790 },
  { slug: 'salinas', name: 'Salinas', region: 'Sur', latitude: 18.0021, longitude: -66.2576, population: 27518 },
  { slug: 'santa-isabel', name: 'Santa Isabel', region: 'Sur', latitude: 17.9661, longitude: -66.4049, population: 21384 },
  { slug: 'coamo', name: 'Coamo', region: 'Sur', latitude: 18.0799, longitude: -66.3580, population: 38336 },
  { slug: 'guanica', name: 'Guánica', region: 'Sur', latitude: 17.9715, longitude: -66.9074, population: 15228 },
  { slug: 'yauco', name: 'Yauco', region: 'Sur', latitude: 18.0352, longitude: -66.8499, population: 35025 },
  { slug: 'guayanilla', name: 'Guayanilla', region: 'Sur', latitude: 18.0193, longitude: -66.7917, population: 17623 },
  { slug: 'penuelas', name: 'Peñuelas', region: 'Sur', latitude: 18.0563, longitude: -66.7260, population: 19267 },
  { slug: 'arroyo', name: 'Arroyo', region: 'Sur', latitude: 17.9665, longitude: -66.0613, population: 17111 },
  { slug: 'villalba', name: 'Villalba', region: 'Sur', latitude: 18.1277, longitude: -66.4924, population: 22093 },
  // Central
  { slug: 'utuado', name: 'Utuado', region: 'Central', latitude: 18.2655, longitude: -66.7008, population: 28186 },
  { slug: 'lares', name: 'Lares', region: 'Central', latitude: 18.2957, longitude: -66.8780, population: 25647 },
  { slug: 'adjuntas', name: 'Adjuntas', region: 'Central', latitude: 18.1627, longitude: -66.7224, population: 17024 },
  { slug: 'jayuya', name: 'Jayuya', region: 'Central', latitude: 18.2183, longitude: -66.5916, population: 14536 },
  { slug: 'ciales', name: 'Ciales', region: 'Central', latitude: 18.3368, longitude: -66.4689, population: 16374 },
  { slug: 'morovis', name: 'Morovis', region: 'Central', latitude: 18.3253, longitude: -66.4075, population: 29612 },
  { slug: 'orocovis', name: 'Orocovis', region: 'Central', latitude: 18.2269, longitude: -66.3912, population: 20791 },
  { slug: 'barranquitas', name: 'Barranquitas', region: 'Central', latitude: 18.1863, longitude: -66.3063, population: 27725 },
  { slug: 'aibonito', name: 'Aibonito', region: 'Central', latitude: 18.1400, longitude: -66.2661, population: 23457 },
  { slug: 'comerio', name: 'Comerío', region: 'Central', latitude: 18.2189, longitude: -66.2256, population: 18648 },
  { slug: 'naranjito', name: 'Naranjito', region: 'Central', latitude: 18.3009, longitude: -66.2450, population: 27914 },
  { slug: 'corozal', name: 'Corozal', region: 'Central', latitude: 18.3417, longitude: -66.3168, population: 33478 },
  { slug: 'florida', name: 'Florida', region: 'Central', latitude: 18.3626, longitude: -66.5717, population: 11254 },
];

/** Lookup municipality by slug */
export const MUNICIPALITY_MAP = new Map(
  MUNICIPALITIES.map((m) => [m.slug, m]),
);

/** All municipality slugs for validation */
export const MUNICIPALITY_SLUGS = MUNICIPALITIES.map((m) => m.slug);

/** Get municipalities by region */
export function getMunicipalitiesByRegion(region: string): MunicipalityDef[] {
  return MUNICIPALITIES.filter((m) => m.region === region);
}

/** Regions of Puerto Rico */
export const REGIONS = ['Metro', 'Norte', 'Este', 'Oeste', 'Sur', 'Central'] as const;

// ============================================================
//  Regex-based municipality extraction
// ============================================================
// Claude sometimes omits obvious municipalities from free-form text. A cheap
// post-pass scans the title + snippet + NLP summary for the 78 canonical
// names and merges them with whatever the LLM returned. Ambiguous /
// collision-prone matches (e.g. "Florida" — also a U.S. state; short
// aliases) require a PR-context anchor word nearby.

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Manual aliases: alternate spellings, barrios, or nicknames that should
// resolve to a canonical slug. Accent-insensitive match.
const MANUAL_ALIASES: Record<string, string> = {
  'rio piedras': 'san-juan',
  'río piedras': 'san-juan',
  'santurce': 'san-juan',
  'hato rey': 'san-juan',
  'condado': 'san-juan',
  'viejo san juan': 'san-juan',
  'old san juan': 'san-juan',
  'levittown': 'toa-baja',
  'isabela segunda': 'vieques',
  'esperanza': 'vieques',
  'la perla': 'san-juan',
};

// Names that collide with non-municipality senses (US states, common nouns).
// Counted only when accompanied by a PR-context anchor in the same text.
const AMBIGUOUS_NAMES = new Set<string>(['florida']);
const PR_CONTEXT_ANCHORS = /\b(puerto\s*rico|municipio|barrio|isla\s*del\s*encanto)\b/i;

/** Extract municipality slugs from free-form text (title + snippet + summary). */
export function extractMunicipalitiesFromText(
  ...parts: Array<string | null | undefined>
): string[] {
  const text = parts.filter((s): s is string => typeof s === 'string' && s.length > 0).join('  ');
  if (!text) return [];
  const normalized = stripAccents(text.toLowerCase());
  const hasPrContext = PR_CONTEXT_ANCHORS.test(text);
  const found = new Set<string>();

  // 1) Canonical names (accent-insensitive, word-boundary)
  for (const m of MUNICIPALITIES) {
    const canon = stripAccents(m.name.toLowerCase());
    const re = new RegExp('(?:^|[^a-z0-9])' + canon.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9])');
    if (re.test(normalized)) {
      if (AMBIGUOUS_NAMES.has(canon) && !hasPrContext) continue;
      found.add(m.slug);
    }
  }

  // 2) Aliases / barrio mappings
  for (const [alias, slug] of Object.entries(MANUAL_ALIASES)) {
    const a = stripAccents(alias);
    const re = new RegExp('(?:^|[^a-z0-9])' + a.replace(/\s+/g, '\\s+') + '(?=$|[^a-z0-9])');
    if (re.test(normalized)) found.add(slug);
  }

  return [...found];
}
export type Region = (typeof REGIONS)[number];
