# Lambdas

ECO tiene **10 funciones Lambda**: 9 definidas en CDK (`EcoWorkers`,
`infra/lib/workers-stack.ts`) y `eco-migration`, que se gestiona fuera de CDK. El
código de cada una está en `infra/lambda/<nombre>/index.ts`. Todas usan Node 22 y
`pg` (raw) para hablar con RDS leyendo la URL del secret `DB_SECRET_ARN`.

## Tabla resumen

| Lambda | Trigger | Memoria | Timeout | Concurrencia |
|---|---|---|---|---|
| `eco-ingestion` | EventBridge 1 min + cron 07:00 (48h) | 512 MB | 15 min | **1** |
| `eco-processor` | SQS `eco-ingestion` (batch 10, conc 10) | 1024 MB | 5 min | (SQS) |
| `eco-alerts` | SQS `eco-alerts` (batch 1) | 256 MB | 60 s | (SQS) |
| `eco-metrics-calculator` | EventBridge 10 min + cron 09:00 (backfill) | 512 MB | 2 min | default |
| `eco-weekly-report` | EventBridge min 0 cada hora | 1024 MB | 5 min | default |
| `eco-ai-tasks` | EventBridge 04,10,16,22 UTC | 512 MB | 5 min | default |
| `eco-narrative-cluster` | EventBridge min 15 cada hora | 2048 MB | 5 min | **1** |
| `eco-narrative-edges` | EventBridge 06:00 UTC diario | 1024 MB | 5 min | default |
| `eco-narrative-drift` | EventBridge lunes 08:00 UTC | 1024 MB | 5 min | default |
| `eco-migration` | Manual (AWS CLI) | — (fuera de CDK) | — | — |

Modelos Bedrock por defecto (env vars): primario
`us.anthropic.claude-opus-4-6-v1`, fallback `us.anthropic.claude-sonnet-4-6`. Ver
[Integraciones](integraciones.md#bedrock).

---

## eco-ingestion

`infra/lambda/ingestion/index.ts`. **Entrada**: vacío (cron normal) o
`{backfillStartDate, backfillEndDate, backfillQueryIds?}` / `{refreshLastHours}`
(`index.ts:38-51`). **Salida**: `{statusCode, body}` con resumen por agencia/query.

Lógica clave: por agencia activa con config Brandwatch, por query, calcula la
ventana desde el cursor (modo normal) o desde el evento (backfill), pagina
Brandwatch, guarda el raw en S3 y encola en SQS en lotes de 10; actualiza el cursor
solo en modo normal. Detalle en [Pipeline de datos](pipeline-datos.md#1-ingesta).

- **Concurrencia 1** (`workers-stack.ts:84`): evita cascada de 429 de Brandwatch.
- **Timeout 15 min** porque el backfill puede correr largo.
- IAM: S3 put (raw), SQS send, read del secret DB y del secret Brandwatch.

---

## eco-processor

`infra/lambda/processor/index.ts`. **Entrada**: `SQSEvent` (batch de hasta 10
menciones de Brandwatch). **Salida**: void; si una mención del lote falla, relanza
el primer error para que SQS reintente el lote (`index.ts:103-112`).

Lógica clave: dedup por lote (existencia de `bw_resource_id`) y por texto
(`text_hash`); NLP con Claude (prompt único, JSON crudo, `temperature 0.1`); merge
regex de municipios; INSERT en `mentions` + junctions; encola alerta a `eco-alerts`
si negativo + alta pertinencia. Detalle en
[Pipeline de datos](pipeline-datos.md#2-procesamiento--nlp).

- **Circuit breaker suave** del modelo primario: ante throttling, lo salta durante
  5 min (`PRIMARY_COOLDOWN_MS`) y usa el fallback (`index.ts:21-30`, `341-379`).
- IAM: `bedrock:InvokeModel`, `aws-marketplace:*`, S3 read, SQS send, secret DB.
- **No genera embeddings** (ver [Motor de narrativas](narrativas-motor.md#embeddings)).

---

## eco-alerts

`infra/lambda/alerts/index.ts`. **Entrada**: `SQSEvent` de `eco-alerts` (batch 1).
**Salida**: void.

Evalúa las reglas activas de la agencia (`alerts/index.ts:43-143`):

- `negative_sentiment`: dispara con cualquier mención negativa.
- `keyword`: dispara si alguna keyword aparece en título/snippet (opcionalmente
  filtrada por sentimiento).
- `volume_spike`: cuenta menciones en `window_minutes` (default 60); dispara si
  `>= threshold` (default 50).

Al disparar: registra en `alert_history` (`notification_sent=true`) y envía email
por SES a `notify_emails` (texto HTML simple, una sola llamada con
`ToAddresses: emails`). IAM: SES send, secret DB.

> Esta es una de las **dos rutas de notificación reales**. Nota: este lambda envía
> a todos los destinatarios en un solo `ToAddresses`, a diferencia del envío
> individual por destinatario de weekly-report y crisis.

---

## eco-metrics-calculator

`infra/lambda/metrics-calculator/index.ts`. **Entrada**:
`{backfill?, forceCrisis?, agencySlug?, recipientsOverride?}` (`index.ts:48-65`).
**Salida**: `{statusCode, body}` con conteo de snapshots y alertas disparadas.

Dos responsabilidades:

1. **Snapshots diarios**: agrega `mentions` del día AST, llama `calculateMetrics`
   (`@eco/shared/metrics`), upsert en `daily_metric_snapshots`. En modo `backfill`
   recomputa todos los días con menciones (`index.ts:88-106`).
2. **Alertas de crisis** (`evaluateCrisisAlerts`, `index.ts:352`): por regla
   `crisis_threshold` activa, si `crisis_risk_score >= crisis_min` (default 0.40),
   `crisis_severity >= severity_min` (default 0.50) y se respeta el cooldown
   (default 12h), construye el contexto (top tópicos/municipios negativos, muestra
   rankeada de menciones), genera un **editorial con Bedrock tool-use**
   (`generateCrisisEditorial`, `index.ts:818`), arma un gráfico de tendencia
   QuickChart, hace best-effort scrape del og:image del "hero", renderiza el HTML
   (`renderCrisisAlertHtml` de `@eco/shared`) y envía por SES **individual por
   destinatario**, registrando en `alert_history`.

- **Timeout 2 min** por el path de crisis (Bedrock + N envíos SES); el path normal
  termina en <10 s.
- `ensureCrisisSchema` crea idempotentemente `alert_rules`/`alert_history` y siembra
  una regla `crisis_threshold` por agencia con recipients (`index.ts:268-323`).
- IAM: secret DB, `bedrock:InvokeModel`, SES send.

---

## eco-weekly-report

`infra/lambda/weekly-report/index.ts`. **Entrada**:
`{agencySlug?, dryRun?, trigger?, recipients?, triggeredBy?}`. **Salida**:
`{statusCode, body, html?}` (en `dryRun` devuelve el HTML).

Trigger: cron **minuto 0 de cada hora** (`workers-stack.ts:303-308`). La Lambda
itera `report_configs` activos y envía solo a las agencias cuya hora local
(`hourInTimeZone(now, cfg.timezone)`) coincide con `send_hour_local`. Para DDEC eso
es 6:00 AM `America/Puerto_Rico` = 10:00 UTC.

- **Periodo**: 7 días naturales **cerrados** terminando AYER en AST
  (`closedWindowYmdInTZ`, `dates.ts:66-77`) — no incluye el día parcial actual.
- Construye el reporte con `buildSentimentReport`
  (`@eco/shared/aggregations/sentiment-report`), genera insights con Bedrock,
  renderiza con `render-weekly-report.ts`, gráficos vía QuickChart (`&v=4`).
- Envío SES **individual por destinatario** (un correo por dirección, no BCC) para
  que un destinatario no verificado en sandbox no tumbe a los demás. Registra en
  `report_send_log`.
- `recipients` en el payload sobreescribe la lista del config solo para esa
  invocación.
- `ensureReportsSchema()` self-heal corre cada hora (patrón de migración
  idempotente). IAM: `bedrock:InvokeModel`, SES send, secret DB.

Comandos de prueba en [Runbooks](runbooks.md#reporte-semanal).

---

## eco-ai-tasks

`infra/lambda/ai-tasks/index.ts`. **Entrada**:
`{action?: 'briefing'|'topic-descriptions', agencySlug?, dryRun?}`. **Salida**:
`{statusCode, body}` con resultados por agencia.

- **`briefing`** (default, cron 4×/día): por agencia, agrega 24h e invoca
  `invokeClaude` (texto crudo) con `EXECUTIVE_BRIEFING_SYSTEM_PROMPT`; persiste en
  `agency_briefings`. <10 menciones o fallo → briefing de reglas
  (`fallback=true`).
- **`topic-descriptions`** (manual): genera y guarda `topics.description` por
  tópico activo (30d de datos + muestras).

`ensureBriefingsSchema` self-heal idempotente. IAM: `bedrock:InvokeModel`, secret
DB. (Ver discrepancia sobre `period-insights` en
[Pipeline de datos](pipeline-datos.md#5-capa-de-ia-del-dashboard).)

---

## eco-narrative-cluster

`infra/lambda/narrative-cluster/index.ts` (+ `naming.ts`). **Entrada**:
`{agencySlug?, dryRun?, skipNaming?, maxNewNarratives?}` (`index.ts:77-84`).
**Salida**: `{statusCode, body}` con stats por agencia (asignadas, candidatos,
nuevas, lifecycle actualizadas, influencers).

Asignación a centroides + DBSCAN + lifecycle + influencers. Detalle completo en
[Motor de narrativas](narrativas-motor.md).

- **Memoria 2048 MB** por el DBSCAN O(N²) en JS sobre cientos de vectores 1024d.
- **Concurrencia 1**: el pool de candidatos es estado compartido (DBSCAN + delete);
  dos corridas simultáneas duplicarían narrativas (bug observado 25/05/2026).
- IAM: `bedrock:InvokeModel` (naming), secret DB.

---

## eco-narrative-edges

`infra/lambda/narrative-edges/index.ts`. **Entrada**: `{agencySlug?}`. **Salida**:
stats por agencia (co_occurrence, author_overlap, semantic, total). Truncate +
reinsert por agencia; **no usa Bedrock**. IAM: solo secret DB. Detalle en
[Motor de narrativas](narrativas-motor.md#edges).

---

## eco-narrative-drift

`infra/lambda/narrative-drift/index.ts`. **Entrada**:
`{agencySlug?, dryRun?, threshold?}`. **Salida**: stats por agencia (evaluadas,
drifted, renamed, errors). Renombra narrativas con drift > 0.25 usando Bedrock
tool-use. IAM: `bedrock:InvokeModel`, secret DB. Detalle en
[Motor de narrativas](narrativas-motor.md#drift-y-renombrado).

---

## eco-migration (fuera de CDK)

`infra/lambda/migration/index.ts`. **No** está en ningún stack CDK; se despliega
manualmente y reusa el role de `eco-ingestion` (por eso no tiene permiso Bedrock
salvo el que tenga ese role — el subtopic backfill usa Bedrock y depende de ello).
Importa `infra/lambda/lib/embeddings.ts`, que tampoco está commiteado en `main`
(se copia desde un worktree al deployar).

**Entrada**: `{action, query?, queryIds?, limit?, agencySlug?, ...}`
(`index.ts:17`). Es un multiplexor de acciones, invocado por AWS CLI. Acciones
principales (`index.ts:28-699`):

| Acción | Qué hace |
|---|---|
| `migrate` / `migrate-and-seed` | Crea enums + todas las tablas base (`runMigrations`) |
| `seed` | Siembra catálogos |
| `status` | Estado del esquema |
| `custom-query` | Ejecuta un SELECT (solo lectura) para diagnóstico |
| `reset-cursors` | Borra `ingestion_cursors` de queryIds dados |
| `cleanup-empty-mentions` | Borra menciones sin título ni snippet |
| `qa-date-alignment` | Compara conteos AST vs UTC, detecta el bug NOW() |
| `create-reports-schema` | Crea `report_configs` + `report_send_log` y siembra |
| `reset-snapshots` | Vacía `daily_metric_snapshots` (para re-backfill) |
| `add-briefing-modes` | Añade `agency_briefings.mode` |
| `add-formula-columns` | Añade columnas de Polarization + subcomp. de Crisis |
| `add-embeddings-column` | pgvector + `mentions.embedding` + índice ivfflat |
| `create-narratives-schema` | Crea las 4 tablas de narrativas |
| `cleanup-narrative-duplicates` | Demota duplicados `is_primary` |
| `backfill-embeddings` | Puebla `mentions.embedding` con Titan v2 (lotes, conc 5) |
| `seed-subtopics` | Siembra `subtopics` desde `@eco/shared` |
| `backfill-subtopics-init` / `backfill-subtopics` | Clasifica subtópicos con Bedrock Haiku |

`backfill-subtopics` usa **Claude Haiku 4.5**
(`us.anthropic.claude-haiku-4-5-20251001-v1:0`) por ser 20× más barato para una
clasificación constrained-enum (`migration/index.ts:15`).

Ejemplos de invocación en [Runbooks](runbooks.md) y
[Despliegue](despliegue.md#migraciones).
