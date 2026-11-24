/**
 * Permiso de la página de Alertas (COR-04): ya no es una lista de correos.
 */
jest.mock('@eco/database', () => ({ getDb: jest.fn(), users: {} }));
jest.mock('@/lib/session', () => ({ getSession: jest.fn() }));

import { canSeeAlerts, pageAllowed } from './require-admin';

describe('permiso por página', () => {
  it('lista vacía o nula = todas las páginas', () => {
    expect(pageAllowed(null, 'alerts')).toBe(true);
    expect(pageAllowed(undefined, 'alerts')).toBe(true);
    expect(pageAllowed([], 'alerts')).toBe(true);
  });

  it('con lista, solo las páginas listadas', () => {
    expect(pageAllowed(['overview', 'alerts'], 'alerts')).toBe(true);
    expect(pageAllowed(['overview', 'mentions'], 'alerts')).toBe(false);
  });

  it('Alertas se decide por la lista de páginas, no por el correo', () => {
    expect(canSeeAlerts(null)).toBe(true);
    expect(canSeeAlerts(['overview'])).toBe(false);
    expect(canSeeAlerts(['alerts'])).toBe(true);
  });
});
