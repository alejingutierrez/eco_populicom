import { buildVoices, classifyVoice, type VoiceRow } from './voices';

const AG = { agencySlug: 'ddecpr', agencyName: 'Departamento de Desarrollo Económico y Comercio' };
const row = (day: string, author: string, o: Partial<VoiceRow> = {}): VoiceRow => ({
  day, author, author_fullname: null, domain: null, page_type: 'facebook_public', n: 1, neg: 0, inter: 0, zero: 1, ...o,
});

describe('quién habló', () => {
  test('clasifica la agencia, la prensa, gobierno y política, y la ciudadanía', () => {
    const c = (r: Partial<VoiceRow>) => classifyVoice({ author: null, author_fullname: null, domain: null, page_type: 'facebook_public', ...r }, AG.agencySlug, AG.agencyName).cat;
    expect(c({ author: 'desarrollopr', page_type: 'instagram' })).toBe('agencia');
    expect(c({ author: 'Departamento de Desarrollo Económico y Comercio', page_type: 'facebook' })).toBe('agencia');
    expect(c({ author: 'Noticentro por WAPA' })).toBe('prensa');
    expect(c({ author: '2 minutes', domain: 'elnuevodia.com', page_type: 'news' })).toBe('prensa');
    expect(c({ author: 'Senado Puerto Rico' })).toBe('gobierno');
    expect(c({ author: 'Municipio de Camuy' })).toBe('gobierno');
    expect(c({ author: 'Lucy Vega' })).toBe('ciudadania');
  });

  test('cuenta por tipo, compara con la ventana previa y nunca nombra a una persona', () => {
    const cur = [
      row('2026-10-01', 'desarrollopr', { page_type: 'instagram', n: 3, inter: 200, zero: 0 }),
      row('2026-10-01', 'Noticias RTZ', { page_type: 'news', n: 2, inter: 50, zero: 1 }),
      row('2026-10-02', 'Lucy Vega', { n: 1, neg: 1, inter: 14, zero: 0 }),
      row('2026-10-02', 'Senado Puerto Rico', { n: 1, inter: 0, zero: 1 }),
    ];
    const prev = [row('2026-09-24', 'El Vocero', { page_type: 'news', n: 5, neg: 3 })];
    const v = buildVoices({ cur, prev, prior: [{ author: 'desarrollopr', author_fullname: null, domain: null, page_type: 'instagram' }], days: ['2026-10-01', '2026-10-02'], ...AG });
    const byK = Object.fromEntries(v.cats.map((c) => [c.k, c]));
    expect(byK.agencia).toMatchObject({ n: 3, neg: 0, inter: 200, voices: 1 });
    expect(byK.prensa).toMatchObject({ n: 2, nPrev: 5, negPrev: 3 });
    expect(byK.ciudadania).toMatchObject({ n: 1, neg: 1 });
    expect(v.daily).toEqual([
      { date: '2026-10-01', agencia: 3, prensa: 2, gobierno: 0, ciudadania: 0 },
      { date: '2026-10-02', agencia: 0, prensa: 0, gobierno: 1, ciudadania: 1 },
    ]);
    expect(v.concentration).toEqual({ total: 264, top1: 200, top5: 264, zero: 2, n: 7 });
    expect(v.top.map((t) => t.name)).toEqual(['desarrollopr', 'Noticias RTZ', null, 'Senado Puerto Rico']);
    expect(v.newVoices).toBe(3);
    expect(v.distinct).toBe(4);
    expect(v.distinctPrev).toBe(1);
  });
});
