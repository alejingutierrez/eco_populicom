import { pgJson, pgSafeString } from '../../../../infra/lambda/lib/pg-json';
import { clipSampleText } from '@eco/shared';

/**
 * Archivo de la composición del correo: PostgreSQL rechaza en `jsonb` un
 * sustituto suelto (medio emoji) y el carácter nulo, aunque `JSON.stringify`
 * los acepte. Pasó con el Diario de DDEC del 17-nov-2026. La prueba vive aquí
 * porque el CI solo corre el jest de apps/web.
 */
describe('pgJson', () => {
  const HALF = '\ud83d'; // primera mitad de 😀

  test('un texto normal, con emojis completos y acentos, queda igual', () => {
    const v = { a: 'Señalamiento 😀 «ok»', n: 3, list: ['á', null, true], nested: { b: '👍🏽' } };
    expect(JSON.parse(pgJson(v))).toEqual(v);
    expect(pgJson(v)).toBe(JSON.stringify(v));
  });

  test('medio emoji (alto o bajo) se cambia por U+FFFD y no deja escapes \\ud8xx', () => {
    const out = pgJson({ text: `Gracias ${HALF}`, tail: '\ude00 hola', arr: [`x${HALF}`] });
    expect(out).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(JSON.parse(out)).toEqual({ text: 'Gracias �', tail: '� hola', arr: ['x�'] });
  });

  test('quita el carácter nulo y sanea también las claves', () => {
    const out = pgJson({ [`k${HALF}`]: 'a\u0000b' });
    expect(out).not.toContain('\\u0000');
    expect(JSON.parse(out)).toEqual({ 'k�': 'ab' });
  });

  test('pgSafeString no toca un par válido pegado a uno suelto', () => {
    expect(pgSafeString(`😀${HALF}`)).toBe('😀�');
  });
});

describe('clipSampleText', () => {
  test('no parte un emoji al recortar', () => {
    const s = 'ab😀cd';
    expect(clipSampleText(s, 3)).toBe('ab'); // el corte caía en medio del emoji
    expect(clipSampleText(s, 4)).toBe('ab😀');
    expect(clipSampleText(s, 2)).toBe('ab');
    expect(clipSampleText(null, 5)).toBe('');
    expect(pgJson(clipSampleText(s, 3))).toBe('"ab"');
  });
});
