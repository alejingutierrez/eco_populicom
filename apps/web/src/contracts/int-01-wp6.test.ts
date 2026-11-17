/**
 * INT-01 · WP-6: el veredicto de la comprobación diaria de los correos reales
 * (`scripts/int-01-wp6-check.ts`). La prueba vive aquí porque el CI solo corre
 * el jest de apps/web.
 */
import { judgeDay, judgeSend, streak, type SendRow } from '../../../../scripts/lib/int-01-wp6';

const FACTS = {
  level_14_neg_pct: { id: 'level_14_neg_pct', value: 59 },
  level_28_neg_pct: { id: 'level_28_neg_pct', value: 62 },
  issue_1_days_open: { id: 'issue_1_days_open', value: 50 },
  week_total: { id: 'week_total', value: 620 },
};

function send(over: Partial<SendRow> = {}, comp: Partial<NonNullable<SendRow['composition']>> = {}): SendRow {
  return {
    slug: 'df', templateKey: 'daily-sentiment-summary', status: 'sent', sentAt: '2026-11-17T10:03:43Z',
    composerVersion: 'composer-1.1.0',
    composition: { facts: FACTS, warnings: [], residualCodeProblems: [], degraded: false, delivery: { sentText: 'composer' }, ...comp },
    ...over,
  };
}

describe('judgeSend', () => {
  it('OK: motor 1.1.0, nivel y asuntos archivados, sin avisos de nivel', () => {
    const v = judgeSend(send());
    expect(v).toMatchObject({ verdict: 'ok', levelFacts: 2, issueFacts: 1, levelWarnings: [], reasons: [] });
  });

  it('acepta los hechos como lista y un día sin asuntos abiertos', () => {
    const v = judgeSend(send({}, { facts: [{ id: 'level_14_neg_pct', value: 19 }, { id: 'level_28_neg_pct', value: 12 }] }));
    expect(v.verdict).toBe('ok');
    expect(v.issueFacts).toBe(0);
  });

  it('FALLA si queda direccion_sin_nivel o mejora_con_nivel_sostenido tras el corrector', () => {
    const a = judgeSend(send({}, { warnings: [{ type: 'direccion_sin_nivel', where: 'summary' }] }));
    expect(a.verdict).toBe('falla');
    expect(a.levelWarnings).toEqual(['direccion_sin_nivel en summary']);
    const b = judgeSend(send({}, { residualCodeProblems: [{ type: 'mejora_con_nivel_sostenido' }] }));
    expect(b.verdict).toBe('falla');
  });

  it('otros avisos (de INT-02) no cuentan para este criterio', () => {
    expect(judgeSend(send({}, { warnings: [{ type: 'cifra_sin_marcador' }] })).verdict).toBe('ok');
  });

  it('FALLA sin nivel, con motor anterior, degradada o con texto que no es del motor', () => {
    expect(judgeSend(send({}, { facts: { week_total: { id: 'week_total', value: 1 } } })).reasons).toContain('sin nivel a 14 y 28 días');
    expect(judgeSend(send({ composerVersion: 'composer-1.0.0' })).verdict).toBe('falla');
    expect(judgeSend(send({}, { degraded: true })).verdict).toBe('falla');
    expect(judgeSend(send({}, { delivery: { sentText: 'legacy' } })).verdict).toBe('falla');
    expect(judgeSend(send({ status: 'failed' })).verdict).toBe('falla');
  });

  it('SIN EVIDENCIA cuando el envío no dejó composición (caso DDEC del 17-nov)', () => {
    const v = judgeSend(send({ composerVersion: null, composition: null }));
    expect(v.verdict).toBe('sin_evidencia');
  });

  it('una versión posterior del motor también vale', () => {
    expect(judgeSend(send({ composerVersion: 'composer-1.10.0' })).verdict).toBe('ok');
  });
});

describe('judgeDay y streak', () => {
  const ok = (day: string) => judgeDay(day, [send(), send({ slug: 'ddecpr' })]);

  it('un día cuenta solo si todos sus envíos están OK', () => {
    expect(ok('2026-11-18').verdict).toBe('ok');
    expect(judgeDay('2026-11-17', [send(), send({ composition: null })]).verdict).toBe('sin_evidencia');
    expect(judgeDay('2026-11-17', [send({ composition: null }), send({ status: 'failed' })]).verdict).toBe('falla');
    expect(judgeDay('2026-11-17', []).verdict).toBe('sin_envios');
  });

  it('la racha cuenta los días OK seguidos desde el último', () => {
    const days = [judgeDay('2026-11-17', [send({ composition: null })]), ok('2026-11-18'), ok('2026-11-19')];
    expect(streak(days)).toEqual({ run: 2, missing: 5 });
    expect(streak([...days, judgeDay('2026-11-20', [])])).toEqual({ run: 0, missing: 7 });
    expect(streak(Array.from({ length: 8 }, (_, i) => ok(`d${i}`)))).toEqual({ run: 8, missing: 0 });
  });
});
