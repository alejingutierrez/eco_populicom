import { compose, type ComposerLlm, type ComposerLlmRequest } from '@eco/shared';
import { fixtureInput } from '../../packages/shared/src/composer/test-fixtures';
import { planDailyText } from '../lambda/weekly-report/composer-mode';
import { compositionStatus, type StoredComposition } from '../lambda/weekly-report/compositions-store';
import {
  composeWithDeadline,
  draftToDailyText,
  evaluateStoredComposition,
  isSendableComposition,
  trimGroups,
} from '../lambda/weekly-report/daily-composer';

/**
 * Orquestación del diario con el motor (WP-6) con LLM simulado: composición
 * guardada fresca / re-rellenada / vieja, plazo del motor, y caída al legacy
 * cuando Bedrock falla. Ningún camino deja el correo sin texto.
 */
const FINDINGS = {
  threads: [{ id: 't1', what: 'Usuarios preguntaron por la panadería', evidence: ['D1'], kind: 'reaccion_tardia_a_publicacion_anterior', origin_day: 'lunes 26 de octubre' }],
  week: { negative: [], neutral: [], positive: [] },
};
const DRAFT = {
  headline: 'Comentarios tardíos a la publicación del lunes 26 dominaron el domingo',
  paragraph: 'El domingo hubo {{day_total}} menciones. Varios usuarios preguntaron por la panadería.',
  highlights: ['Un usuario preguntó la dirección.'],
  insights: { negative: [], neutral: ['La serie del Mes de la Manufactura concentró la semana.'], positive: [] },
};
const fast = { sleep: async () => {}, backoffMs: 0 };

function llmOk(): { llm: ComposerLlm; calls: ComposerLlmRequest[] } {
  const calls: ComposerLlmRequest[] = [];
  return {
    calls,
    llm: {
      async invokeTool(req) {
        calls.push(req);
        if (req.role === 'analyst') return FINDINGS;
        if (req.role === 'writer' || req.role === 'corrector') return DRAFT;
        return { defects: [] };
      },
    },
  };
}

const WINDOW = { startYmd: '2026-10-26', endYmd: '2026-11-01', prevStartYmd: '2026-10-19', prevEndYmd: '2026-10-25' };

async function storedFrom(input = fixtureInput()): Promise<StoredComposition> {
  const r = await compose('daily', input, { llm: llmOk().llm, dryRun: true, ...fast });
  return { agencyId: 'ag', reportType: 'daily', periodEnd: '2026-11-01', composerVersion: r.composition.composerVersion, composition: r.composition, status: compositionStatus(r.composition), createdAt: null };
}

describe('composición guardada vs datos del envío', () => {
  test('sin cambios en las cifras citadas: fresh, mismo texto', async () => {
    const stored = await storedFrom();
    const ev = evaluateStoredComposition(stored, fixtureInput(), WINDOW);
    expect(ev.state).toBe('fresh');
    expect(ev.final?.paragraph).toBe('El domingo hubo 64 menciones. Varios usuarios preguntaron por la panadería.');
  });

  test('una llegada tardía mueve la cifra citada: se re-rellena por código', async () => {
    const stored = await storedFrom();
    const later = fixtureInput();
    later.dailySeries = later.dailySeries.map((d) => (d.date === '2026-11-01' ? { ...d, neutral: d.neutral + 2 } : d));
    const ev = evaluateStoredComposition(stored, later, WINDOW);
    expect(ev.state).toBe('refreshable');
    expect(ev.changed.day_total).toEqual([64, 66]);
    expect(ev.final?.paragraph).toBe('El domingo hubo 66 menciones. Varios usuarios preguntaron por la panadería.');
    expect(ev.final?.headline).toBe(DRAFT.headline);
  });

  test('cambio grande: stale (recomponer); otra ventana o degradada: missing', async () => {
    const stored = await storedFrom();
    const big = fixtureInput();
    big.dailySeries = big.dailySeries.map((d) => (d.date === '2026-11-01' ? { ...d, negative: d.negative + 40 } : d));
    expect(evaluateStoredComposition(stored, big, WINDOW).state).toBe('stale');
    expect(evaluateStoredComposition(stored, fixtureInput(), { ...WINDOW, endYmd: '2026-11-02' }).state).toBe('missing');
    expect(evaluateStoredComposition({ ...stored, status: 'degraded' }, fixtureInput(), WINDOW).state).toBe('missing');
    expect(evaluateStoredComposition(null, fixtureInput(), WINDOW).state).toBe('missing');
  });
});

describe('plazo y fallos del motor', () => {
  test('el motor que no termina a tiempo devuelve timedOut (el caller manda el legacy)', async () => {
    const never = (() => new Promise(() => {})) as unknown as typeof compose;
    const t = await composeWithDeadline(fixtureInput(), { llm: null, dryRun: true, deadlineMs: 20, compose: never });
    expect(t).toMatchObject({ result: null, timedOut: true });
  });

  test('Bedrock caído: compose no lanza, el texto no es enviable y el plan cae al legacy', async () => {
    const down: ComposerLlm = { invokeTool: async () => { throw new Error('ThrottlingException'); } };
    const t = await composeWithDeadline(fixtureInput(), { llm: down, dryRun: true, deadlineMs: 5_000, options: fast });
    expect(t.timedOut).toBe(false);
    expect(t.result).not.toBeNull();
    expect(isSendableComposition(t.result!.composition)).toBe(false);
    expect(compositionStatus(t.result!.composition)).toBe('degraded');
    expect(t.result!.composition.errors.join(' ')).toMatch(/ThrottlingException/);
    // Con la composición degradada guardada, el envío no la usa: compone o va el legacy.
    const stored: StoredComposition = { agencyId: 'ag', reportType: 'daily', periodEnd: '2026-11-01', composerVersion: 'x', composition: t.result!.composition, status: 'degraded', createdAt: null };
    const ev = evaluateStoredComposition(stored, fixtureInput(), WINDOW);
    expect(ev.state).toBe('missing');
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: ev.state, remainingMs: 100_000 }).text).toBe('legacy');
  });

  test('motor sano: 4 o menos llamadas (analista, redactor, QA y corrector si hace falta)', async () => {
    const { llm, calls } = llmOk();
    const t = await composeWithDeadline(fixtureInput(), { llm, dryRun: true, deadlineMs: 5_000, options: fast });
    expect(isSendableComposition(t.result!.composition)).toBe(true);
    expect(calls.map((c) => c.role)).toEqual(['analyst', 'writer', 'qa']);
  });
});

describe('forma del texto para el render', () => {
  test('el titular va en texto plano y se recortan viñetas e insights', () => {
    const t = draftToDailyText({
      headline: 'La <strong>Fortaleza</strong>  pidió   datos',
      paragraph: ' Hubo <strong>64</strong> menciones. ',
      highlights: ['a', 'b', '', 'c', 'd', 'e'],
      insights: { negative: ['x', 'y', 'z'], neutral: [], positive: [' p '] },
    });
    expect(t.headline).toBe('La Fortaleza pidió datos');
    expect(t.paragraph).toBe('Hubo <strong>64</strong> menciones.');
    expect(t.highlights).toEqual(['a', 'b', 'c', 'd']);
    expect(t.insights).toEqual({ negative: ['x', 'y'], neutral: [], positive: ['p'] });
  });

  test('trimGroups corta por el final y conserva la numeración', () => {
    const s = fixtureInput().samples;
    const cut = trimGroups(s, 2);
    expect(cut.today.map((x) => x.sid)).toEqual(['D1', 'D2']);
    expect(cut.negative).toHaveLength(1);
  });
});
