/**
 * Tests de las copias propias de imágenes. Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/media-mirror.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MEDIA_KEY_RE, isExpiringImageUrl, mediaKeyFor, mirrorImage } from './media-mirror';

test('isExpiringImageUrl reconoce el CDN de Meta y los parámetros de vencimiento', () => {
  assert.equal(isExpiringImageUrl('https://scontent-lhr6-1.xx.fbcdn.net/v/t39.30808-6/1_n.jpg?oe=68DA1B2C&_nc_sid=1'), true);
  assert.equal(isExpiringImageUrl('https://scontent.cdninstagram.com/v/t51/2.jpg'), true);
  assert.equal(isExpiringImageUrl('https://bucket.s3.amazonaws.com/a.jpg?X-Amz-Expires=3600'), true);
  // La firma del resizer de Arc (El Nuevo Día) es fija: no caduca.
  assert.equal(isExpiringImageUrl('https://www.elnuevodia.com/resizer/v2/ABC.jpg?auth=08a08e&width=1200'), false);
  assert.equal(isExpiringImageUrl('https://i.ytimg.com/vi/x/hqdefault.jpg'), false);
  assert.equal(isExpiringImageUrl('https://citizenecho.com/media/0123456789abcdef0123456789abcdef.jpg'), false);
  assert.equal(isExpiringImageUrl(null), false);
  assert.equal(isExpiringImageUrl('no es una url'), false);
});

test('mediaKeyFor da una clave estable con la extensión del tipo', async () => {
  const a = await mediaKeyFor('https://x.fbcdn.net/a.jpg?oe=1', 'image/jpeg');
  const b = await mediaKeyFor('https://x.fbcdn.net/a.jpg?oe=1', 'image/jpeg; charset=binary');
  assert.ok(a && MEDIA_KEY_RE.test(a));
  assert.equal(a, b);
  assert.equal(await mediaKeyFor('https://x.fbcdn.net/a.jpg', 'text/html'), null);
});

test('mirrorImage guarda la imagen y devuelve la URL propia; nunca lanza', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const server = createServer((req, res) => {
    if (req.url === '/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); return; }
    if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>'); return; }
    res.writeHead(403); res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stored: Array<{ key: string; bytes: number; type: string }> = [];
  const opts = {
    publicBaseUrl: 'https://citizenecho.com/media/',
    put: async (key: string, body: Uint8Array, type: string) => { stored.push({ key, bytes: body.byteLength, type }); },
  };
  try {
    const url = await mirrorImage(`${base}/ok.png`, opts);
    assert.match(url ?? '', /^https:\/\/citizenecho\.com\/media\/[a-f0-9]{32}\.png$/);
    assert.deepEqual(stored.map((s) => [s.bytes, s.type]), [[png.byteLength, 'image/png']]);
    assert.equal(await mirrorImage(`${base}/expirada.jpg`, opts), null); // 403: ya venció
    assert.equal(await mirrorImage(`${base}/html`, opts), null);        // no es imagen
    assert.equal(await mirrorImage(`${base}/ok.png`, { ...opts, put: async () => { throw new Error('S3 caído'); } }), null);
  } finally {
    server.close();
  }
});
