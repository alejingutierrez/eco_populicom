import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';

// Dashboard UI + dashboard-private API routes. Everything else (public assets,
// auth pages, auth API, health check, Leaflet tiles via rewrites) passes through.
const PROTECTED_PATHS = [
  /^\/dashboard(\/.*)?$/,
  /^\/mentions(\/.*)?$/,
  /^\/sentiment(\/.*)?$/,
  /^\/topics(\/.*)?$/,
  /^\/geography(\/.*)?$/,
  /^\/alerts(\/.*)?$/,
  /^\/settings(\/.*)?$/,
  /^\/api\/eco-data(\/.*)?$/,
  /^\/api\/eco-mentions(\/.*)?$/,
  /^\/api\/dashboard(\/.*)?$/,
  /^\/api\/metrics(\/.*)?$/,
  /^\/api\/mentions(\/.*)?$/,
  /^\/api\/sentiment(\/.*)?$/,
  /^\/api\/topics(\/.*)?$/,
  /^\/api\/geography(\/.*)?$/,
  /^\/api\/alerts(\/.*)?$/,
  /^\/api\/agencies(\/.*)?$/,
  /^\/api\/users(\/.*)?$/,
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some((re) => re.test(pathname));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  const session = getSessionFromRequest(request);
  if (session) {
    // Forward decoded claims to downstream route handlers via header.
    const headers = new Headers(request.headers);
    headers.set('x-eco-user-sub', session.sub);
    if (session.email) headers.set('x-eco-user-email', session.email);
    if (session.agencySlug) headers.set('x-eco-user-agency', session.agencySlug);
    return NextResponse.next({ request: { headers } });
  }

  // API routes get a 401 JSON; everything else bounces to sign-in.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const redirect = request.nextUrl.clone();
  redirect.pathname = '/sign-in';
  redirect.search = `?next=${encodeURIComponent(pathname + (search || ''))}`;
  return NextResponse.redirect(redirect);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/mentions/:path*',
    '/sentiment/:path*',
    '/topics/:path*',
    '/geography/:path*',
    '/alerts/:path*',
    '/settings/:path*',
    '/dashboard',
    '/mentions',
    '/sentiment',
    '/topics',
    '/geography',
    '/alerts',
    '/settings',
    '/api/eco-data/:path*',
    '/api/eco-mentions/:path*',
    '/api/dashboard/:path*',
    '/api/metrics/:path*',
    '/api/mentions/:path*',
    '/api/sentiment/:path*',
    '/api/topics/:path*',
    '/api/geography/:path*',
    '/api/alerts/:path*',
    '/api/agencies/:path*',
    '/api/users/:path*',
  ],
};
