import { aliasFor, expandCases, maskNames, validateEpisodes } from '@eco/shared/src/advisor/eval/episodes';
import {
  buildPairs, humanConsensus, interHumanKappa, judgePair, kappaBetween, makeBlindPacket, parseCsv, parseSheet,
  preferenceMargin, sheetTemplateCsv, validateJudge, JUDGE_SCHEMA, COMPARISONS, type BlindKeyRow, type Winner,
} from '@eco/shared/src/advisor/eval/pairwise';
import { renderMemoCanonical } from '@eco/shared/src/advisor/eval/render';
import { memoOf, resp } from '@eco/shared/src/advisor/fake-llm';
import type { AdvisorLLM } from '@eco/shared/src/advisor/llm';
import type { RunRecord, VariantId } from '@eco/shared/src/advisor/eval/types';

const ep = (id: string, over: Record<string, unknown> = {}) => ({
  id, agencySlug: 'ddecpr', titulo: `Episodio ${id}`, asOf: '2026-05-12T14:00:00-04:00', tags: [], bajaCoberturaNacional: true,
  control: { nombresSustituidos: false }, snapshotsV5: true,
  preguntas: [
    { id: `${id}-q1`, tipo: 'descriptiva', texto: '¿Qué está pasando con la conversación?' },
    { id: `${id}-q2`, tipo: 'decision_reversible', texto: '¿Debemos emitir un comunicado hoy?' },
  ], ...over,
});

describe('episodios', () => {
  test('un episodio válido pasa y se expande en casos', () => {
    const v = validateEpisodes([ep('e1')]);
    expect(v.ok).toBe(true);
    expect(expandCases(v.episodes).map((c) => c.caseId)).toEqual(['e1:e1-q1', 'e1:e1-q2']);
  });

  test('rechaza ids repetidos, asOf sin hora, tipos repetidos, V5 falso y preguntas fuera de 2–3', () => {
    const v = validateEpisodes([
      ep('e1'), ep('e1'),
      ep('e2', { asOf: '2026-05-12' }),
      ep('e3', { preguntas: [{ id: 'a', tipo: 'descriptiva', texto: 'Pregunta uno larga' }, { id: 'b', tipo: 'descriptiva', texto: 'Pregunta dos larga' }] }),
      ep('e4', { snapshotsV5: false }),
      ep('e5', { preguntas: [{ id: 'z', tipo: 'redaccion', texto: 'Solo una pregunta larga' }] }),
      ep('e6', { agencySlug: 'sgpr' }),
    ]);
    expect(v.ok).toBe(false);
    const msg = v.errors.join('\n');
    expect(msg).toContain('id repetido');
    expect(msg).toContain('asOf');
    expect(msg).toContain('tipo repetido');
    expect(msg).toContain('snapshotsV5');
    expect(msg).toContain('de 2 a 3 preguntas');
    expect(msg).toContain('agencySlug');
  });

  test('el set completo exige 20–30 episodios y los obligatorios del spec', () => {
    const few = validateEpisodes([ep('e1')], { full: true });
    expect(few.ok).toBe(false);
    expect(few.errors.join('\n')).toContain('de 20 a 30');
    expect(few.errors.join('\n')).toContain('renuncia-ddec-2026-05');
    expect(few.errors.join('\n')).toContain('familia-2026-10');
    const many = Array.from({ length: 22 }, (_, i) => ep(`e${i}`, i === 0 ? { tags: ['renuncia-ddec-2026-05'] } : i === 1 ? { tags: ['familia-2026-10'], agencySlug: 'df' } : {}));
    const ok = validateEpisodes(many, { full: true });
    expect(ok.ok).toBe(true);
    expect(ok.warnings.join('\n')).toContain('apagon-2025-04'); // opcional: solo aviso
  });

  test('control de nombres exige listar los nombres', () => {
    expect(validateEpisodes([ep('e1', { control: { nombresSustituidos: true } })]).errors.join('')).toContain('control.nombres');
  });
});

describe('control de contaminación', () => {
  test('alias estable: mismo nombre → mismo alias, sin depender del orden', () => {
    expect(aliasFor('Domingo Emanuelli')).toBe(aliasFor(' domingo emanuelli '));
    expect(aliasFor('Domingo Emanuelli')).not.toBe(aliasFor('Jenniffer González'));
  });
  test('sustituye nombre completo y apellido, respeta palabras que lo contienen', () => {
    const out = maskNames('Domingo Emanuelli renunció. Emanuelli dijo que Emanuellicitos no.', ['Domingo Emanuelli']);
    const alias = aliasFor('Domingo Emanuelli');
    expect(out).toBe(`${alias} renunció. ${alias} dijo que Emanuellicitos no.`);
    expect(out).not.toContain('Domingo');
  });
  test('es determinista entre corridas', () => {
    expect(maskNames('Ana Pérez habló', ['Ana Pérez'])).toBe(maskNames('Ana Pérez habló', ['Ana Pérez']));
  });
});

// ---- Pares, paquete ciego, hoja y juez --------------------------------------------------------

const rec = (variant: VariantId, caseId: string, rep: number, marker = ''): RunRecord => ({
  variant, caseId, episodeId: caseId.split(':')[0], rep, status: 'done',
  memo: { ...memoOf(2, 0, ['C0-1']), objeciones_da: [{ id: 'C0-1', texto: 'el titular lo pinta como encubrimiento', estado: 'mitigada', como: 'se publica la fecha' }], encabezado: { agencia: 'DDEC', fecha: 'hoy', camino: `variante ${variant}`, motivo: 'consejo de 6 asientos' }, limites: [`marca ${marker || variant}`] },
  calls: [], costUsd: null, unpricedCalls: 0, citations: { total: 0, invalid: 0 }, latencyMs: 1, expected: null, alarms: null, ranges: [], seenIds: [],
});

describe('render canónico', () => {
  test('no delata la variante ni la deliberación y no usa ids de objeción', () => {
    const txt = renderMemoCanonical(rec('c', 'e1:q1', 0).memo!);
    expect(txt).not.toMatch(/variante c|consejo de 6|C0-1/);
    expect(txt).toContain('## Recomendación');
    expect(txt).toContain('### Camino A');
  });
  test('mismas secciones en el mismo orden para dos memorandos', () => {
    const heads = (t: string) => t.split('\n').filter((l) => l.startsWith('## '));
    expect(heads(renderMemoCanonical(rec('c', 'e1:q1', 0).memo!))).toEqual(heads(renderMemoCanonical(rec('a2', 'e1:q1', 0).memo!)));
  });
});

describe('pares y paquete ciego', () => {
  const records = [
    ...['e1', 'e2', 'e3', 'e4'].flatMap((e) => [0, 1].flatMap((r) => (['c', 'a2', 'b', 'a'] as VariantId[]).map((v) => rec(v, `${e}:q1`, r)))),
    { ...rec('c', 'e5:q1', 0), status: 'error' as const, memo: null },
    rec('a2', 'e5:q1', 0),
  ];
  const pairs = buildPairs(records, COMPARISONS[0]);

  test('solo forma pares con las dos corridas completas', () => {
    expect(pairs).toHaveLength(8);
    expect(pairs.some((p) => p.caseId === 'e5:q1')).toBe(false);
  });

  test('paquete ciego determinista por semilla, orden y orientación mezclados, clave aparte', () => {
    const p1 = makeBlindPacket(pairs, 'semilla-1');
    const p2 = makeBlindPacket(pairs, 'semilla-1');
    const p3 = makeBlindPacket(pairs, 'semilla-2');
    expect(p1).toEqual(p2);
    expect(p3.key.map((k) => k.internalId)).not.toEqual(p1.key.map((k) => k.internalId));
    expect(new Set(p1.key.map((k) => k.A)).size + new Set(p1.key.map((k) => k.B)).size).toBeGreaterThan(2); // ambas orientaciones
    expect(JSON.stringify(p1.items)).not.toMatch(/"(?:variante|variant|key)"|c_vs_a2|e1:q1/);
    expect(p1.items.map((i) => i.pairId)).toEqual(p1.items.map((_, i) => `P${String(i + 1).padStart(3, '0')}`)); // ids opacos
    expect(p1.key.every((k) => k.internalId.startsWith('c_vs_a2:'))).toBe(true);
    expect(JSON.stringify(p1.items)).not.toMatch(/variante (?:c|a2)|consejo de 6/);
  });

  test('hoja de calificación: plantilla y lectura traducida con la clave', () => {
    const { items, key } = makeBlindPacket(pairs, 's');
    const tpl = sheetTemplateCsv(items.map((i) => i.pairId));
    expect(tpl.split('\n')[0]).toBe('pair_id,rater,utilidad,realismo_opciones,disenso_bien_recogido,claridad,preferencia,comentario');
    // Un consultor prefiere SIEMPRE el lado donde está X (el consejo).
    const rows = key.map((k) => `${k.pairId},ana,${k.A === 'c' ? 'A' : 'B'},,,,${k.A === 'c' ? 'A' : 'B'},"un, comentario"`);
    const { verdicts, errors } = parseSheet(['pair_id,rater,utilidad,realismo_opciones,disenso_bien_recogido,claridad,preferencia,comentario', ...rows].join('\n'), key);
    expect(errors).toEqual([]);
    expect(verdicts.every((v) => v.winner === 'X')).toBe(true);
    expect(verdicts[0].criteria.utilidad).toBeDefined();
  });

  test('la hoja reporta filas inválidas sin romperse', () => {
    const key: BlindKeyRow[] = [{ pairId: 'p1', internalId: 'x', A: 'c', B: 'a2', caseId: 'e1:q', episodeId: 'e1', comparison: 'c_vs_a2' }];
    const r = parseSheet('pair_id,rater,preferencia\np1,ana,Z\np9,ana,A\np1,,A\np1,ana,\n', key);
    expect(r.verdicts).toEqual([]);
    expect(r.errors).toHaveLength(3);
    expect(parseSheet('x,y\n1,2', key).errors[0]).toContain('pair_id');
  });

  test('parseCsv con comillas, comas y saltos', () => {
    expect(parseCsv('a,"b,c","d ""e"""\n1,2,3\r\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
  });
});

describe('agregación y kappa', () => {
  const W = (...w: Winner[]) => w;
  test('margen = %X − %Y con empates medios, SE agrupado por episodio', () => {
    const items = [
      { pairId: '1', episodeId: 'e1', winners: W('X') },
      { pairId: '2', episodeId: 'e1', winners: W('X') },
      { pairId: '3', episodeId: 'e2', winners: W('Y') },
      { pairId: '4', episodeId: 'e2', winners: W('empate') },
    ];
    const m = preferenceMargin(items);
    expect(m.points).toBeCloseTo(((2 * 0.625 - 1) * 100)); // X: 1+1+0+.5 = 2.5/4 → +25
    expect(m.xWins).toBe(2);
    expect(m.ties).toBe(1);
    expect(m.yWins).toBe(1);
    expect(m.episodes).toBe(2);
    expect(m.se).not.toBeNull();
  });
  test('varios consultores en un par se promedian; sin datos → null', () => {
    expect(preferenceMargin([{ pairId: '1', episodeId: 'e', winners: W('X', 'Y') }]).points).toBe(0);
    expect(preferenceMargin([]).points).toBeNull();
    expect(preferenceMargin([{ pairId: '1', episodeId: 'e', winners: [] }]).points).toBeNull();
  });
  test('kappa humano-humano y consenso', () => {
    const v = (rater: string, pairId: string, winner: Winner) => ({ rater, pairId, winner, side: 'A' as const, criteria: {} });
    const verdicts = [v('a', '1', 'X'), v('a', '2', 'Y'), v('a', '3', 'X'), v('b', '1', 'X'), v('b', '2', 'Y'), v('b', '3', 'X'), v('c', '1', 'Y'), v('c', '2', 'Y'), v('c', '3', 'X')];
    expect(interHumanKappa(verdicts.filter((x) => x.rater !== 'c')).kappa).toBe(1);
    expect(interHumanKappa(verdicts).pairsOfRaters).toBe(3);
    const cons = humanConsensus(verdicts);
    expect(cons.get('1')).toBe('X');
    expect(cons.get('2')).toBe('Y');
    expect(kappaBetween(cons, new Map([['1', 'X'], ['2', 'Y'], ['3', 'X']] as Array<[string, Winner]>)).kappa).toBe(1);
  });
});

describe('juez de lenguaje', () => {
  const judgeLLM = (pick: (call: number, prompt: string) => 'A' | 'B' | 'empate') => {
    let n = 0;
    const seen: unknown[] = [];
    const llm: AdvisorLLM = {
      stream: async () => { throw new Error('x'); },
      create: async (req) => {
        seen.push(req);
        const p = pick(n++, String(req.messages[0].content));
        return resp({ utilidad: p, realismo_opciones: p, disenso_bien_recogido: p, claridad: p, preferencia: p, razon: 'porque' });
      },
    };
    return { llm, seen };
  };
  const deps = (llm: AdvisorLLM) => ({ llm, model: 'deep' });

  test('esquema y validador', () => {
    expect(JUDGE_SCHEMA.required).toContain('preferencia');
    expect(validateJudge({ utilidad: 'A', realismo_opciones: 'B', disenso_bien_recogido: 'empate', claridad: 'A', preferencia: 'A', razon: 'x' })).not.toBeNull();
    expect(validateJudge({ preferencia: 'C' })).toBeNull();
  });

  test('si el juez prefiere a X en los dos órdenes, gana X', async () => {
    // X = «MEMO-X» aparece como A en el primer orden y como B en el segundo.
    const { llm } = judgeLLM((_, prompt) => (prompt.indexOf('MEMO-X') < prompt.indexOf('MEMO-Y') ? 'A' : 'B'));
    const v = await judgePair(deps(llm), 'pregunta', 'MEMO-X', 'MEMO-Y');
    expect(v).toMatchObject({ winner: 'X', flipped: false });
  });

  test('si el veredicto cambia con el orden (siempre «A»), es empate', async () => {
    const { llm } = judgeLLM(() => 'A');
    const v = await judgePair(deps(llm), 'p', 'x', 'y');
    expect(v).toMatchObject({ winner: 'empate', flipped: true });
  });

  test('empate en ambos órdenes es empate sin marca de cambio', async () => {
    const { llm } = judgeLLM(() => 'empate');
    expect(await judgePair(deps(llm), 'p', 'x', 'y')).toMatchObject({ winner: 'empate', flipped: false });
  });

  test('petición sin temperature ni tool_choice, con salida estructurada y modelo DEEP', async () => {
    const { llm, seen } = judgeLLM(() => 'empate');
    await judgePair(deps(llm), 'p', 'x', 'y');
    expect(seen).toHaveLength(2);
    for (const r of seen as Array<{ model: string; outputSchema: unknown }>) {
      expect(r.model).toBe('deep');
      expect(r.outputSchema).toBeDefined();
      expect(JSON.stringify(r)).not.toMatch(/temperature|tool_choice/);
    }
  });

  test('salida inválida dos veces → error explícito', async () => {
    const llm: AdvisorLLM = { stream: async () => { throw new Error('x'); }, create: async () => resp({ nope: 1 }) };
    await expect(judgePair(deps(llm), 'p', 'x', 'y')).rejects.toThrow('judge_invalid');
  });
});
