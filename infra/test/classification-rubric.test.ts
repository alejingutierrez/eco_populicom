import { readFileSync } from 'fs';
import * as path from 'path';
import { TOPICS_BY_AGENCY, AGENCY_NLP_CONTEXT, TOPIC_ROUTING_RULES, TOPIC_SLUGS_BY_AGENCY } from '../../packages/shared/src/topics';
import { MUNICIPALITY_SLUGS } from '../../packages/shared/src/municipalities';
import {
  LEGACY_PROMPT_VERSION, RUBRIC_V2_VERSION, buildClassificationPrompt, buildClassifyTool, mentionKindLine,
  nlpEnumProblem, normalizeNlpResult, parseAgencyList, promptVersionFor, rubricModeFor, rubricV2Block,
  type PromptMention,
} from '../lambda/lib/classification-rubric';
import { deriveMentionKind, type MentionKind } from '../lambda/lib/mention-kind';
import { LEGACY_ROUTING_RULES, referenceLegacyPrompt } from './legacy-prompt-reference';

const NLP_TEXT_LIMIT = 8000;
const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/interp-v1-mentions.json'), 'utf8')) as {
  agencies: Record<string, { id: string; slug: string; name: string }>;
  kindCases: Array<{ agency: string; pubType: string; pageType: string; url: string; guid: string | null; author: string | null; expected: MentionKind }>;
};

const catalogFor = (slug: string) => ({
  agencyTopics: TOPICS_BY_AGENCY[slug] ?? [],
  agencyContext: AGENCY_NLP_CONTEXT[slug],
  routingRules: TOPIC_ROUTING_RULES[slug] ?? LEGACY_ROUTING_RULES,
});

/**
 * 50 menciones con los metadatos reales del fixture (plataforma, autor,
 * agencia) y texto sintético que ejercita los bordes del template: comillas,
 * saltos de línea, `${}` literal, emojis, cuerpo > 8000 caracteres, campos
 * nulos y las tres pistas de Brandwatch.
 */
function fiftyMentions() {
  const picks: typeof fixture.kindCases = [];
  const perAgency: Record<string, number> = {};
  for (const c of fixture.kindCases) {
    const n = perAgency[c.agency] ?? 0;
    if (n >= 20) continue;
    perAgency[c.agency] = n + 1;
    picks.push(c);
    if (picks.length === 50) break;
  }
  const bw = ['positive', 'neutral', 'negative', null];
  return picks.map((c, i) => {
    const long = 'Lorem «ipsum» dolor, $ {x} `tick` "comillas"\n'.repeat(220); // ~9.900 caracteres
    const mention: PromptMention = {
      title: i % 7 === 0 ? null : `Título ${i} — «${c.pubType}» con "comillas" y \${no-interpolar}`,
      snippet: i % 9 === 0 ? null : `Texto ${i}: ¡Excelente! 👏 línea 1\nlínea 2 · ${c.url}`,
      contentSourceName: i % 5 === 0 ? null : 'Facebook',
      domain: i % 11 === 0 ? null : 'facebook.com',
      author: c.author,
      date: `2026-10-${String(10 + (i % 20)).padStart(2, '0')}T12:34:56.000Z`,
      sentiment: bw[i % 4],
    };
    const fullText = i % 3 === 0 ? long : i % 3 === 1 ? `Cuerpo corto ${i}` : null;
    return { c, mention, fullText, agency: fixture.agencies[c.agency] };
  });
}

describe('no-regresión: rúbrica legacy = prompt de producción anterior', () => {
  const cases = fiftyMentions();

  it('usa 50 menciones de al menos 3 agencias', () => {
    expect(cases).toHaveLength(50);
    expect(new Set(cases.map((x) => x.agency.slug)).size).toBeGreaterThanOrEqual(3);
  });

  it.each(cases.map((x, i) => [i, x] as const))('mención %i: prompt idéntico carácter por carácter', (_i, x) => {
    const expected = referenceLegacyPrompt(x.mention, x.agency, x.fullText, {
      NLP_TEXT_LIMIT, TOPICS_BY_AGENCY, AGENCY_NLP_CONTEXT, TOPIC_ROUTING_RULES,
    });
    const kind = deriveMentionKind({ ...x.c }, x.agency);
    const got = buildClassificationPrompt({
      mention: x.mention, agency: x.agency, fullText: x.fullText, textLimit: NLP_TEXT_LIMIT,
      catalog: catalogFor(x.agency.slug), rubric: 'legacy', kind,
    });
    expect(got).toBe(expected);
  });

  it('el processor conserva las reglas de routing históricas sin cambios', () => {
    const src = readFileSync(path.join(__dirname, '../lambda/processor/index.ts'), 'utf8');
    expect(src).toContain(`const LEGACY_ROUTING_RULES = \`${LEGACY_ROUTING_RULES}\`;`);
  });

  it('la herramienta legacy es la de siempre (sin adverse_fact)', () => {
    const tool = buildClassifyTool('legacy');
    expect(tool.input_schema.required).toEqual(['sentiment', 'pertinence', 'summary']);
    expect(Object.keys(tool.input_schema.properties)).toEqual(['sentiment', 'emotions', 'pertinence', 'topics', 'municipalities', 'summary']);
    expect(promptVersionFor('legacy')).toBe(LEGACY_PROMPT_VERSION);
  });

  it('normalizeNlpResult en legacy = validateNlpResult histórico (adverse_fact nulo)', () => {
    const raw: any = {
      sentiment: 'negative', emotions: '["enojo","feliz"]', pertinence: 'altísima',
      topics: [{ topic_slug: 'no-existe', confidence: 0.9 }, { topic_slug: TOPIC_SLUGS_BY_AGENCY.df[0], confidence: 7 }],
      municipalities: 'san-juan, atlantida', summary: 'x'.repeat(600), adverse_fact: true,
    };
    const out = normalizeNlpResult(raw, { validTopics: TOPIC_SLUGS_BY_AGENCY.df, validMunicipalities: MUNICIPALITY_SLUGS, rubric: 'legacy' });
    expect(out).toEqual({
      sentiment: 'neutral', emotions: ['enojo'], pertinence: 'media',
      topics: [{ topic_slug: TOPIC_SLUGS_BY_AGENCY.df[0], confidence: 1 }],
      municipalities: ['san-juan'], summary: 'x'.repeat(500), adverse_fact: null,
    });
  });
});

describe('rúbrica v2 (Anexo A)', () => {
  const ddec = fixture.agencies.ddecpr;
  const df = fixture.agencies.df;
  const m: PromptMention = { title: 'Post del DDEC', snippet: 'Bravo!', contentSourceName: 'Facebook', domain: 'facebook.com', author: 'autor-1', date: '2026-10-27T12:00:00.000Z', sentiment: 'positive' };
  const build = (kind: MentionKind | null, agency = ddec) => buildClassificationPrompt({
    mention: m, agency, fullText: null, textLimit: NLP_TEXT_LIMIT, catalog: catalogFor(agency.slug), rubric: 'v2', kind,
  });

  it('quita la pista de Brandwatch y las reglas legacy', () => {
    const p = build('comment');
    expect(p).not.toContain('Sentimiento Brandwatch');
    expect(p).not.toContain('REGLAS DE SENTIMIENTO');
    expect(p).toContain('SENTIMIENTO = POSTURA del autor/medio HACIA el Departamento de Desarrollo Económico y Comercio (DDEC)');
    expect(p).toContain('HECHO ADVERSO (campo adverse_fact)');
    expect(p).toContain('«Excelente», «Bravo», «Qué chévere, mucho éxito»');
  });

  it('línea TIPO DE MENCIÓN antes de «Llama a la herramienta», por tipo', () => {
    expect(build('comment')).toContain('Fecha: 2026-10-27T12:00:00.000Z\n\nTIPO DE MENCIÓN: COMENTARIO de un usuario en una publicación del propio DDEC.\nLlama a la herramienta classify_mention');
    expect(build('agency_post')).toContain('\nTIPO DE MENCIÓN: publicación propia del DDEC (el autor es el DDEC).\nLlama a la herramienta');
    expect(build('article')).toContain('\nTIPO DE MENCIÓN: nota de prensa o blog.\nLlama a la herramienta');
    expect(build('third_party_post')).toContain('\nTIPO DE MENCIÓN: publicación de un tercero.\nLlama a la herramienta');
    expect(build(null)).toContain('Fecha: 2026-10-27T12:00:00.000Z\n\nLlama a la herramienta');
    expect(mentionKindLine('agency_post', { slug: 'aaa', name: 'AAA' })).toBe('TIPO DE MENCIÓN: publicación propia de la agencia (AAA) (el autor es la agencia (AAA)).');
  });

  it('la regla de comentarios solo aparece en comentarios', () => {
    expect(build('comment')).toContain('COMENTARIOS A PUBLICACIONES DE el Departamento de Desarrollo Económico y Comercio (DDEC):');
    for (const k of ['agency_post', 'article', 'third_party_post'] as const) {
      expect(build(k)).not.toContain('COMENTARIOS A PUBLICACIONES');
    }
  });

  it('bloque v2 = rubric() de v2.py (laboratorio)', () => {
    const A = 'Departamento de la Familia';
    const block = rubricV2Block(A, false);
    expect(block.startsWith(`SENTIMIENTO = POSTURA del autor/medio HACIA ${A} (su contenido`)).toBe(true);
    expect(block.endsWith('o el texto trata de otra cosa.\n\n')).toBe(true);
    const withComments = rubricV2Block(A, true);
    expect(withComments.endsWith('sin relación con la publicación.\n\n')).toBe(true);
    // DF usa el nombre tal cual (como en el laboratorio)
    expect(build('article', df)).toContain(`HACIA ${A} (su contenido`);
  });

  it('el resto del prompt no cambia respecto de legacy', () => {
    const legacy = buildClassificationPrompt({ mention: m, agency: ddec, fullText: null, textLimit: NLP_TEXT_LIMIT, catalog: catalogFor('ddecpr'), rubric: 'legacy' });
    const v2 = build('article');
    const tail = (s: string) => s.slice(s.indexOf('EMOTIONS:'));
    const head = (s: string) => s.slice(0, s.indexOf('Fecha:'));
    expect(tail(v2)).toBe(tail(legacy));
    expect(head(v2)).toBe(head(legacy));
  });

  it('herramienta v2 exige adverse_fact booleano', () => {
    const tool = buildClassifyTool('v2');
    expect(tool.input_schema.required).toEqual(['sentiment', 'adverse_fact', 'pertinence', 'summary']);
    expect((tool.input_schema.properties as any).adverse_fact).toEqual({ type: 'boolean' });
    expect(promptVersionFor('v2')).toBe(RUBRIC_V2_VERSION);
  });

  it('normalizeNlpResult v2 conserva adverse_fact', () => {
    const base: any = { sentiment: 'neutral', pertinence: 'alta', summary: 's', topics: [], municipalities: [], emotions: [] };
    const opts = { validTopics: [], validMunicipalities: MUNICIPALITY_SLUGS, rubric: 'v2' as const };
    expect(normalizeNlpResult({ ...base, adverse_fact: true }, opts).adverse_fact).toBe(true);
    expect(normalizeNlpResult({ ...base, adverse_fact: 'false' }, opts).adverse_fact).toBe(false);
    expect(normalizeNlpResult({ ...base }, opts).adverse_fact).toBeNull();
  });
});

describe('validación estricta de enums', () => {
  it('rechaza sentiment fuera de positivo|neutral|negativo (p. ej. «negative» del fallback)', () => {
    expect(nlpEnumProblem({ sentiment: 'negative', pertinence: 'alta' })).toMatch(/sentiment/);
    expect(nlpEnumProblem({ sentiment: 'Negativo', pertinence: 'alta' })).toMatch(/sentiment/);
    expect(nlpEnumProblem({ pertinence: 'alta' })).toMatch(/sentiment/);
    expect(nlpEnumProblem({ sentiment: 'negativo', pertinence: 'high' })).toMatch(/pertinence/);
    for (const s of ['positivo', 'neutral', 'negativo']) expect(nlpEnumProblem({ sentiment: s, pertinence: 'baja' })).toBeNull();
  });
});

describe('banderas', () => {
  it('parseAgencyList', () => {
    expect([...parseAgencyList(' ddecpr, DF ,,')]).toEqual(['ddecpr', 'df']);
    expect(parseAgencyList(undefined).size).toBe(0);
    expect(parseAgencyList('').size).toBe(0);
  });

  it('v2 gana sobre sombra; sin listas todo es legacy', () => {
    const v2 = parseAgencyList('ddecpr');
    const shadow = parseAgencyList('ddecpr,df');
    expect(rubricModeFor('ddecpr', v2, shadow)).toBe('v2');
    expect(rubricModeFor('df', v2, shadow)).toBe('shadow');
    expect(rubricModeFor('gobernadora', v2, shadow)).toBe('legacy');
    expect(rubricModeFor('ddecpr', new Set(), new Set())).toBe('legacy');
  });
});
