import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface SessionUser {
  sub: string;
  email?: string;
  name?: string;
  groups?: string[];
  agencySlug?: string;
  exp: number;
}

const ID_COOKIE = 'eco_session';

/**
 * La sesión es el ID token de Cognito guardado en una cookie httpOnly. Hasta
 * nov-2026 solo se DECODIFICABA (`decodeJwt`): cualquiera podía fabricar un
 * token sin firma con el correo y los grupos que quisiera. Ahora se verifica
 * la firma contra el JWKS del user pool, además de emisor, audiencia (app
 * client) y `token_use = id`. Sin configuración de Cognito no hay sesión
 * válida: se falla cerrado.
 */
function cognitoConfig(): { issuer: string; clientId: string } | null {
  const poolId = process.env.COGNITO_USER_POOL_ID || process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '';
  const clientId = process.env.COGNITO_CLIENT_ID || process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '';
  const region = poolId.split('_')[0];
  if (!poolId || !region || !clientId) return null;
  return { issuer: `https://cognito-idp.${region}.amazonaws.com/${poolId}`, clientId };
}

let keyResolver: JWTVerifyGetKey | null = null;
let keyResolverIssuer = '';
let warnedNoConfig = false;

function jwksFor(issuer: string): JWTVerifyGetKey {
  if (!keyResolver || keyResolverIssuer !== issuer) {
    // createRemoteJWKSet cachea las llaves y las vuelve a pedir cuando aparece
    // un `kid` desconocido (rotación de llaves de Cognito).
    keyResolver = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    keyResolverIssuer = issuer;
  }
  return keyResolver;
}

/** Solo para pruebas: sustituye el JWKS remoto por un resolvedor local. */
export function __setKeyResolverForTests(resolver: JWTVerifyGetKey | null, issuer = ''): void {
  keyResolver = resolver;
  keyResolverIssuer = issuer;
  verified.clear();
}

// Un mismo token se presenta en cada petición de la página (una docena de
// llamadas por vista): se guarda el resultado ya verificado hasta su `exp`.
const verified = new Map<string, SessionUser>();
const VERIFIED_MAX = 500;

function toSessionUser(claims: JWTPayload): SessionUser | null {
  const exp = Number(claims.exp ?? 0);
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!exp || !sub) return null;
  const raw = claims as Record<string, unknown>;
  return {
    sub,
    email: typeof raw.email === 'string' ? raw.email : undefined,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    groups: Array.isArray(raw['cognito:groups']) ? (raw['cognito:groups'] as string[]) : undefined,
    agencySlug: typeof raw['custom:agency_slug'] === 'string' ? (raw['custom:agency_slug'] as string) : undefined,
    exp,
  };
}

/**
 * Verifica un ID token de Cognito y devuelve el usuario, o null si la firma,
 * el emisor, la audiencia, el tipo o la vigencia no son válidos.
 */
export async function verifyIdToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;

  const cached = verified.get(token);
  if (cached) {
    if (cached.exp * 1000 > Date.now()) return cached;
    verified.delete(token);
    return null;
  }

  const cfg = cognitoConfig();
  if (!cfg) {
    if (!warnedNoConfig) {
      warnedNoConfig = true;
      console.error('[session] falta la configuración de Cognito (pool o client id): ninguna sesión es válida');
    }
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, jwksFor(cfg.issuer), {
      issuer: cfg.issuer,
      audience: cfg.clientId,
      algorithms: ['RS256'],
    });
    if (payload.token_use !== 'id') return null;
    const user = toSessionUser(payload);
    if (!user) return null;
    if (verified.size >= VERIFIED_MAX) verified.clear();
    verified.set(token, user);
    return user;
  } catch {
    return null;
  }
}

/** Read session from a server component / route handler (uses next/headers). */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifyIdToken(store.get(ID_COOKIE)?.value);
}

/** Read session from a NextRequest (middleware or Route Handler with the req object). */
export async function getSessionFromRequest(request: NextRequest): Promise<SessionUser | null> {
  return verifyIdToken(request.cookies.get(ID_COOKIE)?.value);
}

export const SESSION_COOKIE = ID_COOKIE;
