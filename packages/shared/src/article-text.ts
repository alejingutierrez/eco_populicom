/**
 * article-text — extracción best-effort del CUERPO COMPLETO de un artículo de
 * noticia a partir de su URL. Sin dependencias (se bundlea en lambdas): usa
 * `fetch` global + AbortController, igual que `scrape-image.ts`.
 *
 * POR QUÉ EXISTE: Brandwatch entrega `snippet` truncado a ~255 caracteres
 * (promedio medido sobre 59k menciones news). El artículo real tiene 2,000–9,000.
 * Todo el NLP (sentimiento, pertinencia, emociones, resumen) corre hoy sobre
 * ese 3–10% del texto.
 *
 * ESTRATEGIA: se prueban tres extractores sobre el mismo HTML y gana el que
 * produce más texto (los sitios varían mucho de CMS a CMS):
 *   1. `jsonld`     — `articleBody` de un bloque <script type="application/ld+json">.
 *                     Es el más limpio: el CMS ya separó cuerpo de cromo.
 *   2. `container`  — <p> dentro del contenedor del artículo (<article>,
 *                     [itemprop=articleBody], .entry-content, …).
 *   3. `paragraphs` — todos los <p> del documento tras quitar cromo. Red de
 *                     seguridad para plantillas viejas sin semántica.
 *
 * LIMITACIONES CONOCIDAS (todas devuelven ok:false con un `reason` tipado, nunca lanzan):
 * - Contenido inyectado por JS (SPA shells): el HTML no trae el cuerpo → 'no-content'.
 * - Paywalls duros que sirven solo los primeros párrafos → texto corto pero válido.
 * - Sitios con anti-bot que responden 403 al User-Agent genérico → 'http-error'.
 * - Redes sociales / videos: no aplica, este módulo es para news/blog/forum.
 */

const UA = 'Mozilla/5.0 (compatible; ECO-Radar/1.0; +https://populicom.com)';

/**
 * Tope de descarga: 1.2 MB.
 *
 * El HTML más pesado que vimos en la sonda es El Nuevo Día con 774 KB, así que
 * 1.2 MB cubre el caso real con margen. Estaba en 2 MB y el Lambda del backfill
 * murió con `Runtime.OutOfMemory` a 1024 MB: `stripChrome` hace ~15 reemplazos
 * regex sobre el documento y cada uno crea una copia, así que el pico por
 * documento es varias veces su tamaño — multiplicado por la concurrencia. El
 * tope de bytes es la palanca que acota ese pico.
 */
const MAX_BYTES = 1_200_000;

/** Bajo este umbral asumimos que no extrajimos el cuerpo, solo cromo suelto. */
const MIN_BODY_CHARS = 250;

export type ExtractMethod = 'jsonld' | 'container' | 'paragraphs' | 'none';

export type FetchFailReason =
  | 'bad-url'        // no es http(s)
  | 'bot-challenge'  // el sitio exige resolver un CAPTCHA — fuera de alcance por diseño
  | 'http-error'     // status >= 400 (404, 410, 5xx…)
  | 'not-html'     // content-type no HTML (PDF, imagen, JSON…)
  | 'network'      // DNS, TLS, connection reset
  | 'timeout'      // abortado por AbortController
  | 'no-content'       // HTML descargado pero sin cuerpo reconocible (SPA shell)
  | 'content-mismatch' // el cuerpo extraído NO es el artículo que esperábamos
  | 'too-short';       // extrajimos algo pero por debajo de MIN_BODY_CHARS

/**
 * Rutas a las que redirigen los muros anti-bot cuando quieren que un humano
 * resuelva un reto. Detectarlas y ABANDONAR es deliberado: intentar pasarlas
 * sería evadir un control de acceso que el sitio puso a propósito.
 *
 * `_services/v1/client_captcha` es TownNews/BLOX — la plataforma de
 * notiuno.com y elvocero.com, que juntos son ~8% de las menciones news de la
 * base. Se quedan sin texto completo y así queda registrado.
 */
const CHALLENGE_PATTERNS = [
  /\/_services\/v\d+\/client_captcha\//i,   // TownNews / BLOX
  /\/cdn-cgi\/(l\/chk_jschl|challenge-platform)/i, // Cloudflare
  /[?&]__cf_chl/i,
  /\/(captcha|challenge|are-you-human|bot-detect)(\/|\?|$)/i,
  /\/px\/captcha/i,                          // PerimeterX
  /\/_Incapsula_Resource/i,                   // Imperva
];

/** True si la URL final (tras redirects) es un muro de reto anti-bot. */
export function isBotChallengeUrl(finalUrl: string): boolean {
  return CHALLENGE_PATTERNS.some((re) => re.test(finalUrl));
}

/**
 * Códigos que valen un reintento más tarde (el contenido probablemente existe).
 *
 * Los 3xx entran aquí aunque el fetch va con `redirect: 'follow'`: un redirect
 * que llega al caller es uno que NO se pudo resolver — sin `Location` o en
 * bucle. El WAF de Sucuri (cabecera `x-sucuri-id`) responde 307 pelado cuando
 * throttlea, y las mismas URLs devuelven 200 minutos después. Sin esto,
 * cubaenmiami.com, departamento19.hn y diasporadominicana.com quedaban
 * marcadas como fallo permanente por un límite de tasa pasajero.
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 429 || status === 408) return true;
  if (status >= 300 && status < 400) return true;
  return status >= 500 && status < 600;
}

export interface ArticleTextResult {
  ok: boolean;
  reason: FetchFailReason | null;
  /** Status HTTP; 0 cuando ni siquiera hubo respuesta. */
  status: number;
  text: string | null;
  method: ExtractMethod;
  chars: number;
  words: number;
  /** Metadatos oportunistas del <head> — útiles para QA del fetch. */
  title: string | null;
  publishedAt: string | null;
  /** Bytes de HTML leídos (para detectar truncados por MAX_BYTES). */
  bytes: number;
  /** Milisegundos de la operación completa. */
  ms: number;
  /** True si vale la pena reintentar más tarde (429/5xx/timeout de red). */
  retryable: boolean;
}

/**
 * Decodifica entidades HTML. Se duplica a propósito respecto de
 * `scrape-image.decodeHtmlEntities`: aquí hace falta cubrir el rango numérico
 * completo (`&#8220;`, `&#xE9;`) porque el cuerpo de un artículo en español
 * viene lleno de acentos y comillas tipográficas escapadas, mientras que allí
 * solo se decodifican URLs.
 */
/**
 * Decodifica entidades HTML. DOS PASADAS a propósito.
 *
 * La auditoría de calidad (sep-2026) encontró 148 filas con entidades crudas
 * en el texto guardado -`&oacute;`, `&quot;`, `&iquest;`- pese a estar todas
 * en la tabla. La causa es la DOBLE CODIFICACIÓN: el CMS sirve `&amp;oacute;`,
 * la primera pasada convierte `&amp;` en `&` (y tiene que ir al final, para no
 * reactivar entidades numéricas), y el `&oacute;` resultante ya no vuelve a
 * mirarse. La segunda pasada lo recoge. Sobre HTML normal es un no-op.
 *
 * Una entidad desconocida se deja TAL CUAL en vez de convertirse en espacio:
 * borrarla perdía información y la tabla nunca va a estar completa.
 */
export function decodeEntities(input: string): string {
  const once = decodeOnce(input);
  return /&(?:[a-zA-Z]{2,8}|#\d+|#x[0-9a-fA-F]+);/.test(once) ? decodeOnce(once) : once;
}

function decodeOnce(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&([a-zA-Z]{2,8});/g, (m, n: string) => NAMED_ENTITIES[n] ?? m)
    // &amp; va AL FINAL: si se decodifica primero, un `&amp;#39;` se convierte
    // en `&#39;` y la pasada numérica (ya ejecutada) no lo vuelve a ver.
    .replace(/&amp;/gi, '&');
}

/**
 * Entidades nombradas que aparecen de verdad en prensa en español. `&middot;`
 * y `&copy;` salieron sin decodificar en la sonda de 10 URLs (bylines de
 * WordPress y pies de página), y una entidad cruda dentro del texto envenena
 * el prompt del NLP.
 */
const NAMED_ENTITIES: Record<string, string> = {
  laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–', middot: '·',
  bull: '•', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£',
  yen: '¥', sect: '§', para: '¶', dagger: '†', permil: '‰', prime: '′',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  sbquo: '\u201A', bdquo: '\u201E', times: '×', divide: '÷', plusmn: '±',
  frac12: '½', frac14: '¼', frac34: '¾',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  uuml: 'ü', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Ntilde: 'Ñ', Uuml: 'Ü', ccedil: 'ç', agrave: 'à', egrave: 'è',
  shy: '', ensp: ' ', emsp: ' ', thinsp: ' ', zwj: '', zwnj: '', lrm: '', rlm: '',
  // Añadidas tras la auditoría de calidad (sep-2026): `&iquest;` es
  // imprescindible en español y salía cruda en 159 filas.
  iquest: '¿', iexcl: '¡', auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö',
  atilde: 'ã', Atilde: 'Ã', otilde: 'õ', Otilde: 'Õ', ccedil_: 'ç',
  Ccedil: 'Ç', acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  igrave: 'ì', ograve: 'ò', ugrave: 'ù', aring: 'å', oslash: 'ø',
  szlig: 'ß', micro: 'µ', middot_: '·', nbsp: ' ', amp: '&', lt: '<', gt: '>',
  quot: '"', apos: "'",
};

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 32 || cp > 0x10ffff) return ' ';
  try { return String.fromCodePoint(cp); } catch { return ' '; }
}

/** Quita todas las etiquetas y normaliza espacios. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Elimina el cromo que nunca es cuerpo del artículo. Se hace ANTES de buscar
 * <p> porque menús y pies de página están llenos de <p> con texto largo
 * (avisos legales, listados de secciones) que contaminan la extracción.
 */
function stripChrome(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const kill = ['script', 'style', 'noscript', 'template', 'svg', 'iframe',
    'nav', 'header', 'footer', 'aside', 'form', 'figure', 'figcaption', 'button', 'select'];
  for (const tag of kill) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
    // Etiquetas sin cerrar correctamente (HTML roto es la norma): al menos borra la apertura.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  return out;
}

/**
 * Frases que los CMS meten como <p> dentro o alrededor del cuerpo y que no son
 * periodismo: muros de suscripción, avisos de cookies, promos de newsletter,
 * enlaces "lee también". Conservador a propósito — un filtro agresivo se come
 * párrafos legítimos que empiezan con "Lee" o "Sigue".
 */
const BOILERPLATE = [
  /^(suscr[íi]bete|reg[íi]strate|inicia sesi[óo]n|crea tu cuenta)\b/i,
  /^(lee tambi[ée]n|te recomendamos|leer m[áa]s|sigue leyendo|contenido relacionado|art[íi]culos relacionados)\s*:?\s*$/i,
  /^(comparte|compartir|s[íi]guenos|siguenos en)\b/i,
  /\bacept(ar|as|o) (las )?cookies\b/i,
  /\bpol[íi]tica de (privacidad|cookies)\b/i,
  /^(copyright|todos los derechos reservados|©)/i,
  /\bpowered by\b/i,
  /^(publicidad|advertisement|anuncio)\s*$/i,
  /^(foto|fotos|imagen|video|v[íi]deo)\s*:/i,
  /\b(suscr[íi]bete a nuestro|recibe (el|las|los) (bolet[íi]n|noticias)|newsletter)\b/i,
  // Pie de El Nuevo Día: apareció en 754 filas de la auditoría de calidad,
  // siempre por la vía `paragraphs`. Es el mismo texto que ya había hecho que
  // `paragraphs` le ganara a `jsonld` por 195 caracteres de basura.
  /\bdescargar cualquiera de estos navegadores\b/i,
  /\bpara (ver|leer) nuestras noticias\b/i,
  /\blas noticias explicadas de forma sencilla\b/i,
];

/**
 * Entradas de un listado de artículos, no prosa. `periodicoeloriental.com`
 * devolvía el MISMO texto de 1,530 caracteres para artículos distintos: era su
 * widget de "entradas recientes", con la forma
 * `TITULAR Posted by Redacción | Sep 2, 2026 | Al Frente | 0 |` repetida.
 */
const LISTADO = [
  /\bposted by\b.{0,40}\|.{0,30}\|/i,
  /\|\s*\d+\s*\|/,
  /(\b(lee|leer) m[áa]s\b.*){3,}/i,
];

function isBoilerplate(p: string): boolean {
  return BOILERPLATE.some((re) => re.test(p));
}

/**
 * Descarta párrafos que no son prosa. La sonda de 10 URLs encontró en la cola
 * de nuevapensamientocritico.org bloques enteros de URLs de `sharer.php` con
 * hashes de 200 caracteres: son <p> legítimos en el HTML pero ruido puro para
 * el NLP.
 *
 * Reglas (todas conservadoras — un falso positivo se come un párrafo real):
 * - un "token" sin espacios de más de 60 chars solo puede ser una URL o un hash;
 * - el párrafo es mayoritariamente URLs;
 * - no hay ni un signo de puntuación de cierre de oración en >200 chars
 *   (listados de enlaces, breadcrumbs, tag clouds).
 */
function isJunkProse(p: string): boolean {
  if (LISTADO.some((re) => re.test(p))) return true;
  if (/\S{61,}/.test(p)) return true;
  const urlChars = (p.match(/https?:\/\/\S+/g) ?? []).join('').length;
  if (urlChars > p.length * 0.3) return true;
  if (p.length > 200 && !/[.!?…»"]/.test(p)) return true;
  return false;
}

/**
 * Une párrafos ya limpios: descarta cromo, los muy cortos (pies de foto,
 * créditos, "Compartir") y duplicados exactos (los CMS repiten el lead como
 * sumario y como primer párrafo).
 */
function joinParagraphs(paragraphs: string[], minLen = 60): string {
  const seen = new Set<string>();
  const keep: string[] = [];
  for (const raw of paragraphs) {
    const p = raw.trim();
    if (p.length < minLen) continue;
    if (isBoilerplate(p) || isJunkProse(p)) continue;
    const key = p.slice(0, 120).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(p);
  }
  return keep.join('\n\n');
}

function paragraphsIn(html: string): string[] {
  const out: string[] = [];
  // <p> y también <div class="paragraph"> que usan algunos CMS (Arc XP).
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) out.push(stripTags(m[1]));
  if (out.length === 0) {
    for (const m of html.matchAll(/<div\b[^>]*class=["'][^"']*(?:paragraph|text-block)[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/gi)) {
      out.push(stripTags(m[1]));
    }
  }
  return out;
}

/**
 * Extractor 1 — `articleBody` de JSON-LD. Recorre todos los bloques ld+json y
 * baja por `@graph` / arrays, porque los CMS anidan el NewsArticle a distintas
 * profundidades. Devuelve el `articleBody` más largo encontrado.
 */
export function extractJsonLd(html: string): string {
  let best = '';
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      // JSON-LD roto es común (comas colgantes, HTML sin escapar). Último
      // recurso: saca el articleBody con regex del texto crudo del bloque.
      const raw = m[1].match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (raw) {
        try {
          const s = JSON.parse(`"${raw[1]}"`) as string;
          if (s.length > best.length) best = s;
        } catch { /* ignore */ }
      }
      continue;
    }
    const stack: unknown[] = [parsed];
    let guard = 0;
    while (stack.length && guard++ < 5000) {
      const node = stack.pop();
      if (Array.isArray(node)) { stack.push(...node); continue; }
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      const body = obj.articleBody;
      if (typeof body === 'string' && body.length > best.length) best = body;
      for (const v of Object.values(obj)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  if (!best) return '';
  // El articleBody puede venir con HTML embebido (<p>, <a>) o ya en texto plano.
  const text = best.includes('<') ? stripTags(best) : decodeEntities(best).replace(/[ \t]+/g, ' ').trim();
  // Si trae saltos de línea propios, respétalos como separación de párrafos.
  return text.includes('\n') ? joinParagraphs(text.split(/\n+/), 40) : text;
}

/** Clases/atributos que marcan el contenedor del cuerpo en los CMS que vemos en PR. */
const BODY_CONTAINERS = [
  /<([a-z]+)\b[^>]*itemprop=["']articleBody["'][^>]*>/i,
  /<([a-z]+)\b[^>]*class=["'][^"']*\b(?:article-body|article__body|articleBody|entry-content|entry-body|post-content|post-body|story-body|story__body|story-content|content-body|nota-cuerpo|texto-nota|cuerpo-nota|rich-text|body-text|articulo-cuerpo)[^"']*["'][^>]*>/i,
  /<(article)\b[^>]*>/i,
  /<([a-z]+)\b[^>]*\bid=["'](?:article-body|articleBody|story-body|content|contenido)["'][^>]*>/i,
];

/**
 * Devuelve el HTML interno de la etiqueta que abre en `openIdx`, balanceando
 * anidamiento del MISMO nombre de etiqueta.
 *
 * POR QUÉ NO UN REGEX: la primera versión usaba `([\s\S]*?)<\/[a-z]+>` y en
 * El Nuevo Día devolvía 0 caracteres — el cierre no-greedy matcheaba el primer
 * `</div>` anidado, dos niveles dentro del contenedor. HTML anidado no es un
 * lenguaje regular; hace falta contar.
 */
function innerHtmlBalanced(html: string, openIdx: number, tag: string): string {
  const gt = html.indexOf('>', openIdx);
  if (gt === -1) return '';
  // Etiqueta auto-cerrada: no hay contenido.
  if (html[gt - 1] === '/') return '';
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = gt + 1;
  // Avanza al siguiente evento (apertura o cierre) hasta cerrar la profundidad.
  for (let guard = 0; guard < 20_000; guard++) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return html.slice(gt + 1);          // HTML roto: devuelve el resto
    if (o && o.index < c.index) {
      if (html[o.index + o[0].length - 2] !== '/') depth += 1;
      cursor = o.index + o[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(gt + 1, c.index);
    cursor = c.index + c[0].length;
  }
  return html.slice(gt + 1);
}

/** Extractor 2 — <p> dentro del contenedor del artículo, con cierre balanceado. */
export function extractContainer(html: string): string {
  let best = '';
  for (const re of BODY_CONTAINERS) {
    const m = re.exec(html);
    if (!m) continue;
    const inner = innerHtmlBalanced(html, m.index, m[1]);
    if (!inner) continue;
    const text = joinParagraphs(paragraphsIn(inner));
    // Se queda con el contenedor MÁS RICO entre los selectores, no con el
    // primero: algunos CMS ponen `.entry-content` como wrapper del sumario y
    // el cuerpo real cuelga de `<article>`.
    if (text.length > best.length) best = text;
  }
  return best;
}

/** Extractor 3 — todos los <p> del documento. Red de seguridad. */
export function extractParagraphs(html: string): string {
  return joinParagraphs(paragraphsIn(html));
}

/** Lee un <meta> por property o name, en cualquier orden de atributos. */
function readMeta(html: string, keys: string[]): string | null {
  for (const k of keys) {
    const a = html.match(new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i'));
    if (a?.[1]) return decodeEntities(a[1]).trim() || null;
    const b = html.match(new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'));
    if (b?.[1]) return decodeEntities(b[1]).trim() || null;
  }
  return null;
}

/**
 * Factor por el que un extractor MENOS preciso tiene que superar al preferido
 * para ganarle. Un `articleBody` recortado por paywall (3 párrafos) frente al
 * artículo completo se diferencia por 5×–10×, nunca por 1.1×.
 */
const OVERRIDE_FACTOR = 2;

/**
 * Corre los tres extractores sobre un HTML ya descargado y devuelve el mejor.
 * Función PURA — punto de entrada para los tests unitarios (no toca red).
 *
 * ORDEN DE PREFERENCIA, no "el más largo gana". La primera versión se quedaba
 * con el texto más largo y en El Nuevo Día eso eligió `paragraphs` (2,850
 * chars) sobre `jsonld` (2,655) porque los 195 de diferencia eran
 * "Te invitamos a descargar cualquiera de estos navegadores". Precisión sobre
 * volumen: `jsonld` > `container` > `paragraphs`, y un extractor menos preciso
 * solo gana si supera al preferido por OVERRIDE_FACTOR — señal de que el
 * preferido se quedó con un fragmento (paywall, sumario) y no con el cuerpo.
 */
export function extractArticleText(html: string): { text: string; method: ExtractMethod } {
  const clean = stripChrome(html);
  // `jsonld` corre sobre el HTML CRUDO: el ld+json vive en un <script>, que
  // stripChrome borra por diseño.
  const candidates: Array<{ text: string; method: ExtractMethod }> = [
    { text: extractJsonLd(html), method: 'jsonld' },
    { text: extractContainer(clean), method: 'container' },
    { text: extractParagraphs(clean), method: 'paragraphs' },
  ];

  const longest = candidates.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  for (const c of candidates) {
    if (c.text.length < MIN_BODY_CHARS) continue;
    if (longest.text.length > c.text.length * OVERRIDE_FACTOR) continue;
    return c;
  }
  // Ninguno llegó al mínimo: devuelve el más largo para que el caller decida
  // (marcará 'too-short' y quedará registrado por qué).
  return longest.text ? longest : { text: '', method: 'none' };
}

/**
 * Serializa las peticiones por HOST y les mete una pausa mínima entre sí.
 *
 * POR QUÉ: la sonda de 10 URLs con concurrencia global 5 falló 3 veces con
 * HTTP 429 — no porque los sitios nos bloqueen, sino porque cuatro de esas
 * diez URLs eran del mismo dominio y salieron a la vez. La concurrencia útil
 * es ENTRE dominios; dentro de un dominio hay que ir en fila.
 *
 * Devuelve una función `run(url, fn)` que resuelve en orden por host. El
 * estado vive en el closure, así que un Lambda tibio conserva el espaciado
 * entre invocaciones del mismo contenedor.
 */
export function createDomainLimiter(minGapMs = 1200) {
  const lastRun = new Map<string, number>();
  const chains = new Map<string, Promise<unknown>>();

  return function run<T>(url: string, fn: () => Promise<T>): Promise<T> {
    let host: string;
    try { host = new URL(url).hostname; } catch { host = url; }

    const prev = chains.get(host) ?? Promise.resolve();
    const next = prev.then(async () => {
      const since = Date.now() - (lastRun.get(host) ?? 0);
      const wait = minGapMs - since;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRun.set(host, Date.now());
      return fn();
    });
    // La cadena nunca rechaza: un fallo no debe romper la fila del host.
    chains.set(host, next.catch(() => undefined));
    return next;
  };
}

/** Palabras de contenido, sin acentos ni puntuación, para comparar textos. */
function contentTokens(s: string): string[] {
  const plano = (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return plano.replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 3);
}

/**
 * Umbral de solape por debajo del cual se considera que el cuerpo extraído NO
 * es el artículo esperado. Medido sobre 350 filas reales: el 9% caía por
 * debajo de 0.4 y TODAS eran artículos distintos; entre 0.4 y 0.7 ya eran
 * correctas (snippets con mucho cromo de la red social que los citó).
 */
const MATCH_THRESHOLD = 0.35;

/**
 * Por debajo de este tamaño de CUERPO no se juzga la correspondencia.
 *
 * El Nuevo Día sirve stubs de paywall de 250-570 caracteres: solo el lead. Un
 * stub correcto y un artículo equivocado son indistinguibles para el solape de
 * tokens -en ambos casos falta casi todo el titular-, así que juzgarlos era
 * inventar un veredicto. Marcarlos `judged:false` y aceptarlos es lo honesto:
 * la señal no existe. Los que además no llegan a MIN_BODY_CHARS ya salen como
 * `too-short` por otra vía.
 */
const MIN_BODY_TO_JUDGE = 800;

/**
 * Con menos tokens que esto no se juzga: el veredicto sería ruido. Cinco es el
 * piso para que un titular corto siga siendo juzgable (los reales rondan 8-12
 * palabras de contenido); por debajo, `judged:false` y se acepta.
 */
const MIN_TOKENS_TO_JUDGE = 5;

/**
 * ¿El cuerpo extraído es el artículo del que salió este snippet?
 *
 * POR QUÉ HACE FALTA: la auditoría de calidad (sep-2026) encontró que el 9% de
 * los cuerpos guardados eran OTRO artículo. No es un fallo de extracción: son
 * sitios que sirven contenido distinto en esa URL sin devolver 404 -link rot
 * silencioso-. `laconexionusa.com` daba un snippet sobre Honduras y un cuerpo
 * sobre Lemmy Kilmister. Extraído impecablemente, y completamente inútil: eso
 * entra al prompt del NLP como si fuera la mención.
 *
 * Se mide qué fracción de las palabras del snippet aparece en el cuerpo. El
 * snippet de Brandwatch es una ventana del MEDIO del artículo (empieza con
 * "..."), así que comparar por substring no sirve — hay que comparar por
 * tokens. El titular es el respaldo cuando no hay snippet.
 */
export function bodyMatchesMention(
  body: string,
  ref: { snippet?: string | null; title?: string | null },
): { matches: boolean; overlap: number; judged: boolean } {
  if ((body ?? '').length < MIN_BODY_TO_JUDGE) {
    return { matches: true, overlap: 1, judged: false };
  }
  const cuerpo = new Set(contentTokens(body));
  const medir = (fuente: string | null | undefined): number | null => {
    const tokens = contentTokens(limpiarReferencia(fuente ?? ''));
    if (tokens.length < MIN_TOKENS_TO_JUDGE) return null;
    return tokens.reduce((n, w) => n + (cuerpo.has(w) ? 1 : 0), 0) / tokens.length;
  };

  // El MEJOR de los dos, no el primero disponible.
  //
  // Juzgar solo por el snippet producía falsos positivos en masa: El Nuevo Día
  // arrastra en el suyo la insignia de estándares editoriales ("NoticiaBasado
  // en hechos que el periodista haya observado y verificado de primera
  // mano…"), que ocupa más de la mitad del texto y no aparece en el artículo.
  // Eso hundía el solape de artículos correctamente extraídos: 810 filas de
  // nuestro dominio con MEJOR extracción (97%) habrían sido borradas.
  // El titular no tiene ese problema, y un artículo equivocado falla en LOS
  // DOS -el caso de laconexionusa.com da 0% contra ambos-.
  const valores = [medir(ref.snippet), medir(ref.title)].filter((v): v is number => v !== null);
  if (!valores.length) return { matches: true, overlap: 1, judged: false };
  const overlap = Math.max(...valores);
  return { matches: overlap >= MATCH_THRESHOLD, overlap, judged: true };
}

/**
 * Quita del snippet el cromo que algunos medios le meten y que nunca está en
 * el cuerpo, para no castigar al artículo por algo que no es suyo.
 */
function limpiarReferencia(s: string): string {
  return s
    .replace(/Noticia\s*Basado en hechos[^.]*\./gi, ' ')
    .replace(/\bBasado en hechos que el periodista[^.]*\./gi, ' ')
    .replace(/\b(informaci[oó]n verificada que proviene de fuentes bien informadas)\b/gi, ' ')
    .replace(/^\s*\.{2,}\s*/, ' ')
    .replace(/\bDetalles aqu[ií]\s*:/gi, ' ');
}

function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Descarga una URL y extrae el cuerpo del artículo. Nunca lanza: todo error se
 * traduce en `ok:false` + `reason`. Pensada para correr en Lambda con
 * concurrencia (ver `backfill-full-text` en eco-migration).
 */
export async function fetchArticleText(
  url: string,
  opts: {
    timeoutMs?: number; maxBytes?: number; minChars?: number;
    /** Referencia para verificar que el cuerpo sea el artículo esperado. */
    expect?: { snippet?: string | null; title?: string | null };
  } = {},
): Promise<ArticleTextResult> {
  const { timeoutMs = 12_000 } = opts;
  const t0 = Date.now();

  // GARANTÍA DURA DE TERMINACIÓN. El AbortController aborta el `fetch`, pero
  // no cubre todo lo que puede quedarse esperando después: `reader.read()` en
  // una carrera perdida con el abort, o `reader.cancel()` sobre un stream a
  // medio leer. Bastaba UNA url así para colgar una tanda entera del barrido:
  // el limitador encadena por host, así que la promesa que nunca resuelve
  // bloquea a todas las filas siguientes de ese dominio. El síntoma era
  // inconfundible visto de cerca — `procesadas` salía SIEMPRE exactamente en
  // `seleccionadas - 1` (299/300, 1499/1500, 1999/2000).
  //
  // La carrera funciona porque lo que se cuelga es E/S asíncrona, no CPU: la
  // extracción tarda 2-14 ms sobre documentos de 1 MB (medido), así que nunca
  // bloquea el event loop y el temporizador siempre llega a dispararse.
  return Promise.race([
    fetchArticleTextInner(url, opts, t0),
    new Promise<ArticleTextResult>((resolve) => {
      setTimeout(() => resolve({
        ok: false, reason: 'timeout', status: 0, text: null, method: 'none',
        chars: 0, words: 0, title: null, publishedAt: null, bytes: 0,
        ms: Date.now() - t0, retryable: true,
      }), timeoutMs + 5_000);
    }),
  ]);
}

async function fetchArticleTextInner(
  url: string,
  opts: {
    timeoutMs?: number; maxBytes?: number; minChars?: number;
    expect?: { snippet?: string | null; title?: string | null };
  },
  t0: number,
): Promise<ArticleTextResult> {
  const { timeoutMs = 12_000, maxBytes = MAX_BYTES, minChars = MIN_BODY_CHARS } = opts;
  const fail = (reason: FetchFailReason, status = 0, bytes = 0): ArticleTextResult => ({
    ok: false, reason, status, text: null, method: 'none',
    chars: 0, words: 0, title: null, publishedAt: null, bytes, ms: Date.now() - t0,
    // 'bot-challenge' NO es reintentable: reintentar es exactamente lo que el
    // muro está pidiendo que no hagamos.
    retryable: reason === 'network' || reason === 'timeout' || isRetryableStatus(status),
  });

  if (!url || !/^https?:\/\//i.test(url)) return fail('bad-url');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status = 0;
  let bytes = 0;
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-PR,es;q=0.9,en;q=0.8',
      },
    });
    status = resp.status;

    // `resp.url` es la URL FINAL tras seguir redirects. Los muros anti-bot no
    // responden 403 en la URL pedida: mandan un 302 al reto, y es el reto el
    // que devuelve 429. Sin mirar aquí, el fallo se registraba como
    // "http-error 429" y parecía un problema de nuestra concurrencia.
    if (isBotChallengeUrl(resp.url) || isBotChallengeUrl(url)) {
      return fail('bot-challenge', status);
    }
    if (!resp.ok) return fail('http-error', status);
    const ct = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (ct && !ct.includes('html') && !ct.includes('xml')) return fail('not-html', status);

    // Lectura por chunks con tope duro: evita que una página con un video
    // embebido de 50MB agote la memoria del Lambda.
    const reader = resp.body?.getReader();
    if (!reader) return fail('no-content', status);
    const decoder = new TextDecoder('utf-8');
    let html = '';
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    const { text, method } = extractArticleText(html);
    const title = readMeta(html, ['og:title', 'twitter:title'])
      ?? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ? stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)![1]) : null);
    const publishedAt = readMeta(html, [
      'article:published_time', 'datePublished', 'og:published_time', 'pubdate', 'date',
    ]);

    if (!text) return { ...fail('no-content', status, bytes), title, publishedAt };
    if (text.length < minChars) {
      return { ...fail('too-short', status, bytes), title, publishedAt, text, method, chars: text.length, words: countWords(text) };
    }
    // El texto puede estar perfectamente extraído y ser de OTRO artículo.
    if (opts.expect) {
      const m = bodyMatchesMention(text, opts.expect);
      if (!m.matches) {
        return {
          ...fail('content-mismatch', status, bytes),
          title, publishedAt, method, chars: text.length, words: countWords(text),
          // El texto NO se devuelve: el caller no debe guardarlo por error.
        };
      }
    }
    return {
      ok: true, reason: null, status, text, method,
      chars: text.length, words: countWords(text),
      title, publishedAt, bytes, ms: Date.now() - t0, retryable: false,
    };
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return fail(aborted ? 'timeout' : 'network', status, bytes);
  } finally {
    clearTimeout(timer);
  }
}
