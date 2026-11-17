/**
 * INT-01 · WP-5: el bloque «Asuntos abiertos» y el nivel sostenido del
 * Overview salen del mismo cálculo que el Diario y el Semanal.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSustainedLevel, issueStageText, issueVoiceText, openIssueFacts, sustainedLevelFacts, sustainedLevelText,
  universeFilterSql, type OpenIssue, type OpenIssuesResult, type PgClientLike, type SustainedLevel,
} from '@eco/shared';
import {
  buildOverviewOpenIssuesPayload, loadOverviewInterpretation, OVERVIEW_ISSUES_UNIVERSE,
} from './open-issues';

const END = '2026-11-15';
const ymd = (k: number) => new Date(Date.parse(`${END}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

function level(neg = 12, neu = 7, pos = 1): SustainedLevel {
  return buildSustainedLevel(Array.from({ length: 28 }, (_, i) => ({ date: ymd(-i), negative: neg, neutral: neu, positive: pos })), END);
}

function issue(over: Partial<OpenIssue> = {}): OpenIssue {
  return {
    id: 'n1', name: 'Escándalo contratos ADSEF', lead: null, narrativeIds: ['n1', 'n2', 'n3'],
    week: 121, prevWeek: 57, negWeek: 91, posWeek: 0, negPct: 75,
    openSince: '2026-09-28', firstEverDay: '2026-09-28', daysOpen: 49, reopened: false, lastDay: END,
    stage: 'rising',
    voice: { key: 'jayfonseca', label: 'Jay Fonseca', basis: 'interactions', value: 3300, total: 10000, sharePct: 33, mentions: 4, media: false },
    voices: 61, score: 212, ...over,
  };
}

function issues(list: OpenIssue[] = [issue()], over: Partial<OpenIssuesResult> = {}): OpenIssuesResult {
  return {
    agency: { slug: 'df', name: 'Departamento de la Familia', short: 'DF', article: 'el DF' },
    asOf: END,
    windows: { week: { from: ymd(-6), to: END }, prevWeek: { from: ymd(-13), to: ymd(-7) } },
    issues: list, openCount: list.length,
    coverage: { weekTotal: 387, inIssues: 163, pct: 42 },
    thresholds: { minWeek: 5, recentDays: 3, gapDays: 14, max: 3 },
    ...over,
  };
}

describe('buildOverviewOpenIssuesPayload', () => {
  it('lleva los mismos hechos level_* e issue_* que el paquete del redactor del correo', () => {
    const lv = level();
    const is = issues([issue(), issue({ id: 'n9', name: 'Head Start', voice: null, voices: 6, negPct: 50, stage: 'new', daysOpen: 3 })]);
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: lv, openIssues: is, errors: [] }, END);
    const mail = [...sustainedLevelFacts(lv), ...openIssueFacts(is)];
    expect(p.facts).toEqual(mail.map((f) => ({ id: f.id, value: f.value, display: f.display })));
    expect(p.facts.map((f) => f.id)).toEqual(expect.arrayContaining([
      'level_14_neg_pct', 'level_28_neg_pct', 'level_threshold_neg_pct',
      'issue_1_days_open', 'issue_1_week', 'issue_1_prev', 'issue_1_neg_pct', 'issue_1_voices', 'issue_1_voice_share',
      'issue_2_days_open',
    ]));
    // Sin voz dominante no hay hecho de voz para ese asunto.
    expect(p.facts.find((f) => f.id === 'issue_2_voice_share')).toBeUndefined();
  });

  it('escribe cada fila con el texto del correo', () => {
    const i = issue({ reopened: true });
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: level(), openIssues: issues([i]), errors: [] }, END);
    const row = p.issues[0];
    expect(row.stageText).toBe(issueStageText(i));
    expect(row.voiceText).toBe(issueVoiceText(i));
    expect(row.sinceText).toBe('desde el 28 sep · reabierto');
    expect(row.daysOpen).toBe(49);
    expect(row.negOver).toBe(true);
    expect(p.level?.text).toBe(sustainedLevelText(level()));
    expect(p.level?.sustained).toBe(true);
    expect(p.asOf).toBe(END);
    expect(p.agency).toEqual({ slug: 'df', name: 'Departamento de la Familia', short: 'DF' });
    expect(p.coverage?.pct).toBe(42);
    expect(p.methodology).toContain('asunto abierto');
  });

  it('el enlace a Narrativas va primero a la narrativa más activa de la semana', () => {
    const i = issue({ lead: { id: 'n3', name: 'Vacaciones de la secretaria', week: 40 } });
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: null, openIssues: issues([i]), errors: [] }, END);
    expect(p.issues[0].narrativeIds).toEqual(['n3', 'n1', 'n2']);
    expect(p.issues[0].lead).toEqual({ id: 'n3', name: 'Vacaciones de la secretaria' });
  });

  it('muestra como mucho 3 asuntos y conserva cuántos hay abiertos', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => issue({ id, name: `Asunto ${id}` }));
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: level(), openIssues: issues(list, { openCount: 7 }), errors: [] }, END);
    expect(p.issues).toHaveLength(3);
    expect(p.openCount).toBe(7);
  });

  it('un asunto bajo el umbral no se marca como negativo', () => {
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: level(2, 16, 2), openIssues: issues([issue({ negPct: 4 })]), errors: [] }, END);
    expect(p.issues[0].negOver).toBe(false);
    expect(p.level?.sustained).toBe(false);
    expect(p.level?.d14.overNegPct).toBe(false);
  });

  it('sin asuntos abiertos devuelve la lista vacía con su cobertura (el bloque no se omite)', () => {
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: level(), openIssues: issues([], { openCount: 0 }), errors: [] }, END);
    expect(p.issues).toEqual([]);
    expect(p.thresholds?.minWeek).toBe(5);
    expect(p.level).not.toBeNull();
  });

  it('con base insuficiente el nivel va sin porcentajes y sin hechos', () => {
    const lv = level(1, 0, 0); // 14 menciones en 14 días, 28 en 28: bajo la base de 30
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: lv, openIssues: issues([]), errors: [] }, END);
    expect(p.level?.d14.enoughBase).toBe(false);
    expect(p.level?.d14.negPct).toBeNull();
    expect(p.level?.sustained).toBeNull();
    expect(p.facts.filter((f) => f.id.startsWith('level_'))).toEqual([]);
  });

  it('si una carga falló, sale la otra parte y el error queda anotado', () => {
    const p = buildOverviewOpenIssuesPayload({ sustainedLevel: level(), openIssues: null, errors: ['asuntos abiertos: timeout'] }, END);
    expect(p.level).not.toBeNull();
    expect(p.issues).toEqual([]);
    expect(p.coverage).toBeNull();
    expect(p.agency).toBeNull();
    expect(p.errors).toEqual(['asuntos abiertos: timeout']);
  });
});

describe('loadOverviewInterpretation', () => {
  function spy(fail?: RegExp) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client: PgClientLike = {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params: params ?? [] });
        if (fail && fail.test(sql)) throw new Error('boom');
        if (/FROM agencies WHERE id/.test(sql)) return { rows: [{ slug: 'df', name: 'Departamento de la Familia' }] };
        return { rows: [] };
      },
    } as PgClientLike;
    return { client, calls };
  }

  it('usa el universo del correo (histórico), no el estricto', async () => {
    expect(OVERVIEW_ISSUES_UNIVERSE).toEqual({ strictUniverse: false });
    const { client, calls } = spy();
    const out = await loadOverviewInterpretation(client, 'ag-1', END);
    expect(out.errors).toEqual([]);
    expect(out.openIssues?.issues).toEqual([]);
    expect(out.sustainedLevel?.asOf).toBe(END);
    const mentionSql = calls.filter((c) => /is_duplicate/.test(c.sql));
    expect(mentionSql.length).toBeGreaterThan(0);
    const historic = universeFilterSql({}, 'm.').replace(/\s+/g, ' ');
    for (const c of mentionSql) {
      const flat = c.sql.replace(/\s+/g, ' ');
      expect(flat).not.toContain("IN ('alta','media')");
      expect(flat.includes(historic) || flat.includes(universeFilterSql({}).replace(/\s+/g, ' '))).toBe(true);
    }
  });

  it('pide las ventanas que terminan en la fecha del correo', async () => {
    const { client, calls } = spy();
    await loadOverviewInterpretation(client, 'ag-1', END);
    const flatParams = calls.flatMap((c) => c.params).map(String);
    expect(flatParams).toContain(END); // último día
    expect(flatParams).toContain(ymd(-27)); // primer día del nivel a 28 días
  });

  it('una carga que falla no tumba la otra', async () => {
    const { client } = spy(/narrative_mentions/);
    const out = await loadOverviewInterpretation(client, 'ag-1', END);
    expect(out.openIssues).toBeNull();
    expect(out.sustainedLevel).not.toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/^asuntos abiertos: /);
  });
});

describe('/api/overview/open-issues', () => {
  const root = path.resolve(__dirname, '../../..');
  const mw = fs.readFileSync(path.join(root, 'src/middleware.ts'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/app/api/overview/open-issues/route.ts'), 'utf8');
  const screens = fs.readFileSync(path.join(root, 'public/eco-prototype/screens.js'), 'utf8');

  it('queda bajo sesión en las dos listas del middleware y con requireAuth', () => {
    const block = mw.slice(mw.indexOf('const PROTECTED_PATHS'), mw.indexOf('function isProtected'));
    expect(block).toContain('/^\\/api\\/overview(\\/.*)?$/');
    expect(mw.slice(mw.indexOf('export const config'))).toContain("'/api/overview/:path*'");
    expect(route).toContain('requireAuth()');
  });

  it('no recibe periodo: la fecha es siempre el último día cerrado', () => {
    expect(route).not.toMatch(/searchParams\.get\('(period|from|to)'\)/);
    expect(route).toContain("resolveWindow({ period: '1D', timeZone: TZ })");
  });

  it('el Overview pinta el bloque entre el Resumen y la Tendencia y dice que no sigue al selector', () => {
    const start = screens.indexOf('function OverviewScreen(');
    const body = screens.slice(start, screens.indexOf('function OverviewEyebrow('));
    const iResumen = body.indexOf('<OverviewResumen');
    const iIssues = body.indexOf('<OverviewAsuntos');
    const iTrend = body.indexOf('<OverviewTendencia');
    expect(iResumen).toBeGreaterThan(-1);
    expect(iIssues).toBeGreaterThan(iResumen);
    expect(iTrend).toBeGreaterThan(iIssues);
    expect(screens).toContain('/api/overview/open-issues?');
    expect(screens).toContain('no cambia con el selector de periodo');
  });
});
