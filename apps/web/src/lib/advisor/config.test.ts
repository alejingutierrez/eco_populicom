import { advisorAgencies, advisorAllowed, advisorStaffOnly, isAdvisorStaff } from './config';

describe('acceso al asesor (spec §0.4 D1 y D2)', () => {
  test('por defecto solo staff de Populicom', () => {
    expect(advisorStaffOnly({})).toBe(true);
    expect(advisorAllowed({ email: 'ana@populicom.com' }, 'ddecpr', {}).ok).toBe(true);
    expect(advisorAllowed({ email: 'ana@gmail.com' }, 'ddecpr', {})).toEqual({ ok: false, reason: 'staff_only' });
  });

  test('ADVISOR_STAFF_ONLY=false abre el filtro de staff; solo el literal false lo hace', () => {
    expect(advisorStaffOnly({ ADVISOR_STAFF_ONLY: 'false' })).toBe(false);
    expect(advisorStaffOnly({ ADVISOR_STAFF_ONLY: 'no' })).toBe(true);
    expect(advisorAllowed({ email: 'ana@gmail.com' }, 'ddecpr', { ADVISOR_STAFF_ONLY: 'false' }).ok).toBe(true);
  });

  test('agencias por defecto: ddecpr, gobernadora, df; otras rechazadas', () => {
    expect(advisorAgencies({})).toEqual(['ddecpr', 'gobernadora', 'df']);
    expect(advisorAllowed({ email: 'ana@populicom.com' }, 'sgpr', {})).toEqual({ ok: false, reason: 'agency_not_enabled' });
  });

  test('ADVISOR_AGENCIES reemplaza la lista, normaliza mayúsculas y espacios', () => {
    expect(advisorAgencies({ ADVISOR_AGENCIES: ' DDECPR , sgpr ' })).toEqual(['ddecpr', 'sgpr']);
    expect(advisorAllowed({ email: 'ana@populicom.com' }, 'SGPR', { ADVISOR_AGENCIES: 'sgpr' }).ok).toBe(true);
  });

  test('el dominio de staff no se confunde con un sufijo parecido', () => {
    expect(isAdvisorStaff({ email: 'x@populicom.com.evil.io' })).toBe(false);
    expect(isAdvisorStaff({ email: 'X@POPULICOM.COM' })).toBe(true);
    expect(isAdvisorStaff({})).toBe(false);
  });
});
