/**
 * eco-ai-tasks con el motor de redacción (WP-8): bandera, mapeos y
 * orquestación con un LLM simulado (sin DB ni Bedrock).
 */
import {
  composerEnabledFor,
  useComposerFor,
  composerDecisionFor,
  composedByWriter,
  parseComposerAgencies,
  sampleContextFromRow,
  overviewTextsFromDraft,
  normalizePeakLabels,
  metricValueFact,
  metricLightInput,
  periodComposerInput,
  composeOverview,
  composeLight,
  lightParagraph,
  METRIC_LIGHT_PROFILE,
  SAMPLE_CONTEXT_SQL,
  MAX_COMPOSER_WINDOW_DAYS,
  overviewModelsFor,
  MODELS,
} from '../lambda/ai-tasks/composer-surfaces';
import { annotateSamples, findVetoed, COMPOSER_VERSION, type ComposerLlm, type WeeklyAggregates } from '@eco/shared';

describe('bandera COMPOSER_WEB_AGENCIES', () => {
  it('vacía = nadie; slugs por coma; * = todas', () => {
    expect(parseComposerAgencies('').size).toBe(0);
    expect(composerEnabledFor('ddecpr', { env: '' })).toBe(false);
    expect(composerEnabledFor('ddecpr', { env: undefined as unknown as string })).toBe(!!process.env.COMPOSER_WEB_AGENCIES);
    expect(composerEnabledFor('DDECPR', { env: ' ddecpr , df' })).toBe(true);
    expect(composerEnabledFor('aaa', { env: 'ddecpr,df' })).toBe(false);
    expect(composerEnabledFor('aaa', { env: '*' })).toBe(true);
  });
  it('el payload de la web gana sobre la variable', () => {
    expect(composerEnabledFor('ddecpr', { env: '', override: true })).toBe(true);
    expect(composerEnabledFor('ddecpr', { env: 'ddecpr', override: false })).toBe(false);
  });
  it('ventanas de más de 31 días siguen en legacy', () => {
    expect(MAX_COMPOSER_WINDOW_DAYS).toBe(31);
    expect(useComposerFor('ddecpr', '2026-10-26', '2026-11-01', { env: 'ddecpr' })).toBe(true);
    expect(useComposerFor('ddecpr', '2026-10-02', '2026-11-01', { env: 'ddecpr' })).toBe(true);
    expect(useComposerFor('ddecpr', '2026-08-04', '2026-11-01', { env: 'ddecpr' })).toBe(false);
    expect(useComposerFor('ddecpr', '2025-11-02', '2026-11-01', { env: 'ddecpr' })).toBe(false);
    expect(useComposerFor('ddecpr', '2025-11-02', '2026-11-01', { override: true })).toBe(false);
  });
});

describe('decisión del motor por acción (banderas desalineadas)', () => {
  it('period-insights y metric-insight: solo el `composer` del payload decide', () => {
    for (const action of ['period-insights', 'metric-insight']) {
      // Lambda con la agencia en su variable y la web sin bandera (no manda `composer`): legacy.
      expect(composerDecisionFor(action, 'ddecpr', '2026-10-26', '2026-11-01', undefined, 'ddecpr')).toBe(false);
      expect(composerDecisionFor(action, 'ddecpr', '2026-10-26', '2026-11-01', false, '*')).toBe(false);
      expect(composerDecisionFor(action, 'ddecpr', '2026-10-26', '2026-11-01', true, '')).toBe(true);
      // La ventana máxima se respeta igual.
      expect(composerDecisionFor(action, 'ddecpr', '2026-08-04', '2026-11-01', true, '')).toBe(false);
    }
  });
  it('topic-descriptions (manual): la variable de entorno sigue valiendo', () => {
    expect(composerDecisionFor('topic-descriptions', 'ddecpr', '2026-10-03', '2026-11-01', undefined, 'ddecpr')).toBe(true);
    expect(composerDecisionFor('topic-descriptions', 'ddecpr', '2026-10-03', '2026-11-01', undefined, '')).toBe(false);
  });
});

describe('modelos del overview por largo de ventana', () => {
  it('analista con Sonnet desde 15 días; 7 días con los del laboratorio', () => {
    expect(overviewModelsFor('2026-10-26', '2026-11-01')).toEqual({});
    expect(overviewModelsFor('2026-10-02', '2026-11-01')).toEqual({ analyst: MODELS.sonnet });
  });
});

describe('contexto de muestras', () => {
  it('la consulta solo lee por id dentro de la agencia', () => {
    expect(SAMPLE_CONTEXT_SQL).toContain('m.id = ANY($2::uuid[])');
    expect(SAMPLE_CONTEXT_SQL).toContain('m.agency_id = $1');
    expect(SAMPLE_CONTEXT_SQL).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/);
  });
  it('fila → contexto: padre por parent_mention_id o por el resolvedor', () => {
    const c = sampleContextFromRow({
      id: 'c1', bw_guid: '123_456', url: 'https://facebook.com/123#channels_comment_456', pub_type: 'FACEBOOK',
      page_type: 'facebook', author: 'Usuario', title: 'Post de la agencia', snippet: 'Excelente',
      mention_kind: null, parent_mention_id: null, parent_published_at: null,
      p_id: 'p1', p_published_at: new Date('2026-10-26T14:00:00Z'), p_author: 'Agencia', p_text: '  Post   de la agencia ',
    });
    expect(c.parentMentionId).toBe('p1');
    expect(c.parentPublishedAt).toBe('2026-10-26T14:00:00.000Z');
    expect(c.parentText).toBe('Post de la agencia');
    expect(c.url).toContain('#channels_comment');
  });
});

describe('mapeos de salida', () => {
  it('overview: mismos topes y saneado que el camino legacy', () => {
    const t = overviewTextsFromDraft({
      headline: '<em>La agencia anunció un programa.</em>',
      paragraph: '<p>Uno <strong>dos</strong>.</p>',
      highlights: ['a', 'b', 'c', 'd', 'e'],
      insights: { negative: ['1', '2', '3', '4'], neutral: [], positive: ['<b>x</b>'] },
    });
    expect(t.headline).toBe('La agencia anunció un programa');
    expect(t.dailySummary).toBe('Uno <strong>dos</strong>.');
    expect(t.highlights).toHaveLength(4);
    expect(t.insights.negative).toHaveLength(3);
    expect(t.insights.positive).toEqual(['x']);
  });
  it('rótulos de picos: fuera los vetados, las cifras y las fechas no listadas', () => {
    const r = normalizePeakLabels({
      peak_labels: [
        { date: '2026-10-27', label: 'Anuncio de inversión en Aibonito' },
        { date: '2026-10-28', label: 'Se dispara la conversación' },
        { date: '2026-10-29', label: '37 críticas al secretario' },
        { date: '2026-10-30', label: 'No listado' },
      ],
      hero_index: 7,
    }, new Set(['2026-10-27', '2026-10-28', '2026-10-29']), 3);
    expect(r.labels).toEqual([{ date: '2026-10-27', label: 'Anuncio de inversión en Aibonito' }]);
    expect(r.dropped).toHaveLength(2);
    expect(r.heroIndex).toBeNull();
  });
  it('valor de la métrica en la escala de las tarjetas', () => {
    expect(metricValueFact('crisis', 0.564)[0]).toMatchObject({ id: 'kpi_value', value: 56, display: '56 %' });
    expect(metricValueFact('bhi', 0.5).map((f) => f.id)).toEqual(['kpi_value', 'kpi_scale_max']);
    expect(metricValueFact('nss', 12.34)[0]).toMatchObject({ value: 12.3, display: '+12.3' });
    expect(metricValueFact('polarization', 33.6)[0]).toMatchObject({ value: 34, display: '34 %' });
    expect(metricValueFact('volume', 647)[0]).toMatchObject({ value: 647 });
    expect(metricValueFact('crisis', null)).toEqual([]);
  });
});

// ------------------------------------------------------------------ orquestación

const SERIES = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
  .map((date, i) => ({ date, negative: 5 + i, neutral: 40, positive: 20 }));

const AGG: WeeklyAggregates = {
  periodStart: '2026-10-26', periodEnd: '2026-11-01', agencyName: 'Departamento de Desarrollo Económico y Comercio', agencyShortName: 'DDEC',
  totals: { negative: 56, neutral: 280, positive: 140, total: 476 },
  deltaVsPrevWeek: { negative: 10, neutral: 5, positive: -3 },
  dailySeries: SERIES,
  byTopic: [{ topic: 'Desarrollo Empresarial', subtopics: [], total: 300, negative: 20, neutral: 180, positive: 100 }],
  byMunicipality: [{ municipality: 'Aibonito', total: 40, negative: 2 }],
  topSources: [{ source: 'El Nuevo Día', mentions: 30 }],
  topEmotions: [{ emotion: 'alegría', count: 50 }],
};

function samples() {
  return annotateSamples({
    negative: [{ id: 'n1', createdAt: '2026-10-30T15:00:00Z', text: 'Un comerciante criticó la demora de los permisos.', sentiment: 'negative', author: 'Comerciante', pageType: 'twitter' }],
    neutral: [{ id: 'e1', createdAt: '2026-10-28T15:00:00Z', text: 'El DDEC anunció una inversión en Aibonito.', sentiment: 'neutral', author: 'El Nuevo Día', pageType: 'news' }],
    positive: [],
  });
}

function fakeLlm(byRole: Record<string, unknown>): ComposerLlm & { roles: string[] } {
  const roles: string[] = [];
  return {
    roles,
    invokeTool: async (r) => { roles.push(r.role); return byRole[r.role]; },
  };
}

describe('composeOverview con LLM simulado', () => {
  it('cifras por marcador; un vetado o una cifra sin fuente no sobreviven', async () => {
    const input = periodComposerInput(AGG, {
      agencyId: 'a', agencyName: AGG.agencyName, shortName: 'DDEC', prevStartYmd: '2026-10-19', prevEndYmd: '2026-10-25',
      prevTotals: { negative: 50, neutral: 270, positive: 150, total: 470 }, commentShare: { comments: 300, total: 476 },
    }, samples());
    const bad = {
      headline: 'La inversión en Aibonito dispara la visibilidad del DDEC',
      paragraph: 'El DDEC anunció una inversión en Aibonito y hubo {{week_total}} menciones. Un comerciante criticó 99 demoras.',
      highlights: ['El Nuevo Día publicó el anuncio de inversión.'],
      insights: { negative: ['Un comerciante criticó la demora de los permisos.'], neutral: [], positive: [] },
    };
    const llm = fakeLlm({
      analyst: { threads: [], week: { negative: [], neutral: [], positive: [] } },
      writer: bad,
      qa: { defects: [] },
      corrector: bad, // el corrector no arregla: actúa la red de seguridad
    });
    const r = await composeOverview(input, { llm, dryRun: true });
    expect(llm.roles).toEqual(['analyst', 'writer', 'qa', 'corrector']);
    const t = overviewTextsFromDraft(r.final);
    const all = [t.headline, t.dailySummary, ...t.highlights, ...t.insights.negative].join(' ');
    expect(findVetoed(all)).toEqual([]);
    expect(all).toContain('476');
    expect(all).not.toMatch(/\b99\b/);
    expect(r.composition.composerVersion).toBe(COMPOSER_VERSION);
    expect(r.composition.profile).toBe('overview');
    expect(r.archived).toBe(false);
  });
});

describe('perfil ligero de métrica con LLM simulado', () => {
  it('el valor sale del marcador y el corrector solo corre si hay defectos', async () => {
    const input = metricLightInput({
      agencyId: 'a', agencyName: 'DDEC', shortName: 'DDEC', metric: 'crisis', periodStart: '2026-10-26', periodEnd: '2026-11-01',
      value: 0.564, totals: AGG.totals, prevTotals: null, dailySeries: SERIES,
      topTopics: [{ topic: 'Desarrollo Empresarial', total: 300, negative: 20, positive: 100 }],
      topAuthors: [{ author: 'El Nuevo Día', mentions: 30 }], topMunicipalities: [],
    });
    const good = { headline: 'El riesgo de crisis del DDEC se mantiene en alerta', paragraph: 'El riesgo de crisis está en <strong>{{kpi_value}}</strong>, banda Alerta. Lo explica Desarrollo Empresarial con {{topic_1}} menciones.', highlights: [] };
    const llm = fakeLlm({ writer: good });
    const r = await composeLight(METRIC_LIGHT_PROFILE, input, { llm, dryRun: true });
    expect(llm.roles).toEqual(['writer']);
    expect(lightParagraph(r.final)).toBe('El riesgo de crisis está en <strong>56 %</strong>, banda Alerta. Lo explica Desarrollo Empresarial con 300 menciones.');
  });
});

describe('texto degradado: no se guarda como vigente', () => {
  const input = () => metricLightInput({
    agencyId: 'a', agencyName: 'DDEC', shortName: 'DDEC', metric: 'nss', periodStart: '2026-10-26', periodEnd: '2026-11-01',
    value: 12.3, totals: AGG.totals, prevTotals: null, dailySeries: SERIES,
    topTopics: [], topAuthors: [], topMunicipalities: [],
  });
  it('si el redactor falla (Bedrock), compose da el determinista y composedByWriter es false', async () => {
    const llm: ComposerLlm = { invokeTool: async () => { throw new Error('ThrottlingException'); } };
    const r = await composeLight(METRIC_LIGHT_PROFILE, input(), { llm, dryRun: true });
    expect(r.composition.draft1Raw).toBeNull();
    expect(lightParagraph(r.final).length).toBeGreaterThan(0); // hay texto, pero es el determinista
    expect(composedByWriter(r)).toBe(false);
  });
  it('sin cliente LLM tampoco cuenta como texto del redactor', async () => {
    const r = await composeLight(METRIC_LIGHT_PROFILE, input(), { llm: null, dryRun: true });
    expect(composedByWriter(r)).toBe(false);
  });
  it('con borrador del redactor sí', async () => {
    const good = { headline: 'El sentimiento neto del DDEC se mantiene', paragraph: 'El sentimiento neto está en <strong>{{kpi_value}}</strong>.', highlights: [] };
    const r = await composeLight(METRIC_LIGHT_PROFILE, input(), { llm: fakeLlm({ writer: good }), dryRun: true });
    expect(composedByWriter(r)).toBe(true);
  });
});
