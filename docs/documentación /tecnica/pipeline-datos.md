# Pipeline de datos

Flujo end-to-end desde que Brandwatch publica una mención hasta que aparece en el
dashboard, los reportes y las alertas. Para la versión conceptual ver
[Conceptos · El recorrido del dato](../fundamentos/conceptos.md#el-recorrido-del-dato).

## Vista general

```
Brandwatch ─► eco-ingestion ─► S3 raw + SQS ─► eco-processor ─► RDS (mentions)
                                                                     │
            ┌────────────────────────────────────────────────────────┤
            ▼                          ▼                    ▼          ▼
  eco-metrics-calculator    eco-narrative-cluster    eco-ai-tasks   app web
  (snapshots + crisis)      (+ edges, + drift)       (briefings)    (/api/*)
            │                                                          │
            ▼                                                          ▼
        SES (crisis)          eco-weekly-report ─► SES         usuarios / correo
        eco-alerts ─► SES     (correo semanal)
```

Cada etapa se ejecuta de forma asíncrona y desacoplada. La fuente de verdad es la
tabla `mentions` en RDS; todo lo demás (snapshots, narrativas, cachés de IA) se
deriva de ella.

---

## 1. Ingesta — `eco-ingestion`

Código: `infra/lambda/ingestion/index.ts`. Trigger: EventBridge **cada 1 minuto**
(`workers-stack.ts:108-111`) + un cron diario de "late arrival" a las 07:00 UTC
que re-escanea las últimas 48h (`workers-stack.ts:115-121`).

Por cada agencia activa con `brandwatch_project_id` y `brandwatch_query_ids`
(`ingestion/index.ts:30-36`) y por cada query:

1. Determina la ventana temporal. En **modo normal** lee el cursor
   `ingestion_cursors.last_mention_date`, le resta 1 minuto de solape, y trae
   desde ahí hasta "ahora" (`ingestion/index.ts:96-107`). Si no hay cursor, parte
   de hace 24h.
2. Pagina la API de Brandwatch (`fetchMentionPages`, pageSize 100, orden por fecha
   ascendente — `ingestion/index.ts:115-122`).
3. Guarda el JSON crudo de cada página en S3:
   `brandwatch/<slug>/<queryId>/<YYYY-MM-DD>/page-N.json`
   (`ingestion/index.ts:124-132`).
4. Encola cada mención en SQS `eco-ingestion` en lotes de 10
   (`ingestion/index.ts:135-146`).
5. Al terminar, actualiza el cursor con la fecha de la última mención y suma al
   contador (`ingestion/index.ts:161-163`, `218-231`).

**Modo backfill** (`{backfillStartDate, backfillEndDate}` o `{refreshLastHours}`):
re-escanea una ventana pasada **sin tocar el cursor**, para recuperar menciones
que Brandwatch indexa con retraso (`ingestion/index.ts:38-66`, `159-163`). El
cursor solo avanza hacia adelante; los backfills no lo retroceden ni cuentan dups.

Concurrencia **1** (`reservedConcurrentExecutions:1`, `workers-stack.ts:84`): una
sola invocación puede tardar 5–10 min cuando Brandwatch hace rate-limit; sin
serialización, las invocaciones del cron de 1 min se apilarían y colapsarían el
pipeline con 429s. Las invocaciones sobrantes se throttlean (esperado).

---

## 2. Procesamiento / NLP — `eco-processor`

Código: `infra/lambda/processor/index.ts`. Trigger: SQS `eco-ingestion`, batch 10,
`maxConcurrency` 10 (`workers-stack.ts:144-147`). Concurrencia no reservada.

Por cada lote:

1. **Dedup por lote**: un solo `SELECT bw_resource_id ... WHERE = ANY(...)` filtra
   las menciones que ya están en la DB (`processor/index.ts:72-98`).
2. Para cada mención nueva (`processRecord`, `processor/index.ts:118`):
   - Resuelve la agencia por `queryId` desde un mapa cacheado; si falla, refresca
     desde DB; si sigue sin match, lanza para que SQS reintente/DLQ
     (`processor/index.ts:122-132`).
   - **Dedup por texto**: `text_hash = sha256(normalizeText(title+snippet))`. Si
     ya existe ese hash para la agencia, marca `is_duplicate=true` y guarda
     `duplicate_of_id` (`processor/index.ts:137-147`).
   - **NLP con Claude** (`analyzeWithClaude`, `processor/index.ts:283`): un único
     prompt en español pide JSON crudo con `sentiment`, `emotions`, `pertinence`,
     `topics` (slugs de la taxonomía de la agencia), `municipalities` y `summary`.
     El prompt incluye el sentimiento de Brandwatch como ancla y reglas anti-sesgo
     (el modelo tendía a ser demasiado positivo). `max_tokens:1024`,
     `temperature:0.1` (`processor/index.ts:359-365`).
   - **Refuerzo regex de municipios**: un pase determinístico
     (`extractMunicipalitiesFromText`) se fusiona con la salida de Claude — subió
     la cobertura de 31% a >70% (`processor/index.ts:155-157`).
   - **INSERT** en `mentions` con todos los campos de Brandwatch + NLP, usando
     `published_at` parseado de `date`/`added` (nunca `NOW()` — un fallback a NOW
     colapsaría menciones sin fecha en el día de ingesta, `processor/index.ts:426-441`).
   - Asocia tópicos (`mention_topics`), subtópicos y municipios
     (`mention_municipalities`, source `nlp` o `brandwatch`).
   - **Disparo de alerta**: si `pertinence='alta'` y `sentiment='negativo'`,
     encola un mensaje en SQS `eco-alerts` (`processor/index.ts:264-278`).

> **Embeddings**: este lambda **no genera** el embedding de la mención (no hay
> llamada a Titan aquí). Los embeddings se pueblan vía la acción
> `backfill-embeddings` de `eco-migration` usando Amazon Titan Embed Text v2
> (1024 dims). El helper `infra/lambda/lib/embeddings.ts` documenta en su
> comentario que el processor *debería* generarlos, pero en el código actual del
> processor no ocurre. Ver [Integraciones](integraciones.md#embeddings) y
> [Modelo de datos](modelo-de-datos.md#pgvector).

---

## 3. Métricas diarias — `eco-metrics-calculator`

Código: `infra/lambda/metrics-calculator/index.ts`. Trigger: EventBridge **cada 10
minutos** (recalcula solo el snapshot de hoy) + backfill diario 09:00 UTC que
recomputa todos los días históricos con menciones (`workers-stack.ts:243-259`).

Por cada agencia activa y para la fecha objetivo (hoy, en AST):

1. Agrega `mentions` del día en AST: conteos por sentimiento, pertinencia alta,
   sumas de engagement/reach/impact (`metrics-calculator/index.ts:202-235`).
2. Carga los últimos 30 snapshots previos como historia
   (`metrics-calculator/index.ts:237-256`).
3. Llama `calculateMetrics` de `@eco/shared/metrics` (single source of truth) y
   hace `INSERT ... ON CONFLICT (agency_id, date) DO UPDATE` en
   `daily_metric_snapshots` (`metrics-calculator/index.ts:143-200`).
4. **Evalúa alertas de crisis** (`evaluateCrisisAlerts`,
   `metrics-calculator/index.ts:352`): si una regla `crisis_threshold` está activa
   y `crisis_risk_score >= crisis_min` y se respeta el cooldown, genera un
   editorial con Bedrock (tool-use) y envía un correo HTML por SES, individual por
   destinatario. Ver [Métricas](metricas.md) y [Lambdas](lambdas.md).

Las fórmulas exactas (NSS, BHI, Crisis Risk v3, Polarization, etc.) están en
[metricas.md](metricas.md).

---

## 4. Narrativas — `eco-narrative-cluster` (+ edges, + drift)

Código: `infra/lambda/narrative-cluster/index.ts`. Trigger: cron **horario en el
minuto 15** (15 min después del weekly-report para dar margen a que ingesta +
processor pueblen embeddings — `workers-stack.ts:416-421`).

Por cada agencia activa:

1. Toma menciones con `embedding` no asignadas a ninguna narrativa ni candidato
   (`narrative-cluster/index.ts:189-201`).
2. Para cada una busca las top-3 narrativas activas más cercanas por coseno
   (pgvector `<=>`). Si la mejor `>= 0.78`, asigna 1:N (`narrative_mentions`,
   top-1 `is_primary`) y actualiza el centroide del top-1 con EWMA
   (`narrative-cluster/index.ts:206-283`). Si no, encola la mención en
   `narrative_candidates`.
3. Sobre el pool de candidatos corre **DBSCAN** (eps 0.22, minPts 10); cada
   cluster denso nace como narrativa nueva, nombrada con Bedrock tool-use
   (`narrative-cluster/index.ts:316-487`).
4. Recalcula los estados de ciclo de vida (`updateLifecycleStates`).
5. Calcula el iniciador influyente de narrativas con ≥24h de antigüedad.

Concurrencia **1** (`workers-stack.ts:377`): el pool de candidatos es estado
compartido; dos corridas simultáneas duplicarían narrativas.

Complementos:

- **`eco-narrative-edges`** (diario 06:00 UTC): recalcula edges co_occurrence,
  author_overlap y semantic (truncate + reinsert por agencia).
- **`eco-narrative-drift`** (semanal, lunes 08:00 UTC): renombra narrativas cuyo
  centroide derivó >25% desde el último naming.

Detalle completo en [Motor de narrativas](narrativas-motor.md).

---

## 5. Capa de IA del dashboard — `eco-ai-tasks`

Código: `infra/lambda/ai-tasks/index.ts`. Trigger: cron **4×/día** (04, 10, 16, 22
UTC = 00, 06, 12, 18 AST — `workers-stack.ts:346-351`), acción `briefing` por
defecto.

- **`briefing`**: por agencia, agrega las últimas 24h e invoca Claude para producir
  un resumen ejecutivo (`narrative_html`, `dominant_signal`, `action_label`,
  `reach_label`) que persiste en `agency_briefings`. Si hay <10 menciones o
  Bedrock falla, cae a un briefing de reglas determinístico (`fallback=true`).
- **`topic-descriptions`** (manual): genera una descripción 2-3 oraciones por
  tópico activo y la guarda en `topics.description`.

> El schema `overview_period_insights` y el endpoint `/api/eco-insights` referencian
> una acción `period-insights` de este lambda, pero **el handler en el código
> actual solo implementa `briefing` y `topic-descriptions`**
> (`ai-tasks/index.ts:96-106`). Discrepancia a tener presente.

---

## 6. Entrega

- **App web** (ECS Fargate, Next.js): el dashboard llama a `/api/eco-data`,
  `/api/overview`, `/api/narratives`, etc. Las métricas compuestas se recalculan
  sobre la ventana del periodo del usuario con `loadMetricsForWindow`
  (`eco-data/route.ts:349-353`). Ver [API interna](api-interna.md) y
  [Frontend](frontend.md).
- **Reporte semanal** (`eco-weekly-report`): cron horario; envía por SES a las
  agencias cuya hora local coincide con `send_hour_local`. Periodo: 7 días
  naturales **cerrados** terminando ayer en AST. Ver [Lambdas](lambdas.md) y
  [Runbooks](runbooks.md).
- **Alertas**: dos pipelines reales (siguiente sección).

---

## Cadencias (resumen)

| Etapa | Lambda | Cadencia (UTC) |
|---|---|---|
| Ingesta | `eco-ingestion` | cada 1 min + 07:00 (late arrival 48h) |
| Procesamiento | `eco-processor` | event-driven (SQS) |
| Métricas + crisis | `eco-metrics-calculator` | cada 10 min + 09:00 (backfill) |
| Alertas por regla | `eco-alerts` | event-driven (SQS) |
| Narrativas: cluster | `eco-narrative-cluster` | min 15 de cada hora |
| Narrativas: edges | `eco-narrative-edges` | 06:00 diario |
| Narrativas: drift | `eco-narrative-drift` | lunes 08:00 |
| Briefings IA | `eco-ai-tasks` | 04, 10, 16, 22 |
| Reporte semanal | `eco-weekly-report` | min 0 de cada hora (filtra por TZ) |

---

## Alertas: real vs mock

Hay **dos rutas de notificación reales**:

1. **`eco-alerts`** (`infra/lambda/alerts/index.ts`): se dispara cuando el
   processor encola una mención negativa de alta pertinencia. Evalúa reglas
   `negative_sentiment`, `keyword`, `volume_spike` de `alert_rules` y envía email
   por SES, registrando en `alert_history` (`alerts/index.ts:43-143`).
2. **Crisis** desde `eco-metrics-calculator`: reglas `crisis_threshold`, editorial
   IA + correo HTML por SES.

En cambio, la **consola de alertas del frontend tiene datos mock que no
persisten**. El endpoint `/api/eco-data` devuelve los `ALERTS` con campos
hardcodeados `priority:'media'`, `triggered:0`, `lastFired:'—'`
(`eco-data/route.ts:1069-1077`); los KPIs, el feed en vivo y las acciones de
triage de esa pantalla son maqueta en evolución. La lista de reglas
(`/api/alerts`) y el historial (`/api/alerts/history`) sí son reales. Esto se
documenta también en la [Guía de Usuario] para mantener consistencia. Ver
[API interna](api-interna.md).
