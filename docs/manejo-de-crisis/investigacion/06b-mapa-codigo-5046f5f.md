# 06b · Mapa del código para el spec (origin/main 5046f5f, 28-oct-2026)

Complementa a `06-asistente-actual.md`. Todas las rutas son de `origin/main`; `archivo:N` = línea.

## Correcciones al mapa 06
- `fireCrisisAlert` → `infra/lambda/metrics-calculator/index.ts:807`; `generateCrisisEditorial` → `:1258`; índice V5 → `packages/shared/src/metrics.ts:249-284`; bandas → `packages/shared/src/format/metrics-display.ts:143` (`crisisBand`).
- `/api/chat/stream` **no** exige capacidad (solo sesión). Rate limit en memoria por tarea ECS (el servicio escala 1–3 tareas, `compute-stack.ts:225-231`).
- `resolveAgencyId` depende de `next/headers` → no usable en lambda; resolver en la ruta y pasar `agencyId` explícito.
- Tripwire de datos: `apps/web/src/contracts/data-contract.test.ts:~140-185` (MANIFEST) cuenta predicados SQL por archivo; mover SQL obliga a actualizarlo.

## bedrock.ts (`packages/shared/src/bedrock.ts`)
- Cliente inyectado `BedrockClientLike` (:17); SDK por `await import('@aws-sdk/client-bedrock-runtime')`; no re-exportado en index (`@eco/shared/src/bedrock`).
- Defaults :33-34 `us.anthropic.claude-opus-4-6-v1` / `us.anthropic.claude-sonnet-4-6`.
- `invokeClaudeWithTool` :60-115 — `anthropic_version:'bedrock-2023-05-31'`, `temperature ?? 0`, **`tool_choice:{type:'tool'}` forzado** (:78-89), un turno de texto. Consumidores: metric-insight :387, eco-executive-summary :47, eco-topic-description :40, export/report :145, ai-tasks :67 (usos :271/:750/:966/:1011/:1217), narrative-cluster/naming :15, scripts/live-export-report :131.
- `invokeClaudeStream` :143-208 — `InvokeModelWithResponseStreamCommand` sin tools; solo emite `text_delta`; mensajes `{role, content:string}`. **No sirve para tool-use.** Único consumidor: chat/stream :31.
- `invokeClaude` :219-258 — sin consumidores.
- Implementaciones propias fuera del helper: weekly-report :1629, metrics-calculator :1307-1357, processor/migration/embeddings con InvokeModel directo.
- ⚠️ Opus/Sonnet 5.5 rechazan `tool_choice` forzado y `temperature` → el helper no sirve tal cual para modelos 5.x.

## Dependencias
- Sin `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk` ni zod en ningún package.json/lock.
- apps/web: `@aws-sdk/client-bedrock-runtime ^3.1045.0`, `@aws-sdk/client-lambda ^3.1033.0`, next 15.5.14, TS 5.9.3, React 19. infra: aws-cdk-lib ^2.246.0, jest 30. Node >=22. No hay package.json por lambda (se bundlea desde infra, `externalModules: ['@aws-sdk/*']`).

## Chat
- `apps/web/src/app/api/chat/stream/route.ts` (264 l.): `maxDuration=60` :41; env `BEDROCK_MODEL_ID`/`BEDROCK_FALLBACK_MODEL_ID` :43-44 (no definidas en compute-stack → defaults); límites 4000 chars / 1500 tokens :45-46; flujo sesión :57 → rate 30/min :62 → `resolveAgencyId` :71 → `ensureChatSchema` :97 → conversación :104-126 → historial :129-136 → persistir user con `contentJson{viewContext,period,screen,filters}` :139-149 → stream meta/delta/done/error :187-239; persistencia única con partial :168-184; headers NDJSON :250-255; temperature 0.3 :196.
- `lib/chat-store.ts`: `ensureChatSchema` :11-50 (CREATE IF NOT EXISTS por request), `normalizeTurns(rows,12)` :66-85. Drizzle `packages/database/src/schema/chat.ts:12-64` (`contentJson` tipado :48-53, ampliar para trazas).
- `packages/shared/src/prompts/chat.ts`: `ChatViewContext` :13-37, `CHAT_SYSTEM_PROMPT` :39-63, `buildChatViewContextBlock` :106-223, `buildChatUserTurn` :230-233.
- Frontend `apps/web/public/eco-prototype/chat-drawer.js` (335 l., IIFE con React.createElement, `window.ECO_CHAT`): bucle NDJSON :194-229; markdown mínimo :10-39; tracking `chat_message_send` :171, `chat_error` :220/:232, `chat_conversation_delete` :156. Montaje `app.js:7`, estado :305, `openChat` :459, props :539-547.
- Build: `apps/web/scripts/compile-prototype.js` (lista FILES :18) → `public/eco-prototype/dist/`; cargador `index.html:1466` + `?v=prodc98` :1470. Archivo JS nuevo = añadir en ambos y subir a `prodc99`.

## Datos reutilizables como herramientas
| Endpoint | Lógica | Estado |
|---|---|---|
| scorecard | `lib/scorecard/payload.ts:74` `computeScorecard(pool, agencyId, startYmd, endYmd, prevStartYmd, prevEndYmd)` | listo |
| mentions/analysis | `lib/mentions/payload.ts:89` `computeMentionsAnalysis(pool, {id,slug,name}, since, until)` | listo |
| sentiment/analysis | `lib/sentiment/payload.ts:66` `computeSentimentAnalysis(pool, agency, {startYmd,endYmd,prevStartYmd,prevEndYmd})` | listo |
| geo/analysis | `lib/geo/payload.ts:48` `computeGeoAnalysis(pool, agencyId, {startYmd,endYmd}, {source?,topic?,subtopic?})` | listo |
| overview | compuesto de shared (`buildSentimentReport` aggregations/sentiment-report.ts:478, `loadMetricsForWindow` metrics.ts:459, `loadDailySentimentSeries` :330) + SQL inline :159-166 | refactor ligero |
| narrative/overview | `buildOverview` puro (`lib/narrative/overview.ts:516`); `computeOverview` en route.ts:157-201 no exportado | mover a lib |
| narrative/[id]/propagation | SQL inline :55-66 + helpers lib | refactor ligero |
| eco-mentions (756 l.) | embebido (filtros :105-128, `handleSimilarTo`) | refactor pesado |
| eco-terms, narrative lista/[id]/edges/day | embebidos | refactor medio |
| alerts/history | Drizzle inline :55-73 tras `requireAlertsAccess` | trivial |
- En lambda, los payload.ts usan alias `@/lib/...` que el esbuild de infra no resuelve.

## Tablas para "crisis anteriores"
- `daily_metric_snapshots` (`schema/daily-metric-snapshots.ts:14-66`): diaria por agencia, unique (agency,date), índice (agency_id, crisis_risk_score); columnas de conteos, nss, bhi, crisis_risk_score, crisis_severity, crisis_velocity, crisis_confidence, volume_anomaly_zscore, polarization_index, nss_7d/30d, computed_at. Escribe metrics-calculator cada 5 min (HOY) + backfill 45 días a las 09:00 UTC. Filas desde ene-2025, cobertura real por `loadAgencyCoverage(...).startYmd` (`coverage.ts:63`). ⚠️ >45 días conservan su fórmula (V4/V5): mirar `computed_at`.
- `alert_history` (`schema/alerts.ts:23-36`): alert_rule_id, agency_id, triggered_at, mention_ids, details (band, scores, editorial{headline,lede}…). También `metric_threshold`, `volume_spike`, `keyword`.
- `alert_rules`: crisis `crisis_min 0.40`, `severity_min 0.50`, `cooldown_hours 12`.
- Complementos: `agency_briefings` (signal/emerging/crisis), `narratives` (status, born_at, peaked_at, last_mention_at, mention_count, drift_score).

## Infra
- Patrón `NodejsFunction` en `infra/lib/workers-stack.ts` (bundling :72-80, VPC privada, `addToRolePolicy` para `bedrock:InvokeModel`). **Ningún lambda tiene `InvokeModelWithResponseStream`.**
- eco-metrics-calculator :301-361 (512 MB, 2 min, rate 5 min + cron 09:00); eco-ai-tasks :474-513 (512 MB, 5 min).
- Web → lambda asíncrono: `api/eco-insights/route.ts:49-79` (`InvokeCommand` `InvocationType:'Event'` + dedupe `claimAiTrigger`).
- Rol ECS: `lambda:InvokeFunction` solo sobre eco-weekly-report, eco-ai-tasks, eco-mention-import (`compute-stack.ts:130-138`); Bedrock :177-188. ALB sin `idleTimeout` → 60 s por defecto: los streams largos necesitan keep-alive.

## Auth
- `lib/auth/roles.ts`: capacidades :19-24, `ROLE_CAPS` :30-35 (admin todas; editor templates/alert_rules/export; analyst export; viewer nada).
- `require-admin.ts`: `requireCapability` :44, `ALERTS_ALLOWED_EMAILS` :77.
- `middleware.ts`: `/api/chat` en PROTECTED_PATHS :45 y matcher `/api/chat/:path*` :198 → rutas nuevas bajo `/api/chat/*` quedan cubiertas.
- SPA: `/api/auth/me` → `window.ECO_SESSION` (`app.js:315-326`); `ecoHasCap` `shell.js:192-196` (devuelve true mientras carga).
- `resolveAgencyId` `lib/agency.ts:172-212` (x-eco-user-*, `RESTRICTED_AGENCIES`, caché 60 s).

## Agencias
- "Archivada" ≠ `is_active`: `isArchivedAgency` (`shared/src/bunker-import.ts:52-57`). SGPR y AAA archivadas; activas con datos: ddecpr, gobernadora, df (+ medalla restringida). Confirmar con `SELECT slug, is_active, brandwatch_project_id, brandwatch_query_ids FROM agencies`.

## Analítica
- `window.ecoTrack(name, params, opts)` en `apps/web/public/eco-analytics.js`; convenciones en `docs/analitica-gtm.md` (snake_case ≤40, parámetro nuevo = tocar `EVENT_PARAMS` en `scripts/build-gtm-container.mjs` + dimensión GA4; nunca texto del asistente ni PII).

## Tests
- apps/web: Jest + ts-jest (`npm test -w apps/web`), contratos en `src/contracts/`. packages/shared: `node:test` con `tsx --test`. infra: CDK tests (`npm test -w infra`). CI: `.github/workflows/contract-tests.yml`. `npm run contract:live` = SELECTs contra prod vía eco-migration (G1–G7), requiere credenciales.
