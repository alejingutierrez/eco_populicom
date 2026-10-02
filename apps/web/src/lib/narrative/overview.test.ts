/**
 * Agregado de la página Narrativas: reglas de dato, historias, cajón, posible
 * duplicado y selección de los cuatro bloques.
 */
import {
  processRows, firstMention, peak14, cajonStats, mondayOf, groupStories, findDuplicates,
  distinctiveTerms, buildOverview, propagationRows,
  type RawMentionRow, type StoryCandidate, type NarrMeta, type OverviewInput,
} from './overview';

const AG = { agencySlug: 'ddecpr', agencyName: 'Departamento de Desarrollo Económico y Comercio' };
let seq = 0;
function raw(nid: string, published_at: string, extra: Partial<RawMentionRow> = {}): RawMentionRow {
  seq += 1;
  return {
    nid, id: `m-${seq}`, published_at, url: `https://medio.pr/nota-${seq}`, title: `Nota ${seq}`,
    page_type: 'news', author: 'Primera Hora', author_fullname: null, domain: 'primerahora.com',
    sentiment: 'neutral', inter: 0, ...extra,
  };
}
const ymd = (base: string, k: number) => new Date(Date.parse(`${base}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

describe('processRows', () => {
  test('deduplica artículos con dos URL, resuelve «solo fecha» y corta en el último día', () => {
    const art = 'article_8da73240-345f-4672-bd63-3daa6e5b1a89';
    const { byNarr, voiceLabels } = processRows([
      raw('n1', '2026-09-24T16:14:00Z', { url: `https://elvocero.com/a/${art}.html`, author: 'Redacción, EL VOCERO' }),
      raw('n1', '2026-09-24T18:00:00Z', { url: `https://elvocero.com/b/${art}.html`, author: 'El Vocero de Puerto Rico' }),
      raw('n1', '2026-09-25T00:00:00Z'), // solo fecha → día 25, sin hora
      raw('n1', '2026-10-01T03:00:00Z'), // 23:00 del 30 en PR → entra
      raw('n1', '2026-10-01T00:00:00Z'), // solo fecha del 1 de octubre → fuera
    ], { ...AG, endYmd: '2026-09-30' });
    const rows = byNarr.get('n1')!;
    expect(rows.map((r) => [r.day, r.time])).toEqual([
      ['2026-09-24', '12:14'], ['2026-09-25', null], ['2026-09-30', '23:00'],
    ]);
    expect(voiceLabels.elvocero).toBe('El Vocero');
  });

  test('marca la voz propia, el canal propio, los medios y las páginas de etiqueta', () => {
    const { byNarr } = processRows([
      raw('n1', '2026-09-20T12:00:00Z', { author: 'desarrollopr', page_type: 'instagram', domain: 'instagram.com' }),
      raw('n1', '2026-09-20T13:00:00Z', { url: 'https://waloradio.com/tag/ddec/', author: 'WALO Radio' }),
      raw('n1', '2026-09-20T14:00:00Z', { author: 'Noticentro por WAPA', page_type: 'facebook_public' }),
    ], { ...AG, endYmd: '2026-09-30' });
    const [own, tag, wapa] = byNarr.get('n1')!;
    expect([own.own, own.owned, own.channel]).toEqual([true, true, 2]);
    expect(tag.tag).toBe(true);
    expect([wapa.media, wapa.channel, wapa.voice]).toEqual([true, 1, 'noticentrowapa']);
  });
});

describe('firstMention', () => {
  test('salta páginas de etiqueta y, en el mismo día, prefiere la que tiene hora', () => {
    const { byNarr } = processRows([
      raw('n1', '2026-09-23T15:00:00Z', { url: 'https://x.pr/tag/ddec/' }),
      raw('n1', '2026-09-24T00:00:00Z', { author: 'Telemundo PR' }), // solo fecha del 24
      raw('n1', '2026-09-24T16:14:00Z', { author: 'Es Noticia PR' }),
    ], { ...AG, endYmd: '2026-09-30' });
    const f = firstMention(byNarr.get('n1')!)!;
    expect([f.day, f.time, f.voice]).toEqual(['2026-09-24', '12:14', 'esnoticiapr']);
  });
});

describe('fechas, pico y cajón', () => {
  test('semanas de lunes a domingo', () => {
    expect(mondayOf('2026-09-30')).toBe('2026-09-28'); // miércoles
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // domingo
  });

  test('pico de 14 días: inicio, conteo y peso', () => {
    const days = ['2026-01-01', '2026-03-01', '2026-03-05', '2026-03-14', '2026-03-15', '2026-06-01'];
    expect(peak14(days)).toEqual({ start: '2026-03-01', n: 3, share: 0.5 });
  });

  test('cajón: muchas semanas y ninguna quincena con peso', () => {
    const spread = Array.from({ length: 20 }, (_, i) => raw('c', `${ymd('2026-01-05', i * 7)}T15:00:00Z`));
    const concentrated = Array.from({ length: 20 }, (_, i) => raw('k', `${ymd('2026-01-05', i < 16 ? i % 10 : i * 7)}T15:00:00Z`));
    const { byNarr } = processRows([...spread, ...concentrated], { ...AG, endYmd: '2026-12-31' });
    expect(cajonStats(byNarr.get('c')!).isCajon).toBe(true);
    expect(cajonStats(byNarr.get('k')!).isCajon).toBe(false);
  });
});

function cand(id: string, name: string, keywords: string[], born: string, last: string, peak: string, size = 10, extra: Partial<StoryCandidate> = {}): StoryCandidate {
  return { id, name, keywords, bornMs: Date.parse(born), lastMs: Date.parse(last), peakStart: peak, size, life: size, ownedShare: 0, ...extra };
}

describe('historias', () => {
  const all = [
    { name: 'FEI investiga a Lefranc Fortuño', keywords: ['Roberto Lefranc Fortuño', 'FEI'] },
    { name: 'Lefranc Fortuño retenido pese a investigación FEI', keywords: ['Roberto Lefranc Fortuño'] },
    { name: 'Expansión de Customed en Fajardo', keywords: ['Customed', 'Fajardo'] },
    { name: 'Renuncia de Sebastián Negrón', keywords: ['renuncia'] },
    { name: 'Renuncia del secretario de Hacienda', keywords: ['renuncia'] },
  ];

  test('coseno medio + término distintivo une capítulos; un término genérico no', () => {
    const c = [
      cand('fei', all[0].name, all[0].keywords, '2026-09-24', '2026-09-30', '2026-09-24', 31),
      cand('ret', all[1].name, all[1].keywords, '2026-09-26', '2026-09-30', '2026-09-26', 13),
      cand('cus', all[2].name, all[2].keywords, '2026-09-24', '2026-09-30', '2026-09-24'),
      cand('ren1', all[3].name, all[3].keywords, '2026-09-01', '2026-09-10', '2026-09-01'),
      cand('ren2', all[4].name, all[4].keywords, '2026-09-02', '2026-09-12', '2026-09-02'),
    ];
    const terms = distinctiveTerms(c, all);
    const stories = groupStories(c, [
      { a: 'fei', b: 'ret', sim: 0.5 },
      { a: 'fei', b: 'cus', sim: 0.5 },   // sin término compartido → no
      { a: 'ren1', b: 'ren2', sim: 0.5 }, // solo «renuncia» (genérico) → no
    ], terms);
    expect(stories.map((s) => s.memberIds.sort())).toEqual([['fei', 'ret']]);
    expect(stories[0].name).toBe('FEI investiga a Lefranc Fortuño'); // grupo de 2: la mayor
  });

  test('las condiciones de tiempo cortan aunque el coseno sea alto', () => {
    const c = [
      cand('a', 'Caso A', [], '2026-01-01', '2026-01-10', '2026-01-01'),
      cand('b', 'Caso B', [], '2026-03-01', '2026-03-10', '2026-03-01'), // vidas a 50 días
      cand('c', 'Caso C', [], '2026-01-05', '2026-06-01', '2026-05-01'), // pico a 120 días de A
    ];
    const stories = groupStories(c, [{ a: 'a', b: 'b', sim: 0.9 }, { a: 'a', b: 'c', sim: 0.9 }], new Map());
    expect(stories).toEqual([]);
  });

  test('una historia de 3 o más toma la keyword común como nombre', () => {
    const kw = ['reforma de permisos', 'OGPe'];
    const c = [
      cand('r1', 'DDEC reforma sistema permisos', kw, '2026-05-01', '2026-06-01', '2026-05-01', 200),
      cand('r2', 'Alcaldes condicionan reforma', kw, '2026-05-10', '2026-06-01', '2026-05-10', 50),
      cand('r3', 'Comisión especial', ['reforma de permisos'], '2026-05-15', '2026-06-01', '2026-05-15', 19),
    ];
    const stories = groupStories(c, [{ a: 'r1', b: 'r2', sim: 0.7 }, { a: 'r2', b: 'r3', sim: 0.7 }], new Map());
    expect(stories[0].name).toBe('Reforma de permisos');
    expect(stories[0].subtitle).toBe('DDEC reforma sistema permisos');
  });
});

describe('posible duplicado', () => {
  test('mismo hecho partido entre canal propio y prensa; capítulos no', () => {
    const c = [
      cand('s1', 'Startups Puerto Rico en Silicon Valley', [], '2026-05-01', '2026-05-10', '2026-05-02', 26, { ownedShare: 1 }),
      cand('s2', 'Startups de Puerto Rico en Silicon Valley', [], '2026-05-01', '2026-05-10', '2026-05-03', 24, { ownedShare: 0.5 }),
      cand('f1', 'FEI investiga a Lefranc Fortuño', [], '2026-09-24', '2026-09-30', '2026-09-24', 31),
      cand('f2', 'Lefranc Fortuño retenido pese a investigación FEI', [], '2026-09-26', '2026-09-30', '2026-09-26', 13),
    ];
    const d = findDuplicates(c, [{ a: 's1', b: 's2', sim: 0.69 }, { a: 'f1', b: 'f2', sim: 0.695 }]);
    expect([...d.entries()]).toEqual([['s2', { id: 's1', sim: 0.69 }]]);
  });
});

describe('buildOverview', () => {
  const END = '2026-09-30';
  function meta(id: string, status: string, extra: Partial<NarrMeta> = {}): NarrMeta {
    return { id, name: `Narrativa ${id}`, summary: null, keywords: [], status, born_at: '2026-01-01', last_mention_at: '2026-09-30', created_at: '2026-01-01', ...extra };
  }
  function input(rows: RawMentionRow[], metas: NarrMeta[], extra: Partial<OverviewInput> = {}): OverviewInput {
    return {
      agency: { slug: 'ddecpr', name: AG.agencyName }, endYmd: END, rows, metas,
      agencyNames: metas.map((m) => ({ name: m.name, keywords: m.keywords })), pairs: [],
      contextDays: [], statusCounts: [{ status: 'dormant', n: 260, first_born: '2025-01-07T12:00:00Z' }], ...extra,
    };
  }
  const burst = (nid: string, day: string, n: number, extra: Partial<RawMentionRow> = {}) =>
    Array.from({ length: n }, (_, i) => raw(nid, `${day}T${String(12 + (i % 10)).padStart(2, '0')}:00:00Z`, extra));

  test('ventanas: 30 días de serie, 7 contra 7, y 26 semanas de lunes con la última parcial', () => {
    const p = buildOverview(input([], []));
    expect(p.windows.series).toMatchObject({ from: '2026-09-01', to: END });
    expect(p.windows.series.days).toHaveLength(30);
    expect(p.windows.week).toEqual({ from: '2026-09-24', to: END });
    expect(p.windows.prevWeek).toEqual({ from: '2026-09-17', to: '2026-09-23' });
    expect(p.windows.map.weeks).toHaveLength(26);
    expect(p.windows.map.weeks[25]).toBe('2026-09-28');
    expect(p.windows.map.from).toBe('2026-04-06');
    expect(p.windows.map.partialDays).toBe(3);
    expect(p.counts).toEqual({ live: 0, dormant: 260, dormantSince: '2025-01-07' });
  });

  test('serie: 6 vivas por menciones del mes + 2 terminadas recientes con al menos 3', () => {
    const rows: RawMentionRow[] = [];
    const metas: NarrMeta[] = [];
    for (let i = 0; i < 8; i++) { rows.push(...burst(`v${i}`, '2026-09-20', 10 - i)); metas.push(meta(`v${i}`, i % 2 ? 'active' : 'declining')); }
    rows.push(...burst('d1', '2026-09-10', 5), ...burst('d2', '2026-09-12', 3), ...burst('d3', '2026-09-15', 2), ...burst('d4', '2026-09-05', 9));
    metas.push(meta('d1', 'dormant'), meta('d2', 'dormant'), meta('d3', 'dormant'), meta('d4', 'dormant'));
    const p = buildOverview(input(rows, metas));
    expect(p.series).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'd2', 'd1']);
    expect(p.board.active).toEqual(['v1', 'v3', 'v5', 'v7']);
    expect(p.board.declining).toEqual(['v0', 'v2', 'v4', 'v6']);
  });

  test('alerta: naciendo, no la inició la agencia, con negativas y 8+ menciones en 7 días', () => {
    const rows = [
      ...burst('e1', '2026-09-26', 9, { sentiment: 'negativo' }),
      ...burst('e2', '2026-09-26', 12, { author: 'desarrollopr', page_type: 'facebook' }),
      ...burst('e3', '2026-09-26', 7, { sentiment: 'negativo' }),
    ];
    const p = buildOverview(input(rows, [meta('e1', 'emerging'), meta('e2', 'emerging'), meta('e3', 'emerging')]));
    expect(p.alertId).toBe('e1');
    const e2 = p.narratives.find((n) => n.id === 'e2')!;
    expect(e2.origin).toBe('propia');
  });

  test('el cajón no entra a ningún bloque y se lista aparte', () => {
    const spread = Array.from({ length: 30 }, (_, i) => raw('caj', `${ymd('2026-03-02', i * 7)}T15:00:00Z`));
    const p = buildOverview(input([...spread, ...burst('ok', '2026-09-28', 3)], [meta('caj', 'active'), meta('ok', 'active')]));
    expect(p.narratives.map((n) => n.id)).toEqual(['ok']);
    expect(p.cajones).toEqual([{ id: 'caj', name: 'Narrativa caj', life: 30, bornDay: '2026-03-02' }]);
  });

  test('mapa: carriles por semana más reciente, fila de contexto y una historia solo con 2 en la página', () => {
    const rows = [
      ...burst('old', '2026-05-04', 20), ...burst('new', '2026-09-14', 16), ...burst('tiny', '2026-09-15', 2),
    ];
    const metas = [
      meta('old', 'dormant', { keywords: ['Customed'] }),
      meta('new', 'dormant', { keywords: ['Customed'], born_at: '2026-05-04' }),
      meta('tiny', 'dormant', { keywords: ['Customed'] }),
    ];
    const p = buildOverview(input(rows, metas, {
      pairs: [{ a: 'new', b: 'tiny', sim: 0.9 }],
      contextDays: [{ day: '2026-07-07', total: 40, in_narr: 0 }, { day: '2026-09-29', total: 5, in_narr: 2 }],
    }));
    expect(p.lanes).toEqual(['new', 'old']); // tiny: < 15 y fuera de serie y tablero
    const nw = p.narratives.find((n) => n.id === 'new')!;
    expect(nw.n180).toBe(16);
    expect(nw.w[23]).toBe(16); // semana del 14 de septiembre
    expect(nw.storyId).toBeNull(); // su historia con «tiny» no tiene 2 narrativas en la página
    expect(p.stories).toEqual([]);
    expect(p.context[13]).toEqual({ week: '2026-07-06', total: 40, inNarr: 0 });
    expect(p.context[25]).toEqual({ week: '2026-09-28', total: 5, inNarr: 2 });
  });

  test('las historias se arman solo con narrativas de la página: una oculta no encadena', () => {
    const rows = [...burst('a', '2026-09-10', 20), ...burst('b', '2026-09-11', 20), ...burst('hid', '2026-09-10', 2)];
    const metas = [meta('a', 'dormant'), meta('b', 'dormant'), meta('hid', 'dormant')];
    // a–hid y hid–b superan el umbral; a–b no. «hid» (2 menciones) no está en la página.
    const p = buildOverview(input(rows, metas, { pairs: [{ a: 'a', b: 'hid', sim: 0.9 }, { a: 'b', b: 'hid', sim: 0.9 }] }));
    expect(p.lanes.sort()).toEqual(['a', 'b']);
    expect(p.stories).toEqual([]);
  });

  test('el nombre visible de una voz no depende de las filas de cada consulta', () => {
    const a = processRows([raw('n1', '2026-09-20T12:00:00Z', { author: 'WAPA Digital' })], { ...AG, endYmd: END }).voiceLabels;
    const b = processRows([
      raw('n1', '2026-09-20T12:00:00Z', { author: 'wapadigital' }), raw('n1', '2026-09-20T13:00:00Z', { author: 'wapadigital' }),
      raw('n1', '2026-09-20T14:00:00Z', { author: 'Wapa Digital' }),
    ], { ...AG, endYmd: END }).voiceLabels;
    expect(a.wapadigital).toBe('WAPA Digital');
    expect(b.wapadigital).toBe('WAPA Digital');
    const c = processRows([raw('n1', '2026-09-20T12:00:00Z', { author: 'Redacción', domain: 'sincomillas.com' })], { ...AG, endYmd: END });
    expect(c.voiceLabels.sincomillas).toBe('sincomillas.com');
  });

  test('propagación: filas compactas y sin URL que no sea http(s)', () => {
    const { byNarr } = processRows([
      raw('n1', '2026-09-24T16:14:00Z', { url: 'javascript:alert(1)', sentiment: 'negative', inter: '12' }),
    ], { ...AG, endYmd: END });
    expect(propagationRows(byNarr.get('n1')!)).toEqual([
      { d: '2026-09-24', t: '12:14', c: 0, s: 'n', e: 12, v: 'primerahora', m: 1, j: 0, o: 0, ti: expect.any(String), u: null },
    ]);
  });
});
