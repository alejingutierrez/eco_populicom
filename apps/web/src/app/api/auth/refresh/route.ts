import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ONE_HOUR = 60 * 60;
const REFRESH_COOKIE = 'eco_refresh';

/** Cognito IDP region is encoded in the pool id (e.g. `us-east-1_AbC123`). */
function cognitoRegion(): string {
  const poolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '';
  const region = poolId.split('_')[0];
  return region || process.env.AWS_REGION || 'us-east-1';
}

/**
 * POST /api/auth/refresh
 * Exchanges the httpOnly `eco_refresh` token for a fresh ID token via Cognito's
 * REFRESH_TOKEN_AUTH flow and re-sets the `eco_session` cookie. This is what
 * keeps an active user signed in: the ID token expires in ~1h, but until now
 * the refresh token was stored and never used, so sessions died mid-work and
 * bounced users to the login screen.
 *
 * Public app clients have no secret, so no SECRET_HASH is required. The refresh
 * flow does not return a new refresh token, so `eco_refresh` is left untouched.
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '';
  if (!refreshToken || !clientId) {
    return NextResponse.json({ error: 'no_refresh_token' }, { status: 401 });
  }

  let idToken = '';
  try {
    const resp = await fetch(`https://cognito-idp.${cognitoRegion()}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      }),
      cache: 'no-store',
    });
    if (!resp.ok) {
      // Cognito rejected the refresh token (revoked/expired). 401 → client
      // falls back to the sign-in form. Cookies are left as-is; a fresh login
      // overwrites them.
      return NextResponse.json({ error: 'refresh_rejected' }, { status: 401 });
    }
    const data = (await resp.json()) as { AuthenticationResult?: { IdToken?: string } };
    idToken = data?.AuthenticationResult?.IdToken ?? '';
  } catch {
    // Network/transient error reaching Cognito — do NOT clear the session.
    return NextResponse.json({ error: 'refresh_unavailable' }, { status: 502 });
  }
  if (!idToken) {
    return NextResponse.json({ error: 'no_id_token' }, { status: 401 });
  }

  // TTL mirrors /api/auth/session: derive from the token's own exp, capped 12h.
  let ttl = ONE_HOUR;
  try {
    const claims = decodeJwt(idToken);
    const exp = Number(claims.exp ?? 0);
    if (exp > 0) {
      const secs = Math.floor(exp - Date.now() / 1000);
      if (secs > 60) ttl = Math.min(secs, 12 * ONE_HOUR);
    }
  } catch {
    return NextResponse.json({ error: 'malformed_id_token' }, { status: 502 });
  }

  const res = NextResponse.json({ ok: true, expiresIn: ttl });
  // Secure only over HTTPS — same rationale as /api/auth/session (the ALB runs
  // plain HTTP today; a Secure cookie set over HTTP is never returned).
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  const secure = proto === 'https';
  res.cookies.set(SESSION_COOKIE, idToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: ttl,
  });
  return res;
}
