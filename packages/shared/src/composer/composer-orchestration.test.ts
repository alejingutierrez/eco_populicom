/**
 * Pruebas de orquestación con LLM simulado: orden de etapas, corrector solo
 * si hay defectos, reintentos, la red nunca bloquea y `compose` nunca lanza.
 * Corre con:
 *   node_modules/.bin/tsx --test packages/shared/src/composer/composer-orchestration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, DEFAULT_ROLE_MODELS } from './compose';
import type { SendLogArchiveRow } from './archive';
import { fixtureInput } from './test-fixtures';
import type { ComposerLlm, ComposerLlmRequest } from './types';

const FINDINGS = {
  threads: [{ id: 't1', what: 'Usuarios preguntaron por la panadería', evidence: ['D1'], kind: 'reaccion_tardia_a_publicacion_anterior', origin_day: 'lunes 26 de octubre' }],
  week: { negative: [], neutral: [], positive: [] },
};
const CLEAN_DRAFT = {
  headline: 'Comentarios tardíos a la publicación del lunes 26 dominaron el domingo',
  paragraph: 'El domingo hubo {{day_total}} menciones. Varios usuarios preguntaron por la panadería.',
  highlights: ['Un usuario preguntó la dirección.'],
  insights: { negative: [], neutral: ['La serie del Mes de la Manufactura concentró la semana.'], positive: [] },
};

type Handler = (req: ComposerLlmRequest, n: number) => unknown;

function mockLlm(handlers: Partial<Record<ComposerLlmRequest['role'], Handler>>) {
  const calls: ComposerLlmRequest[] = [];
  const count: Record<string, number> = {};
  const llm: ComposerLlm = {
    async invokeTool(req) {
      calls.push(req);
      count[req.role] = (count[req.role] ?? 0) + 1;
      const h = handlers[req.role];
      if (!h) throw new Error(`sin handler para ${req.role}`);
      return h(req, count[req.role]);
    },
  };
  return { llm, calls };
}

const fast = { sleep: async () => {}, backoffMs: 0 };

test('diario sin defectos: analista → redactor → QA, sin corrector', async () => {
  const { llm, calls } = mockLlm({ analyst: () => FINDINGS, writer: () => CLEAN_DRAFT, qa: () => ({ defects: [] }) });
  const r = await compose('daily', fixtureInput(), { llm, ...fast });
  assert.deepEqual(calls.map((c) => c.role), ['analyst', 'writer', 'qa']);
  assert.deepEqual(calls.map((c) => c.model), [DEFAULT_ROLE_MODELS.analyst, DEFAULT_ROLE_MODELS.writer, DEFAULT_ROLE_MODELS.qa]);
  assert.equal(r.ok, true);
  assert.equal(r.composition.correctorRan, false);
  assert.equal(r.final.paragraph, 'El domingo hubo 64 menciones. Varios usuarios preguntaron por la panadería.');
  assert.equal(r.subject, '[Diario] DDEC · Comentarios tardíos a la publicación del lunes 26 dominaron el domingo');
  assert.deepEqual(r.composition.residualCodeProblems, []);
  // El redactor recibe los hallazgos, y el analista las muestras anotadas y las reglas.
  assert.match(calls[1].user, /HALLAZGOS DEL ANALISTA/);
  assert.match(calls[0].user, /REACCIÓN TARDÍA/);
  assert.match(calls[0].system, /AUSENCIAS/);
  assert.equal(calls[2].model, 'us.anthropic.claude-sonnet-4-6');
});

test('QA con defectos: corre el corrector y su borrador es el final', async () => {
  const { llm, calls } = mockLlm({
    analyst: () => FINDINGS,
    writer: () => ({ ...CLEAN_DRAFT, paragraph: 'El domingo no hubo cobertura de prensa. Hubo {{day_total}} menciones.' }),
    qa: () => ({ defects: [{ where: 'párrafo', quote: 'no hubo cobertura de prensa', type: 'sin_respaldo', why: 'ausencia sin hecho', fix: 'quitar' }] }),
    corrector: () => CLEAN_DRAFT,
  });
  const r = await compose('daily', fixtureInput(), { llm, ...fast });
  assert.deepEqual(calls.map((c) => c.role), ['analyst', 'writer', 'qa', 'corrector']);
  assert.match(calls[3].user, /DEFECTOS A CORREGIR/);
  assert.match(calls[3].user, /no hubo cobertura de prensa/);
  assert.equal(r.composition.correctorRan, true);
  assert.equal(r.final.paragraph, 'El domingo hubo 64 menciones. Varios usuarios preguntaron por la panadería.');
  assert.equal(r.composition.qa.agent.length, 1);
});

test('defecto de código (vetado) dispara el corrector aunque el QA no vea nada', async () => {
  const { llm, calls } = mockLlm({
    analyst: () => FINDINGS,
    writer: () => ({ ...CLEAN_DRAFT, headline: 'El Senado aprieta al DDEC' }),
    qa: () => ({ defects: [] }),
    corrector: () => CLEAN_DRAFT,
  });
  const r = await compose('daily', fixtureInput(), { llm, ...fast });
  assert.deepEqual(calls.map((c) => c.role), ['analyst', 'writer', 'qa', 'corrector']);
  assert.ok(r.composition.qa.code.some((d) => d.type === 'tono_dramatico'));
  assert.equal(r.final.headline, CLEAN_DRAFT.headline);
});

test('la red nunca bloquea: si el corrector deja defectos, se quitan y el texto sale', async () => {
  const bad = { ...CLEAN_DRAFT, headline: 'Fortaleza se deslinda', paragraph: 'Hubo {{day_total}} menciones. Al menos 41 usuarios se quejaron.' };
  const { llm } = mockLlm({ analyst: () => FINDINGS, writer: () => bad, qa: () => ({ defects: [] }), corrector: () => bad });
  const r = await compose('daily', fixtureInput(), { llm, ...fast });
  assert.equal(r.final.headline, 'Domingo 1 de noviembre: 64 menciones, 4 negativas y 6 positivas');
  assert.equal(r.final.paragraph, 'Hubo 64 menciones.');
  assert.deepEqual(r.composition.residualCodeProblems, []);
  assert.ok(r.composition.safetyNetLog.some((l) => l.action === 'titular_reemplazado'));
  assert.ok(r.composition.safetyNetLog.some((l) => l.action === 'frase_removida'));
});

test('reintentos: el rol se reintenta y un truncamiento sube max_tokens', async () => {
  const seen: number[] = [];
  const { llm, calls } = mockLlm({
    analyst: () => FINDINGS,
    writer: (req, n) => {
      seen.push(req.maxTokens);
      if (n === 1) throw new Error('Model x stopped with reason="max_tokens" (likely truncated)');
      if (n === 2) return { headline: 'sin párrafo' }; // normalizador lo rechaza
      return CLEAN_DRAFT;
    },
    qa: () => ({ defects: [] }),
  });
  const r = await compose('daily', fixtureInput(), { llm, ...fast });
  assert.equal(calls.filter((c) => c.role === 'writer').length, 3);
  assert.equal(seen[1], Math.round(seen[0] * 1.5));
  assert.equal(r.ok, true);
  const w = r.composition.calls.find((c) => c.role === 'writer');
  assert.equal(w?.attempts, 3);
});

test('nunca lanza: si todo el LLM falla, sale el titular determinista y el error queda registrado', async () => {
  const llm: ComposerLlm = { invokeTool: async () => { throw new Error('ConverseThrottling'); } };
  const r = await compose('daily', fixtureInput(), { llm, ...fast, retries: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.degraded, true);
  assert.equal(r.final.headline, 'Domingo 1 de noviembre: 64 menciones, 4 negativas y 6 positivas');
  assert.match(r.final.paragraph, /^El domingo 1 de noviembre hubo 64 menciones pertinentes/);
  assert.ok(r.composition.errors.some((e) => e.startsWith('redactor:')));
  assert.ok(r.composition.errors.some((e) => e.startsWith('analista:')));
});

test('nunca lanza: sin cliente LLM o con datos malformados', async () => {
  const r1 = await compose('daily', fixtureInput(), {});
  assert.equal(r1.degraded, true);
  assert.match(r1.final.headline, /^Domingo 1 de noviembre/);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r2 = await compose('daily', { agency: { name: 'X' } } as any, {});
  assert.equal(r2.degraded, true);
  assert.ok(r2.final.headline.length > 0);
});

test('perfil ligero: redactor + QA código + una vuelta de corrector, sin analista ni QA agente', async () => {
  const { llm, calls } = mockLlm({
    writer: () => ({ headline: 'El NSS bajó el domingo', paragraph: 'Hubo {{day_total}} menciones y {{nope}} quejas.', highlights: [] }),
    corrector: () => ({ headline: 'El NSS bajó el domingo', paragraph: 'Hubo {{day_total}} menciones.', highlights: [] }),
  });
  const r = await compose('light', fixtureInput(), { llm, ...fast });
  assert.deepEqual(calls.map((c) => c.role), ['writer', 'corrector']);
  assert.doesNotMatch(calls[0].user, /HALLAZGOS/);
  assert.equal(r.final.paragraph, 'Hubo 64 menciones.');
  assert.equal(r.subject, null);
});

test('semanal y scorecard: esquemas con comparison y sections', async () => {
  const { llm, calls } = mockLlm({
    analyst: () => FINDINGS,
    writer: (req) => {
      const props = (req.tool.input_schema as { properties: Record<string, unknown> }).properties;
      if (props.comparison) return { ...CLEAN_DRAFT, comparison: ['Las negativas variaron {{week_neg_delta_abs}} contra la semana previa.'] };
      return { ...CLEAN_DRAFT, sections: { signal: { narrative: 'Domina la manufactura.', points: ['a'] }, emerging: { narrative: 'n', points: [] }, crisis: { narrative: 'c', points: [] } } };
    },
    qa: () => ({ defects: [] }),
  });
  const w = await compose('weekly', fixtureInput(), { llm, ...fast });
  assert.deepEqual(w.final.comparison, ['Las negativas variaron +44 contra la semana previa.']);
  assert.equal(w.subject?.startsWith('[Semanal] DDEC · '), true);
  assert.match(calls[0].user, /PERIODO QUE SE RESUME: del lunes 26 de octubre al domingo 1 de noviembre/);
  const s = await compose('scorecard', fixtureInput(), { llm, ...fast });
  assert.equal(s.final.sections?.signal.narrative, 'Domina la manufactura.');
});

test('dryRun no escribe el archivo; sin dryRun sí, y un fallo del archivo no lanza', async () => {
  const rows: SendLogArchiveRow[] = [];
  const sink = { write: async (row: SendLogArchiveRow) => { rows.push(row); } };
  const mk = () => mockLlm({ analyst: () => FINDINGS, writer: () => CLEAN_DRAFT, qa: () => ({ defects: [] }) }).llm;
  const dry = await compose('daily', fixtureInput(), { llm: mk(), ...fast, dryRun: true, archive: sink });
  assert.equal(dry.archived, false);
  assert.equal(rows.length, 0);
  assert.equal(dry.composition.dryRun, true);
  const real = await compose('daily', fixtureInput(), { llm: mk(), ...fast, archive: sink });
  assert.equal(real.archived, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].headline, CLEAN_DRAFT.headline);
  assert.equal(rows[0].composer_version, real.composition.composerVersion);
  const broken = await compose('daily', fixtureInput(), { llm: mk(), ...fast, archive: { write: async () => { throw new Error('pg caído'); } } });
  assert.equal(broken.archived, false);
  assert.ok(broken.composition.errors.some((e) => e.includes('pg caído')));
});

test('la composición registra hechos, borradores, modelos, versiones y segundos por etapa', async () => {
  const { llm } = mockLlm({
    analyst: () => FINDINGS,
    writer: () => CLEAN_DRAFT,
    qa: () => ({ defects: [{ where: 'viñeta 1', quote: 'x', type: 'otro', why: 'y', fix: 'z' }] }),
    corrector: () => CLEAN_DRAFT,
  });
  const r = await compose('daily', fixtureInput(), { llm, ...fast, models: { corrector: 'modelo-x' } });
  const c = r.composition;
  assert.equal(c.facts.day_total.value, 64);
  assert.ok(c.findings);
  assert.ok(c.draft1Raw && c.draft1 && c.draft2Raw && c.draft2);
  assert.equal(c.models.corrector, 'modelo-x');
  assert.match(c.promptVersion, /^composer-prompts-v/);
  for (const k of ['facts', 'analyst', 'writer', 'qa_code', 'qa_agent', 'corrector', 'safety_net', 'total']) {
    assert.equal(typeof c.stageSeconds[k], 'number', k);
  }
  assert.equal(JSON.parse(JSON.stringify(c)).final.headline, CLEAN_DRAFT.headline);
});
