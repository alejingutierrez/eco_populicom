/**
 * Asuntos abiertos y nivel sostenido (INT-01). Viven en `@eco/shared`; las
 * pruebas están aquí porque el CI solo corre el jest de apps/web.
 */
import {
  buildOpenIssues, buildSustainedLevel, currentRunStart, groupIssues, openIssueStage, principalVoice, processRows,
  sustainedSeriesStart, SUSTAINED_MIN_BASE,
  type NarrMeta, type OpenIssuesInput, type RawMentionRow, type SimPair, type StoryCandidate, type SustainedDailyPoint,
} from '@eco/shared';

const AGENCY = { slug: 'df', name: 'Departamento de la Familia' };
const END = '2026-10-23';
let seq = 0;
const ymd = (base: string, k: number) => new Date(Date.parse(`${base}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
/** Mención al mediodía de Puerto Rico del día `day` (16:00Z), para que el día no dependa de la zona. */
function raw(nid: string, day: string, extra: Partial<RawMentionRow> = {}): RawMentionRow {
  seq += 1;
  return {
    nid, id: `m-${seq}`, published_at: `${day}T16:00:00Z`, url: `https://medio.pr/nota-${seq}`, title: `Nota ${seq}`,
    page_type: 'news', author: 'Primera Hora', author_fullname: null, domain: 'primerahora.com',
    sentiment: 'neutral', inter: 0, ...extra,
  };
}
const many = (n: number, nid: string, day: string, extra: Partial<RawMentionRow> = {}) =>
  Array.from({ length: n }, () => raw(nid, day, extra));
function meta(id: string, name: string, keywords: string[] = []): NarrMeta {
  return { id, name, summary: null, keywords, status: 'dormant', born_at: null, last_mention_at: null, created_at: null };
}
function input(rows: RawMentionRow[], metas: NarrMeta[], pairs: SimPair[] = [], weekTotal = 0): OpenIssuesInput {
  return { agency: AGENCY, endYmd: END, rows, metas, agencyNames: metas.map((m) => ({ name: m.name, keywords: m.keywords })), pairs, weekTotal };
}

describe('currentRunStart', () => {
  test('sin huecos largos, el tramo empieza en la primera mención', () => {
    expect(currentRunStart(['2026-10-01', '2026-10-10', '2026-10-23'])).toBe('2026-10-01');
  });
  test('14 días sin menciones no cierran; 15 sí', () => {
    // Entre el 1 y el 16 hay 14 días sin menciones: sigue el mismo tramo.
    expect(currentRunStart(['2026-10-01', '2026-10-16', '2026-10-20'])).toBe('2026-10-01');
    // Entre el 1 y el 17 hay 15: el tramo actual empieza el 17.
    expect(currentRunStart(['2026-10-01', '2026-10-17', '2026-10-20'])).toBe('2026-10-17');
  });
  test('sin días devuelve null', () => {
    expect(currentRunStart([])).toBeNull();
  });
});

describe('openIssueStage', () => {
  test('nuevo: tramo de 3 días o menos, diga lo que diga el volumen', () => {
    expect(openIssueStage(40, 0, 3)).toBe('new');
  });
  test('sube: 25 % más y al menos 5 menciones más', () => {
    expect(openIssueStage(25, 20, 10)).toBe('rising');
    expect(openIssueStage(24, 20, 10)).toBe('steady'); // +20 %
    expect(openIssueStage(6, 2, 10)).toBe('steady'); // triplica pero solo +4
  });
  test('baja: 25 % menos y al menos 5 menciones menos', () => {
    expect(openIssueStage(15, 20, 10)).toBe('falling');
    expect(openIssueStage(16, 20, 10)).toBe('steady');
    expect(openIssueStage(5, 9, 10)).toBe('steady'); // −44 % pero solo −4
  });
});

describe('principalVoice', () => {
  const rowsOf = (rs: RawMentionRow[]) => {
    const { byNarr, voiceLabels } = processRows(rs, { agencySlug: AGENCY.slug, agencyName: AGENCY.name, endYmd: END });
    return { rows: byNarr.get('n1') ?? [], voiceLabels };
  };
  test('gana la voz con más interacciones, no la que más publica', () => {
    const { rows, voiceLabels } = rowsOf([
      ...many(6, 'n1', END, { author: 'Telemundo PR', domain: 'telemundopr.com', inter: 10 }),
      raw('n1', END, { author: 'Jay Fonseca', domain: 'facebook.com', page_type: 'facebook', inter: 300 }),
      raw('n1', END, { author: 'jayfonsecapr', domain: 'instagram.com', page_type: 'instagram', inter: 100 }),
    ]);
    const { voice, voices } = principalVoice(rows, voiceLabels);
    expect(voice).toMatchObject({ key: 'jayfonseca', label: 'Jay Fonseca', basis: 'interactions', value: 400, total: 460, sharePct: 87, mentions: 2 });
    expect(voices).toBe(2); // las dos cuentas de Jay Fonseca son una voz
  });
  test('las cuentas de la agencia no pueden ser la voz principal, pero cuentan como voz', () => {
    const { rows, voiceLabels } = rowsOf([
      raw('n1', END, { author: 'Departamento de la Familia', domain: 'facebook.com', page_type: 'facebook', inter: 900 }),
      raw('n1', END, { author: 'NotiCel', domain: 'noticel.com', inter: 150 }),
    ]);
    const { voice, voices } = principalVoice(rows, voiceLabels);
    expect(voice).toMatchObject({ key: 'noticel', value: 150, total: 1050, sharePct: 14 });
    expect(voices).toBe(2);
  });
  test('sin interacciones: la voz con más menciones, si llega a 3', () => {
    const { rows, voiceLabels } = rowsOf([
      ...many(3, 'n1', END, { author: 'El Vocero', domain: 'elvocero.com' }),
      ...many(2, 'n1', END, { author: 'NotiCel', domain: 'noticel.com' }),
    ]);
    expect(principalVoice(rows, voiceLabels).voice).toMatchObject({ key: 'elvocero', basis: 'mentions', value: 3, total: 5, sharePct: 60 });
  });
  test('pocas interacciones no hacen una voz principal: decide por menciones', () => {
    // 1 «me gusta» en un comentario: sería el 100 % de las interacciones.
    const few = rowsOf([
      raw('n1', END, { author: 'Persona Particular', domain: 'facebook.com', page_type: 'facebook', inter: 1 }),
      ...many(3, 'n1', END, { author: 'NotiCel', domain: 'noticel.com' }),
    ]);
    expect(principalVoice(few.rows, few.voiceLabels).voice).toMatchObject({ key: 'noticel', basis: 'mentions', value: 3 });
    // 12 interacciones, pero menos del 10 % de las del asunto (el resto son de la agencia).
    const small = rowsOf([
      raw('n1', END, { author: 'Departamento de la Familia', domain: 'facebook.com', page_type: 'facebook', inter: 500 }),
      raw('n1', END, { author: 'Persona Particular', domain: 'facebook.com', page_type: 'facebook', inter: 12 }),
    ]);
    expect(principalVoice(small.rows, small.voiceLabels)).toEqual({ voice: null, voices: 2 });
  });

  test('una persona particular no se nombra: ni por comentar mucho ni por pocas interacciones', () => {
    // 4 comentarios en Facebook (no es un medio) y un medio con 3 notas: gana el medio.
    const a = rowsOf([
      ...many(4, 'n1', END, { author: 'Mara Particular', domain: 'facebook.com', page_type: 'facebook' }),
      ...many(3, 'n1', END, { author: 'NotiCel', domain: 'noticel.com' }),
    ]);
    expect(principalVoice(a.rows, a.voiceLabels).voice).toMatchObject({ key: 'noticel', basis: 'mentions', media: true });
    // Solo la persona: sin voz dominante, pero cuenta como voz.
    const b = rowsOf(many(5, 'n1', END, { author: 'Mara Particular', domain: 'facebook.com', page_type: 'facebook', inter: 9 }));
    expect(principalVoice(b.rows, b.voiceLabels)).toEqual({ voice: null, voices: 1 });
    // Una cuenta que no es un medio pero con alcance (100 interacciones o más) sí se nombra.
    const c = rowsOf([raw('n1', END, { author: 'Jay Fonseca', domain: 'facebook.com', page_type: 'facebook', inter: 100 })]);
    expect(principalVoice(c.rows, c.voiceLabels).voice).toMatchObject({ key: 'jayfonseca', basis: 'interactions', media: false });
  });

  test('sin interacciones y sin una voz con 3 menciones: sin voz dominante', () => {
    const { rows, voiceLabels } = rowsOf([
      ...many(2, 'n1', END, { author: 'El Vocero', domain: 'elvocero.com' }),
      ...many(2, 'n1', END, { author: 'NotiCel', domain: 'noticel.com' }),
    ]);
    expect(principalVoice(rows, voiceLabels)).toEqual({ voice: null, voices: 2 });
  });
});

describe('groupIssues', () => {
  const day = (k: number) => ymd(END, k);
  // Nombres sin palabras en común: con el mismo nombre, dos narrativas serían «posible duplicado».
  const cand = (id: string, size: number, name = `Tema ${id.repeat(5)}`): StoryCandidate => ({
    id, name, keywords: [], bornMs: Date.parse(`${day(-10)}T00:00:00Z`), lastMs: Date.parse(`${END}T00:00:00Z`),
    peakStart: day(-10), size, life: size, ownedShare: 0,
  });
  // 0.66: arista (≥ 0.65) sin llegar a «posible duplicado» (≥ 0.72 con el mismo pico).
  const edge = (a: string, b: string): SimPair => ({ a, b, sim: 0.66 });
  const ids = (gs: StoryCandidate[][]) => gs.map((g) => g.map((c) => c.id));

  test('una cadena no une casos distintos: hace falta arista directa con la mayor', () => {
    // roig — schatz — reforma: la reforma no toca a la mayor.
    const out = groupIssues([cand('roig', 50), cand('schatz', 20), cand('reforma', 40)], [edge('roig', 'schatz'), edge('schatz', 'reforma')], new Map());
    expect(ids(out)).toEqual([['roig', 'schatz'], ['reforma']]);
  });

  test('sin arista con la mayor, entra quien conecta con 2 narrativas del grupo', () => {
    const cands = [cand('a', 100), cand('b', 30), cand('c', 20), cand('d', 10), cand('e', 5)];
    // d conecta con b y c (2 del grupo); e solo con d cuando d ya entró, y con b: entra en la segunda vuelta.
    const out = groupIssues(cands, [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('d', 'e'), edge('b', 'e')], new Map());
    expect(ids(out)).toEqual([['a', 'b', 'c', 'd', 'e']]);
  });

  test('una sola arista con un miembro que no es la mayor no basta', () => {
    const out = groupIssues([cand('a', 100), cand('b', 30), cand('x', 10)], [edge('a', 'b'), edge('b', 'x')], new Map());
    expect(ids(out)).toEqual([['a', 'b'], ['x']]);
  });

  test('dos grupos del mismo caso se unen si la mitad del menor toca al mayor', () => {
    // Grupo a: a, b, c. Grupo p: p, q (ninguna toca a `a`). p y q tocan cada una a un miembro distinto.
    const cands = [cand('a', 100), cand('b', 30), cand('c', 20), cand('p', 15), cand('q', 10)];
    const base = [edge('a', 'b'), edge('a', 'c'), edge('p', 'q')];
    expect(ids(groupIssues(cands, base, new Map()))).toEqual([['a', 'b', 'c'], ['p', 'q']]);
    // Una sola arista entre los grupos no basta (hacen falta 2).
    expect(ids(groupIssues(cands, [...base, edge('b', 'p')], new Map()))).toEqual([['a', 'b', 'c'], ['p', 'q']]);
    expect(ids(groupIssues(cands, [...base, edge('b', 'p'), edge('c', 'q')], new Map()))).toEqual([['a', 'b', 'c', 'p', 'q']]);
  });

  test('un posible duplicado que quedó suelto se suma al grupo de su narrativa mayor', () => {
    const out = groupIssues([cand('a', 100), cand('b', 30), cand('x', 10)], [edge('a', 'b'), { a: 'b', b: 'x', sim: 0.8 }], new Map());
    expect(ids(out)).toEqual([['a', 'b', 'x']]);
  });

  test('la arista respeta las reglas de la página: coseno bajo sin término común no agrupa', () => {
    const out = groupIssues([cand('a', 10), cand('b', 5)], [{ a: 'a', b: 'b', sim: 0.5 }], new Map());
    expect(ids(out)).toEqual([['a'], ['b']]);
  });
});

describe('buildOpenIssues', () => {
  test('agrupa en un asunto las narrativas del mismo caso y cuenta los días desde la más antigua', () => {
    const rows = [
      // n1: nació hace 26 días y sigue con menciones.
      ...many(4, 'n1', ymd(END, -25), { sentiment: 'negativo' }),
      ...many(3, 'n1', ymd(END, -15)),
      ...many(6, 'n1', ymd(END, -9), { sentiment: 'negativo' }),
      ...many(8, 'n1', ymd(END, -2), { sentiment: 'negativo' }),
      // n2: narrativa nueva del mismo caso (4 días).
      ...many(5, 'n2', ymd(END, -3), { sentiment: 'negativo' }),
      ...many(2, 'n2', END),
      // n3: otro asunto, menor.
      ...many(6, 'n3', ymd(END, -1)),
    ];
    const metas = [
      meta('n1', 'Escándalo Suzanne Roig contratos ADSEF', ['suzanne roig', 'adsef']),
      meta('n2', 'Demanda contra Suzanne Roig por hostigamiento', ['suzanne roig', 'demanda']),
      meta('n3', 'Cierre cuido infantil San Juan', ['cuido']),
    ];
    const out = buildOpenIssues(input(rows, metas, [{ a: 'n1', b: 'n2', sim: 0.7 }, { a: 'n1', b: 'n3', sim: 0.3 }], 40));
    expect(out.openCount).toBe(2);
    const [first, second] = out.issues;
    expect(first.narrativeIds.sort()).toEqual(['n1', 'n2']);
    expect(first).toMatchObject({
      name: 'Escándalo Suzanne Roig contratos ADSEF', // la narrativa mayor
      lead: null, // y también la más activa de la semana
      week: 15, prevWeek: 6, negWeek: 13, negPct: 87,
      openSince: ymd(END, -25), firstEverDay: ymd(END, -25), daysOpen: 26, reopened: false,
      stage: 'rising', score: 28,
    });
    expect(second).toMatchObject({ narrativeIds: ['n3'], week: 6, daysOpen: 2, stage: 'new', negPct: 0 });
    expect(out.coverage).toEqual({ weekTotal: 40, inIssues: 21, pct: 53 });
    expect(out.windows.week).toEqual({ from: ymd(END, -6), to: END });
  });

  test('el nombre es el de la narrativa mayor de toda la vida; `lead` dice cuál mueve la semana', () => {
    const rows = [
      ...many(40, 'vieja', ymd(END, -12)),
      ...many(2, 'vieja', END),
      ...many(9, 'nueva', ymd(END, -1)),
    ];
    const metas = [meta('vieja', 'Escándalo contratos ADSEF'), meta('nueva', 'Senado pospone destitución')];
    const [issue] = buildOpenIssues(input(rows, metas, [{ a: 'vieja', b: 'nueva', sim: 0.7 }])).issues;
    expect(issue).toMatchObject({ name: 'Escándalo contratos ADSEF', week: 11, lead: { id: 'nueva', name: 'Senado pospone destitución', week: 9 } });
  });

  test('una negativa cuenta doble al ordenar', () => {
    const rows = [
      ...many(10, 'a', ymd(END, -1)),
      ...many(7, 'b', ymd(END, -1), { sentiment: 'negativo' }),
    ];
    const out = buildOpenIssues(input(rows, [meta('a', 'Feria de empleo en Mayagüez'), meta('b', 'Denuncia por filas del PAN')]));
    expect(out.issues.map((i) => [i.narrativeIds[0], i.score])).toEqual([['b', 14], ['a', 10]]);
  });

  test('abierto exige 5 menciones en la semana y una en los últimos 3 días', () => {
    const rows = [
      ...many(4, 'pocas', END),
      ...many(9, 'viejas', ymd(END, -5)), // dentro de la semana, pero nada en los últimos 3 días
      ...many(5, 'justas', ymd(END, -2)),
    ];
    const out = buildOpenIssues(input(rows, [meta('pocas', 'Uno'), meta('viejas', 'Dos'), meta('justas', 'Tres')]));
    expect(out.issues.map((i) => i.narrativeIds[0])).toEqual(['justas']);
    expect(out.openCount).toBe(1);
  });

  test('un asunto que vuelve tras más de 14 días sin menciones cuenta desde su regreso', () => {
    const rows = [
      ...many(20, 'luma', '2025-05-22'),
      ...many(8, 'luma', ymd(END, -4)),
      ...many(4, 'luma', END),
    ];
    const [issue] = buildOpenIssues(input(rows, [meta('luma', 'González rechaza aumento tarifario LUMA')])).issues;
    expect(issue).toMatchObject({ openSince: ymd(END, -4), firstEverDay: '2025-05-22', daysOpen: 5, reopened: true, stage: 'rising' });
  });

  test('etapa «baja» con su % negativo intacto: menos volumen no es mejora', () => {
    const rows = [
      ...many(30, 'n', ymd(END, -10), { sentiment: 'negativo' }),
      ...many(10, 'n', ymd(END, -8)),
      ...many(9, 'n', ymd(END, -1), { sentiment: 'negativo' }),
      ...many(3, 'n', END),
    ];
    const [issue] = buildOpenIssues(input(rows, [meta('n', 'Senado investiga viaje a España')])).issues;
    expect(issue).toMatchObject({ week: 12, prevWeek: 40, stage: 'falling', negPct: 75 });
  });

  test('un cajón de cuentas propias no es un asunto', () => {
    // Activo en 10 semanas, con las menciones repartidas: ninguna ventana de 14 días llega al 30 %.
    const rows = Array.from({ length: 10 }, (_, w) => many(6, 'cajon', ymd(END, -7 * w), {
      author: 'Departamento de la Familia', domain: 'facebook.com', page_type: 'facebook',
    })).flat();
    const out = buildOpenIssues(input(rows, [meta('cajon', 'Publicaciones del Departamento en redes sociales')], [], 20));
    expect(out.issues).toEqual([]);
    expect(out.openCount).toBe(0);
    expect(out.coverage).toEqual({ weekTotal: 20, inIssues: 0, pct: 0 });
  });

  test('muestra hasta 3 y dice cuántos hay abiertos', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const rows = ids.flatMap((id, i) => many(6 + i, id, END));
    const out = buildOpenIssues(input(rows, ids.map((id, i) => meta(id, `Asunto distinto número ${i}`))));
    expect(out.issues).toHaveLength(3);
    expect(out.issues.map((i) => i.narrativeIds[0])).toEqual(['e', 'd', 'c']);
    expect(out.openCount).toBe(5);
  });

  test('sin narrativas: bloque vacío y cobertura sin base', () => {
    const out = buildOpenIssues(input([], []));
    expect(out).toMatchObject({ issues: [], openCount: 0, coverage: { weekTotal: 0, inIssues: 0, pct: null } });
    expect(out.agency).toMatchObject({ short: 'DF', article: 'el DF' });
  });

  test('lo publicado después de la fecha no cuenta (regenerar un correo pasado)', () => {
    const rows = [...many(6, 'n', ymd(END, -1)), ...many(50, 'n', ymd(END, 2), { sentiment: 'negativo' })];
    const [issue] = buildOpenIssues(input(rows, [meta('n', 'Demanda Coccoloba contra Familia')])).issues;
    expect(issue).toMatchObject({ week: 6, negWeek: 0, lastDay: ymd(END, -1) });
  });
});

describe('buildSustainedLevel', () => {
  const series = (days: number, perDay: Partial<SustainedDailyPoint>): SustainedDailyPoint[] =>
    Array.from({ length: days }, (_, i) => ({ date: ymd(END, -i), negative: 0, neutral: 0, positive: 0, ...perDay }));

  test('nivel sostenido: 14 y 28 días por encima de 30 % negativo', () => {
    const lvl = buildSustainedLevel(series(28, { negative: 13, neutral: 6, positive: 1 }), END);
    expect(lvl.d14).toMatchObject({ days: 14, startYmd: ymd(END, -13), endYmd: END, total: 280, negPct: 65, nss: -60, overNegPct: true, underNss: true });
    expect(lvl.d28).toMatchObject({ days: 28, startYmd: ymd(END, -27), total: 560, negPct: 65, nss: -60 });
    expect(lvl.sustained).toBe(true);
    expect(lvl.thresholds).toEqual({ negPct: 30, nss: -20, minBase: SUSTAINED_MIN_BASE });
  });

  test('la semana baja de volumen y el nivel no cambia', () => {
    // 21 días con 100 menciones y 7 con 10, siempre 60 % negativas.
    const s = [
      ...Array.from({ length: 7 }, (_, i) => ({ date: ymd(END, -i), negative: 6, neutral: 4, positive: 0 })),
      ...Array.from({ length: 21 }, (_, i) => ({ date: ymd(END, -7 - i), negative: 60, neutral: 40, positive: 0 })),
    ];
    const lvl = buildSustainedLevel(s, END);
    expect(lvl.d14.negPct).toBe(60);
    expect(lvl.d28.negPct).toBe(60);
    expect(lvl.sustained).toBe(true);
  });

  test('una ventana alta y la otra no: no es sostenido', () => {
    const s = [
      ...Array.from({ length: 14 }, (_, i) => ({ date: ymd(END, -i), negative: 5, neutral: 5, positive: 0 })),
      ...Array.from({ length: 14 }, (_, i) => ({ date: ymd(END, -14 - i), negative: 0, neutral: 40, positive: 0 })),
    ];
    const lvl = buildSustainedLevel(s, END);
    expect(lvl.d14).toMatchObject({ negPct: 50, overNegPct: true });
    expect(lvl.d28).toMatchObject({ negPct: 10, overNegPct: false });
    expect(lvl.sustained).toBe(false);
  });

  test('el borde exacto del umbral cuenta', () => {
    const lvl = buildSustainedLevel(series(28, { negative: 3, neutral: 6, positive: 1 }), END);
    expect(lvl.d14).toMatchObject({ negPct: 30, nss: -20, overNegPct: true, underNss: true });
    expect(lvl.sustained).toBe(true);
  });

  test('el redondeo no decide: 29.6 % se muestra 30 % pero no pasa el umbral', () => {
    // 8 negativas de 27 por día = 29.63 %.
    const lvl = buildSustainedLevel(series(28, { negative: 8, neutral: 19, positive: 0 }), END);
    expect(lvl.d14).toMatchObject({ negPct: 30, overNegPct: false });
    expect(lvl.sustained).toBe(false);
  });

  test('base insuficiente: no hay nivel ni veredicto', () => {
    const lvl = buildSustainedLevel([{ date: END, negative: 20, neutral: 9, positive: 0 }], END);
    expect(lvl.d14).toMatchObject({ total: 29, enoughBase: false, negPct: null, nss: null, overNegPct: null, underNss: null });
    expect(lvl.sustained).toBeNull();
  });

  test('días sin menciones cuentan como cero y lo de fuera de la ventana no entra', () => {
    const s = [
      { date: ymd(END, 1), negative: 500, neutral: 0, positive: 0 }, // posterior a la fecha
      { date: END, negative: 10, neutral: 30, positive: 0 },
      { date: ymd(END, -20), negative: 0, neutral: 60, positive: 0 },
      { date: ymd(END, -28), negative: 500, neutral: 0, positive: 0 }, // un día antes de la ventana de 28
    ];
    const lvl = buildSustainedLevel(s, END);
    expect(lvl.d14).toMatchObject({ total: 40, negPct: 25 });
    expect(lvl.d28).toMatchObject({ total: 100, negPct: 10 });
    expect(sustainedSeriesStart(END)).toBe(ymd(END, -27));
  });
});
