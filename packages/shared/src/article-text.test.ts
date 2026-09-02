/**
 * Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/article-text.test.ts
 *
 * Estos tests fijan los defectos que la sonda contra URLs reales encontró
 * mientras se construía el extractor, para que no vuelvan:
 *
 *  A1 · "el más largo gana" elegía `paragraphs` sobre `jsonld` en El Nuevo Día
 *       porque los 195 caracteres de ventaja eran "Te invitamos a descargar
 *       cualquiera de estos navegadores". Ahora manda la PRECISIÓN, y un
 *       extractor menos preciso solo gana si dobla al preferido.
 *  A2 · `extractContainer` devolvía 0 en El Nuevo Día: el cierre no-greedy
 *       `[\s\S]*?</[a-z]+>` matcheaba el primer `</div>` ANIDADO. HTML anidado
 *       no es regular — hay que contar profundidad.
 *  A3 · `&middot;` y `&copy;` salían crudas en los bylines de WordPress, y una
 *       entidad sin decodificar dentro del texto envenena el prompt del NLP.
 *  A4 · la cola de nuevapensamientocritico.org traía <p> enteros de URLs de
 *       `sharer.php` con hashes de 200 caracteres: 7,400 caracteres de ruido.
 *  A5 · notiuno.com y elvocero.com responden 302 hacia un CAPTCHA y es el
 *       CAPTCHA el que devuelve 429. Sin mirar la URL final, el fallo se
 *       registraba como "http-error 429" y parecía culpa de nuestra
 *       concurrencia. Un muro de reto NO es reintentable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractArticleText, extractContainer, extractJsonLd, extractParagraphs,
  decodeEntities, isBotChallengeUrl, isRetryableStatus, createDomainLimiter,
} from './article-text';

/**
 * Párrafo de prueba con ARRANQUE DISTINTO por bloque. `joinParagraphs`
 * deduplica por los primeros 120 caracteres — los CMS repiten el lead como
 * sumario y como primer párrafo — así que fixtures con el mismo comienzo se
 * colapsan en uno y el test mide otra cosa.
 */
const parrafo = (n: number, extra = '') =>
  `<p>Bloque ${n}: el embalse número ${n} del sistema registró un cambio de nivel durante las últimas veinticuatro horas `
  + `según los datos de la corporación pública correspondientes al bloque ${n}. ${extra}</p>`;

// ── A1 · precisión sobre volumen
test('A1: jsonld gana a paragraphs aunque paragraphs sea algo más largo', () => {
  const cuerpo = 'El embalse Carraízo registró un aumento de 172 centímetros en apenas 24 horas. '.repeat(6);
  const html = `
    <html><head>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: cuerpo })}</script>
    </head><body>
      <p>${cuerpo}</p>
      <p>Te invitamos a descargar cualquiera de estos navegadores para ver nuestras noticias con toda la calidad.</p>
    </body></html>`;
  const { method } = extractArticleText(html);
  assert.equal(method, 'jsonld');
});

test('A1: paragraphs SÍ gana cuando jsonld viene recortado por paywall', () => {
  const html = `
    <html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'NewsArticle',
        articleBody: 'Primer párrafo del artículo, y aquí se corta el muro de pago dejando solo el arranque visible.',
      })}</script>
    </head><body>
      ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => parrafo(n)).join('')}
    </body></html>`;
  const { method, text } = extractArticleText(html);
  assert.equal(method, 'paragraphs');
  assert.ok(text.length > 1000, `esperaba el cuerpo completo, salieron ${text.length} chars`);
});

// ── A2 · contenedor con anidamiento
test('A2: extractContainer atraviesa divs anidados en vez de cortar en el primer cierre', () => {
  const html = `
    <body>
      <div class="article-body">
        <div class="ad-slot"><span>publicidad</span></div>
        <div class="paragraph-wrapper">
          ${[1, 2, 3].map((n) => parrafo(n)).join('')}
        </div>
      </div>
      <div class="related">${parrafo(99, 'ESTO ES DE LA BARRA LATERAL Y NO DEBE ENTRAR.')}</div>
    </body>`;
  const text = extractContainer(html);
  assert.ok(text.length > 300, `el contenedor devolvió ${text.length} chars (el bug daba 0)`);
  assert.ok(text.includes('Bloque 3:'), 'debe llegar hasta el último párrafo del cuerpo');
  assert.ok(!text.includes('BARRA LATERAL'), 'no debe pasarse del cierre del contenedor');
});

// ── A3 · entidades
test('A3: decodifica las entidades nombradas de los bylines en español', () => {
  assert.equal(decodeEntities('Publicada 2 de septiembre &middot; Actualizado'), 'Publicada 2 de septiembre · Actualizado');
  assert.equal(decodeEntities('Nueva Pensamiento Cr&iacute;tico &copy; 2026'), 'Nueva Pensamiento Crítico © 2026');
  assert.equal(decodeEntities('&ldquo;no hay agua&rdquo;'), '“no hay agua”');
});

test('A3: &amp; se decodifica al final para no reactivar entidades numéricas', () => {
  // Si &amp; se decodificara primero, `&amp;#39;` se volvería `&#39;` y la
  // pasada numérica (ya ejecutada) no lo vería.
  assert.equal(decodeEntities('Ley &amp;#39;seca&amp;#39;'), "Ley &#39;seca&#39;");
});

// ── A4 · basura que no es prosa
test('A4: descarta párrafos que son URLs de compartir con hashes largos', () => {
  const basura = 'https://www.facebook.com/sharer/sharer.php?u=x&h=AT3FHuil0sanzetE844y5lVikd5hRdGmL9rYylXO6oyFFaNNtkgbU3cldt8Ds95JbxuSAURXstc';
  const html = `<body>${parrafo(1)}<p>${basura}</p><p>${basura} ${basura}</p></body>`;
  const text = extractParagraphs(html);
  assert.ok(text.includes('Bloque 1:'), 'el párrafo real sobrevive');
  assert.ok(!text.includes('sharer.php'), 'las URLs de compartir se van');
});

test('A4: descarta el aviso de cookies y el pie de copyright', () => {
  const html = `<body>
    ${parrafo(1)}
    <p>Al continuar navegando aceptas cookies conforme a nuestra política de privacidad y de cookies vigente.</p>
    <p>Copyright 2026. Todos los derechos reservados por esta publicación y sus filiales comerciales.</p>
  </body>`;
  const text = extractParagraphs(html);
  assert.ok(text.includes('Bloque 1:'));
  assert.ok(!/aceptas cookies/.test(text));
  assert.ok(!/Todos los derechos/.test(text));
});

test('A4: no se come párrafos legítimos que empiezan por "Lee" o "Sigue"', () => {
  const html = `<body><p>Lee Camacho, presidente de la AAA, explicó que el racionamiento continuará hasta que los embalses recuperen su nivel operativo.</p></body>`;
  assert.ok(extractParagraphs(html).includes('Lee Camacho'));
});

// ── A5 · muros anti-bot
test('A5: reconoce el reto de TownNews/BLOX y los de Cloudflare', () => {
  assert.ok(isBotChallengeUrl('https://www.notiuno.com/_services/v1/client_captcha/challenge?request=eyJ0'));
  assert.ok(isBotChallengeUrl('https://x.com/cdn-cgi/l/chk_jschl?x=1'));
  assert.ok(isBotChallengeUrl('https://x.com/captcha/'));
  assert.ok(!isBotChallengeUrl('https://www.elnuevodia.com/noticias/locales/notas/monitoreo-diario/'));
  // Un artículo cuyo slug contenga "challenge" en inglés no es un muro.
  assert.ok(!isBotChallengeUrl('https://sanjuandailystar.com/2026/09/the-water-challenge-explained/'));
});

test('A5: 429 y 5xx son reintentables; 403 y 404 no', () => {
  assert.ok(isRetryableStatus(429));
  assert.ok(isRetryableStatus(503));
  assert.ok(!isRetryableStatus(403));
  assert.ok(!isRetryableStatus(404));
});

// ── limitador por dominio
test('limitador: serializa el mismo host y deja pasar hosts distintos en paralelo', async () => {
  const run = createDomainLimiter(120);
  const orden: string[] = [];
  const marca = (etiqueta: string) => async () => { orden.push(etiqueta); return etiqueta; };

  const t0 = Date.now();
  await Promise.all([
    run('https://a.com/1', marca('a1')),
    run('https://a.com/2', marca('a2')),
    run('https://a.com/3', marca('a3')),
    run('https://b.com/1', marca('b1')),
  ]);
  const elapsed = Date.now() - t0;

  // Tres peticiones al mismo host con 120 ms de separación ⇒ ≥ 240 ms.
  assert.ok(elapsed >= 230, `esperaba ≥230ms de espaciado, fueron ${elapsed}ms`);
  // …pero b.com no espera detrás de la fila de a.com.
  assert.ok(orden.indexOf('b1') < 2, `b.com debió salir temprano, salió en la posición ${orden.indexOf('b1')}`);
  assert.deepEqual(orden.filter((o) => o.startsWith('a')), ['a1', 'a2', 'a3'], 'el mismo host va en orden');
});

test('limitador: un fallo no rompe la fila del host', async () => {
  const run = createDomainLimiter(10);
  const fallo = run('https://a.com/1', async () => { throw new Error('boom'); });
  await assert.rejects(fallo, /boom/);
  assert.equal(await run('https://a.com/2', async () => 'ok'), 'ok');
});

// ── sanidad general
test('un HTML sin cuerpo reconocible devuelve method none', () => {
  assert.equal(extractArticleText('<html><body><div id="root"></div></body></html>').method, 'none');
});

test('extractJsonLd baja por @graph y arrays anidados', () => {
  const cuerpo = 'Cuerpo del artículo con longitud más que suficiente para superar el mínimo exigido. '.repeat(4);
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'WebPage' }, { '@type': 'NewsArticle', articleBody: cuerpo }],
  })}</script>`;
  assert.ok(extractJsonLd(html).startsWith('Cuerpo del artículo'));
});

test('extractJsonLd sobrevive a un bloque ld+json roto', () => {
  // JSON-LD con coma colgante: JSON.parse falla y entra el rescate por regex.
  const html = `<script type="application/ld+json">
    {"@type":"NewsArticle","articleBody":"Texto rescatado del bloque roto con longitud suficiente para el test.",}
  </script>`;
  assert.ok(extractJsonLd(html).includes('Texto rescatado'));
});
