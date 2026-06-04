/**
 * Tests for resolveAgencyId — the agency-resolution precedence shared by every
 * dashboard data route (eco-data, overview, mentions, narratives, alerts, ...).
 *
 * Precedence under test (see ./agency.ts):
 *   1. explicit ?agency= query param  — the dashboard's agency switcher
 *   2. session agency from the JWT     — x-eco-user-agency header (middleware)
 *   3. DEFAULT_AGENCY_SLUG ('aaa')      — seed/bootstrap/public contexts
 *   4. first active agency              — DB last-resort so the app never 404s
 *
 * SECURITY: "explicit param overrides session" is the rule that makes the
 * switcher work AND the rule that currently lets any authenticated user read
 * any agency. When per-user agency access lands, the param must be validated
 * against the user's allowed set before step 1 wins — add those cases here.
 */
import { headers } from 'next/headers';
import { resolveAgencyId } from './agency';

// --- mocks -----------------------------------------------------------------
jest.mock('next/headers', () => ({ headers: jest.fn() }));
jest.mock('drizzle-orm', () => ({ eq: (col: unknown, val: unknown) => ({ col, val }) }));

// Per-test DB state. Names start with `mock` so jest.mock's factory may
// reference them despite hoisting.
let mockSlugToId: Record<string, string> = {};
let mockFirstActiveId: string | null = null;

jest.mock('@eco/database', () => {
  const agencies = { id: Symbol('id'), slug: Symbol('slug'), isActive: Symbol('isActive') };
  const getDb = () => ({
    select: () => ({
      from: () => ({
        where: (cond: { col: unknown; val: unknown }) => ({
          limit: () => {
            // slugToId(): SELECT id FROM agencies WHERE slug = <val>
            if (cond.col === agencies.slug) {
              const id = mockSlugToId[String(cond.val)];
              return Promise.resolve(id ? [{ id }] : []);
            }
            // fallback: SELECT id FROM agencies WHERE isActive = true
            return Promise.resolve(mockFirstActiveId ? [{ id: mockFirstActiveId }] : []);
          },
        }),
      }),
    }),
  });
  return { agencies, getDb };
});

// --- helpers ---------------------------------------------------------------
function withSession(slug: string | null) {
  (headers as jest.Mock).mockResolvedValue({
    get: (k: string) => (k === 'x-eco-user-agency' ? slug : null),
  });
}
function outsideRequestScope() {
  // headers() throws outside a request scope (seed/bootstrap/CLI tools).
  (headers as jest.Mock).mockRejectedValue(new Error('headers() outside request scope'));
}
const params = (qs = '') => new URLSearchParams(qs);

beforeEach(() => {
  jest.clearAllMocks();
  mockSlugToId = { aaa: 'id-aaa', ddecpr: 'id-ddecpr', other: 'id-other' };
  mockFirstActiveId = 'id-first-active';
});

describe('resolveAgencyId — switcher behavior (param vs session)', () => {
  test('explicit ?agency= overrides the session agency', async () => {
    withSession('ddecpr');
    expect(await resolveAgencyId(params('agency=aaa'))).toBe('id-aaa');
  });

  test('explicit ?agency= equal to the session agency resolves to it', async () => {
    withSession('ddecpr');
    expect(await resolveAgencyId(params('agency=ddecpr'))).toBe('id-ddecpr');
  });

  test('switching resolves to whichever slug is in the URL', async () => {
    withSession('ddecpr');
    expect(await resolveAgencyId(params('agency=aaa'))).toBe('id-aaa');
    expect(await resolveAgencyId(params('agency=other'))).toBe('id-other');
    expect(await resolveAgencyId(params('agency=ddecpr'))).toBe('id-ddecpr');
  });
});

describe('resolveAgencyId — fallback to session', () => {
  test('no ?agency= falls back to the session agency', async () => {
    withSession('ddecpr');
    expect(await resolveAgencyId(params(''))).toBe('id-ddecpr');
  });

  test('empty "agency=" is ignored and falls back to session', async () => {
    withSession('ddecpr');
    expect(await resolveAgencyId(params('agency='))).toBe('id-ddecpr');
  });

  test('an unknown ?agency= slug falls through to the session agency', async () => {
    withSession('ddecpr');
    expect(await resolveAgencyId(params('agency=does-not-exist'))).toBe('id-ddecpr');
  });
});

describe('resolveAgencyId — unauthenticated / public contexts', () => {
  test('no session + explicit ?agency= uses the param', async () => {
    withSession(null);
    expect(await resolveAgencyId(params('agency=aaa'))).toBe('id-aaa');
  });

  test('no session + no param resolves to the default slug (aaa)', async () => {
    withSession(null);
    expect(await resolveAgencyId(params(''))).toBe('id-aaa');
  });

  test('headers() unavailable + param still uses the param', async () => {
    outsideRequestScope();
    expect(await resolveAgencyId(params('agency=other'))).toBe('id-other');
  });

  test('headers() unavailable + no param resolves to the default slug', async () => {
    outsideRequestScope();
    expect(await resolveAgencyId(params(''))).toBe('id-aaa');
  });
});

describe('resolveAgencyId — last-resort DB fallback', () => {
  test('no param, no session, default slug missing → first active agency', async () => {
    withSession(null);
    mockSlugToId = {}; // even 'aaa' is unknown
    expect(await resolveAgencyId(params(''))).toBe('id-first-active');
  });

  test('unknown param, no session, default slug missing → first active agency', async () => {
    withSession(null);
    mockSlugToId = {};
    expect(await resolveAgencyId(params('agency=ghost'))).toBe('id-first-active');
  });

  test('nothing resolves and no active agency → null', async () => {
    withSession(null);
    mockSlugToId = {};
    mockFirstActiveId = null;
    expect(await resolveAgencyId(params(''))).toBeNull();
  });
});
