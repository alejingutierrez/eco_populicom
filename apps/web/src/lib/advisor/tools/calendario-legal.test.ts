import { vedaStatus, VEDA_ELECTORAL } from '../calendar';
import { runAdvisorTool } from './index';
import type { AdvisorToolCtx } from './types';

const AGENCY = '6f1c2b3a-1111-4222-8333-444455556666';

const ctxWith = (pool: unknown, asOf = '2026-10-28T15:00:00Z'): AdvisorToolCtx => ({
  agencyId: AGENCY,
  agencySlug: 'ddecpr',
  agencyName: 'DDEC',
  userSub: 'user-test',
  asOf: new Date(asOf),
  runId: null,
  pool: pool as AdvisorToolCtx['pool'],
});

describe('vedaStatus', () => {
  test('hoy (2026) no hay veda; la próxima empieza el 1-ene-2028 según el manual', () => {
    const s = vedaStatus('2026-10-28');
    expect(s.estado).toBe('no vigente');
    expect(s.proximaInicio).toBe('2028-01-01');
    expect(s.fin).toBe('sin fecha confirmada en la versión del manual');
  });

  test('el día anterior al inicio sigue sin veda; el inicio la activa', () => {
    expect(vedaStatus('2027-12-31').estado).toBe('no vigente');
    const s = vedaStatus('2028-01-01');
    expect(s.estado).toBe('vigente');
    expect(s.texto).toContain('sin fecha confirmada');
  });

  test('el manual no da fecha de cierre: no se inventa', () => {
    expect(VEDA_ELECTORAL.fin).toBeNull();
  });
});

describe('calendario_legal', () => {
  test('tabla advisor_legal_calendar inexistente (42P01): sin emergencias registradas', async () => {
    const pool = {
      query: async () => {
        const e = new Error('relation "advisor_legal_calendar" does not exist') as Error & { code?: string };
        e.code = '42P01';
        throw e;
      },
    };
    const r = await runAdvisorTool('calendario_legal', {}, ctxWith(pool));
    expect(r.ok).toBe(true);
    const body = JSON.parse(r.text) as { veda_electoral: { estado: string }; emergencias: { nota: string; items: unknown[] } };
    expect(body.emergencias.nota).toBe('sin emergencias registradas');
    expect(body.emergencias.items).toEqual([]);
    expect(body.veda_electoral.estado).toBe('no vigente');
  });

  test('emergencias: clasifica activa, futura y pasada; alcance null = toda la isla', async () => {
    const pool = {
      query: async () => ({
        rows: [
          { id: 'a', starts_on: '2026-10-20', ends_on: '2026-11-05', reference: 'Proclama 1', municipalities: null },
          { id: 'b', starts_on: '2026-11-10', ends_on: '2026-11-12', reference: 'Proclama 2', municipalities: ['Canóvanas'] },
          { id: 'c', starts_on: '2026-09-01', ends_on: '2026-09-05', reference: 'Proclama 0', municipalities: null },
        ],
      }),
    };
    const r = await runAdvisorTool('calendario_legal', { response_format: 'detalle' }, ctxWith(pool));
    expect(r.ok).toBe(true);
    const body = JSON.parse(r.text) as { emergencias: { items: Array<{ id: string; estado: string; alcance: unknown }> }; veda_electoral: { que_prohibe: unknown } };
    expect(body.emergencias.items.map((i) => [i.id, i.estado])).toEqual([['a', 'activa'], ['b', 'futura'], ['c', 'pasada']]);
    expect(body.emergencias.items[0].alcance).toBe('toda la isla');
    expect(body.emergencias.items[1].alcance).toEqual(['Canóvanas']);
    expect(body.veda_electoral.que_prohibe).toBeDefined();
  });

  test('otros errores de base de datos no se ocultan como «sin emergencias»', async () => {
    const pool = { query: async () => { throw new Error('boom'); } };
    const r = await runAdvisorTool('calendario_legal', {}, ctxWith(pool));
    expect(r.ok).toBe(false);
  });
});
