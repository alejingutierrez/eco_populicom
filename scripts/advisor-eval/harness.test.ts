import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeCouncilLLM } from '../../packages/shared/src/advisor/fake-llm';
import type { AdvisorLLM } from '../../packages/shared/src/advisor/llm';
import { expandCases, validateEpisodes } from '../../packages/shared/src/advisor/eval/episodes';
import { MeteredLLM } from '../../packages/shared/src/advisor/eval/metered';
import { VARIANT_IDS, type RunRecord } from '../../packages/shared/src/advisor/eval/types';
import { buildInputs, controlCases, dryRunFactSheets, gradeAll, runEvaluation, recordKey } from './harness';
import { preloadedRound0, runVariant } from './variants';
import { main, parseArgs, resolveSpend } from './run';
import example from './episodes.example.json';

const models = { fast: 'fast', main: 'main', deep: 'deep' };
const episodes = validateEpisodes(example).episodes;
const cases = expandCases(episodes);

describe('episodes.example.json', () => {
  test('es válido (forma) y NO pasa como set completo: es solo un ejemplo', () => {
    expect(validateEpisodes(example).ok).toBe(true);
    expect(validateEpisodes(example, { full: true }).ok).toBe(false);
  });
});

describe('variantes sobre una misma hoja de hechos (LLM simulado)', () => {
  test.each(VARIANT_IDS)('variante %s devuelve un registro uniforme y válido', async (v) => {
    const inp = await buildInputs(cases[0], dryRunFactSheets());
    const rec = await runVariant(v, inp, 0, { llm: fakeCouncilLLM().llm, models, retryBaseMs: 0 });
    expect(rec.error).toBeUndefined();
    expect(rec).toMatchObject({ variant: v, status: 'done', caseId: cases[0].caseId, rep: 0 });
    expect(rec.memo).toHaveProperty('recomendacion');
    expect(rec.calls.length).toBeGreaterThan(0);
    expect(rec.calls[0].usage).toHaveProperty('cacheRead');
    expect(rec.seenIds).toContain('M-48213');
    expect(rec.citations.total).toBeGreaterThan(0);
    // Modelos de prueba sin precio: el costo es null y NO se estima.
    expect(rec.costUsd).toBeNull();
    expect(rec.unpricedCalls).toBe(rec.calls.length);
  });

  test('número de llamadas por variante (estructura de cada una)', async () => {
    const inp = await buildInputs(cases[0], dryRunFactSheets());
    const n = async (v: 'a' | 'a2' | 'b' | 'c') => (await runVariant(v, inp, 0, { llm: fakeCouncilLLM().llm, models, retryBaseMs: 0 })).calls.length;
    expect(await n('a')).toBe(4); // 3 partes del memorando + 1 posición con rangos
    expect(await n('a2')).toBe(16); // (3 + 1) × 3 muestras + (3 + 1) síntesis
    expect(await n('c')).toBe(20); // 6 + 1 + 3 + 6 + 3 + 1
    // El panel no gasta ronda 0: 3 posiciones + DA + 3 partes del memorando
    expect(await n('b')).toBe(7);
  });

  test('el panel usa la hoja compartida: ninguna petición con herramientas llega al LLM real', async () => {
    const inner = fakeCouncilLLM();
    const inp = await buildInputs(cases[0], dryRunFactSheets());
    const rec = await runVariant('b', inp, 0, { llm: inner.llm, models });
    expect(rec.status).toBe('done');
    expect(inner.calls.some((r) => r.tools)).toBe(false);
    expect(JSON.stringify(inner.calls[0].system)).toContain('Hay conversación en redes'); // la hoja compartida está en el prefijo
    // seenIds llegan al panel a través de la «herramienta» precargada
    expect(rec.citations.invalid).toBeLessThanOrEqual(rec.citations.total);
  });

  test('preloadedRound0 responde la ronda 0 sin tokens', async () => {
    const inner = fakeCouncilLLM().llm;
    const llm = preloadedRound0(inner, { x: 1 });
    const r1 = await llm.create({ model: 'm', effort: 'low', maxTokens: 1, tools: [], messages: [{ role: 'user', content: 'q' }] });
    expect(r1.stopReason).toBe('tool_use');
    const r2 = await llm.create({ model: 'm', effort: 'low', maxTokens: 1, tools: [], messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] }] });
    expect(r2.stopReason).toBe('end_turn');
    expect(r1.usage.output + r2.usage.output).toBe(0);
  });

  test('(b) y (c) dejan lo que el memorando DEBE traer: objeciones del DA y vetos', async () => {
    const inp = await buildInputs(cases[0], dryRunFactSheets());
    const c = await runVariant('c', inp, 0, { llm: fakeCouncilLLM().llm, models, retryBaseMs: 0 });
    expect(c.expected?.objeciones).toEqual(['C0-1', 'C0-2', 'C0-3', 'C1-1', 'C1-2', 'C1-3']);
    expect(c.expected?.vetos).toEqual(['V1', 'W1']); // el consejo cita los vetos por id (V ronda 1, W ronda 4)
    const a = await runVariant('a', inp, 0, { llm: fakeCouncilLLM().llm, models });
    expect(a.expected).toBeNull();
  });

  test('un fallo de validación de una variante queda registrado como error y no tumba la corrida', async () => {
    const llm: AdvisorLLM = { stream: async () => { throw new Error('x'); }, create: async () => { throw new Error('boom'); } };
    const inp = await buildInputs(cases[0], dryRunFactSheets());
    const rec = await runVariant('a', inp, 0, { llm, models });
    expect(rec).toMatchObject({ status: 'error', memo: null });
    expect(rec.error).toContain('boom');
  });
});

describe('ejecución con tope duro', () => {
  const opts = (over: Partial<Parameters<typeof runEvaluation>[0]> = {}) => ({
    cases: cases.slice(0, 2), variants: ['a', 'c'] as Array<'a' | 'c'>, reps: 1, llm: fakeCouncilLLM().llm, models, facts: dryRunFactSheets(), caps: null, retryBaseMs: 0, ...over,
  });

  test('--dry-run de punta a punta: todas las combinaciones, sin errores', async () => {
    const sum = await runEvaluation(opts({ variants: [...VARIANT_IDS], reps: 2 }));
    expect(sum.records).toHaveLength(2 * 4 * 2);
    expect(sum.records.every((r) => r.status === 'done')).toBe(true);
    expect(sum.stoppedByCap).toBeNull();
  });

  test('el tope de llamadas aborta TODA la ejecución y conserva lo ya hecho', async () => {
    const seen: RunRecord[] = [];
    const sum = await runEvaluation(opts({ caps: { maxUsd: 100, maxCalls: 6 }, onRecord: (r) => void seen.push(r) }));
    expect(sum.stoppedByCap).toContain('tope de llamadas');
    expect(sum.calls).toBeLessThanOrEqual(6);
    expect(sum.records.length).toBeLessThan(4);
    expect(seen).toEqual(sum.records);
  });

  test('el tope en USD cuenta solo llamadas con precio conocido', async () => {
    const llm = fakeCouncilLLM().llm;
    const m = new MeteredLLM(llm, { maxUsd: 0.0000001, maxCalls: 1000 });
    // Modelo con precio conocido (Sonnet): el segundo intento ya supera el tope.
    const req = { model: 'us.anthropic.claude-sonnet-5-5', effort: 'low' as const, maxTokens: 10, messages: [{ role: 'user' as const, content: 'x' }] };
    // el fake exige esquema; usamos Review para que no lance
    const { REVIEW_SCHEMA } = await import('../../packages/shared/src/advisor/schemas');
    await m.create({ ...req, outputSchema: REVIEW_SCHEMA as unknown as Record<string, unknown> });
    await expect(m.create({ ...req, outputSchema: REVIEW_SCHEMA as unknown as Record<string, unknown> })).rejects.toThrow('tope de gasto');
    // Opus sin precio: no suma al USD (lo cubre el tope de llamadas) y el costo total queda null.
    const o = new MeteredLLM(llm, { maxUsd: 0.0000001, maxCalls: 1000 });
    await o.create({ ...req, model: 'us.anthropic.claude-opus-5-5', outputSchema: REVIEW_SCHEMA as unknown as Record<string, unknown> });
    await o.create({ ...req, model: 'us.anthropic.claude-opus-5-5', outputSchema: REVIEW_SCHEMA as unknown as Record<string, unknown> });
    expect(o.spentUsd).toBe(0);
    expect(o.costUsd).toBeNull();
  });

  test('un precio verificado de Opus pasado por quien lo conoce sí entra al tope', async () => {
    const { REVIEW_SCHEMA } = await import('../../packages/shared/src/advisor/schemas');
    const o = new MeteredLLM(fakeCouncilLLM().llm, { maxUsd: 1e-9, maxCalls: 100 }, { 'opus-x': { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6, cacheWrite1h: 10 } });
    const req = { model: 'opus-x', effort: 'low' as const, maxTokens: 10, messages: [{ role: 'user' as const, content: 'x' }], outputSchema: REVIEW_SCHEMA as unknown as Record<string, unknown> };
    await o.create(req);
    await expect(o.create(req)).rejects.toThrow('tope de gasto');
    expect(o.costUsd).not.toBeNull();
  });

  test('reanudar: las corridas ya hechas se saltan', async () => {
    const first = await runEvaluation(opts());
    const skip = new Set(first.records.map(recordKey));
    const second = await runEvaluation(opts({ skip }));
    expect(second.records).toHaveLength(0);
  });

  test('un caso sin hoja de hechos queda como error, no como éxito falso', async () => {
    const sum = await runEvaluation(opts({ facts: async () => { throw new Error('falta la hoja de hechos'); } }));
    expect(sum.records.every((r) => r.status === 'error')).toBe(true);
  });
});

describe('control de contaminación', () => {
  test('los casos de control sustituyen los nombres en la pregunta y en la hoja', async () => {
    const ctl = controlCases(cases);
    expect(ctl.length).toBeGreaterThan(0);
    expect(ctl.every((c) => c.caseId.endsWith('~masked'))).toBe(true);
    expect(ctl[0].question.texto).not.toContain('Nombre Ejemplo');
    const inp = await buildInputs(ctl[0], async (c) => ({ factSheet: { pregunta_normalizada: 'salida de Nombre Ejemplo' }, seenIds: [] }));
    expect(JSON.stringify(inp.factSheet)).not.toContain('Nombre Ejemplo');
  });
});

describe('calificación por código sobre registros reales del flujo', () => {
  test('gradeAll resume por variante', async () => {
    const sum = await runEvaluation({ cases: cases.slice(0, 2), variants: [...VARIANT_IDS], reps: 1, llm: fakeCouncilLLM().llm, models, facts: dryRunFactSheets(), caps: null, retryBaseMs: 0 });
    const { grades, summary } = gradeAll(sum.records, episodes);
    expect(grades).toHaveLength(8);
    expect(summary.map((s) => s.variant)).toEqual(['a', 'a2', 'b', 'c']);
    for (const s of summary) {
      expect(s.completed).toBe(s.runs);
      expect(s.formatOkRate).toBe(1);
      expect(s.citeValidRate).toBeGreaterThan(0.5);
    }
    // sin precios verificados de Opus, el costo medio de (a′), (b) y (c) es n/d: no hay modelos con precio en este flujo
    expect(summary.find((s) => s.variant === 'c')!.unpricedRuns).toBe(2);
  });
});

describe('CLI', () => {
  const lines: string[] = [];
  const log = (s: string) => void lines.push(s);

  test('sin permiso explícito no corre nada', async () => {
    await expect(main(['run', '--episodes', 'x.json'], log)).rejects.toThrow('--dry-run');
    expect(() => resolveSpend(parseArgs(['run', '--confirm-spend']))).toThrow('--max-usd');
    expect(() => resolveSpend(parseArgs(['run', '--confirm-spend', '--max-usd', '0']))).toThrow('--max-usd');
    expect(() => resolveSpend(parseArgs(['run', '--dry-run', '--confirm-spend', '--max-usd', '5']))).toThrow('excluyentes');
    expect(resolveSpend(parseArgs(['run', '--confirm-spend', '--max-usd', '5'])).caps).toEqual({ maxUsd: 5, maxCalls: 300 });
    expect(resolveSpend(parseArgs(['run', '--dry-run'])).caps).toBeNull();
    const p = resolveSpend(parseArgs(['run', '--confirm-spend', '--max-usd', '5', '--opus-usd-per-mtok', '5,25']));
    expect(Object.values(p.prices)[0]).toMatchObject({ input: 5, output: 25 });
    expect(() => resolveSpend(parseArgs(['run', '--confirm-spend', '--max-usd', '5', '--opus-usd-per-mtok', 'x']))).toThrow('verificados');
  });

  test('el modo real sin hojas de hechos pide --fact-sheets antes de gastar', async () => {
    await expect(main(['run', '--episodes', join(__dirname, 'episodes.example.json'), '--allow-partial', '--confirm-spend', '--max-usd', '1'], log)).rejects.toThrow('--fact-sheets');
  });

  test('flujo completo en --dry-run: run → grade → export-packet → judge → decide', async () => {
    const out = mkdtempSync(join(tmpdir(), 'advisor-eval-'));
    const ep = join(__dirname, 'episodes.example.json');
    expect(await main(['run', '--episodes', ep, '--allow-partial', '--dry-run', '--reps', '1', '--out', out], log)).toBe(0);
    const records = join(out, 'records.jsonl');
    const recs = readFileSync(records, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as RunRecord);
    expect(recs).toHaveLength(5 * 4); // 5 casos del ejemplo × 4 variantes
    expect(recs.every((r) => r.status === 'done')).toBe(true);

    // segunda corrida con el mismo --out: reanuda sin duplicar
    await main(['run', '--episodes', ep, '--allow-partial', '--dry-run', '--reps', '1', '--out', out], log);
    expect(readFileSync(records, 'utf8').trim().split('\n')).toHaveLength(20);

    expect(await main(['grade', '--episodes', ep, '--allow-partial', '--records', records, '--out', out], log)).toBe(0);
    const summary = join(out, 'summary.json');
    expect(JSON.parse(readFileSync(summary, 'utf8'))).toHaveLength(4);

    expect(await main(['export-packet', '--records', records, '--seed', 'semilla', '--episodes', ep, '--allow-partial', '--out', out], log)).toBe(0);
    const keyFile = join(out, 'CLAVE-no-entregar.json');
    const key = JSON.parse(readFileSync(keyFile, 'utf8')) as Array<{ pairId: string; A: string; B: string; comparison: string }>;
    expect(key).toHaveLength(10); // 5 casos × 2 comparaciones
    expect(readdirSync(join(out, 'paquete'))).toHaveLength(10);
    const packetText = readdirSync(join(out, 'paquete')).map((f) => readFileSync(join(out, 'paquete', f), 'utf8')).join('\n');
    expect(packetText).not.toMatch(/consejo|panel|variante|a2|c_vs_a2|ejemplo-/i);
    expect(packetText).toContain('Pregunta que se le hizo al asesor');

    expect(await main(['judge', '--episodes', ep, '--allow-partial', '--records', records, '--dry-run', '--out', out], log)).toBe(0);
    expect(existsSync(join(out, 'judge.jsonl'))).toBe(true);

    // Hoja llenada por una consultora que SIEMPRE prefiere el lado de X.
    const rows = key.map((k) => {
      const xIsA = (k.comparison === 'c_vs_a2' ? 'c' : 'b') === k.A;
      return `${k.pairId},ana,,,,,${xIsA ? 'A' : 'B'},`;
    });
    const sheet = join(out, 'hoja-ana.csv');
    writeFileSync(sheet, ['pair_id,rater,utilidad,realismo_opciones,disenso_bien_recogido,claridad,preferencia,comentario', ...rows].join('\n'));
    lines.length = 0;
    expect(await main(['decide', '--summary', summary, '--key', keyFile, '--sheets', sheet, '--judge', join(out, 'judge.jsonl'), '--out', out], log)).toBe(0);
    const d = JSON.parse(readFileSync(join(out, 'decision.json'), 'utf8'));
    expect(d.margins.c_vs_a2.points).toBe(100);
    // Los registros del dry-run no traen rangos observados: no hay Brier, así que el consejo NO se decide.
    expect(d.decision.council).toBe('pendiente_datos');
    expect(d.decision.panel).toBe('panel_se_queda');
    expect(d.judgeMargins.c_vs_a2.points).toBe(0); // el juez simulado empata
    expect(lines.join('\n')).toContain('Panel: panel_se_queda');
  });

  test('subcomando desconocido → código 2', async () => {
    expect(await main(['nada'], log)).toBe(2);
  });
});
