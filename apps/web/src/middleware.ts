import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';

// Dashboard UI + dashboard-private API routes. Everything else (public assets,
// auth pages, auth API, health check, Leaflet tiles) passes through.
const PROTECTED_PATHS = [
  /^\/overview(\/.*)?$/,
  /^\/dashboard(\/.*)?$/,
  /^\/mentions(\/.*)?$/,
  /^\/search(\/.*)?$/,
  /^\/sentiment(\/.*)?$/,
  /^\/topics(\/.*)?$/,
  /^\/geography(\/.*)?$/,
  /^\/alerts(\/.*)?$/,
  /^\/settings(\/.*)?$/,
  /^\/narrative(\/.*)?$/,
  /^\/api\/overview(\/.*)?$/,
  /^\/api\/eco-data(\/.*)?$/,
  /^\/api\/eco-geo(\/.*)?$/,
  /^\/api\/eco-mentions(\/.*)?$/,
  /^\/api\/eco-insights(\/.*)?$/,
  /^\/api\/eco-metric-insight(\/.*)?$/,
  /^\/api\/eco-topic-description(\/.*)?$/,
  /^\/api\/alerts(\/.*)?$/,
  /^\/api\/agencies(\/.*)?$/,
  /^\/api\/users(\/.*)?$/,
  /^\/api\/ai(\/.*)?$/,
  /^\/api\/narrative(\/.*)?$/,
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some((re) => re.test(pathname));
}

// Conservative CSP that allows the known externals the dashboard depends on:
//   - Leaflet core + tiles from unpkg and CARTO basemaps
//   - Google Fonts (css + gstatic)
//   - React + ReactDOM from unpkg
//   - Inline <style> in the prototype index.html (acceptable: the file is
//     server-rendered, not user-content, so no XSS vector through it)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
  "connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com",
  // 'self' permite que páginas del mismo origen (p. ej. el prototype del
  // dashboard) embeban /settings/reports en un iframe. Cross-origin sigue
  // bloqueado, así que no abre vector de clickjacking.
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function addSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  // Headers applied to every matched response (including redirects / 401s).
  response.headers.set('Content-Security-Policy', CSP);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // SAMEORIGIN match con frame-ancestors 'self' arriba: permite embedding
  // desde el prototype same-origin pero impide cross-origin clickjacking.
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // Only advertise HSTS once the ALB is serving HTTPS — on plain HTTP browsers
  // ignore it, but when we move to TLS this turns on automatically.
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
  if (proto === 'https') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  const session = getSessionFromRequest(request);
  if (session) {
    const headers = new Headers(request.headers);
    headers.set('x-eco-user-sub', session.sub);
    if (session.email) headers.set('x-eco-user-email', session.email);
    if (session.agencySlug) headers.set('x-eco-user-agency', session.agencySlug);
    return addSecurityHeaders(NextResponse.next({ request: { headers } }), request);
  }

  // API routes get a 401 JSON; everything else bounces to sign-in.
  if (pathname.startsWith('/api/')) {
    return addSecurityHeaders(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      request,
    );
  }
  const redirect = request.nextUrl.clone();
  redirect.pathname = '/sign-in';
  redirect.search = `?next=${encodeURIComponent(pathname + (search || ''))}`;
  return addSecurityHeaders(NextResponse.redirect(redirect), request);
}

export const config = {
  matcher: [
    '/overview/:path*',
    '/dashboard/:path*',
    '/mentions/:path*',
    '/search/:path*',
    '/sentiment/:path*',
    '/topics/:path*',
    '/geography/:path*',
    '/alerts/:path*',
    '/settings/:path*',
    '/narrative/:path*',
    '/overview',
    '/dashboard',
    '/mentions',
    '/search',
    '/sentiment',
    '/topics',
    '/geography',
    '/alerts',
    '/settings',
    '/narrative',
    '/api/overview/:path*',
    '/api/eco-data/:path*',
    '/api/eco-geo/:path*',
    '/api/eco-mentions/:path*',
    '/api/eco-insights/:path*',
    '/api/eco-metric-insight/:path*',
    '/api/eco-topic-description/:path*',
    '/api/alerts/:path*',
    '/api/agencies/:path*',
    '/api/users/:path*',
    '/api/ai/:path*',
    '/api/narrative/:path*',
  ],
};
