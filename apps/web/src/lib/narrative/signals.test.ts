/**
 * Reglas de dato de Narrativas (`@eco/shared/narrative-signals`). Viven aquí,
 * en jest, para que el CI las corra (jest solo mira apps/web/src).
 */
import {
  mentionWhen, articleKey, isTagPage, voiceKey, normalizeVoice, isOwnVoice, isMediaMention,
  channelOf, originOf, isNegativeShare, decodeEntities,
} from '@eco/shared';

describe('narrative-signals', () => {
  test('medianoche UTC es «solo fecha»: el día es la fecha UTC y no hay hora', () => {
    // Telemundo, caso FEI: 2026-09-24T00:00Z caía el 23 a las 8 p.m. en hora PR.
    expect(mentionWhen('2026-09-24T00:00:00.000Z')).toEqual({ day: '2026-09-24', time: null });
  });

  test('una hora real se convierte a hora de Puerto Rico', () => {
    // Es Noticia PR: 16:14 UTC = 12:14 p.m. en Puerto Rico (UTC−4, sin horario de verano).
    expect(mentionWhen('2026-09-24T16:14:00Z')).toEqual({ day: '2026-09-24', time: '12:14' });
    // 02:30 UTC del 25 = 22:30 del 24 en Puerto Rico.
    expect(mentionWhen(new Date('2026-09-25T02:30:00Z'))).toEqual({ day: '2026-09-24', time: '22:30' });
    // 04:05 UTC = 00:05 en PR: la hora 00 no se escribe «24».
    expect(mentionWhen('2026-09-25T04:05:00Z')).toEqual({ day: '2026-09-25', time: '00:05' });
  });

  test('un artículo con dos URL comparte la llave article_<uuid>', () => {
    const a = 'https://www.elvocero.com/gobierno/agencias/pfei-incluye-al-subsecretario/article_8da73240-345f-4672-bd63-3daa6e5b1a89.html';
    const b = 'https://www.elvocero.com/gobierno/agencias/fei-ampl-a-pesquisa/article_8da73240-345f-4672-bd63-3daa6e5b1a89.html';
    expect(articleKey(a, 'x')).toBe(articleKey(b, 'y'));
    expect(articleKey('https://example.com/nota', 'x')).toBe('https://example.com/nota');
    expect(articleKey(null, 'mid-1')).toBe('mid-1');
  });

  test('páginas de etiqueta no son artículos', () => {
    expect(isTagPage('https://waloradio.com/tag/departamento-de-desarrollo-economico-y-comercio/', '')).toBe(true);
    expect(isTagPage('https://x.com/nota', 'Departamento de Desarrollo Económico y Comercio Archives')).toBe(true);
    expect(isTagPage('https://www.elnuevodia.com/noticias/gobierno/notas/jefe-del-ddec/', 'Jefe del DDEC defiende')).toBe(false);
  });

  test('un mismo medio es una sola voz aunque cambie la grafía o el canal', () => {
    expect(voiceKey('Telemundo Pr', null)).toBe(voiceKey('telemundopr', null));
    expect(voiceKey('Telemundo PR', null)).toBe('telemundopr');
    expect(voiceKey('Noticentro por WAPA', null)).toBe(voiceKey('noticentrowapa', null));
    expect(voiceKey('radioisla.tv (Radio Isla 1320 AM)', null)).toBe(voiceKey('Radio Isla 1320', null));
    expect(voiceKey('Redacción, EL VOCERO', null)).toBe(voiceKey('El Vocero de Puerto Rico', null));
    expect(voiceKey('primerahora', null)).toBe(voiceKey('primerahora.com', null));
    expect(voiceKey('', 'esnoticiapr.com')).toBe(voiceKey('Es Noticia PR', null));
    expect(normalizeVoice('Redacci&oacute;n, EL VOCERO')).toBe('elvocero');
    expect(decodeEntities('Ca&ntilde;o &amp; Co &#241;')).toBe('Caño & Co ñ');
  });

  test('cuentas propias por agencia', () => {
    const name = 'Departamento de Desarrollo Económico y Comercio';
    expect(isOwnVoice(voiceKey(name, null), 'ddecpr', name)).toBe(true);
    expect(isOwnVoice(voiceKey('desarrollopr', null), 'ddecpr', name)).toBe(true);
    expect(isOwnVoice(voiceKey('Telemundo PR', null), 'ddecpr', name)).toBe(false);
  });

  test('origen: la agencia, prensa (también un medio en Facebook), política o redes', () => {
    const base = { agencySlug: 'ddecpr', agencyName: 'Departamento de Desarrollo Económico y Comercio' };
    expect(originOf({ ...base, key: voiceKey('desarrollopr', null), pageType: 'instagram', displayName: 'desarrollopr' })).toBe('propia');
    expect(originOf({ ...base, key: voiceKey('', 'esnoticiapr.com'), pageType: 'news', displayName: 'esnoticiapr.com' })).toBe('prensa');
    expect(originOf({ ...base, key: voiceKey('La Perla del Sur', null), pageType: 'facebook_public', displayName: 'La Perla del Sur' })).toBe('prensa');
    expect(originOf({ ...base, key: voiceKey('Senado Puerto Rico', null), pageType: 'facebook_public', displayName: 'Senado Puerto Rico' })).toBe('politica');
    expect(originOf({ ...base, key: voiceKey('María Pérez', null), pageType: 'facebook_public', displayName: 'María Pérez' })).toBe('redes');
  });

  test('medios y carriles', () => {
    expect(isMediaMention('news', '')).toBe(true);
    expect(isMediaMention('facebook_public', 'Noticentro por WAPA')).toBe(true);
    expect(isMediaMention('facebook_public', 'Jay Fonseca')).toBe(false);
    expect(['news', 'blog', 'facebook_public', 'instagram', 'bluesky', null].map(channelOf)).toEqual([0, 0, 1, 2, 3, 3]);
  });

  test('el tiempo de lectura no es una voz y «Redacción de» se descarta', () => {
    expect(voiceKey('2 minutes', 'elnuevodia.com')).toBe('elnuevodia');
    expect(voiceKey('1 minute', 'primerahora.com')).toBe('primerahora');
    expect(voiceKey('Redacción de Sin Comillas', null)).toBe(voiceKey('Sin Comillas', null));
    expect(voiceKey('Jay Fonseca PR', null)).toBe('jayfonseca');
    expect(voiceKey('Autor: CyberNews', null)).toBe(voiceKey('CyberNews', null));
    expect(voiceKey('Por Juan Pérez', null)).toBe(voiceKey('Juan Pérez', null));
  });

  test('cuentas propias de la Gobernadora y del DDEC con otras grafías', () => {
    expect(isOwnVoice(voiceKey('La Fortaleza de PR', null), 'gobernadora', 'Gobernadora de Puerto Rico')).toBe(true);
    expect(isOwnVoice(voiceKey('Jenniffer González', null), 'gobernadora', 'Gobernadora de Puerto Rico')).toBe(true);
    expect(isOwnVoice(voiceKey('DDEC Puerto Rico', null), 'ddecpr', 'Departamento de Desarrollo Económico y Comercio')).toBe(true);
  });

  test('un nombre de persona no se lee como medio', () => {
    expect(isMediaMention('facebook', 'Rosalyn Lopez Victoria')).toBe(false);
    expect(isMediaMention('facebook_public', 'Victoria 840')).toBe(true);
    expect(isMediaMention('facebook_public', 'Radio Isla 1320')).toBe(true);
  });

  test('una sola regla de negativo: ≥ 30% con 8 o más menciones', () => {
    expect(isNegativeShare(3, 13)).toBe(false);
    expect(isNegativeShare(11, 32)).toBe(true);
    expect(isNegativeShare(3, 5)).toBe(false);
  });
});
