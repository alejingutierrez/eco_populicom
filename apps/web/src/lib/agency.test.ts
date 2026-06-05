/**
 * Tests for resolveAgencyId / resolveAllowedAgencySlugs — the per-user agency
 * authorization shared by every dashboard data route.
 *
 * Rules under test (see ./agency.ts):
 *   - Authenticated: the explicit ?agency= (switcher) is honored ONLY if it's
 *     within the user's allowed set; otherwise fall back to their primary.
 *   - Allowed set: a users row with all_agencies=true → every agency; a row
 *     with explicit user_agencies → those ∪ the primary; no row → domain rule
 *     (@populicom.com → all, else the JWT agency only).
 *   - No session (public/seed): ?agency= → default slug → first active.
 *
 * SECURITY: the "param within allowed set" check is the tenant-isolation
 * boundary — a user must never resolve to an agency outside their grants.
 */
import { headers } from 'next/headers';
import { resolveAgencyId, resolveAllowedAgencySlugs, clearAccessCache } from './agency';

jest.mock('next/headers', () => ({ headers: jest.fn() }));
jest.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
  or: (...conds: unknown[]) => ({ kind: 'or', conds }),
}));

// --- in-memory DB state (configured per test) ---
type Row = Record<string, unknown>;
let mockAgenciesRows: Row[] = [];
let mockUsersRows: Row[] = [];
let mockUserAgenciesRows: Row[] = [];

jest.mock('@eco/database', () => {
  const agencies = { id: 'agencies.id', slug: 'agencies.slug', isActive: 'agencies.isActive', name: 'agencies.name' };
  const users = { id: 'users.id', cognitoSub: 'users.cognitoSub', email: 'users.email', allAgencies: 'users.allAgencies', agencyId: 'users.agencyId' };
  const userAgencies = { userId: 'user_agencies.userId', agencyId: 'user_agencies.agencyId' };

  const field = (col: unknown) => String(col).split('.')[1];

  const match = (row: Row, cond: { kind: string; col?: unknown; val?: unknown; conds?: unknown[] } | undefined): boolean => {
    if (!cond) return true;
    if (cond.kind === 'or') return (cond.conds as { kind: string }[]).some((c) => match(row, c as never));
    if (cond.kind === 'eq') return row[field(cond.col)] === cond.val;
    return true;
  };
  const dataFor = (name: string): Row[] =>
    name === 'agencies' ? mockAgenciesRows : name === 'users' ? mockUsersRows : mockUserAgenciesRows;
  const project = (rows: Row[], cols: Record<string, unknown> | null): Row[] =>
    !cols ? rows : rows.map((r) => {
      const o: Row = {};
      for (const k of Object.keys(cols)) o[k] = r[field(cols[k])];
      return o;
    });

  const getDb = () => ({
    select: (cols?: Record<string, unknown>) => {
      const state: { cols: Record<string, unknown> | null; table: string; cond?: unknown } = { cols: cols ?? null, table: '' };
      const run = () => project(dataFor(state.table).filter((r) => match(r, state.cond as never)), state.cols);
      const chain: Record<string, unknown> = {
        where(cond: unknown) { state.cond = cond; return chain; },
        limit() { return Promise.resolve(run()); },
        orderBy() { return Promise.resolve(run()); },
        then(res: (v: Row[]) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
      };
      return {
        from(tbl: unknown) {
          state.table = tbl === agencies ? 'agencies' : tbl === users ? 'users' : 'user_agencies';
          return chain;
        },
      };
    },
  });

  return { agencies, users, userAgencies, getDb };
});

// --- helpers ---
function session(opts: { sub?: string | null; email?: string | null; slug?: string | null }) {
  (headers as jest.Mock).mockResolvedValue({
    get: (k: string) =>
      k === 'x-eco-user-sub' ? opts.sub ?? null
      : k === 'x-eco-user-email' ? opts.email ?? null
      : k === 'x-eco-user-agency' ? opts.slug ?? null
      : null,
  });
}
function noSession() {
  (headers as jest.Mock).mockResolvedValue({ get: () => null });
}
const params = (qs = '') => new URLSearchParams(qs);

const AAA = 'id-aaa';
const DDEC = 'id-ddecpr';
const OTHER = 'id-other';

beforeEach(() => {
  jest.clearAllMocks();
  clearAccessCache();
  mockAgenciesRows = [
    { id: AAA, slug: 'aaa', isActive: true, name: 'AAA' },
    { id: DDEC, slug: 'ddecpr', isActive: true, name: 'DDEC' },
    { id: OTHER, slug: 'other', isActive: true, name: 'Other' },
  ];
  mockUsersRows = [];
  mockUserAgenciesRows = [];
});

describe('resolveAgencyId — no session (public / seed)', () => {
  test('explicit ?agency= is used', async () => {
    noSession();
    expect(await resolveAgencyId(params('agency=ddecpr'))).toBe(DDEC);
  });
  test('no param resolves to the default slug (aaa)', async () => {
    noSession();
    expect(await resolveAgencyId(params(''))).toBe(AAA);
  });
});

describe('resolveAgencyId — user with all_agencies', () => {
  beforeEach(() => {
    mockUsersRows = [{ id: 'u1', cognitoSub: 'sub-1', email: 'a@populicom.com', allAgencies: true, agencyId: DDEC }];
  });
  test('switcher can select any active agency', async () => {
    session({ sub: 'sub-1', email: 'a@populicom.com', slug: 'ddecpr' });
    expect(await resolveAgencyId(params('agency=aaa'))).toBe(AAA);
    clearAccessCache();
    expect(await resolveAgencyId(params('agency=other'))).toBe(OTHER);
  });
  test('no param → primary agency', async () => {
    session({ sub: 'sub-1', email: 'a@populicom.com', slug: 'ddecpr' });
    expect(await resolveAgencyId(params(''))).toBe(DDEC);
  });
  test('resolveAllowedAgencySlugs → null (all)', async () => {
    session({ sub: 'sub-1', email: 'a@populicom.com', slug: 'ddecpr' });
    expect(await resolveAllowedAgencySlugs()).toBeNull();
  });
});

describe('resolveAgencyId — user with explicit grants', () => {
  beforeEach(() => {
    // primary ddecpr, also granted aaa. NOT granted 'other'.
    mockUsersRows = [{ id: 'u2', cognitoSub: 'sub-2', email: 'cliente@ddec.pr.gov', allAgencies: false, agencyId: DDEC }];
    mockUserAgenciesRows = [{ userId: 'u2', agencyId: AAA }];
  });
  test('?agency= within the granted set is honored', async () => {
    session({ sub: 'sub-2', email: 'cliente@ddec.pr.gov', slug: 'ddecpr' });
    expect(await resolveAgencyId(params('agency=aaa'))).toBe(AAA);
  });
  test('primary agency is always allowed', async () => {
    session({ sub: 'sub-2', email: 'cliente@ddec.pr.gov', slug: 'ddecpr' });
    expect(await resolveAgencyId(params('agency=ddecpr'))).toBe(DDEC);
  });
  test('?agency= OUTSIDE the granted set falls back to the primary', async () => {
    session({ sub: 'sub-2', email: 'cliente@ddec.pr.gov', slug: 'ddecpr' });
    expect(await resolveAgencyId(params('agency=other'))).toBe(DDEC);
  });
  test('resolveAllowedAgencySlugs → granted ∪ primary', async () => {
    session({ sub: 'sub-2', email: 'cliente@ddec.pr.gov', slug: 'ddecpr' });
    const slugs = await resolveAllowedAgencySlugs();
    expect(slugs && [...slugs].sort()).toEqual(['aaa', 'ddecpr']);
  });
});

describe('resolveAgencyId — no users row yet (domain fallback)', () => {
  test('staff (@populicom.com) may switch into any agency', async () => {
    session({ sub: 'sub-x', email: 'staff@populicom.com', slug: 'ddecpr' });
    expect(await resolveAgencyId(params('agency=aaa'))).toBe(AAA);
  });
  test('non-staff is limited to their JWT agency', async () => {
    session({ sub: 'sub-y', email: 'someone@ddec.pr.gov', slug: 'ddecpr' });
    expect(await resolveAgencyId(params('agency=aaa'))).toBe(DDEC); // request denied → primary
  });
  test('non-staff resolveAllowedAgencySlugs → only their JWT agency', async () => {
    session({ sub: 'sub-y', email: 'someone@ddec.pr.gov', slug: 'ddecpr' });
    expect(await resolveAllowedAgencySlugs()).toEqual(['ddecpr']);
  });
});
