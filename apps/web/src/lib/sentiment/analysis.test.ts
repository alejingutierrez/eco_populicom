import { bucketEmotionWeeks, buildNssShift, emotionLabel, whereOf } from './analysis';

const DDEC = { slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };
const row = (o: Partial<{ author: string; author_fullname: string; domain: string; page_type: string; pub_type: string }>) =>
  ({ author: null, author_fullname: null, domain: null, page_type: null, pub_type: null, ...o });

describe('whereOf: dónde se dijo', () => {
  test('la publicación de la agencia en su canal es de la agencia, no un comentario', () => {
    expect(whereOf(row({ author: 'Departamento de Desarrollo Económico y Comercio', page_type: 'facebook', pub_type: 'FACEBOOK', domain: 'facebook.com' }), DDEC.slug, DDEC.name)).toBe('agencia');
  });
  test('una persona en un canal propio es un comentario en sus canales', () => {
    expect(whereOf(row({ author: 'Chris Rodríguez', page_type: 'facebook', pub_type: 'FACEBOOK', domain: 'facebook.com' }), DDEC.slug, DDEC.name)).toBe('comentarios');
    expect(whereOf(row({ author: '', page_type: 'linkedin', pub_type: 'LINKEDIN', domain: 'linkedin.com' }), DDEC.slug, DDEC.name)).toBe('comentarios');
  });
  test('una persona en Facebook público es «otras cuentas»; un medio, prensa', () => {
    expect(whereOf(row({ author: 'Chris Rodríguez', page_type: 'facebook_public', pub_type: 'FACEBOOK_PUBLIC', domain: 'facebook.com' }), DDEC.slug, DDEC.name)).toBe('otras');
    expect(whereOf(row({ author: 'NotiUno.com', page_type: 'news', pub_type: 'WISE_NEWS_PUBLIC', domain: 'notiuno.com' }), DDEC.slug, DDEC.name)).toBe('prensa');
  });
});

describe('buildNssShift', () => {
  test('los aportes suman exactamente el cambio del NSS', () => {
    // previa: 104 menciones (+7 −4); actual: 129 (+9 −20) — DDEC 29 sep–12 oct.
    const s = buildNssShift([
      { where: 'agencia', cur: false, n: 36, pos: 0, neg: 0 }, { where: 'agencia', cur: true, n: 45, pos: 0, neg: 0 },
      { where: 'comentarios', cur: false, n: 9, pos: 4, neg: 3 }, { where: 'comentarios', cur: true, n: 43, pos: 7, neg: 12 },
      { where: 'prensa', cur: false, n: 41, pos: 0, neg: 1 }, { where: 'prensa', cur: true, n: 29, pos: 0, neg: 8 },
      { where: 'gobierno', cur: false, n: 8, pos: 0, neg: 0 }, { where: 'gobierno', cur: true, n: 6, pos: 1, neg: 0 },
      { where: 'otras', cur: false, n: 10, pos: 3, neg: 0 }, { where: 'otras', cur: true, n: 6, pos: 1, neg: 0 },
    ]);
    expect(s.cur).toMatchObject({ n: 129, pos: 9, neg: 20, nss: -8.5 });
    expect(s.prev).toMatchObject({ n: 104, pos: 7, neg: 4, nss: 2.9 });
    const byKey = Object.fromEntries(s.groups.map((g) => [g.key, g.delta]));
    expect(byKey).toEqual({ agencia: 0, comentarios: -4.8, prensa: -5.2, gobierno: 0.8, otras: -2.1 });
    const sum = s.groups.reduce((a, g) => a + (g.now - g.before), 0);
    expect(Math.abs(sum - (-8.53 - 2.88))).toBeLessThan(0.15);
  });
  test('un grupo que no aparece en ninguno de los dos periodos no se lista', () => {
    const s = buildNssShift([{ where: 'prensa', cur: true, n: 10, pos: 1, neg: 2 }]);
    expect(s.groups.map((g) => g.key)).toEqual(['prensa']);
    expect(s.prev.nss).toBeNull();
  });
});

describe('bucketEmotionWeeks', () => {
  test('12 semanas que terminan el último día; la última semana manda el orden', () => {
    const w = bucketEmotionWeeks([
      { d: '2026-10-12', emotion: 'frustración', c: 3 },
      { d: '2026-10-06', emotion: 'Frustración', c: 2 },
      { d: '2026-10-05', emotion: 'gratitud', c: 9 },
      { d: '2026-07-20', emotion: 'enojo', c: 4 }, // antes de la primera semana: fuera
    ], '2026-10-12');
    expect(w.weeks).toHaveLength(12);
    expect(w.weeks[11]).toEqual({ start: '2026-10-06', end: '2026-10-12' });
    expect(w.weeks[0]).toEqual({ start: '2026-07-21', end: '2026-07-27' });
    expect(w.rows.map((r) => r.emotion)).toEqual(['Frustración', 'Gratitud']);
    expect(w.rows[0].counts[11]).toBe(5);
    expect(w.rows[1].counts[10]).toBe(9);
  });
  test('la etiqueta es la de /api/eco-data', () => {
    expect(emotionLabel(' preocupación ')).toBe('Preocupación');
  });
});
