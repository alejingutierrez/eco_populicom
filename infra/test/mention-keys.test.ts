import {
  EXISTING_MENTIONS_SQL,
  MENTION_CONFLICT_TARGET,
  mentionKey,
  selectNewRecords,
  type BatchEntry,
} from '../lambda/lib/mention-keys';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

const entry = (record: string, over: Partial<BatchEntry<string>> = {}): BatchEntry<string> =>
  ({ record, valid: true, agencyId: A, resourceId: 'r1', ...over });

describe('mentionKey', () => {
  it('distingue la misma nota en agencias distintas', () => {
    expect(mentionKey(A, 'r1')).not.toBe(mentionKey(B, 'r1'));
    expect(mentionKey(A, 'r1')).toBe(mentionKey(A, 'r1'));
  });
});

describe('selectNewRecords', () => {
  it('salta lo que ya existe para SU agencia, no para otra', () => {
    const existing = new Set([mentionKey(A, 'r1')]);
    const out = selectNewRecords([
      entry('A-r1 (ya está en A)'),
      entry('B-r1 (solo está en A: es nueva para B)', { agencyId: B }),
    ], existing);
    expect(out).toEqual(['B-r1 (solo está en A: es nueva para B)']);
  });

  it('deja pasar lo que no se puede llavear: processRecord lo refresca o rechaza', () => {
    const existing = new Set([mentionKey(A, 'r1')]);
    const out = selectNewRecords([
      entry('sin agencia en el mapa cacheado', { agencyId: undefined }),
      entry('sin resourceId', { resourceId: undefined }),
    ], existing);
    expect(out).toEqual(['sin agencia en el mapa cacheado', 'sin resourceId']);
  });

  it('descarta el cuerpo que no es JSON', () => {
    expect(selectNewRecords([entry('roto', { valid: false })], new Set())).toEqual([]);
  });
});

describe('SQL compartido con el processor', () => {
  it('el árbitro del INSERT es el índice por agencia, nunca resourceId solo', () => {
    expect(MENTION_CONFLICT_TARGET).toBe('(agency_id, bw_resource_id)');
  });

  it('la consulta de existencia cruza agencia Y resourceId', () => {
    expect(EXISTING_MENTIONS_SQL).toMatch(/m\.agency_id = k\.agency_id AND m\.bw_resource_id = k\.resource_id/);
  });
});
