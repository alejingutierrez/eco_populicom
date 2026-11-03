import {
  buildFactPackage,
  buildLintContext,
  codeLint,
  compose,
  dowInTimeZone,
  fillPlaceholders,
  formatDelta,
  formatMetric,
  hourInTimeZone,
  type ComposerLlm,
  type ComposerLlmRequest,
} from '@eco/shared';
import { fixtureInput } from '../../packages/shared/src/composer/test-fixtures';
import { isWeeklyComposeAheadDue, planDailyText } from '../lambda/weekly-report/composer-mode';
import { compositionStatus, type StoredComposition } from '../lambda/weekly-report/compositions-store';
import { composeWithDeadline, evaluateStoredComposition, isSendableComposition } from '../lambda/weekly-report/daily-composer';
import {
  buildWeeklyExtraFacts,
  draftToWeeklyText,
  numberFromDisplay,
  shareHasComments,
  topicMoves,
  weeklyExtraContext,
  type WeeklyIndicator,
} from '../lambda/weekly-report/weekly-composer';

/**
 * Correo semanal con el motor (WP-7): paquete comparativo (indicadores,
 * tópicos que suben, bajan, nuevos y sin menciones, variaciones sin signo),
 * composición anticipada del viernes y caída al legacy. LLM simulado.
 */
const CLOCK = { hourInTimeZone, dowInTimeZone };
const TZ = 'America/Puerto_Rico';
const WEEKLY = { enabled: true, dow: 5, hourLocal: 15 };

describe('composición anticipada del semanal', () => {
  test('viernes 1:00 PM PR (17:00Z) dispara el semanal de las 3:00 PM; otras horas no', () => {
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T17:00:00Z'), TZ, WEEKLY, 'agentic', CLOCK)).toBe(true);
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T17:00:00Z'), TZ, WEEKLY, 'shadow', CLOCK)).toBe(true);
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T19:00:00Z'), TZ, WEEKLY, 'agentic', CLOCK)).toBe(false);
    // 4 AM PR del viernes es la composición del DIARIO, no la del semanal.
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T08:00:00Z'), TZ, WEEKLY, 'agentic', CLOCK)).toBe(false);
    // Jueves a la 1 PM no.
    expect(isWeeklyComposeAheadDue(new Date('2026-11-05T17:00:00Z'), TZ, WEEKLY, 'agentic', CLOCK)).toBe(false);
  });

  test('legacy o semanal apagado: nunca', () => {
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T17:00:00Z'), TZ, WEEKLY, 'legacy', CLOCK)).toBe(false);
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T17:00:00Z'), TZ, { ...WEEKLY, enabled: false }, 'agentic', CLOCK)).toBe(false);
  });

  test('envío a la 1 AM del viernes: compone el jueves a las 11 PM (cruza el día)', () => {
    const early = { enabled: true, dow: 5, hourLocal: 1 };
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T03:00:00Z'), TZ, early, 'agentic', CLOCK)).toBe(true); // jue 23:00 PR
    expect(isWeeklyComposeAheadDue(new Date('2026-11-06T05:00:00Z'), TZ, early, 'agentic', CLOCK)).toBe(false); // vie 1:00 PR = envío
  });
});

describe('tópicos que suben, bajan, nuevos y sin menciones', () => {
  const cur = [
    { topic: 'A', total: 50, negative: 5 },
    { topic: 'B', total: 10, negative: 1 },
    { topic: 'C', total: 8, negative: 0 },
    { topic: 'D', total: 2, negative: 0 },
    { topic: 'F', total: 31, negative: 0 },
  ];
  const prev = [
    { topic: 'A', total: 30, negative: 3 },
    { topic: 'B', total: 25, negative: 2 },
    { topic: 'D', total: 1, negative: 0 },
    { topic: 'E', total: 12, negative: 4 },
    { topic: 'F', total: 30, negative: 0 },
    { topic: 'G', total: 2, negative: 0 },
  ];
  test('umbral de 3 menciones y orden por magnitud', () => {
    const m = topicMoves(cur, prev);
    expect(m.up).toEqual([{ topic: 'A', cur: 50, prev: 30 }]);
    expect(m.down).toEqual([{ topic: 'B', cur: 10, prev: 25 }]);
    expect(m.fresh).toEqual([{ topic: 'C', cur: 8, prev: 0 }]);
    expect(m.gone).toEqual([{ topic: 'E', cur: 0, prev: 12 }]);
  });

  test('hechos de tópicos: sin signo, % solo con base previa ≥ 30, nombre en la etiqueta', () => {
    const facts = buildWeeklyExtraFacts({
      totals: { negative: 5, neutral: 80, positive: 15, total: 100 },
      prevTotals: { negative: 4, neutral: 100, positive: 16, total: 120 },
      indicators: [], topics: cur, prevTopics: prev,
    });
    const by = Object.fromEntries(facts.map((f) => [f.id, f]));
    expect(by.topic_up_1).toMatchObject({ value: 50, display: '50' });
    expect(by.topic_up_1_rise).toMatchObject({ value: 20, display: '20' });
    expect(by.topic_up_1_rise_pct).toMatchObject({ value: 67, display: '67 %' });
    expect(by.topic_down_1_drop).toMatchObject({ value: 15 });
    expect(by.topic_down_1_drop_pct).toBeUndefined(); // base previa 25 < 30
    expect(by.topic_new_1.label).toMatch(/«C».*no tuvo menciones la semana previa/);
    expect(by.topic_gone_1_prev).toMatchObject({ value: 12 });
    expect(by.topic_1_prev).toMatchObject({ value: 30 }); // A (primer tópico de la semana)
    // Variaciones de la semana sin signo (reemplazan las del paquete base), con la dirección en la etiqueta.
    expect(by.week_total_delta_abs).toMatchObject({ value: 20, display: '20' });
    expect(by.week_total_delta_abs.label).toMatch(/MENOS/);
    expect(by.week_total_delta_pct).toMatchObject({ value: 17, display: '17 %' });
    expect(by.week_total_delta_pct.label).toMatch(/CAÍDA/);
    expect(by.week_neg_delta_pct).toBeUndefined(); // base previa 4
    expect(by.week_neg_delta_abs).toMatchObject({ value: 1 });
    expect(by.week_neg_delta_abs.label).toMatch(/MÁS/);
    expect(by.prev_week_neu_pct).toMatchObject({ value: 83, display: '83 %' });
  });
});

describe('indicadores compuestos en escala pública', () => {
  const indicators: WeeklyIndicator[] = [
    { key: 'crisis', label: 'Riesgo de crisis', cur: formatMetric('crisis', 0.12).value, prev: formatMetric('crisis', 0.15).value, delta: formatDelta(12, 15, { kind: 'absolute', decimals: 0, suffix: ' pts', invert: true }) },
    { key: 'nss', label: 'Sentimiento neto', cur: formatMetric('nss', -3.14).value, prev: formatMetric('nss', 9).value, delta: formatDelta(-3.14, 9, { kind: 'absolute', decimals: 1 }) },
    { key: 'bhi', label: 'Salud de marca', cur: formatMetric('bhi', 0.6).value, prev: formatMetric('bhi', 0.5).value, delta: formatDelta(6.4, 5.5, { kind: 'absolute', decimals: 1, suffix: '' }) },
    { key: 'polarization', label: 'Polarización', cur: null, prev: null, delta: null },
  ];

  test('numberFromDisplay entiende el menos tipográfico y la escala', () => {
    expect(numberFromDisplay('−3.1')).toBe(-3.1);
    expect(numberFromDisplay('+12%')).toBe(12);
    expect(numberFromDisplay('6.4 / 10')).toBe(6.4);
    expect(numberFromDisplay(null)).toBeNull();
    expect(numberFromDisplay('—')).toBeNull();
  });

  test('el texto rellenado con los marcadores ind_* pasa el lint (sin cifras sin fuente)', () => {
    const input = fixtureInput();
    input.extraFacts = buildWeeklyExtraFacts({ totals: input.totals, prevTotals: input.prevTotals!, indicators, topics: [], prevTopics: [] });
    const pkg = buildFactPackage(input);
    expect(pkg.facts.ind_crisis).toMatchObject({ display: '12%', value: 12 });
    expect(pkg.facts.ind_crisis_delta).toMatchObject({ display: '3 pts', value: 3 });
    expect(pkg.facts.ind_crisis_delta.label).toMatch(/BAJÓ/);
    // El paquete base trae week_total_delta_pct con signo; el semanal lo reemplaza sin signo.
    expect(pkg.facts.week_total_delta_pct.display).not.toMatch(/^[+\-−]/);
    expect(pkg.facts.ind_nss).toMatchObject({ display: '−3.1', value: -3.1 });
    expect(pkg.facts.ind_bhi).toMatchObject({ display: '6.4 / 10', value: 6.4 });
    expect(pkg.facts.ind_polarization).toBeUndefined();
    const ctx = buildLintContext(pkg, input.samples);
    const text = fillPlaceholders('El riesgo de crisis bajó {{ind_crisis_delta}} a {{ind_crisis}}; la Salud de marca quedó en {{ind_bhi}} y el sentimiento neto bajó {{ind_nss_delta}}, a {{ind_nss}}.', pkg.facts);
    expect(text).toBe('El riesgo de crisis bajó 3 pts a 12%; la Salud de marca quedó en 6.4 / 10 y el sentimiento neto bajó 12.1, a −3.1.');
    expect(codeLint(text, 'párrafo', ctx)).toEqual([]);
  });

  test('el contexto no trae cifras y avisa si no hay comentarios en redes propias', () => {
    const moves = topicMoves([{ topic: 'A', total: 50, negative: 0 }, { topic: 'B', total: 40, negative: 0 }], [{ topic: 'A', total: 30, negative: 0 }, { topic: 'B', total: 20, negative: 0 }]);
    const c = weeklyExtraContext({ hasComments: false, moves });
    expect(c.replace(/\{\{[^}]+\}\}/g, '').replace(/topic_[a-z]+_\d(_prev)?/g, '')).not.toMatch(/\d/);
    expect(c).toMatch(/no hubo comentarios/);
    expect(c).toMatch(/SUBEN al menos tres menciones \(dos\): topic_up_1 «A», topic_up_2 «B»/);
    expect(c).toMatch(/BAJAN al menos tres menciones \(ninguno\): ninguno/);
    expect(weeklyExtraContext({ hasComments: true, moves })).toMatch(/comment_share_prev_week/);
  });

  test('chip: solo si alguna semana redondea a más de 0 %', () => {
    expect(shareHasComments({ week: { total: 100, comments: 0 }, prevWeek: { total: 100, comments: 0 } })).toBe(false);
    expect(shareHasComments({ week: { total: 100, comments: 83 }, prevWeek: { total: 100, comments: 40 } })).toBe(true);
    expect(shareHasComments({ week: { total: 0, comments: 0 }, prevWeek: { total: 100, comments: 40 } })).toBe(false);
  });
});

// ------------------------------------------------------------------ orquestación con LLM simulado

const FINDINGS = {
  threads: [{ id: 't1', what: 'Usuarios preguntaron por la panadería', evidence: ['N1'], kind: 'reaccion_tardia_a_publicacion_anterior', origin_day: 'lunes 26 de octubre' }],
  week: { negative: [], neutral: [], positive: [] },
};
const DRAFT = {
  headline: 'Usuarios preguntaron por la panadería que el DDEC destacó el lunes 26',
  paragraph: 'La semana tuvo {{week_total}} menciones, {{week_total_delta_abs}} más que la previa.',
  highlights: ['Un usuario preguntó la dirección.'],
  insights: { negative: [], neutral: ['La serie del Mes de la Manufactura concentró la semana.'], positive: [] },
  comparison: ['Las menciones pasaron de {{prev_week_total}} a {{week_total}}.'],
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

function weeklyInput() {
  const input = fixtureInput();
  input.window = { ...input.window, dayYmd: null };
  input.extraFacts = buildWeeklyExtraFacts({ totals: input.totals, prevTotals: input.prevTotals!, indicators: [], topics: [], prevTopics: [] });
  return input;
}
const WINDOW = { startYmd: '2026-10-26', endYmd: '2026-11-01', prevStartYmd: '2026-10-19', prevEndYmd: '2026-10-25' };

describe('perfil weekly con plazo', () => {
  test('compone con el perfil weekly: comparación, sin muestras del día y con hechos sin signo', async () => {
    const { llm, calls } = llmOk();
    const t = await composeWithDeadline(weeklyInput(), { llm, dryRun: true, deadlineMs: 5_000, options: fast, profile: 'weekly' });
    const c = t.result!.composition;
    expect(c.profile).toBe('weekly');
    expect(isSendableComposition(c)).toBe(true);
    expect(calls.map((x) => x.role)).toEqual(['analyst', 'writer', 'qa']);
    // El perfil semanal no manda las muestras del día al prompt.
    expect(calls[0].user).not.toMatch(/MENCIONES MÁS RECIENTES DEL DÍA RESUMIDO/);
    expect(calls[0].user).toMatch(/\{\{week_total_delta_abs\}\} = \d+  \(menciones de (MÁS|MENOS) que el periodo previo/);
    expect(t.result!.subject).toMatch(/^\[Semanal\] /);
    const text = draftToWeeklyText(t.result!.final);
    expect(text.comparison).toHaveLength(1);
    expect(text.comparison[0]).toMatch(/^Las menciones pasaron de \d+ a \d+\.$/);
    expect(text.paragraph).not.toMatch(/\{\{/);
  });

  test('composición guardada del semanal: fresh, re-rellenada o stale con la red de seguridad de periodo', async () => {
    const r = await compose('weekly', weeklyInput(), { llm: llmOk().llm, dryRun: true, ...fast });
    const stored: StoredComposition = { agencyId: 'ag', reportType: 'weekly', periodEnd: '2026-11-01', composerVersion: r.composition.composerVersion, composition: r.composition, status: compositionStatus(r.composition), createdAt: null };
    expect(evaluateStoredComposition(stored, weeklyInput(), WINDOW, 'period').state).toBe('fresh');
    const later = weeklyInput();
    later.totals = { ...later.totals, neutral: later.totals.neutral + 2, total: later.totals.total + 2 };
    later.extraFacts = buildWeeklyExtraFacts({ totals: later.totals, prevTotals: later.prevTotals!, indicators: [], topics: [], prevTopics: [] });
    const ev = evaluateStoredComposition(stored, later, WINDOW, 'period');
    expect(ev.state).toBe('refreshable');
    expect(ev.final?.comparison?.[0]).toContain(`a ${later.totals.total}.`);
    const big = weeklyInput();
    big.totals = { ...big.totals, negative: big.totals.negative + 200, total: big.totals.total + 200 };
    expect(evaluateStoredComposition(stored, big, WINDOW, 'period').state).toBe('stale');
  });

  test('Bedrock caído: el semanal no es enviable y el plan cae al legacy', async () => {
    const down: ComposerLlm = { invokeTool: async () => { throw new Error('ThrottlingException'); } };
    const t = await composeWithDeadline(weeklyInput(), { llm: down, dryRun: true, deadlineMs: 5_000, options: fast, profile: 'weekly' });
    expect(isSendableComposition(t.result!.composition)).toBe(false);
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'missing', remainingMs: 100_000 }).text).toBe('legacy');
  });
});
