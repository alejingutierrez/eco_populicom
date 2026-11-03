/**
 * Resumen ejecutivo con el motor (WP-8): mapeo del borrador a la forma de
 * `executive_summaries_cache.payload` y orquestación con un LLM simulado.
 */
import { COMPOSER_VERSION, annotateSamples, findVetoed, type ComposerLlm } from '@eco/shared';
import { composeScorecard, deterministicSignals, executiveSummaryFromComposition, scorecardComposerInput, SCORECARD_MODELS } from './composer';

const TOPICS = [
  { name: 'Desarrollo Empresarial', total: 300, negative: 20, neutral: 180, positive: 100, deltaPct: 10 },
  { name: 'Permisos', total: 60, negative: 30, neutral: 25, positive: 5, deltaPct: 80 },
];
const SERIES = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']
  .map((date) => ({ date, negative: 7, neutral: 30, positive: 15 }));

describe('señales deterministas', () => {
  it('signal = más menciones, emerging = más crecimiento, crisis = más negativas', () => {
    const s = deterministicSignals(TOPICS);
    expect(s.signal.dominant).toBe('Desarrollo Empresarial · Positiva');
    expect(s.emerging.dominant).toBe('Permisos · Negativa');
    expect(s.crisis.action).toBe('Seguir Permisos →');
    expect(deterministicSignals([]).signal.dominant).toBe('Sin señal dominante · Neutral');
  });
});

describe('composeScorecard con LLM simulado', () => {
  it('tres secciones con cifras por marcador, sin vetados, en la forma del caché', async () => {
    const samples = annotateSamples({
      negative: [{ id: 'n1', createdAt: '2026-10-30T15:00:00Z', text: 'Un comerciante criticó la demora de los permisos.', sentiment: 'negativo', author: 'Comerciante' }],
      neutral: [{ id: 'e1', createdAt: '2026-10-28T15:00:00Z', text: 'El DDEC anunció una inversión en Aibonito.', sentiment: 'neutral', author: 'El Nuevo Día', pageType: 'news' }],
    });
    const input = scorecardComposerInput({
      agencyId: 'a', agencyName: 'Departamento de Desarrollo Económico y Comercio', shortName: 'DDECPR', periodLabel: '26 oct – 1 nov',
      startYmd: '2026-10-26', endYmd: '2026-11-01', prevStartYmd: '2026-10-19', prevEndYmd: '2026-10-25',
      totals: { negative: 49, neutral: 210, positive: 105, total: 364 }, prevTotals: { negative: 40, neutral: 200, positive: 120, total: 360 },
      dailySeries: SERIES, topics: TOPICS, municipalities: [{ name: 'Aibonito', count: 40 }], authors: [{ name: 'El Nuevo Día', mentions: 30 }],
      samples,
    });
    const draft = {
      headline: 'El DDEC anunció una inversión en Aibonito',
      paragraph: 'El periodo tuvo {{week_total}} menciones.',
      highlights: [],
      sections: {
        signal: { narrative: 'El DDEC anunció una inversión en Aibonito, según El Nuevo Día; hubo {{week_total}} menciones.', points: ['El Nuevo Día publicó el anuncio.', 'Hubo {{topic_1}} menciones de Desarrollo Empresarial.'] },
        emerging: { narrative: 'Los permisos se disparan como tema.', points: [] },
        crisis: { narrative: 'Un comerciante criticó la demora de los permisos.', points: ['Hubo {{week_neg}} menciones negativas.'] },
      },
    };
    const roles: string[] = [];
    const llm: ComposerLlm = {
      invokeTool: async (r) => {
        roles.push(`${r.role}:${r.model}`);
        if (r.role === 'analyst') return { threads: [], week: { negative: [], neutral: [], positive: [] } };
        if (r.role === 'qa') return { defects: [] };
        return draft;
      },
    };
    const r = await composeScorecard(input, llm);
    expect(roles).toEqual([
      `writer:${SCORECARD_MODELS.writer}`, `qa:${SCORECARD_MODELS.qa}`, `corrector:${SCORECARD_MODELS.corrector}`,
    ]);
    const out = executiveSummaryFromComposition(r, TOPICS);
    expect(out.signal_narrative).toContain('364 menciones');
    expect(out.signal_points).toEqual(['El Nuevo Día publicó el anuncio.', 'Hubo 300 menciones de Desarrollo Empresarial.']);
    expect(findVetoed(out.emerging_narrative)).toEqual([]); // «se disparan» lo quita la red de seguridad
    expect(out.crisis_points).toEqual(['Hubo 49 menciones negativas.']);
    expect(out.signal_dominant).toBe('Desarrollo Empresarial · Positiva');
    expect(out.composer_version).toBe(COMPOSER_VERSION);
    expect(out.composition).toBeTruthy();
  });
});
