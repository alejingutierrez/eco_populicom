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
  | 'no-content'     // HTML descargado pero sin cuerpo reconocible (SPA shell)
  | 'too-short';     // extrajimos algo pero por debajo de MIN_BODY_CHARS

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
export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&(laquo|raquo|hellip|mdash|ndash|middot|bull|copy|reg|trade|deg|euro|pound|yen|sect|para|dagger|permil|prime|lsquo|rsquo|ldquo|rdquo|sbquo|bdquo|times|divide|plusmn|frac12|frac14|frac34|aacute|eacute|iacute|oacute|uacute|ntilde|uuml|Aacute|Eacute|Iacute|Oacute|Uacute|Ntilde|Uuml|ccedil|agrave|egrave|shy|ensp|emsp|thinsp|zwj|zwnj|lrm|rlm);/g,
      (_, n: string) => NAMED_ENTITIES[n] ?? ' ')
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
  opts: { timeoutMs?: number; maxBytes?: number; minChars?: number } = {},
): Promise<ArticleTextResult> {
  const { timeoutMs = 12_000, maxBytes = MAX_BYTES, minChars = MIN_BODY_CHARS } = opts;
  const t0 = Date.now();
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
