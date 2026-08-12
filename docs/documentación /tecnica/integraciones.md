# Integraciones externas

ECO depende de cinco servicios externos: Brandwatch (datos), AWS Bedrock (IA),
AWS SES (correo), AWS Cognito (auth) y AWS Secrets Manager (secretos).

---

## Brandwatch (proveedor de datos)

Cliente: `@eco/brandwatch` (`packages/brandwatch`), usado por `eco-ingestion`
(`ingestion/index.ts:4`, `81-122`).

- **Autenticación**: token leído de Secrets Manager `eco/brandwatch-token`
  (`workers-stack.ts:52-56`). El secret acepta string plano o `{"token":"..."}`
  (`ingestion/index.ts:192-208`). Se cachea entre invocaciones warm; la rotación se
  recoge en el siguiente cold start sin redeploy.
- **Configuración por agencia**: `agencies.brandwatch_project_id` y
  `brandwatch_query_ids` (array). Una agencia puede tener varias queries.
- **Paginación**: `bw.fetchMentionPages({ queryId, startDate, endDate, pageSize:
  100, orderBy: 'date', orderDirection: 'asc' })` (`ingestion/index.ts:115-122`).
- **Cursores**: `ingestion_cursors` (keyed por `query_id`). El cursor solo avanza;
  los backfills no lo tocan. Se le resta 1 minuto de solape al leerlo
  (`ingestion/index.ts:100-103`).
- **Reintentos / rate limiting**: el cliente reintenta con backoff exponencial
  (hasta ~45 s, 10 intentos según el comentario del stack). La concurrencia 1 del
  lambda y el visibility timeout de 300 s en SQS evitan que se apilen invocaciones.
- **Late arrivals**: Brandwatch indexa algunas menciones con retraso. El cron
  diario 07:00 UTC re-escanea las últimas 48h (`workers-stack.ts:115-121`).
- **Raw en S3**: cada página se persiste en `eco-raw` bajo
  `brandwatch/<slug>/<queryId>/<fecha>/page-N.json`.

---

## AWS Bedrock (IA)

Cliente compartido: `packages/shared/src/bedrock.ts`. La app web usa
`apps/web/src/lib/bedrock-client.ts` (singleton).

### Modelos exactos

Definidos como defaults en `bedrock.ts:33-34` y repetidos en las env vars de cada
Lambda en CDK:

- **Primario**: `us.anthropic.claude-opus-4-6-v1`
- **Fallback**: `us.anthropic.claude-sonnet-4-6`
- **Embeddings**: `amazon.titan-embed-text-v2:0`, 1024 dims, normalize
  (`infra/lambda/lib/embeddings.ts:15`).
- **Subtopic backfill**: `us.anthropic.claude-haiku-4-5-20251001-v1:0` — Haiku por
  ser ~20× más barato para clasificación constrained-enum
  (`migration/index.ts:15`).

`anthropic_version: 'bedrock-2023-05-31'` en todas las invocaciones.

### Patrón de invocación

`bedrock.ts` expone dos helpers:

- **`invokeClaude(opts)`** (`bedrock.ts:126-165`): devuelve texto crudo (quita los
  code fences markdown). El caller hace el `JSON.parse`. Frágil con comillas o
  saltos de línea sin escapar. Lo usan `eco-ai-tasks` (briefings, descripciones) y
  el processor implementa su propia variante.
- **`invokeClaudeWithTool(opts)`** (`bedrock.ts:60-115`): **patrón preferido.**
  Fuerza la respuesta vía `tools` + `tool_choice: {type:'tool', name}`, con un
  `input_schema` JSON. Bedrock garantiza el shape del `tool_use`, eliminando el
  problema del `JSON.parse` sobre texto. Lo usan el naming de narrativas
  (`naming.ts`) y el editorial de crisis (`metrics-calculator/index.ts:818-865`).
  Propaga error si `stop_reason` no es `end_turn`/`tool_use` (trunc/filtro) o si no
  hay `tool_use` block (`bedrock.ts:100-106`).

### Fallback y circuit breaker

- Ambos helpers intentan primario y luego fallback en orden, deduplicando
  (`bedrock.ts:63-67`, `127-131`).
- El **processor** añade un circuit breaker suave por su volumen: ante
  `ThrottlingException` (o "too many tokens/requests"), marca el primario en
  cooldown 5 min (`PRIMARY_COOLDOWN_MS`) y usa solo el fallback
  (`processor/index.ts:21-30`, `341-379`).
- Temperatura por defecto 0 (determinismo) — el processor usa 0.1.

### Permisos IAM

- Lambdas: `bedrock:InvokeModel` sobre `*` (`workers-stack.ts`).
- App web (ECS task role): `bedrock:InvokeModel` restringido a los foundation
  models y **inference profiles** `*claude*` (`compute-stack.ts:139-147`). Si
  faltan, `/api/ai/metric-insight` cae a un insight basado en reglas.

---

## AWS SES (correo)

Tres lambdas envían correo: `eco-alerts`, `eco-metrics-calculator` (crisis) y
`eco-weekly-report`.

- **Remitentes verificados**: `agutierrez@populicom.com` (weekly-report y crisis,
  con nombre "ECO Radar"); `noreply@populicom.com` (alerts). Para usar otro hay que
  verificarlo en la consola SES primero.
- **Envío individual por destinatario**: weekly-report y crisis envían **un correo
  por dirección** en un loop (no BCC). Razón: en SES sandbox una dirección no
  verificada en un `To` compartido tumba el mensaje entero; el loop permite que los
  verificados reciban aunque otros fallen (`metrics-calculator/index.ts:759-776`).
  `eco-alerts` en cambio sí manda a todos en un solo `ToAddresses`
  (`alerts/index.ts:115-118`).
- IAM: `ses:SendEmail`, `ses:SendRawEmail` sobre `*`.
- Imágenes de correo: QuickChart para gráficos (`&v=4` evita la leyenda duplicada
  de Chart.js v2) y scraping best-effort de `og:image` para el "hero" de la alerta
  de crisis, con validación HEAD del content-type
  (`metrics-calculator/index.ts:953-1097`).

---

## AWS Cognito (autenticación)

User pool `eco-users` (`auth-stack.ts`). Detalle en
[Autenticación y seguridad](autenticacion-seguridad.md).

- **Sign-in**: SRP desde el browser con `amazon-cognito-identity-js`
  (`apps/web/src/lib/auth/cognito.ts`). El id token resultante se manda a
  `/api/auth/session`, que lo guarda en una cookie httpOnly.
- **Grupos**: `admin`, `analyst`, `viewer` (claim `cognito:groups`).
- **Atributo custom `agency_slug`**: rutea el tenant. El middleware lo lee del JWT y
  lo propaga como header `x-eco-user-agency` (`session.ts:27-29`,
  `middleware.ts:81`).
- IDs deployados: pool `us-east-1_exuhIKYQ8`, client
  `1t4v0kt8nn9nnmtet8t3l5g7u3` (`compute-stack.ts:83-84`).

---

## AWS Secrets Manager

| Secret | Consumidor | Contenido |
|---|---|---|
| `EcoDbSecret` (ARN `DB_SECRET_ARN`) | todas las Lambdas + ECS | credenciales RDS (`username`, `password`, `host`, `port`, `dbname`) |
| `eco/brandwatch-token` | `eco-ingestion` | token de Brandwatch |
| `eco/cron-secret` (`...-O69oRN`) | ECS (`ECO_CRON_SECRET`) | secreto para endpoints `/api/admin/*` |

El secret de DB se crea por CDK (`database-stack.ts:19`); los otros dos se crean
manualmente fuera de CDK (`workers-stack.ts:52-56`, `compute-stack.ts:72-76`). La
URL de conexión se arma en cada Lambda:
`postgresql://user:pass@host:port/dbname` con `ssl: { rejectUnauthorized: false }`.

Rotación: el token de Brandwatch se cachea por invocación; rota sin redeploy. Ver
[Runbooks](runbooks.md#rotación-de-secretos).
