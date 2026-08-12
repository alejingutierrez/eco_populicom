# Autenticación y seguridad

## Flujo de autenticación

1. **Sign-in (browser)**: el cliente usa `amazon-cognito-identity-js` con SRP
   contra el user pool `eco-users` (`apps/web/src/lib/auth/cognito.ts:31-49`). El
   pool no tiene client secret (`auth-stack.ts:69-75`).
2. **Sesión (servidor)**: el id token se envía a `POST /api/auth/session`
   (`auth/session/route.ts:15-64`), que lo guarda en una cookie **httpOnly**
   `eco_session` (`SameSite=Strict`, `path=/`, TTL = exp del token, máx 12h) y un
   `eco_refresh` (30 días). La bandera `Secure` se activa **solo si la request vino
   por HTTPS** (`x-forwarded-proto === 'https'`) — porque el ALB sirve HTTP plano
   hoy y una cookie `Secure` sobre HTTP nunca volvería, dejando a los usuarios
   bloqueados.
3. **Gate (middleware)**: `apps/web/src/middleware.ts` decodifica la cookie
   (`getSessionFromRequest`) en cada request a rutas protegidas. Si hay sesión
   válida, inyecta headers `x-eco-user-sub`, `x-eco-user-email` y
   `x-eco-user-agency` para las rutas downstream (`middleware.ts:76-83`). Si no:
   API → `401 JSON`, páginas → redirect a `/sign-in`.

El token se decodifica con `jose.decodeJwt` (`apps/web/src/lib/session.ts:16-35`).
Importante: `decodeJwt` **decodifica pero no verifica la firma** del JWT; la
validación que se hace es de expiración (`exp`). La confianza se apoya en que la
cookie es httpOnly y la fija el propio backend tras un sign-in Cognito exitoso.

---

## Multi-tenancy

El atributo custom de Cognito **`agency_slug`** (claim `custom:agency_slug`)
determina el tenant del usuario. El middleware lo propaga como
`x-eco-user-agency`; `resolveAgencyId` lo traduce a `agency_id` y todas las queries
se filtran por esa agencia (`apps/web/src/lib/agency.ts`). Sin el atributo, la API
cae a la agencia por defecto (`aaa`) o a la primera activa — exactamente el bug que
motivó añadir el atributo (`auth-stack.ts:36-45`).

---

## Roles y autorización

Existen **tres roles** en dos lugares:

- **Grupos Cognito**: `admin`, `analyst`, `viewer` (`auth-stack.ts:50-66`), en el
  claim `cognito:groups`.
- **Tabla `users`**: columna `role` enum `admin|analyst|viewer`
  (`packages/database/src/schema/users.ts:4`).

### Helpers de autorización

`apps/web/src/lib/auth/require-admin.ts`:

- **`requireAdmin()`**: exige sesión válida **y** `groups.includes('admin')`; si no,
  401/403 (`require-admin.ts:9-21`).
- **`requireAuth()`**: solo exige sesión válida (`require-admin.ts:24-33`).

### Dónde se aplica `requireAdmin`

**Únicamente en `/api/reports/*`**:
`reports/config` (GET/PUT), `reports/history` (GET), `reports/send-test` (POST).
(`grep requireAdmin` → solo esos tres archivos.)

### Brecha de enforcement de roles

> **Hallazgo de seguridad.** A nivel servidor, el rol `admin` solo se exige en
> `/api/reports/*`. Las rutas de gestión de usuarios y alertas **no** lo exigen:
>
> - **`/api/users` (GET/POST) y `/api/users/[id]` (PATCH/DELETE)**: listan, invitan,
>   actualizan y eliminan usuarios. Solo resuelven la agencia del header de sesión
>   (`users/route.ts:30-87`); **no** llaman `requireAdmin`. Cualquier usuario
>   autenticado —incluido un `viewer`— puede gestionar usuarios de su propia
>   agencia (incluso asignar `role: 'admin'` al invitar, `users/route.ts:65`).
> - **`/api/alerts` (GET/POST)** y `/api/alerts/history`: CRUD de reglas de alerta,
>   también sin `requireAdmin` (`alerts/route.ts:26-98`).
> - **`/api/agencies` (GET)**: sin `requireAdmin` ni rate limit (solo middleware).
>
> Los roles `analyst` y `viewer` **existen** (Cognito + tabla `users`) pero **no
> tienen enforcement server-side diferenciado**: el middleware solo distingue
> "autenticado vs no". Cualquier distinción de rol en la UI es cosmética y se puede
> sortear llamando directo a la API. El único corte real de privilegio es
> `admin → /api/reports/*`.
>
> Además, **`/api/admin/*`** (`diagnostics`, `invited-users-cleanup`) **no** usa
> Cognito en absoluto: se autoriza con el header `x-eco-cron-secret` igual a
> `ECO_CRON_SECRET` (`admin/diagnostics/route.ts:16-20`). Es un canal de
> servicio/cron, no de usuario.
>
> El mapa de partida afirmaba que `/api/users` y `/api/admin` usan `requireAdmin`;
> el código **no** lo confirma. Estado real documentado arriba.

### `/api/narrative` (singular) fuera del matcher

El matcher del middleware lista `/api/narratives/:path*` (plural) pero **no**
`/api/narrative/:path*` (singular) (`middleware.ts:118-128`). Las rutas singulares
(`/api/narrative`, `/api/narrative/[id]`, `/api/narrative/[id]/day`) no pasan por
el gate de sesión del middleware; solo se autolimitan por rate limit. Punto a
revisar.

---

## Headers de seguridad y CSP

`addSecurityHeaders` aplica en cada respuesta de ruta protegida
(`middleware.ts:54-70`):

- **Content-Security-Policy** (`middleware.ts:39-52`):
  - `default-src 'self'`
  - `script-src 'self' 'unsafe-inline' https://unpkg.com`
  - `style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com`
  - `font-src 'self' https://fonts.gstatic.com data:`
  - `img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org`
  - `connect-src 'self' https://cognito-idp.us-east-1.amazonaws.com`
  - `frame-ancestors 'self'`, `base-uri 'self'`, `form-action 'self'`
  - Nota: `'unsafe-inline'` en scripts/estilos es necesario por el prototipo
    server-rendido; reduce la protección XSS de la CSP.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN` (alineado con `frame-ancestors 'self'`: permite
  embeber `/settings/reports` same-origin, bloquea clickjacking cross-origin).
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- **HSTS**: solo si `x-forwarded-proto === 'https'` (hoy no, por el ALB HTTP).

---

## Red y datos en reposo

- RDS en subredes privadas; solo accesible desde Fargate y Lambda (security groups,
  `network-stack.ts:62-76`). Sin egress.
- Conexiones a RDS con TLS (`ssl: { rejectUnauthorized: false }` en los clientes
  `pg`) — cifrado en tránsito, sin validación de CA.
- S3 con `BLOCK_ALL` público y cifrado S3-managed (`storage-stack.ts`).
- Secretos en Secrets Manager (DB, Brandwatch token, cron secret). Ver
  [Integraciones](integraciones.md#aws-secrets-manager).
- Las Lambdas y la app log con `console`/`log`; evitan imprimir secretos.

---

## Rate limiting

Token bucket in-memory por IP (`apps/web/src/lib/rate-limit.ts`), key
`x-forwarded-for`. Solo válido con 1 tarea ECS (con autoescalado a varias, se
necesitaría Redis). Detalle de límites por ruta en
[API interna](api-interna.md#rate-limiting).

---

## Resumen ejecutivo de seguridad

| Capa | Estado |
|---|---|
| Autenticación | Cognito SRP + cookie httpOnly; firma JWT no verificada (solo exp) |
| Multi-tenancy | Por `custom:agency_slug`; queries scoped por `agency_id` |
| Autorización admin | Solo `/api/reports/*` (`requireAdmin`) |
| Roles analyst/viewer | Existen pero **sin enforcement server-side** |
| `/api/users`, `/api/alerts` | Cualquier usuario autenticado de la agencia |
| `/api/admin/*` | Header `ECO_CRON_SECRET` (no Cognito) |
| `/api/narrative` singular | Fuera del matcher del middleware |
| TLS público | ALB HTTP hoy (cookies `Secure`/HSTS condicionados a HTTPS) |
| CSP | Estricta salvo `'unsafe-inline'` (prototipo) |
