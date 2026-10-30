import { advisorToolDefs, ADVISOR_TOOL_SPECS, runAdvisorTool } from './index';
import type { AdvisorToolCtx } from './types';

const AGENCY = '6f1c2b3a-1111-4222-8333-444455556666';

const emptyPool = () => ({ query: async () => ({ rows: [] as unknown[] }) });

const ctx = (over: Partial<AdvisorToolCtx> = {}): AdvisorToolCtx => ({
  agencyId: AGENCY,
  agencySlug: 'ddecpr',
  agencyName: 'DDEC',
  userSub: 'user-test',
  asOf: new Date('2026-10-28T15:00:00Z'),
  runId: null,
  pool: emptyPool(),
  ...over,
});

const FORBIDDEN_PROPS = ['agency', 'agency_id', 'agencia', 'agencia_id', 'agency_slug', 'slug', 'as_of', 'asof', 'fecha_corte'];

describe('advisorToolDefs', () => {
  test('nombres en orden fijo', () => {
    expect(advisorToolDefs().map((d) => d.name)).toEqual([
      'situacion_actual',
      'como_viajo',
      'quien_movio_nss',
      'municipios',
      'historial_agencia',
      'calendario_legal',
    ]);
    expect(ADVISOR_TOOL_SPECS.map((s) => s.def.name)).toEqual(advisorToolDefs().map((d) => d.name));
  });

  test('cada schema es objeto estricto sin propiedades de agencia ni de fecha de corte', () => {
    for (const d of advisorToolDefs()) {
      expect(d.strict).toBe(true);
      const s = d.input_schema as { type: string; properties: Record<string, unknown>; required: unknown; additionalProperties: unknown };
      expect(s.type).toBe('object');
      expect(s.additionalProperties).toBe(false);
      expect(Array.isArray(s.required)).toBe(true);
      for (const key of Object.keys(s.properties)) {
        expect(FORBIDDEN_PROPS).not.toContain(key);
      }
      expect(JSON.stringify(d.input_schema)).not.toContain('"as_of"');
    }
  });

  test('las definiciones son deterministas', () => {
    expect(JSON.stringify(advisorToolDefs())).toBe(JSON.stringify(advisorToolDefs()));
  });
});

describe('runAdvisorTool', () => {
  test('nombre desconocido: ok:false con JSON en español, sin lanzar', async () => {
    const r = await runAdvisorTool('no_existe', {}, ctx());
    expect(r.ok).toBe(false);
    expect(JSON.parse(r.text)).toEqual({ ok: false, error: expect.stringContaining('Herramienta desconocida') });
    expect(r.resultTokens).toBe(Math.ceil(r.text.length / 4));
  });

  test('response_format inválido: mensaje accionable con el valor recibido', async () => {
    const r = await runAdvisorTool('situacion_actual', { response_format: 'corto' }, ctx());
    expect(r.ok).toBe(false);
    const msg = (JSON.parse(r.text) as { error: string }).error;
    expect(msg).toContain('"resumen"');
    expect(msg).toContain('"corto"');
  });

  test('intento de elegir agencia: rechazado', async () => {
    const r = await runAdvisorTool('municipios', { agency_id: 'otra' }, ctx());
    expect(r.ok).toBe(false);
    expect((JSON.parse(r.text) as { error: string }).error).toContain('fija el sistema');
  });

  test('fecha de corte: rechazada', async () => {
    const r = await runAdvisorTool('situacion_actual', { as_of: '2026-01-01' }, ctx());
    expect(r.ok).toBe(false);
  });

  test('rango fuera de límites: dias 99 en como_viajo', async () => {
    const r = await runAdvisorTool('como_viajo', { dias: 99 }, ctx());
    expect(r.ok).toBe(false);
    expect((JSON.parse(r.text) as { error: string }).error).toContain('entre 1 y 31');
  });

  test('argumentos que no son objeto', async () => {
    const r = await runAdvisorTool('situacion_actual', 'texto', ctx());
    expect(r.ok).toBe(false);
    expect((JSON.parse(r.text) as { error: string }).error).toContain('objeto JSON');
  });

  test('error de base de datos: ok:false y sin propagar', async () => {
    const pool = { query: async () => { throw new Error('connection refused postgres://secret'); } };
    const r = await runAdvisorTool('situacion_actual', {}, ctx({ pool }));
    expect(r.ok).toBe(false);
    expect(r.text).not.toContain('secret');
  });
});
