import {
  parseStrictAgencies, isStrictForSlug, universeOptsForSlug, universeOptsForAgencyId, clearUniverseSlugCache,
  strictOnlyPertinenceSql, universeLabel, anyStrictAgency,
} from './universe-config';
import { universeFilterSql } from '@eco/shared';

describe('UNIVERSE_STRICT_AGENCIES', () => {
  test('vacía, ausente o solo espacios = ninguna agencia estricta', () => {
    for (const raw of [undefined, null, '', '  ', ' , ,']) {
      expect(anyStrictAgency(raw)).toBe(false);
      expect(isStrictForSlug('ddecpr', raw)).toBe(false);
      expect(universeOptsForSlug('ddecpr', raw)).toEqual({});
    }
  });

  test('lista de slugs: sin importar mayúsculas ni espacios', () => {
    expect(isStrictForSlug('ddecpr', 'ddecpr, DF ')).toBe(true);
    expect(isStrictForSlug('df', 'ddecpr, DF ')).toBe(true);
    expect(isStrictForSlug('aaa', 'ddecpr, DF ')).toBe(false);
    expect(isStrictForSlug(null, 'ddecpr')).toBe(false);
  });

  test('* = todas las agencias', () => {
    expect(isStrictForSlug('aaa', '*')).toBe(true);
    expect(parseStrictAgencies('*').all).toBe(true);
  });

  test('las opciones vacías dan EXACTAMENTE el predicado histórico', () => {
    expect(universeFilterSql(universeOptsForSlug('aaa', 'ddecpr'), 'm.')).toBe(universeFilterSql(undefined, 'm.'));
    expect(universeFilterSql(universeOptsForSlug('ddecpr', 'ddecpr'), 'm.')).toContain("nlp_pertinence IN ('alta','media')");
  });
});

describe('universeOptsForAgencyId', () => {
  beforeEach(() => clearUniverseSlugCache());

  test('con la bandera vacía responde sin tocar la base', async () => {
    const lookup = { query: jest.fn() };
    expect(await universeOptsForAgencyId('id-1', lookup, '')).toEqual({});
    expect(lookup.query).not.toHaveBeenCalled();
  });

  test('con bandera resuelve el slug UNA vez y lo cachea', async () => {
    const lookup = { query: jest.fn(async () => ({ rows: [{ slug: 'ddecpr' }] })) };
    expect(await universeOptsForAgencyId('id-1', lookup, 'ddecpr')).toEqual({ strictUniverse: true });
    expect(await universeOptsForAgencyId('id-1', lookup, 'ddecpr')).toEqual({ strictUniverse: true });
    expect(lookup.query).toHaveBeenCalledTimes(1);
  });

  test('otra agencia con la bandera de ddecpr queda en histórico', async () => {
    const lookup = { query: jest.fn(async () => ({ rows: [{ slug: 'aaa' }] })) };
    expect(await universeOptsForAgencyId('id-2', lookup, 'ddecpr')).toEqual({});
  });

  test('* no necesita el slug', async () => {
    const lookup = { query: jest.fn() };
    expect(await universeOptsForAgencyId('id-3', lookup, '*')).toEqual({ strictUniverse: true });
    expect(lookup.query).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  test('strictOnlyPertinenceSql: vacío sin bandera; AND … con bandera', () => {
    expect(strictOnlyPertinenceSql({}, 'm.')).toBe('');
    expect(strictOnlyPertinenceSql(undefined, 'm.')).toBe('');
    expect(strictOnlyPertinenceSql({ strictUniverse: true }, 'm.')).toBe("AND m.is_duplicate = false AND m.nlp_pertinence IN ('alta','media')");
  });
  test('universeLabel dice qué universo muestra la lista', () => {
    expect(universeLabel({}, false)).toBe('sin pertinencia baja');
    expect(universeLabel({ strictUniverse: true }, false)).toBe('sin pertinencia baja');
    expect(universeLabel({}, true)).toBe('todas las pertinencias');
  });
});
