# API interna

Rutas bajo `apps/web/src/app/api/` (Next.js App Router, Route Handlers). Todas las
rutas de datos del dashboard están protegidas por el middleware (sesión Cognito) y
la mayoría aplica rate limiting in-memory. La resolución de agencia (tenant) usa el
header `x-eco-user-agency` que el middleware inyecta desde el JWT, con fallback al
query param `agency` y a la primera agencia activa (`apps/web/src/lib/agency.ts`).

Ver [Autenticación y seguridad](autenticacion-seguridad.md) para el modelo de
autorización (y su brecha de roles).

## Rate limiting

Token bucket in-memory por IP (`apps/web/src/lib/rate-limit.ts`), keyed por
`x-forwarded-for`. Responde `429` con `Retry-After`. **In-memory**: solo correcto
con 1 tarea ECS; con autoescalado a varias tareas habría que mover a Redis (nota en
el propio archivo). Límites observados: `eco-data` 60/min; `eco-mentions`,
`narratives`, `narratives-edges`, `narrative*`, `eco-insights`,
`eco-topic-description` 120/min.

---

## Endpoints de datos del dashboard

### `GET /api/eco-data`
El endpoint más grande (`eco-data/route.ts`). Devuelve el payload completo del
scorecard. Rate limit 60/min.
- **Params**: `period` (`1D|5D|7D|30D|1M|2M|3M|6M|1A|Max` y aliases `24h/7d/30d/90d`,
  default `1M`), o rango custom `from`/`to` (YYYY-MM-DD en AST), `agency`.
- **Respuesta**: `AGENCIES_FULL`, `TIMELINE` (diario, u **horario** si periodo=1
  día), `CURRENT_METRICS` (todas las compuestas recalculadas sobre la ventana vía
  `loadMetricsForWindow`), `SENTIMENT_BREAKDOWN`, `TOP_SOURCES`,
  `SENTIMENT_BY_SOURCE/TOPIC/SUBTOPIC/REGION`, `TOPICS` (con evolución y delta),
  `SUBTOPICS`, `TOPIC_CALENDAR`, `MUNICIPALITIES`, `EMOTIONS`, `MENTIONS` (top 50
  recientes, sin Twitter ni baja pertinencia en el feed), `INGESTION_STATUS`,
  `ALERTS`, briefing.
- **Mock**: el array `ALERTS` trae `priority/triggered/lastFired` hardcodeados
  (`eco-data/route.ts:1069-1077`).

### `GET /api/overview`
Espejo del correo semanal (`overview/route.ts`). Usa `buildSentimentReport`
(`@eco/shared`) + `loadMetricsForWindow`. Ventana rolante (termina hoy) o custom.
Devuelve `periodLabel`, totales, `deltaVsPrev`, `dailySeries`, `topicsTable`, etc.
Rate limit aplicado.

### `GET /api/eco-mentions`
Feed de menciones con filtros (`eco-mentions/route.ts`). Rate limit 120/min.
- **Params**: `period`/`from`/`to`, `limit` (≤100), `offset`, `sentiment`,
  `pertinence`, `includeLow`, `minEngagement`, `pageType`/`source`, `q` (texto),
  `emotion`, `dow`, `hour`, `day`, `region`, y **`similar_to`** (id de mención →
  menciones relacionadas por similitud de embedding pgvector, con fallback a
  filtros si la mención fuente no tiene embedding, `eco-mentions/route.ts:482-536`).

### `GET /api/agencies`
Lista de agencias activas (`agencies/route.ts`). Devuelve `slug`, `name`,
`logoUrl`, `brandwatchProjectId`, `brandwatchQueryIds`. Cache público 1h. **No
aplica `requireAdmin` ni rate limit**; solo lo cubre el middleware.

---

## Endpoints de IA (insights)

Patrón común: caché en DB; si está fresco lo sirve, si no genera (o responde 202 y
refresca en background). Histórico inmutable, rolling refresca cada 1h.

### `GET /api/ai/metric-insight`
`ai/metric-insight/route.ts`. Insight coloquial de un KPI clickeable.
- **Params**: `metric` (`nss|crisis|volume|bhi|polarization`, requerido), periodo.
- Devuelve `{metric, label, value, band, deltaVsPrev, insight, ...}`. Usa Bedrock
  vía `getBedrockClient`; si falla o sin permisos, cae a `buildRuleBasedInsight`.
  Cacheado por `(agency, metric, period)`.

### `GET /api/eco-metric-insight`
`eco-metric-insight/route.ts`. Sirve desde `metric_insights_cache`, keyed por
`metric`. Patrón cache-or-202.

### `GET /api/eco-insights`
`eco-insights/route.ts`. Insights del Overview desde `overview_period_insights`.
Patrón cache-or-202. (Ver discrepancia con la acción `period-insights` de
`eco-ai-tasks` en [Pipeline de datos](pipeline-datos.md#5-capa-de-ia-del-dashboard).)

### `GET /api/eco-topic-description`
`eco-topic-description/route.ts`. Descripción de un tópico×periodo desde
`topic_descriptions_cache`.

---

## Endpoints de narrativas

Todos con rate limit 120/min y resolución de agencia.

### `GET /api/narratives`
Lista de nodos para el grafo (`narratives/route.ts`). Params: `agency`, `status`
(comma-sep), `period`, `minMentions`, `limit` (≤500, default 250). Devuelve
`narratives[]` con `mentionCount`, `velocity24h`, totales, iniciadores.

### `GET /api/narratives/edges`
Aristas del grafo (`narratives/edges/route.ts`). Params: `agency`, `minStrength`
(default 0.15), `types` (comma-sep). Devuelve `edges[] {source,target,type,strength}`.

### `GET /api/narratives/[id]`
Detalle de una narrativa (`narratives/[id]/route.ts`).

### `GET /api/narrative` · `GET /api/narrative/[id]` · `GET /api/narrative/[id]/day`
Variante singular (`narrative/...`). `[id]/day?date=YYYY-MM-DD&agency=slug` devuelve
la actividad de la narrativa en un día (para el timeline). Rate limit 120/min.

> Coexisten dos familias de rutas: `/api/narratives/*` (plural, grafo) y
> `/api/narrative/*` (singular, detalle/día). Ambas están en el matcher del
> middleware vía `/api/narratives/:path*` — **`/api/narrative` (singular) NO está
> listado en el matcher** (`middleware.ts:118-128`), por lo que esas rutas no pasan
> por el gate de sesión del middleware (sí aplican su propio rate limit). Punto a
> revisar.

---

## Endpoints admin (requieren rol o secreto)

### `/api/reports/config` — `GET` y `PUT`
`reports/config/route.ts`. **Requiere `requireAdmin`** (grupo `admin`). GET por
`agencyId` o `agencySlug`; PUT crea/actualiza `report_configs`.

### `GET /api/reports/history`
`reports/history/route.ts`. **Requiere `requireAdmin`**. Histórico de
`report_send_log`.

### `POST /api/reports/send-test`
`reports/send-test/route.ts`. **Requiere `requireAdmin`**. Invoca la Lambda
`eco-weekly-report` con `trigger:'test'` (`InvocationType: RequestResponse`).
Valida `agencySlug` y `recipients` (emails). Usa el permiso
`lambda:InvokeFunction` del task role.

### `GET /api/admin/diagnostics`
`admin/diagnostics/route.ts`. **Autorización por header `x-eco-cron-secret`**
(= `ECO_CRON_SECRET`), **no** por sesión Cognito. Devuelve señales de calidad del
pipeline: cobertura NLP, distribución de sentimiento BW vs NLP, matriz de confusión,
freshness de snapshots, cursores, ingesta diaria. Pensado para invocación
automatizada/diagnóstico desde el browser.

### `GET /api/admin/invited-users-cleanup`
`admin/invited-users-cleanup/route.ts`. **Autorización por `ECO_CRON_SECRET`**.

---

## Endpoints de usuarios y alertas (atención: sin `requireAdmin`)

### `GET /POST /api/users`, `PATCH /DELETE /api/users/[id]`
`users/route.ts`, `users/[id]/route.ts`. Listan, invitan, actualizan y borran
usuarios **dentro de la agencia del caller**. **NO usan `requireAdmin`** — solo
resuelven la agencia del header de sesión. Cualquier usuario autenticado
(viewer/analyst incluidos) puede gestionar usuarios de su agencia. Ver la brecha en
[Autenticación y seguridad](autenticacion-seguridad.md#brecha-de-enforcement-de-roles).

### `GET /POST /api/alerts`, `/api/alerts/history`
`alerts/route.ts`, `alerts/history/route.ts`. Reglas de alerta (CRUD) e historial.
También sin `requireAdmin`; scoped por agencia del header. `agencyId` se toma del
header de sesión, **nunca del body** (`alerts/route.ts:85`).

---

## Endpoints de auth y salud (no protegidos por el matcher)

### `POST /DELETE /api/auth/session`
`auth/session/route.ts`. POST recibe `{idToken, refreshToken?}` y setea cookies
httpOnly `eco_session` (TTL = exp del token, máx 12h) y `eco_refresh` (30 días).
`Secure` solo si la request vino por HTTPS (el ALB es HTTP hoy). DELETE limpia las
cookies (sign out).

### `GET /api/auth/me`
`auth/me/route.ts`. Devuelve la sesión decodificada (`getSession`).

### `GET /api/health`
`health/route.ts`. Health check del ALB y del contenedor ECS (`/api/health`).

---

## Resumen de autorización por ruta

| Ruta | Protección |
|---|---|
| `/api/eco-data`, `/api/overview`, `/api/eco-mentions`, `/api/eco-insights`, `/api/eco-metric-insight`, `/api/eco-topic-description`, `/api/ai/*`, `/api/narratives/*` | middleware (sesión) + rate limit |
| `/api/agencies` | middleware (sesión) |
| `/api/users*`, `/api/alerts*` | middleware (sesión) + scope de agencia — **sin requireAdmin** |
| `/api/reports/*` | **`requireAdmin`** (grupo Cognito `admin`) |
| `/api/admin/*` | header **`ECO_CRON_SECRET`** |
| `/api/narrative/*` (singular) | rate limit propio — **fuera del matcher del middleware** |
| `/api/auth/*`, `/api/health` | público (no en el matcher) |
