// ============================================================
// ECO Platform — Municipalities of Puerto Rico
// ============================================================
// Los 78 municipios. Población: estimado del Negociado del Censo de EE. UU. al
// 1 de julio de 2025 (Vintage 2025, tabla PRM-EST2025-POP; suman 3,184,835).
// La base de datos (`municipalities.population`) lleva las mismas cifras.
// Coordenadas: el centro del pueblo (no el centroide del municipio).
//
// Región: Metro es el núcleo de San Juan (8 municipios), no el área
// metropolitana del Censo; los que lo rodean van con su costa (Dorado y Loíza
// en Norte). Canóvanas va en Norte: su pueblo está en el llano del norte, junto
// a Río Grande, y fue barrio de Loíza hasta 1970. Todos los pueblos de Norte
// quedan a 18.37° N o más y todos los de Este a 18.33° o menos.

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
  { slug: 'san-juan', name: 'San Juan', region: 'Metro', latitude: 18.4655, longitude: -66.1057, population: 329737 },
  { slug: 'bayamon', name: 'Bayamón', region: 'Metro', latitude: 18.3985, longitude: -66.1553, population: 180562 },
  { slug: 'carolina', name: 'Carolina', region: 'Metro', latitude: 18.3811, longitude: -65.9574, population: 149874 },
  { slug: 'guaynabo', name: 'Guaynabo', region: 'Metro', latitude: 18.3566, longitude: -66.1108, population: 89055 },
  { slug: 'trujillo-alto', name: 'Trujillo Alto', region: 'Metro', latitude: 18.3547, longitude: -66.0074, population: 66348 },
  { slug: 'catano', name: 'Cataño', region: 'Metro', latitude: 18.4414, longitude: -66.1181, population: 21701 },
  { slug: 'toa-baja', name: 'Toa Baja', region: 'Metro', latitude: 18.4442, longitude: -66.2546, population: 70931 },
  { slug: 'toa-alta', name: 'Toa Alta', region: 'Metro', latitude: 18.3882, longitude: -66.2484, population: 65754 },
  // Norte
  { slug: 'arecibo', name: 'Arecibo', region: 'Norte', latitude: 18.4725, longitude: -66.7157, population: 85539 },
  { slug: 'manati', name: 'Manatí', region: 'Norte', latitude: 18.4319, longitude: -66.4835, population: 38413 },
  { slug: 'vega-baja', name: 'Vega Baja', region: 'Norte', latitude: 18.4443, longitude: -66.3907, population: 53505 },
  { slug: 'vega-alta', name: 'Vega Alta', region: 'Norte', latitude: 18.4123, longitude: -66.3312, population: 34351 },
  { slug: 'dorado', name: 'Dorado', region: 'Norte', latitude: 18.4589, longitude: -66.2678, population: 35891 },
  { slug: 'barceloneta', name: 'Barceloneta', region: 'Norte', latitude: 18.4512, longitude: -66.5385, population: 22316 },
  { slug: 'camuy', name: 'Camuy', region: 'Norte', latitude: 18.4839, longitude: -66.8449, population: 32691 },
  { slug: 'hatillo', name: 'Hatillo', region: 'Norte', latitude: 18.4866, longitude: -66.7883, population: 37810 },
  { slug: 'quebradillas', name: 'Quebradillas', region: 'Norte', latitude: 18.4729, longitude: -66.9386, population: 23189 },
  { slug: 'isabela', name: 'Isabela', region: 'Norte', latitude: 18.5000, longitude: -67.0244, population: 42938 },
  { slug: 'loiza', name: 'Loíza', region: 'Norte', latitude: 18.4313, longitude: -65.8783, population: 21542 },
  { slug: 'canovanas', name: 'Canóvanas', region: 'Norte', latitude: 18.3792, longitude: -65.9010, population: 41302 },
  { slug: 'rio-grande', name: 'Río Grande', region: 'Norte', latitude: 18.3802, longitude: -65.8314, population: 44799 },
  { slug: 'luquillo', name: 'Luquillo', region: 'Norte', latitude: 18.3726, longitude: -65.7165, population: 17190 },
  // Este
  { slug: 'caguas', name: 'Caguas', region: 'Este', latitude: 18.2388, longitude: -66.0486, population: 124161 },
  { slug: 'humacao', name: 'Humacao', region: 'Este', latitude: 18.1497, longitude: -65.8198, population: 49249 },
  { slug: 'fajardo', name: 'Fajardo', region: 'Este', latitude: 18.3258, longitude: -65.6525, population: 30780 },
  { slug: 'juncos', name: 'Juncos', region: 'Este', latitude: 18.2276, longitude: -65.9211, population: 36639 },
  { slug: 'las-piedras', name: 'Las Piedras', region: 'Este', latitude: 18.1831, longitude: -65.8666, population: 34723 },
  { slug: 'gurabo', name: 'Gurabo', region: 'Este', latitude: 18.2542, longitude: -65.9730, population: 39780 },
  { slug: 'san-lorenzo', name: 'San Lorenzo', region: 'Este', latitude: 18.1895, longitude: -65.9607, population: 37275 },
  { slug: 'naguabo', name: 'Naguabo', region: 'Este', latitude: 18.2115, longitude: -65.7347, population: 22666 },
  { slug: 'yabucoa', name: 'Yabucoa', region: 'Este', latitude: 18.0507, longitude: -65.8792, population: 28058 },
  { slug: 'ceiba', name: 'Ceiba', region: 'Este', latitude: 18.2632, longitude: -65.6487, population: 10559 },
  { slug: 'culebra', name: 'Culebra', region: 'Este', latitude: 18.3103, longitude: -65.3028, population: 1735 },
  { slug: 'vieques', name: 'Vieques', region: 'Este', latitude: 18.1263, longitude: -65.4401, population: 7867 },
  { slug: 'aguas-buenas', name: 'Aguas Buenas', region: 'Este', latitude: 18.2570, longitude: -66.1021, population: 22838 },
  { slug: 'cidra', name: 'Cidra', region: 'Este', latitude: 18.1759, longitude: -66.1612, population: 39669 },
  { slug: 'cayey', name: 'Cayey', region: 'Este', latitude: 18.1119, longitude: -66.1660, population: 40027 },
  { slug: 'maunabo', name: 'Maunabo', region: 'Este', latitude: 18.0072, longitude: -65.8992, population: 10120 },
  { slug: 'patillas', name: 'Patillas', region: 'Este', latitude: 18.0038, longitude: -65.9966, population: 15077 },
  // Oeste
  { slug: 'mayaguez', name: 'Mayagüez', region: 'Oeste', latitude: 18.2013, longitude: -67.1397, population: 68905 },
  { slug: 'aguadilla', name: 'Aguadilla', region: 'Oeste', latitude: 18.4274, longitude: -67.1541, population: 53219 },
  { slug: 'cabo-rojo', name: 'Cabo Rojo', region: 'Oeste', latitude: 18.0866, longitude: -67.1457, population: 46580 },
  { slug: 'san-german', name: 'San Germán', region: 'Oeste', latitude: 18.0831, longitude: -67.0359, population: 30809 },
  { slug: 'anasco', name: 'Añasco', region: 'Oeste', latitude: 18.2828, longitude: -67.1395, population: 24449 },
  { slug: 'rincon', name: 'Rincón', region: 'Oeste', latitude: 18.3402, longitude: -67.2499, population: 15582 },
  { slug: 'aguada', name: 'Aguada', region: 'Oeste', latitude: 18.3793, longitude: -67.1876, population: 37319 },
  { slug: 'moca', name: 'Moca', region: 'Oeste', latitude: 18.3949, longitude: -67.1131, population: 37562 },
  { slug: 'san-sebastian', name: 'San Sebastián', region: 'Oeste', latitude: 18.3367, longitude: -66.9904, population: 39019 },
  { slug: 'las-marias', name: 'Las Marías', region: 'Oeste', latitude: 18.2518, longitude: -66.9910, population: 8638 },
  { slug: 'hormigueros', name: 'Hormigueros', region: 'Oeste', latitude: 18.1395, longitude: -67.1270, population: 15222 },
  { slug: 'lajas', name: 'Lajas', region: 'Oeste', latitude: 18.0498, longitude: -67.0591, population: 22784 },
  { slug: 'sabana-grande', name: 'Sabana Grande', region: 'Oeste', latitude: 18.0786, longitude: -66.9608, population: 22055 },
  { slug: 'maricao', name: 'Maricao', region: 'Oeste', latitude: 18.1808, longitude: -66.9800, population: 4336 },
  // Sur
  { slug: 'ponce', name: 'Ponce', region: 'Sur', latitude: 18.0111, longitude: -66.6141, population: 128384 },
  { slug: 'guayama', name: 'Guayama', region: 'Sur', latitude: 17.9843, longitude: -66.1117, population: 34043 },
  { slug: 'juana-diaz', name: 'Juana Díaz', region: 'Sur', latitude: 18.0535, longitude: -66.5065, population: 45853 },
  { slug: 'salinas', name: 'Salinas', region: 'Sur', latitude: 18.0021, longitude: -66.2576, population: 24218 },
  { slug: 'santa-isabel', name: 'Santa Isabel', region: 'Sur', latitude: 17.9661, longitude: -66.4049, population: 19547 },
  { slug: 'coamo', name: 'Coamo', region: 'Sur', latitude: 18.0799, longitude: -66.3580, population: 33076 },
  { slug: 'guanica', name: 'Guánica', region: 'Sur', latitude: 17.9715, longitude: -66.9074, population: 11840 },
  { slug: 'yauco', name: 'Yauco', region: 'Sur', latitude: 18.0352, longitude: -66.8499, population: 31608 },
  { slug: 'guayanilla', name: 'Guayanilla', region: 'Sur', latitude: 18.0193, longitude: -66.7917, population: 16489 },
  { slug: 'penuelas', name: 'Peñuelas', region: 'Sur', latitude: 18.0563, longitude: -66.7260, population: 19325 },
  { slug: 'arroyo', name: 'Arroyo', region: 'Sur', latitude: 17.9665, longitude: -66.0613, population: 14744 },
  { slug: 'villalba', name: 'Villalba', region: 'Sur', latitude: 18.1277, longitude: -66.4924, population: 21133 },
  // Central
  { slug: 'utuado', name: 'Utuado', region: 'Central', latitude: 18.2655, longitude: -66.7008, population: 26894 },
  { slug: 'lares', name: 'Lares', region: 'Central', latitude: 18.2957, longitude: -66.8780, population: 27744 },
  { slug: 'adjuntas', name: 'Adjuntas', region: 'Central', latitude: 18.1627, longitude: -66.7224, population: 17994 },
  { slug: 'jayuya', name: 'Jayuya', region: 'Central', latitude: 18.2183, longitude: -66.5916, population: 14423 },
  { slug: 'ciales', name: 'Ciales', region: 'Central', latitude: 18.3368, longitude: -66.4689, population: 16652 },
  { slug: 'morovis', name: 'Morovis', region: 'Central', latitude: 18.3253, longitude: -66.4075, population: 28170 },
  { slug: 'orocovis', name: 'Orocovis', region: 'Central', latitude: 18.2269, longitude: -66.3912, population: 21329 },
  { slug: 'barranquitas', name: 'Barranquitas', region: 'Central', latitude: 18.1863, longitude: -66.3063, population: 29509 },
  { slug: 'aibonito', name: 'Aibonito', region: 'Central', latitude: 18.1400, longitude: -66.2661, population: 24746 },
  { slug: 'comerio', name: 'Comerío', region: 'Central', latitude: 18.2189, longitude: -66.2256, population: 18445 },
  { slug: 'naranjito', name: 'Naranjito', region: 'Central', latitude: 18.3009, longitude: -66.2450, population: 29627 },
  { slug: 'corozal', name: 'Corozal', region: 'Central', latitude: 18.3417, longitude: -66.3168, population: 34531 },
  { slug: 'florida', name: 'Florida', region: 'Central', latitude: 18.3626, longitude: -66.5717, population: 11371 },
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
