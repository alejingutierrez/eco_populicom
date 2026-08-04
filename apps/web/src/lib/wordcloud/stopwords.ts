/**
 * Stopwords de DOMINIO para la nube de palabras.
 *
 * La configuración `spanish` de Postgres ya quita los funcionales ("de", "que",
 * "para"…). Lo que no puede saber es qué palabras son ruido *en este corpus*.
 *
 * Medido en producción sobre gobernadora a 365 días, los seis términos más
 * frecuentes son **los términos del propio boolean de Brandwatch**:
 *
 *   gonzález 36,649 · jenniffer 34,819 · gobernadora 33,803 · colón · puerto · rico
 *
 * seguidos de basura de plataforma (https, com, www, photos, from, post). Una
 * nube construida con frecuencia cruda y sin esta lista es una nube de la propia
 * consulta: cero información.
 *
 * Dos niveles:
 *  - `STOP_SURFACES`: se escriben como el humano las diría; el caller las pasa
 *    por `ts_lexize('spanish_stem', …)` para obtener el tallo real, porque el
 *    stemmer español es inconsistente (anuncia→anunci pero anunció→anunc).
 *  - `STOP_STEMS`: tallos crudos, para lo que el stemmer parte de forma
 *    impredecible o para tokens que no son palabras.
 *
 * La lista es deliberadamente CORTA y quirúrgica. Una lista agresiva borra la
 * noticia: "agua" es stopword para AAA y es LA noticia para la Gobernadora en
 * una sequía.
 */

/** Ruido de plataforma y de scraping. Nunca aporta significado. */
export const STOP_PLATFORM = [
  'http', 'https', 'www', 'com', 'net', 'org', 'html', 'php',
  'amp', 'utm', 'rt', 'via', 'pic', 'photo', 'photos', 'video', 'videos',
  'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'linkedin', 'reddit',
  'tumblr', 'bluesky', 'threads', 'whatsapp', 'telegram',
  'post', 'posts', 'story', 'stories', 'reel', 'reels', 'tweet', 'tweets',
  'comment', 'comments', 'share', 'shares', 'like', 'likes', 'follow',
  'click', 'link', 'enlace', 'leer', 'lee', 'ver', 'mira', 'aqui', 'aquí',
  'from', 'the', 'and', 'for', 'with', 'this', 'that',
];

/** Nombres, siglas y variantes de las agencias monitoreadas y del país. */
export const STOP_ENTITIES = [
  // país / territorio
  'puerto', 'rico', 'boricua', 'isla', 'pr', 'pueblo',
  // gobierno genérico
  'gobierno', 'gobernación', 'gobernacion', 'gobernador', 'gobernadora',
  'administración', 'administracion', 'agencia', 'agencias',
  'departamento', 'secretario', 'secretaria', 'secretaría',
  'autoridad', 'oficina', 'junta', 'programa', 'gobiernos',
  'fortaleza', 'capitolio', 'senado', 'cámara', 'camara', 'legislatura',
  // DDEC
  'ddec', 'desarrollo', 'económico', 'economico', 'comercio',
  // AAA
  'aaa', 'acueductos', 'alcantarillados',
  // Gobernadora JGO
  'jenniffer', 'jennifer', 'gonzález', 'gonzalez', 'colón', 'colon', 'jgo',
  // SGPR
  'sgpr', 'domenech',
];

/**
 * Verbos y sustantivos vacíos de titular de prensa. Aparecen en todo y no
 * distinguen nada: "DDEC ANUNCIA…", "El secretario ASEGURA…".
 */
export const STOP_HEADLINE = [
  'anuncia', 'anunció', 'anuncio', 'anunciar',
  'asegura', 'aseguró', 'afirma', 'afirmó', 'informa', 'informó',
  'señala', 'senala', 'señaló', 'indica', 'indicó', 'explica', 'explicó',
  'dice', 'dijo', 'expresa', 'expresó', 'sostiene', 'sostuvo',
  'destaca', 'destacó', 'reitera', 'reiteró', 'confirma', 'confirmó',
  'declara', 'declaró', 'agrega', 'agregó', 'añade', 'anade', 'añadió',
  'presenta', 'presentó', 'realiza', 'realizó', 'busca', 'buscó',
  'noticia', 'noticias', 'nota', 'reporte', 'reportaje', 'comunicado',
  'declaración', 'declaracion', 'declaraciones',
  'conferencia', 'prensa', 'entrevista',
  'hoy', 'ayer', 'mañana', 'manana', 'semana', 'mes', 'año', 'ano', 'años',
  'nuevo', 'nueva', 'nuevos', 'nuevas', 'gran', 'grande',
  'primer', 'primera', 'último', 'ultimo', 'última', 'ultima',
];

/** Meses y días: son metadatos de la fecha, no del tema. */
export const STOP_DATES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre',
  'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes',
  'sábado', 'sabado', 'domingo',
];

/**
 * Tallos crudos: van directo a la comparación, sin pasar por ts_lexize. Para
 * los casos donde el stemmer produce algo que no se puede escribir como
 * superficie, o donde queremos cubrir toda una familia de una vez.
 */
export const STOP_STEMS = [
  'dic', 'sab', 'hac', 'ten', 'pod', 'deb', 'seg', 'com',
  'anunci', 'anunc', 'asegur', 'inform', 'señal', 'senal', 'declar',
];

/** Superficies = todo lo que el caller debe pasar por ts_lexize. */
export const STOP_SURFACES: string[] = Array.from(new Set([
  ...STOP_PLATFORM,
  ...STOP_ENTITIES,
  ...STOP_HEADLINE,
  ...STOP_DATES,
]));

/**
 * Stopwords específicas por agencia: el nombre propio de la agencia es ruido
 * *dentro de su propio panel* pero puede ser la noticia en otro. Se añaden a
 * `STOP_SURFACES` en tiempo de consulta según el slug.
 */
export const STOP_BY_AGENCY: Record<string, string[]> = {
  ddecpr: ['ddec', 'desarrollo', 'económico', 'comercio', 'secretario'],
  aaa: ['aaa', 'acueductos', 'alcantarillados', 'agua'],
  gobernadora: ['jenniffer', 'gonzález', 'colón', 'gobernadora', 'gobernador'],
  sgpr: ['sgpr', 'gobernación', 'secretario', 'domenech'],
};

export function stopSurfacesFor(agencySlug: string | null | undefined): string[] {
  const extra = (agencySlug && STOP_BY_AGENCY[agencySlug]) || [];
  return Array.from(new Set([...STOP_SURFACES, ...extra]));
}
