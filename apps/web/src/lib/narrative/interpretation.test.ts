/**
 * INT-01 · WP-3 y WP-4: lo que recibe el redactor (hechos, contexto, reglas),
 * los detectores de «variación sin nivel» y los bloques del Diario y el
 * Semanal. Viven en `@eco/shared`; las pruebas están aquí porque el CI solo
 * corre el jest de apps/web.
 */
import {
  buildFactPackage, buildLintContext, buildPromptContext, buildSustainedLevel, codeLint, compose, COMPOSER_PROFILES,
  COMPOSER_PROMPT_VERSION, COMPOSER_VERSION, directionLevelDefects, enforceLevelRules, findCalming, formatDelta, interpretationContext,
  interpretationMethodologyNote, isVariationMarker, issueStageText, issueVoiceText, openIssueFacts, openIssuesSection,
  renderDailyReportHtml, renderWeeklySummaryHtml, splitSentences, sustainedLevelBox, sustainedLevelFacts, sustainedLevelText,
  type ComposerInput, type ComposerLlm, type ComposerLlmRequest, type DailyReportRenderData, type Draft, type OpenIssue,
  type OpenIssuesResult, type SustainedLevel, type WeeklySummaryRenderData,
} from '@eco/shared';

const END = '2026-10-23';
const ymd = (k: number) => new Date(Date.parse(`${END}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

/** DF al 23-oct: 65 % de negativas en las dos ventanas (nivel sostenido). */
function level(neg = 13, neu = 6, pos = 1): SustainedLevel {
  return buildSustainedLevel(Array.from({ length: 28 }, (_, i) => ({ date: ymd(-i), negative: neg, neutral: neu, positive: pos })), END);
}
const SUSTAINED = level();
const CALM = level(2, 16, 2); // 10 % de negativas: no sostenido

function issue(over: Partial<OpenIssue> = {}): OpenIssue {
  return {
    id: 'issue-n1', name: 'Escándalo contratos ADSEF', lead: null, narrativeIds: ['n1', 'n2'],
    week: 290, prevWeek: 89, negWeek: 212, posWeek: 1, negPct: 73,
    openSince: '2026-09-28', firstEverDay: '2026-09-28', daysOpen: 26, reopened: false, lastDay: END,
    stage: 'rising',
    voice: { key: 'jayfonseca', label: 'Jay Fonseca', basis: 'interactions', value: 18113, total: 46339, sharePct: 39, mentions: 6, media: false },
    voices: 87, score: 502, ...over,
  };
}
function issues(list: OpenIssue[] = [issue()], over: Partial<OpenIssuesResult> = {}): OpenIssuesResult {
  return {
    agency: { slug: 'df', name: 'Departamento de la Familia', short: 'DF', article: 'el DF' },
    asOf: END,
    windows: { week: { from: ymd(-6), to: END }, prevWeek: { from: ymd(-13), to: ymd(-7) } },
    issues: list, openCount: list.length,
    coverage: { weekTotal: 1048, inIssues: 424, pct: 40 },
    thresholds: { minWeek: 5, recentDays: 3, gapDays: 14, max: 3 },
    ...over,
  };
}

const EMPTY_SAMPLES = { today: [], negative: [], neutral: [], positive: [], droppedByThreadCap: { today: 0, negative: 0, neutral: 0, positive: 0 } };
function input(over: Partial<ComposerInput> = {}): ComposerInput {
  return {
    agency: { id: 'ag', name: 'Departamento de la Familia', shortName: 'DF' },
    window: { startYmd: ymd(-6), endYmd: END, prevStartYmd: ymd(-13), prevEndYmd: ymd(-7), timeZone: 'America/Puerto_Rico' },
    totals: { negative: 680, neutral: 360, positive: 5, total: 1045 },
    prevTotals: { negative: 331, neutral: 230, positive: 4, total: 565 },
    dailySeries: [
      { date: ymd(-6), negative: 57, neutral: 40, positive: 0 },
      { date: ymd(-5), negative: 27, neutral: 28, positive: 0 },
      { date: ymd(-4), negative: 49, neutral: 34, positive: 0 },
      { date: ymd(-3), negative: 138, neutral: 73, positive: 1 },
      { date: ymd(-2), negative: 209, neutral: 71, positive: 1 },
      { date: ymd(-1), negative: 125, neutral: 80, positive: 2 },
      { date: END, negative: 75, neutral: 34, positive: 1 },
    ],
    samples: EMPTY_SAMPLES,
    ...over,
  };
}

// ------------------------------------------------------------------ hechos

describe('hechos de nivel y de asuntos', () => {
  test('nivel: % de negativas, NSS con signo, total y umbral; la etiqueta dice que es un nivel', () => {
    const f = Object.fromEntries(sustainedLevelFacts(SUSTAINED).map((x) => [x.id, x]));
    expect(f.level_14_neg_pct).toMatchObject({ value: 65, display: '65 %' });
    expect(f.level_14_neg_pct.label).toMatch(/NIVEL a 14 días/);
    expect(f.level_14_neg_pct.label).toMatch(/no una variación/);
    expect(f.level_28_nss).toMatchObject({ value: -60, display: '−60' });
    expect(f.level_28_total).toMatchObject({ value: 560 });
    expect(f.level_threshold_neg_pct).toMatchObject({ value: 30, display: '30 %' });
    expect(f.level_threshold_nss).toMatchObject({ value: -20, display: '−20' });
  });

  test('una ventana sin base no aporta hechos; sin ninguna, tampoco el umbral', () => {
    const thin = buildSustainedLevel([{ date: END, negative: 5, neutral: 5, positive: 0 }], END);
    expect(sustainedLevelFacts(thin)).toEqual([]);
    expect(sustainedLevelFacts(null)).toEqual([]);
  });

  test('asuntos: días abierto, semana, previa, % negativas, voces y voz; el nombre va en la etiqueta', () => {
    const f = Object.fromEntries(openIssueFacts(issues()).map((x) => [x.id, x]));
    expect(f.issue_1_days_open).toMatchObject({ value: 26, display: '26' });
    expect(f.issue_1_days_open.label).toBe('días que lleva abierto el asunto «Escándalo contratos ADSEF» (desde el lunes 28 de septiembre)');
    expect(f.issue_1_week.value).toBe(290);
    expect(f.issue_1_prev.value).toBe(89);
    expect(f.issue_1_neg_pct.display).toBe('73 %');
    expect(f.issue_1_voices.value).toBe(87);
    expect(f.issue_1_voice_share.label).toMatch(/de las interacciones .* Jay Fonseca/);
  });

  test('sin voz dominante no hay hecho de voz; un asunto reabierto lo dice en la etiqueta', () => {
    const f = Object.fromEntries(openIssueFacts(issues([issue({ voice: null, reopened: true })])).map((x) => [x.id, x]));
    expect(f.issue_1_voice_share).toBeUndefined();
    expect(f.issue_1_days_open.label).toMatch(/volvió tras más de 14 días sin menciones/);
  });

  test('el paquete de hechos no cambia si el caller no trae nivel ni asuntos', () => {
    const base = buildFactPackage(input());
    expect(Object.keys(base.facts).some((k) => k.startsWith('level_') || k.startsWith('issue_'))).toBe(false);
    const withAll = buildFactPackage(input({ sustainedLevel: SUSTAINED, openIssues: issues() }));
    const added = Object.keys(withAll.facts).filter((k) => !(k in base.facts));
    expect(added.sort()).toEqual([
      'issue_1_days_open', 'issue_1_neg_pct', 'issue_1_prev', 'issue_1_voice_share', 'issue_1_voices', 'issue_1_week',
      'level_14_neg_pct', 'level_14_nss', 'level_14_total', 'level_28_neg_pct', 'level_28_nss', 'level_28_total',
      'level_threshold_neg_pct', 'level_threshold_nss',
    ]);
    for (const k of Object.keys(base.facts)) expect(withAll.facts[k]).toEqual(base.facts[k]);
  });

  test('«a 14 días» y «a 28 días» no son cifras sin fuente cuando hay nivel', () => {
    const pkg = buildFactPackage(input({ sustainedLevel: SUSTAINED }));
    const ctx = buildLintContext(pkg, EMPTY_SAMPLES);
    expect(codeLint('A 14 días el 65 % es negativo y a 28 días el 65 %.', 'párrafo', ctx)).toEqual([]);
    const without = buildLintContext(buildFactPackage(input()), EMPTY_SAMPLES);
    expect(codeLint('A 28 días sigue igual.', 'párrafo', without).map((d) => d.quote)).toEqual(['28']);
  });
});

// ------------------------------------------------------------------ contexto y reglas

describe('contexto y reglas para los roles', () => {
  test('el contexto trae el veredicto ya calculado y los asuntos con sus marcadores', () => {
    const txt = interpretationContext(SUSTAINED, issues());
    expect(txt).toMatch(/NIVEL SOSTENIDO/);
    expect(txt).toMatch(/¿Nivel sostenido\? SÍ/);
    expect(txt).toMatch(/Menos menciones con el mismo % de negativas no es una mejora/);
    expect(txt).toMatch(/issue_1: «Escándalo contratos ADSEF» · abierto hace \{\{issue_1_days_open\}\} días \(desde el lunes 28 de septiembre\)/);
    expect(txt).toMatch(/voz que más lo empuja: Jay Fonseca \(\{\{issue_1_voice_share\}\} de las interacciones\)/);
    // Sin cifras propias: todo número va por marcador (salvo las ventanas y las reglas).
    expect(txt.replace(/\{\{[^}]+\}\}/g, '').match(/\d+ %/g)).toBeNull();
  });

  test('no sostenido, sin base y sin asuntos', () => {
    expect(interpretationContext(CALM, null)).toMatch(/¿Nivel sostenido\? NO/);
    expect(interpretationContext(null, issues([]))).toMatch(/Ninguno cumple la definición esta semana/);
    expect(interpretationContext(null, null)).toBe('');
  });

  test('el contexto llega a los prompts del diario, el semanal y el overview, antes de las muestras', () => {
    const inp = input({ sustainedLevel: SUSTAINED, openIssues: issues() });
    const pkg = buildFactPackage(inp);
    for (const id of ['daily', 'weekly', 'overview'] as const) {
      const ctx = buildPromptContext(COMPOSER_PROFILES[id], inp, pkg, EMPTY_SAMPLES);
      expect(ctx.header).toMatch(/\{\{level_14_neg_pct\}\} = 65 %/);
      expect(ctx.header).toMatch(/ASUNTOS ABIERTOS/);
      expect(COMPOSER_PROFILES[id].writerTask).toMatch(/NIVEL Y ASUNTOS/);
      expect(COMPOSER_PROFILES[id].qaTask).toMatch(/Nivel sostenido\? SÍ/);
      expect(COMPOSER_PROFILES[id].correctorTask).toMatch(/direccion_sin_nivel/);
    }
    // Los perfiles que no llevan la regla no cambian.
    expect(COMPOSER_PROFILES.light.writerTask).not.toMatch(/NIVEL Y ASUNTOS/);
  });

  test('las versiones del motor y de los prompts subieron', () => {
    expect(COMPOSER_VERSION).toBe('composer-1.1.0');
    expect(COMPOSER_PROMPT_VERSION).toBe('composer-prompts-v1.2');
  });
});

// ------------------------------------------------------------------ detectores

describe('directionLevelDefects', () => {
  const pkg = buildFactPackage(input({ sustainedLevel: SUSTAINED }));
  const ctx = { facts: pkg.facts, sustained: true as boolean | null };
  const draft = (over: Partial<Draft>): Draft => ({ headline: 'Coccoloba demandó a la secretaria', paragraph: '', highlights: [], ...over });
  const types = (d: Draft, c = ctx) => directionLevelDefects(d, c).map((x) => `${x.where}:${x.type}`);

  test('qué marcadores son una variación', () => {
    for (const id of ['day_delta_pct', 'day_delta_abs', 'week_total_delta_pct', 'week_neg_delta_abs', 'ind_crisis_delta', 'ind_nss_delta']) {
      expect(isVariationMarker(id)).toBe(true);
    }
    for (const id of ['day_total', 'week_neg_pct', 'topic_up_1_rise', 'topic_down_1_drop_pct', 'level_14_neg_pct', 'ind_nss', 'ind_nss_prev', 'issue_1_week']) {
      expect(isVariationMarker(id)).toBe(false);
    }
  });

  test('el caso del 24-oct: «el volumen bajó» con marcador y sin nivel', () => {
    const d = draft({ paragraph: 'El volumen del día bajó {{day_delta_pct}} respecto al jueves, pero {{day_neg}} de {{day_total}} menciones fueron negativas.' });
    expect(directionLevelDefects(d, ctx)).toEqual([{ where: 'párrafo', type: 'direccion_sin_nivel', quote: '{{day_delta_pct}}', severity: 'soft' }]);
  });

  test('con el nivel a 14 y 28 días en el mismo bloque no hay defecto; con uno solo, sí', () => {
    const ok = draft({ paragraph: 'El volumen bajó {{day_delta_pct}}. A 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}.' });
    expect(types(ok)).toEqual([]);
    const half = draft({ paragraph: 'El volumen bajó {{day_delta_pct}}; a 14 días el {{level_14_neg_pct}} es negativo.' });
    expect(types(half)).toEqual(['párrafo:direccion_sin_nivel']);
  });

  test('cada bloque se mira por separado: el nivel del párrafo no cubre una viñeta', () => {
    const d = draft({
      paragraph: 'Las negativas subieron {{week_neg_delta_pct}}; a 14 días van en {{level_14_neg_pct}} y a 28 en {{level_28_neg_pct}}.',
      highlights: ['Las menciones bajaron {{week_total_delta_abs}} contra la semana previa.'],
      insights: { negative: ['Carmelo Ríos pidió la renuncia de la secretaria.'], neutral: [], positive: [] },
    });
    expect(types(d)).toEqual(['viñeta 1:direccion_sin_nivel']);
  });

  test('un verbo de dirección sobre el volumen o el sentimiento cuenta aunque no haya marcador', () => {
    expect(types(draft({ highlights: ['Las menciones negativas cayeron a la mitad en dos días.'] }))).toEqual(['viñeta 1:direccion_sin_nivel']);
    // El mismo verbo sobre otra cosa no es una variación de la conversación.
    expect(types(draft({ highlights: ['El Senado bajó al hemiciclo la resolución sobre la secretaria.'] }))).toEqual([]);
    // Un movimiento de tópico no pide nivel.
    expect(types(draft({ highlights: ['El tópico «Head Start» tuvo {{topic_1}} notas esta semana.'] }))).toEqual([]);
  });

  test('con nivel sostenido, «va bajando», «se calma» o «mejora» se marcan también en el titular', () => {
    const d = draft({ headline: 'La controversia por los contratos va bajando', paragraph: 'La conversación sobre la secretaria se calma.' });
    expect(types(d)).toEqual(['titular:mejora_con_nivel_sostenido', 'párrafo:mejora_con_nivel_sostenido']);
    // Sin nivel sostenido esas frases no son un defecto de nivel.
    expect(types(d, { facts: pkg.facts, sustained: false })).toEqual([]);
  });

  test('las frases ambiguas solo cuentan si el bloque habla de la conversación', () => {
    expect(findCalming('La mejora salarial de Head Start quedó cancelada.')).toEqual([]);
    expect(findCalming('El tono de la conversación mejora.')).toEqual(['mejora']);
    expect(findCalming('La crítica mantiene una tendencia a la baja.')).toEqual(['tendencia a la baja']);
    expect(findCalming('La controversia pierde fuerza.')).toEqual(['pierde fuerza']);
  });

  test('sin hechos de nivel en el paquete no se marca nada (el motor se comporta como antes)', () => {
    const plain = buildFactPackage(input());
    const d = draft({ headline: 'La controversia va bajando', paragraph: 'El volumen bajó {{day_delta_pct}}.' });
    expect(directionLevelDefects(d, { facts: plain.facts, sustained: undefined })).toEqual([]);
  });
});

// ------------------------------------------------------------------ orquestación

describe('compose con nivel y asuntos', () => {
  const FINDINGS = { threads: [], week: { negative: [], neutral: [], positive: [] } };
  const BAD: Draft = {
    headline: 'Coccoloba demandó a la secretaria por los contratos',
    paragraph: 'El volumen del día bajó {{day_delta_pct}} respecto al jueves.',
    highlights: [], insights: { negative: [], neutral: [], positive: [] },
  };
  const GOOD: Draft = {
    ...BAD,
    paragraph: 'El volumen del día bajó {{day_delta_pct}} respecto al jueves; a 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}. El asunto lleva {{issue_1_days_open}} días abierto.',
  };
  function mock(handlers: Partial<Record<ComposerLlmRequest['role'], () => unknown>>) {
    const calls: ComposerLlmRequest[] = [];
    const llm: ComposerLlm = { async invokeTool(req) { calls.push(req); return handlers[req.role]!(); } };
    return { llm, calls };
  }
  const fast = { sleep: async () => {}, backoffMs: 0 };
  const inp = () => input({ sustainedLevel: SUSTAINED, openIssues: issues() });

  test('una variación sin nivel manda el borrador al corrector, que la arregla', async () => {
    const { llm, calls } = mock({ analyst: () => FINDINGS, writer: () => BAD, qa: () => ({ defects: [] }), corrector: () => GOOD });
    const r = await compose('daily', inp(), { llm, ...fast });
    expect(calls.map((c) => c.role)).toEqual(['analyst', 'writer', 'qa', 'corrector']);
    expect(r.composition.qa.code).toEqual([{ where: 'párrafo', type: 'direccion_sin_nivel', quote: '{{day_delta_pct}}', severity: 'soft' }]);
    expect(calls[3].user).toMatch(/direccion_sin_nivel/);
    expect(r.final.paragraph).toBe('El volumen del día bajó -47 % respecto al jueves; a 14 días el 65 % de las menciones es negativo y a 28 días el 65 %. El asunto lleva 26 días abierto.');
    expect(r.composition.warnings).toEqual([]);
    expect(r.composition.residualCodeProblems).toEqual([]);
    expect(r.composition.composerVersion).toBe('composer-1.1.0');
  });

  test('si el corrector no lo arregla, el código añade el nivel y lo deja archivado', async () => {
    const { llm } = mock({ analyst: () => FINDINGS, writer: () => BAD, qa: () => ({ defects: [] }), corrector: () => BAD });
    const r = await compose('daily', inp(), { llm, ...fast });
    expect(r.final.paragraph).toBe('El volumen del día bajó -47 % respecto al jueves. A 14 días el 65 % de las menciones es negativo y a 28 días el 65 %.');
    expect(r.composition.warnings).toEqual([]);
    expect(r.composition.residualCodeProblems).toEqual([]);
    // El borrador del corrector se archiva tal cual; el antes y el después, en el registro.
    expect(r.composition.draft2Raw!.paragraph).toBe(BAD.paragraph);
    expect(r.composition.safetyNetLog).toEqual([{
      action: 'nivel_añadido', where: 'párrafo', text: BAD.paragraph,
      after: 'El volumen del día bajó {{day_delta_pct}} respecto al jueves. A 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}.',
      reasons: [{ where: 'párrafo', type: 'direccion_sin_nivel', quote: '{{day_delta_pct}}', severity: 'soft' }],
    }]);
  });

  test('si el corrector deja una frase de calma con nivel sostenido, el código la quita', async () => {
    const calm: Draft = { ...GOOD, paragraph: `${GOOD.paragraph} La conversación va bajando.` };
    const { llm } = mock({ analyst: () => FINDINGS, writer: () => calm, qa: () => ({ defects: [] }), corrector: () => calm });
    const r = await compose('daily', inp(), { llm, ...fast });
    expect(r.final.paragraph).not.toMatch(/va bajando/);
    expect(r.final.paragraph).toMatch(/a 14 días el 65 %/);
    expect(r.composition.warnings).toEqual([]);
    expect(r.composition.safetyNetLog.map((l) => l.action)).toEqual(['frase_removida']);
  });

  test('con el nivel desde el primer borrador no corre el corrector', async () => {
    const { llm, calls } = mock({ analyst: () => FINDINGS, writer: () => GOOD, qa: () => ({ defects: [] }) });
    const r = await compose('daily', inp(), { llm, ...fast });
    expect(calls.map((c) => c.role)).toEqual(['analyst', 'writer', 'qa']);
    expect(r.composition.correctorRan).toBe(false);
  });
});

// ------------------------------------------------------------------ red de seguridad de nivel

describe('enforceLevelRules', () => {
  const pkg = buildFactPackage(input({ sustainedLevel: SUSTAINED }));
  const ctx = { facts: pkg.facts, sustained: true as boolean | null };
  const draft = (over: Partial<Draft>): Draft => ({ headline: 'Coccoloba demandó a la secretaria', paragraph: '', highlights: [], ...over });

  test('Gobernadora, 22-nov-2026: el corrector metió la variación contra el viernes sin el nivel', () => {
    // Párrafo real que dejó el corrector (con marcadores), recortado tras la tercera oración.
    const paragraph = 'El sábado 21 de noviembre fue el día con menos actividad de la semana, con {{day_total}} menciones frente a las {{prev_day_total}} del viernes 20 ({{day_delta_pct}}) y las {{peak_total}} del pico del jueves 19. La mayor parte de la conversación retomó temas de días anteriores, aunque también circularon nuevos anuncios. <strong>Jay Fonseca</strong> siguió difundiendo una encuesta que muestra empate técnico entre la gobernadora y Thomas Rivera Schatz.';
    const d = draft({ paragraph });
    expect(directionLevelDefects(d, ctx).map((x) => x.type)).toEqual(['direccion_sin_nivel']);
    const r = enforceLevelRules(d, ctx);
    // El nivel va justo después de la oración que cita la variación, no al final.
    expect(r.draft.paragraph).toBe(paragraph.replace(
      'del pico del jueves 19. ',
      'del pico del jueves 19. A 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}. ',
    ));
    expect(directionLevelDefects(r.draft, ctx)).toEqual([]);
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ action: 'nivel_añadido', where: 'párrafo', text: paragraph, after: r.draft.paragraph });
    // Es determinista: aplicarla otra vez no cambia nada (el re-relleno del lambda depende de eso).
    expect(enforceLevelRules(r.draft, ctx)).toEqual({ draft: r.draft, log: [] });
  });

  test('DF, 23-nov-2026: «aumento salarial» en el nombre de un asunto no es una variación', () => {
    // Viñeta 2 real: el aviso era un falso positivo.
    const real = 'Una nota de prensa recogió que la OATRH advirtió que no procede el alza salarial para Roig si regresa a ASSMCA. Esa nota es la mención más reciente del asunto rastreado como «Suzanne Roig aumento salarial Assmca», que lleva {{issue_2_days_open}} días abierto con {{issue_2_week}} menciones en la semana; Jay Fonseca concentra {{issue_2_voice_share}} de las interacciones.';
    const d = draft({ highlights: ['WKAQ 580 republicó el domingo un resumen.', real] });
    expect(directionLevelDefects(d, ctx)).toEqual([]);
    expect(enforceLevelRules(d, ctx)).toEqual({ draft: d, log: [] });
    // Sin tilde, «aumento» y «bajo» son sustantivo y preposición; con tilde siguen siendo el verbo.
    expect(directionLevelDefects(draft({ highlights: ['El aumento de sueldo dominó las menciones bajo el sello de la OATRH.'] }), ctx)).toEqual([]);
    expect(directionLevelDefects(draft({ highlights: ['El volumen de menciones aumentó tras la vista.'] }), ctx).map((x) => x.quote)).toEqual(['aumentó']);
    // Un verbo dentro de un nombre citado tampoco cuenta.
    expect(directionLevelDefects(draft({ highlights: ['El asunto «Sube la luz» tuvo {{issue_1_week}} menciones.'] }), ctx)).toEqual([]);
  });

  test('un verbo sin marcador en una viñeta: se añade el nivel y la viñeta queda cerrada con punto', () => {
    const d = draft({ highlights: ['Las menciones negativas cayeron a la mitad en dos días'] });
    const r = enforceLevelRules(d, ctx);
    expect(r.draft.highlights).toEqual(['Las menciones negativas cayeron a la mitad en dos días. A 14 días el {{level_14_neg_pct}} de las menciones es negativo y a 28 días el {{level_28_neg_pct}}.']);
    expect(directionLevelDefects(r.draft, ctx)).toEqual([]);
  });

  test('si ya cita uno de los dos niveles, solo se añade el que falta', () => {
    const d = draft({ paragraph: 'El volumen bajó {{day_delta_pct}}; a 14 días el {{level_14_neg_pct}} es negativo.' });
    const r = enforceLevelRules(d, ctx);
    expect(r.draft.paragraph).toBe('El volumen bajó {{day_delta_pct}}; a 14 días el {{level_14_neg_pct}} es negativo. A 28 días el {{level_28_neg_pct}} de las menciones es negativo.');
    expect(directionLevelDefects(r.draft, ctx)).toEqual([]);
  });

  test('frase de calma con nivel sostenido: sale la oración; el titular queda vacío para la red', () => {
    const d = draft({
      headline: 'La controversia se calma tras la vista',
      paragraph: 'El Senado citó a la secretaria. La conversación va bajando desde el martes. Jay Fonseca publicó el contrato.',
    });
    const r = enforceLevelRules(d, ctx);
    expect(r.draft.headline).toBe('');
    expect(r.draft.paragraph).toBe('El Senado citó a la secretaria. Jay Fonseca publicó el contrato.');
    expect(directionLevelDefects(r.draft, ctx)).toEqual([]);
    expect(r.log.map((l) => `${l.where}:${l.action}`)).toEqual(['titular:frase_removida', 'párrafo:frase_removida']);
    // Sin nivel sostenido, la misma frase no se toca.
    const calmCtx = { facts: buildFactPackage(input({ sustainedLevel: CALM })).facts, sustained: false as boolean | null };
    expect(enforceLevelRules(d, calmCtx).draft.headline).toBe(d.headline);
  });

  test('sin hechos de nivel en el paquete no hace nada', () => {
    const d = draft({ paragraph: 'El volumen bajó {{day_delta_pct}}.' });
    expect(enforceLevelRules(d, { facts: buildFactPackage(input({})).facts, sustained: null })).toEqual({ draft: d, log: [] });
  });
});

// ------------------------------------------------------------------ bloques del correo

describe('bloques del correo', () => {
  test('el nivel va con sus números y con el umbral, nunca como etiqueta sola', () => {
    expect(sustainedLevelText(SUSTAINED)).toBe('Nivel · 14 días: 65% negativo, NSS −60 · 28 días: 65% negativo, NSS −60 · umbral 30% y NSS −20');
    const html = sustainedLevelBox(SUSTAINED);
    expect(html).toMatch(/65% negativo<\/span> · NSS −60/);
    expect(html).toMatch(/umbral 30% negativo · NSS −20/);
    expect(html).not.toMatch(/sostenido/i);
    expect(sustainedLevelBox(null)).toBe('');
  });

  test('sin base suficiente lo dice en vez de dar un porcentaje', () => {
    const thin = buildSustainedLevel([{ date: END, negative: 5, neutral: 5, positive: 0 }], END);
    expect(sustainedLevelBox(thin)).toMatch(/14 días<\/span> base insuficiente \(10 menciones\)/);
  });

  test('cada asunto lleva días abierto, etapa con sus dos cifras, % de negativas y voz', () => {
    const i = issue();
    expect(issueStageText(i)).toBe('sube · 290 en 7 días · 89 en los 7 previos');
    expect(issueVoiceText(i)).toBe('Jay Fonseca · 39% de las interacciones · 87 voces');
    expect(issueVoiceText(issue({ voice: null, voices: 6 }))).toBe('sin voz dominante · 6 voces');
    const html = openIssuesSection(issues([i, issue({ id: 'b', name: 'Inglés obligatorio en Head Start', stage: 'falling', week: 20, prevWeek: 66, negPct: 5, daysOpen: 23, openSince: '2026-10-01', reopened: true, lead: { id: 'x', name: 'Cambios federales a Head Start', week: 12 } })], { openCount: 8 }), '02');
    expect(html).toMatch(/02 · Asuntos abiertos/);
    expect(html).toMatch(/Escándalo contratos ADSEF/);
    expect(html).toMatch(/26 días abierto/);
    expect(html).toMatch(/desde el 28 sep/);
    expect(html).toMatch(/73% negativas/);
    expect(html).toMatch(/baja · 20 en 7 días · 66 en los 7 previos/);
    expect(html).toMatch(/desde el 1 oct · reabierto/);
    expect(html).toMatch(/Lo más activo: Cambios federales a Head Start/);
    expect(html).toMatch(/40 de cada 100 menciones de los 7 días pertenecen a un asunto identificado · 8 asuntos abiertos en total/);
  });

  test('sin asuntos el bloque lo dice (no se omite); sin datos no hay bloque', () => {
    expect(openIssuesSection(issues([]), '02')).toMatch(/Sin asuntos abiertos esta semana/);
    expect(openIssuesSection(null, '02')).toBe('');
  });

  test('el nombre del asunto se escapa', () => {
    expect(openIssuesSection(issues([issue({ name: 'A <b>B</b> & C' })]), '02')).toMatch(/A &lt;b&gt;B&lt;\/b&gt; &amp; C/);
  });

  test('la nota de metodología explica el nivel y los asuntos', () => {
    const note = interpretationMethodologyNote(SUSTAINED, issues());
    expect(note).toMatch(/umbral fijo de 30% y −20/);
    expect(note).toMatch(/5 menciones o más en 7 días/);
    expect(interpretationMethodologyNote(null, null)).toBe('');
  });
});

describe('Diario y Semanal con los bloques', () => {
  const dd = (c: number, p: number) => formatDelta(c, p, { kind: 'percent', decimals: 0 });
  const DAILY: DailyReportRenderData = {
    agencyName: 'Departamento de la Familia', agencyShortName: 'DF', agencyKicker: 'DF · Departamento de la Familia',
    periodLabel: '17 – 23 oct 2026', updatedAtLabel: '24 oct, 6:00 a.m. AST',
    totals: { negative: 680, neutral: 360, positive: 5, total: 1045 },
    deltaVsPrev: { negative: 105, neutral: 57, positive: 25 },
    deltaDisplay: { negative: dd(680, 331), neutral: dd(360, 230), positive: dd(5, 4) },
    dailySeries: [{ date: END, dayLabel: 'vie 23', negative: 75, neutral: 34, positive: 1 }],
    topicsTable: [{ topic: 'Gestión de la Secretaria', subtopics: '', total: 500, secondaryCount: 0, negative: 400, neutral: 100, positive: 0 }],
    insights: { negative: ['Carmelo Ríos pidió la renuncia de la secretaria.'], neutral: [], positive: [] },
    dailySummary: { label: 'Resumen del día · 23 oct', headline: 'Coccoloba demandó a la secretaria', paragraph: 'Texto.', highlights: [] },
  };
  const labels = (html: string) => Array.from(html.matchAll(/>(\d\d) · (\p{L}[^<·]+)/gu), (m) => `${m[1]} ${m[2].trim()}`);

  test('Diario sin interpretación: la numeración y las secciones de siempre', () => {
    const html = renderDailyReportHtml(DAILY);
    expect(labels(html)).toEqual(['01 Resumen del día', '02 Tendencia día a día', '03 Insights', '04 Tópicos']);
    expect(html).not.toMatch(/Asuntos abiertos|Nivel de negatividad/);
  });

  test('Diario con el motor: nivel bajo las lecturas y asuntos tras el resumen', () => {
    const html = renderDailyReportHtml({ ...DAILY, interpretation: { insightsWindowLabel: 'últimos 7 días', methodologyNote: 'Nota base.', sustainedLevel: SUSTAINED, openIssues: issues() } });
    expect(labels(html)).toEqual(['01 Resumen del día', '02 Asuntos abiertos', '03 Tendencia día a día', '04 Insights', '05 Tópicos']);
    // El nivel queda entre las lecturas y el reparto, que son los dos grupos de variaciones.
    const iLevel = html.indexOf('Nivel de negatividad'), iDist = html.indexOf('Menciones · 7 días vs 7 previos'), iSummary = html.indexOf('01 · Resumen del día');
    expect(iLevel).toBeGreaterThan(0);
    expect(iLevel).toBeLessThan(iDist);
    expect(iDist).toBeLessThan(iSummary);
    expect(html).toMatch(/Nota base\. El nivel de negatividad es/);
  });

  test('Diario con el motor pero sin datos de INT-01 (carga fallida): sale sin los bloques', () => {
    const html = renderDailyReportHtml({ ...DAILY, interpretation: { methodologyNote: 'Nota base.', sustainedLevel: null, openIssues: null } });
    expect(labels(html)).toEqual(['01 Resumen del día', '02 Tendencia día a día', '03 Insights', '04 Tópicos']);
    expect(html).not.toMatch(/Asuntos abiertos|Nivel de negatividad/);
  });

  const wd = (c: number, p: number) => formatDelta(c, p, { kind: 'percent', decimals: 0 });
  const WEEKLY: WeeklySummaryRenderData = {
    agencyName: 'Departamento de la Familia', agencyShortName: 'DF', agencyKicker: 'DF · Departamento de la Familia',
    weekLabel: '17 – 23 oct 2026', prevWeekLabel: '10 – 16 oct 2026', updatedAtLabel: '23 oct, 3:00 p.m. AST',
    totals: { negative: 680, neutral: 360, positive: 5, total: 1045 },
    prevTotals: { negative: 331, neutral: 230, positive: 4, total: 565 },
    totalDelta: wd(1045, 565),
    sentimentDelta: { negative: wd(680, 331), neutral: wd(360, 230), positive: wd(5, 4) },
    weeklyHeadline: 'El Senado pidió documentos a la secretaria', weeklySummary: 'Texto.', highlights: ['Las menciones subieron.'],
    topicsCompare: [],
  } as WeeklySummaryRenderData;

  test('Semanal sin interpretación: sin bloques nuevos', () => {
    const html = renderWeeklySummaryHtml(WEEKLY);
    expect(html).not.toMatch(/Asuntos abiertos|Nivel de negatividad/);
    expect(labels(html).slice(0, 2)).toEqual(['01 La semana en un vistazo', '02 Semana vs semana']);
  });

  test('Semanal con el motor: asuntos tras el vistazo y nivel bajo la tabla de comparación', () => {
    const html = renderWeeklySummaryHtml({ ...WEEKLY, interpretation: { windowLabel: '17 – 23 oct 2026', sustainedLevel: SUSTAINED, openIssues: issues() } });
    expect(labels(html).slice(0, 3)).toEqual(['01 La semana en un vistazo', '02 Asuntos abiertos', '03 Semana vs semana']);
    const iTable = html.indexOf('03 · Semana vs semana'), iLevel = html.indexOf('Nivel de negatividad', iTable), iNext = html.indexOf('04 ·');
    expect(iLevel).toBeGreaterThan(iTable);
    expect(iLevel).toBeLessThan(iNext);
    expect(html).toMatch(/26 días abierto/);
  });
});

describe('splitSentences', () => {
  test('una inicial o un tratamiento no cierran la oración', () => {
    expect(splitSentences('La empresa y el agrónomo Christian W. Torres presentaron una demanda. El Lcdo. Pérez la firmó. ¿Y luego? Nada.')).toEqual([
      'La empresa y el agrónomo Christian W. Torres presentaron una demanda.', 'El Lcdo. Pérez la firmó.', '¿Y luego?', 'Nada.',
    ]);
  });
  test('una oración que termina en sigla de una letra sigue siendo un caso raro: no se parte', () => {
    expect(splitSentences('Hubo 3 notas. Otra oración.')).toEqual(['Hubo 3 notas.', 'Otra oración.']);
  });
});
