import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADVISOR_SCHEMA_SQL } from './store';
import { checkCitations, idsInToolResult } from '@eco/shared/src/advisor/citations';
import { reviewDraft } from '@eco/shared/src/advisor/review';
import { parseReviewOutput, REVIEW_SCHEMA } from '@eco/shared/src/advisor/schemas';
import { MANUAL_TEXT } from '@eco/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT } from '@eco/shared/src/advisor/legal-rules';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const migration = readFileSync(join(ROOT, 'packages', 'database', 'src', 'migrations', '0012_advisor.sql'), 'utf8');

/** Quita comentarios SQL y espacios para comparar solo sentencias. */
const norm = (s: string) =>
  s
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('esquema del asesor (spec §10.1)', () => {
  test('ensureAdvisorSchema usa exactamente las sentencias de la migración 0012', () => {
    expect(norm(ADVISOR_SCHEMA_SQL)).toBe(norm(migration));
  });

  test('crea las cinco tablas del spec', () => {
    for (const t of ['advisor_runs', 'advisor_events', 'advisor_tool_calls', 'advisor_forecasts', 'advisor_legal_calendar']) {
      expect(ADVISOR_SCHEMA_SQL).toContain(`CREATE TABLE IF NOT EXISTS ${t} `);
    }
  });
});

describe('verificación de citas (spec §3.3, §12.2)', () => {
  const seen = new Set(['M-48213', 'N-112']);
  const corpus = { seenIds: seen, manual: MANUAL_TEXT, legal: LEGAL_RULES_TEXT };

  test('una mención devuelta por una herramienta es válida; una inventada no', () => {
    const r = checkCitations('Ver M-48213 y M-99999.', corpus);
    expect(r.items.find((i) => i.ref === 'M-48213')?.ok).toBe(true);
    expect(r.items.find((i) => i.ref === 'M-99999')?.ok).toBe(false);
    expect(r.invalid).toBe(1);
  });

  test('una narrativa N-112 vista en la corrida es válida', () => {
    expect(checkCitations('La narrativa N-112 sube.', corpus).invalid).toBe(0);
  });

  test('reglas: M-116 existe en el manual; M-999 no', () => {
    const r = checkCitations('Según M-116 y M-999.', corpus);
    expect(r.items.find((i) => i.ref === 'M-116')?.ok).toBe(true);
    expect(r.items.find((i) => i.ref === 'M-999')?.ok).toBe(false);
  });

  test('una cita repetida cuenta una vez', () => {
    expect(checkCitations('M-116 y otra vez M-116.', corpus).total).toBe(1);
  });

  test('idsInToolResult extrae menciones y narrativas del JSON de terceros', () => {
    const txt = JSON.stringify({ tipo: 'mencion_de_tercero', id: 'M-48213', texto: 'x N-112 y M-116' });
    expect(idsInToolResult(txt).sort()).toEqual(['M-48213', 'N-112']);
  });
});

describe('revisor de borradores (M-116, trece puntos)', () => {
  const ctx = { vedaActiva: false, esFamilia: false };

  test('siempre devuelve los trece puntos, aunque algunos sean no mecánicos', () => {
    const r = reviewDraft('Texto cualquiera de prueba.', ctx);
    const ids = r.puntos.map((p) => p.id).filter((i) => i <= 13);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(r.puntos.find((p) => p.id === 2)?.estado).toBe('no_mecanico');
  });

  test('«sin comentarios» y tú mezclado con usted salen en alerta', () => {
    const r = reviewDraft('Sin comentarios. Tú puedes llamar, usted también.', ctx);
    expect(r.puntos.find((p) => p.id === 5)?.estado).toBe('alerta');
    expect(r.puntos.find((p) => p.id === 9)?.estado).toBe('alerta');
  });

  test('logro durante la veda sale en alerta; sin veda no', () => {
    expect(reviewDraft('Logramos entregar el plan.', { vedaActiva: true, esFamilia: false }).puntos.find((p) => p.id === 11)?.estado).toBe('alerta');
    expect(reviewDraft('Logramos entregar el plan.', ctx).puntos.find((p) => p.id === 11)?.estado).toBe('ok');
  });

  test('en Familia, un menor identificado por nombre sale en alerta', () => {
    const r = reviewDraft('El menor Juan Pérez, de 9 años, fue atendido.', { vedaActiva: false, esFamilia: true });
    expect(r.puntos.find((p) => p.id === 13)?.estado).toBe('alerta');
  });

  test('una hora concreta cumple el punto 1 del próximo parte', () => {
    expect(reviewDraft('El próximo parte sale a las 4:00 p.m.', ctx).puntos.find((p) => p.id === 1)?.estado).toBe('ok');
  });
});

describe('salida estructurada del revisor (schemas.ts)', () => {
  test('acepta una salida bien formada y rechaza tipos incorrectos', () => {
    expect(parseReviewOutput({ puntos: [{ id: 1, ok: true, nota: 'ok' }], titular_peor: 'x' })).not.toBeNull();
    expect(parseReviewOutput({ puntos: [{ id: '1', ok: true, nota: 'ok' }], titular_peor: 'x' })).toBeNull();
    expect(parseReviewOutput({ puntos: 'no' as unknown as [], titular_peor: 'x' })).toBeNull();
  });

  test('el esquema es estricto: sin propiedades extra', () => {
    expect(REVIEW_SCHEMA.additionalProperties).toBe(false);
  });
});
