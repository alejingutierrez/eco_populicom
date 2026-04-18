import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { decodeJwt } from 'jose';

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
  agencySlug?: string;
  exp: number;
}

const ID_COOKIE = 'eco_session';

function parseToken(token: string | undefined): SessionUser | null {
  if (!token) return null;
  try {
    const claims = decodeJwt(token);
    const exp = Number(claims.exp ?? 0);
    if (!exp || exp * 1000 < Date.now()) return null;
    return {
      sub: String(claims.sub ?? ''),
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      groups: Array.isArray(claims['cognito:groups']) ? (claims['cognito:groups'] as string[]) : undefined,
      agencySlug: typeof (claims as Record<string, unknown>)['custom:agency_slug'] === 'string'
        ? ((claims as Record<string, unknown>)['custom:agency_slug'] as string)
        : undefined,
      exp,
    };
  } catch {
    return null;
  }
}

/** Read session from a server component / route handler (uses next/headers). */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return parseToken(store.get(ID_COOKIE)?.value);
}

/** Read session from a NextRequest (middleware or Route Handler with the req object). */
export function getSessionFromRequest(request: NextRequest): SessionUser | null {
  return parseToken(request.cookies.get(ID_COOKIE)?.value);
}

export const SESSION_COOKIE = ID_COOKIE;
