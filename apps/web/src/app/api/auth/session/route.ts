import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';
import { SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ONE_HOUR = 60 * 60;

/**
 * POST /api/auth/session
 * Body: { idToken: string, refreshToken?: string }
 * Sets httpOnly, Secure, SameSite=Strict cookies with the ID token (used by the
 * middleware to gate dashboard routes) and optional refresh token.
 */
export async function POST(request: NextRequest) {
  let body: { idToken?: string; refreshToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const idToken = typeof body?.idToken === 'string' ? body.idToken.trim() : '';
  if (!idToken) {
    return NextResponse.json({ error: 'idToken required' }, { status: 400 });
  }

  let ttl = ONE_HOUR;
  try {
    const claims = decodeJwt(idToken);
    const exp = Number(claims.exp ?? 0);
    if (exp > 0) {
      const secs = Math.floor(exp - Date.now() / 1000);
      if (secs > 60) ttl = Math.min(secs, 12 * ONE_HOUR);
    }
  } catch {
    return NextResponse.json({ error: 'Malformed idToken' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, expiresIn: ttl });
  const secure = process.env.NODE_ENV === 'production';
  res.cookies.set(SESSION_COOKIE, idToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: ttl,
  });
  if (body.refreshToken) {
    res.cookies.set('eco_refresh', body.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  }
  return res;
}

/** DELETE /api/auth/session — clear cookies (sign out). */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === 'production';
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 0 });
  res.cookies.set('eco_refresh', '', { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 0 });
  // Also clear the old plaintext cookies from the legacy flow, if present.
  res.cookies.set('eco_id_token', '', { path: '/', maxAge: 0 });
  res.cookies.set('eco_access_token', '', { path: '/', maxAge: 0 });
  return res;
}
