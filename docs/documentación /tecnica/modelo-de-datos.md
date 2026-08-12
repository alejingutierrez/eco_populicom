# Modelo de datos

PostgreSQL 16 en RDS (`infra/lib/database-stack.ts`), base `eco`. El esquema se
define con Drizzle en `packages/database/src/schema/*.ts` (re-exportado por
`schema/index.ts`). El DDL ejecutable vive en la Lambda `eco-migration`
(`infra/lambda/migration/index.ts`), no en `drizzle-kit push`. Ver
[Despliegue](despliegue.md#migraciones).

## Extensiones

- **pgvector** — `CREATE EXTENSION IF NOT EXISTS vector` (acción
  `add-embeddings-column`, `migration/index.ts:229`). Habilita los tipos
  `vector(1024)` y el operador de distancia coseno `<=>`.
- `gen_random_uuid()` (pgcrypto, disponible en PG16) para PKs UUID.

## Inventario de tablas (~22)

| Tabla | Definición Drizzle | Propósito |
|---|---|---|
| `agencies` | `agencies.ts` | Clientes (tenants) |
| `users` | `users.ts` | Usuarios + rol |
| `topics` | `topics.ts` | Taxonomía de tópicos por agencia |
| `subtopics` | `topics.ts` | Subdivisiones de tópico |
| `municipalities` | `municipalities.ts` | 78 municipios PR |
| `mentions` | `mentions.ts` | **Tabla núcleo** |
| `mention_topics` | `mention-relations.ts` | Mención ↔ tópico/subtópico |
| `mention_municipalities` | `mention-relations.ts` | Mención ↔ municipio |
| `ingestion_cursors` | `ingestion-cursors.ts` | Cursor por query Brandwatch |
| `daily_metric_snapshots` | `daily-metric-snapshots.ts` | Métricas diarias |
| `alert_rules` | `alerts.ts` | Reglas de alerta |
| `alert_history` | `alerts.ts` | Disparos de alerta |
| `report_configs` | `reports.ts` | Config del reporte por agencia |
| `report_send_log` | `reports.ts` | Histórico de envíos |
| `agency_briefings` | `briefings.ts` | Briefings IA del scorecard |
| `overview_period_insights` | `overview-period-insights.ts` | Caché insights Overview |
| `metric_insights_cache` | `metric-insights-cache.ts` | Caché insights por métrica |
| `topic_descriptions_cache` | `topic-descriptions-cache.ts` | Caché descripción tópico×periodo |
| `narratives` | `narratives.ts` | Narrativas (clusters) |
| `narrative_mentions` | `narratives.ts` | Narrativa ↔ mención (1:N) |
| `narrative_edges` | `narratives.ts` | Conexiones entre narrativas |
| `narrative_candidates` | `narratives.ts` | Pool DBSCAN pendiente |

> Nota: `topics.description` existe pero la descripción "buena" por periodo vive en
> `topic_descriptions_cache`; `topics.description` se usa como fallback simple.

---

## Núcleo: `mentions`

`packages/database/src/schema/mentions.ts`; DDL en `migration/index.ts:839-898`.
PK `id uuid`. `bw_resource_id` es **UNIQUE** (idempotencia de ingesta). Grupos de
columnas:

- **Identificadores Brandwatch**: `bw_resource_id`, `bw_guid`, `bw_query_id`,
  `bw_query_name`.
- **Contenido**: `title`, `snippet`, `url`, `original_url`.
- **Autor**: `author`, `author_fullname`, `author_gender`, `author_avatar_url`.
- **Fuente**: `domain`, `page_type` (NOT NULL), `content_source`,
  `content_source_name`, `pub_type`, `subtype`.
- **Engagement**: `likes`, `comments`, `shares`, `engagement_score`, `impact`,
  `reach_estimate`, `potential_audience`, `monthly_visitors`.
- **Geo Brandwatch**: `bw_country`, `bw_country_code`, `bw_region`, `bw_city`,
  `bw_city_code`.
- **Sentimiento**: `bw_sentiment` (de Brandwatch), `nlp_sentiment` (Claude),
  `nlp_emotions` (jsonb array), `nlp_pertinence` (`alta|media|baja`),
  `nlp_summary`.
- **Dedup**: `text_hash` (sha256), `is_duplicate`, `duplicate_of_id`.
- **Media**: `media_urls` (jsonb), `has_image`, `has_video`.
- **Tiempos**: `published_at` (NOT NULL, **fecha de la mención**), `ingested_at`,
  `processed_at`, `language`.
- **pgvector** (añadidas por migración, no en el schema Drizzle):
  `embedding vector(1024)`, `embedded_at timestamptz`.

Índices (`mentions.ts:90-98` + `migration/index.ts:893-898`):
`idx_mentions_agency_id`, `idx_mentions_published_at` (desc),
`idx_mentions_nlp_sentiment`, `idx_mentions_page_type`, `idx_mentions_text_hash`,
`idx_mentions_domain`, `idx_mentions_agency_published`, y el **ivfflat**
`idx_mentions_embedding USING ivfflat (embedding vector_cosine_ops) WITH (lists=100)`
(`migration/index.ts:232`).

---

## Multi-tenancy y catálogos

### `agencies` (`agencies.ts`)
`id uuid` PK, `name`, `slug` UNIQUE, `brandwatch_project_id bigint`,
`brandwatch_query_ids jsonb (number[])`, `logo_url`, `is_active`. El `slug` es la
clave de tenant (mapea a `custom:agency_slug` de Cognito).

### `users` (`users.ts`)
`id uuid` PK, `cognito_sub` UNIQUE, `email`, `name`, `role` (enum
`user_role: admin|analyst|viewer`), `agency_id` → `agencies`, `is_active`,
`last_login`. Los invitados se crean con `cognito_sub = 'invited:<email>'` hasta el
primer login (`users/route.ts:79`).

### `topics` / `subtopics` (`topics.ts`)
`topics`: `id serial`, `agency_id` → `agencies`, `name`, `slug`,
UNIQUE `(agency_id, slug)`. `subtopics`: `id serial`, `topic_id` → `topics`, `slug`,
UNIQUE `(topic_id, slug)`. La taxonomía base se siembra desde
`@eco/shared.TOPICS_BY_AGENCY`.

### `municipalities` (`municipalities.ts`)
`id serial`, `name`, `slug` UNIQUE, `region`, `latitude`, `longitude`,
`population`. 78 municipios de Puerto Rico.

### Junctions (`mention-relations.ts`)
- `mention_topics`: PK `(mention_id, topic_id)`, `subtopic_id` (nullable, FK),
  `confidence double`. `subtopic_attempts smallint` se añade por migración para no
  reprocesar filas que el LLM no pudo clasificar (`migration/index.ts:536-539`).
- `mention_municipalities`: PK `(mention_id, municipality_id)`, `source`
  (`brandwatch|nlp`).

### `ingestion_cursors` (`ingestion-cursors.ts`)
PK `query_id bigint` (id de query de Brandwatch, **no** por agencia),
`last_mention_date`, `last_run_at`, `mentions_fetched`, `status`.

---

## Métricas: `daily_metric_snapshots`

`daily-metric-snapshots.ts`; DDL en `migration/index.ts:964+`. `id uuid` PK,
`agency_id` → `agencies`, `date date`, UNIQUE `(agency_id, date)`.

- **Brutos**: `total_mentions`, `positive/neutral/negative_count`,
  `high_pertinence_count`, `total_likes/comments/shares`, `total_reach bigint`,
  `total_impact`, `total_engagement_score`.
- **Compuestas**: `nss`, `brand_health_index`, `reputation_momentum`,
  `engagement_rate`, `amplification_rate`, `engagement_velocity`,
  `crisis_risk_score`, `volume_anomaly_zscore`, `polarization_index`,
  `nss_7d`, `nss_30d`.
- **Drilldown de crisis**: `crisis_severity`, `crisis_velocity`,
  `crisis_relevance`, `crisis_confidence` (no se exponen en UI; auditoría).
- `computed_at`.

Índices: UNIQUE `(agency_id, date)`, `idx_daily_metrics_agency_crisis`
`(agency_id, crisis_risk_score)`. Las fórmulas en [Métricas](metricas.md).

---

## Alertas

### `alert_rules` (`alerts.ts`)
`id uuid`, `agency_id`, `name`, `description`, `is_active`, `config jsonb`
(`AlertConfig`), `notify_emails jsonb (string[])`, `created_by`. Tipos de `config`:
`negative_sentiment`, `keyword`, `volume_spike` (evaluados por `eco-alerts`) y
`crisis_threshold` (evaluado por `eco-metrics-calculator`, con `crisis_min`,
`severity_min`, `cooldown_hours`).

### `alert_history` (`alerts.ts`)
`id uuid`, `alert_rule_id`, `agency_id`, `triggered_at`, `mention_ids jsonb`,
`details jsonb`, `notification_sent`, `sent_at`.

---

## Reportes

### `report_configs` (`reports.ts`)
PK `agency_id` (una fila por agencia). `is_active`, `send_hour_local` (0–23, default
6), `timezone` (default `America/Puerto_Rico`), `template_key`
(`weekly-sentiment-summary`), `recipients jsonb`, `from_email`, `from_name`,
`updated_by`.

### `report_send_log` (`reports.ts`)
`id uuid`, `agency_id`, `sent_at`, `recipients jsonb`, `from_email`,
`template_key`, `trigger` (`scheduled|manual|test`), `status`
(`sent|skipped|failed|no_recipients|no_data`), `message_id`, `error`,
`stats jsonb {negative,neutral,positive,total}`, `triggered_by`.

---

## Cachés de IA

### `agency_briefings` (`briefings.ts`)
`id uuid`, `agency_id`, `generated_at`, `period_hours` (default 24), `mode`
(`signal|emerging|crisis`, default `signal`), `narrative_html`, `dominant_signal`,
`action_label`, `action_tone`, `reach_label`, `model_used`, `source_mentions`,
`fallback bool`. Históricos se conservan. Índices por `(agency_id, generated_at)` y
`(agency_id, mode, generated_at)`.

> Aunque el schema declara `mode` con 3 valores, el handler actual de `eco-ai-tasks`
> persiste un único briefing por agencia (sin diferenciar modo) —
> `ai-tasks/index.ts:118-163`.

### `overview_period_insights` (`overview-period-insights.ts`)
`id uuid`, `agency_id`, `period_start_date`, `period_end_date`,
`negative/neutral/positive_insights jsonb`, `daily_summary`, `model_used`,
`generated_at`. UNIQUE `(agency_id, period_start, period_end)`. Patrón de caché:
histórico inmutable; rolling refresca si `generated_at < NOW()-1h`. Lee
`/api/eco-insights`.

### `metric_insights_cache` (`metric-insights-cache.ts`)
`id uuid`, `agency_id`, `metric varchar(24)`, `period_start/end_date`,
`insight_text`, `model_used`, `generated_at`. UNIQUE
`(agency_id, metric, period_start, period_end)`. Lee `/api/eco-metric-insight`.

### `topic_descriptions_cache` (`topic-descriptions-cache.ts`)
`id uuid`, `agency_id`, `topic_id`, `period_start/end_date`, `description`,
`model_used`, `generated_at`. UNIQUE `(topic_id, period_start, period_end)`. Lee
`/api/eco-topic-description`.

---

## Narrativas (pgvector)

DDL en la acción `create-narratives-schema` (`migration/index.ts:249-354`).
Detalle algorítmico en [Motor de narrativas](narrativas-motor.md).

### `narratives` (`narratives.ts`)
`id uuid`, `agency_id`, `name`, `slug`, `summary`, `keywords jsonb`,
`centroid vector(1024)`, `centroid_at_naming vector(1024)`, `status`
(CHECK `emerging|active|peaking|declining|dormant|revived`), `first_mention_id`
(FK → `mentions`, ON DELETE SET NULL), `initiator_first jsonb`,
`initiator_influencer jsonb`, `mention_count`, `total_engagement bigint`,
`total_reach bigint`, `velocity_24h`, `engagement_velocity_24h`, `drift_score`,
`born_at`, `last_mention_at`, `peaked_at`, `last_renamed_at`. UNIQUE
`(agency_id, slug)`. Índices: `(agency_id, status)`, `(agency_id, last_mention_at)`,
e **ivfflat** sobre `centroid` `WITH (lists=10)`.

> En Drizzle `centroid`/`centroid_at_naming` se declaran como `text` porque el ORM
> no tiene tipo nativo pgvector; los queries usan `::vector` y `<=>` en raw SQL
> (`narratives.ts:37-39`).

### `narrative_mentions` (`narratives.ts`)
PK `(narrative_id, mention_id)`, `similarity double`, `is_primary bool`,
`assigned_at`. Una mención puede pertenecer hasta a 3 narrativas; la de mayor
similitud lleva `is_primary=true`. Índice extra `(mention_id)` y parcial
`(mention_id) WHERE is_primary` (`migration/index.ts:304-307`).

### `narrative_edges` (`narratives.ts`)
PK `(source_narrative_id, target_narrative_id, edge_type)`, `agency_id`,
`edge_type` (CHECK `co_occurrence|author_overlap|semantic`), `strength double`,
`computed_at`. CHECK `source < target` (undirected, orden UUID). Índice
`(agency_id, edge_type)`.

### `narrative_candidates` (`narratives.ts`)
`id uuid`, `agency_id`, `mention_id` UNIQUE, `embedding vector(1024) NOT NULL`,
`created_at`. Pool DBSCAN: menciones que no matchearon ninguna narrativa; se vacían
cuando spawnean una narrativa nueva.

---

## Diagrama de relaciones (simplificado)

```
agencies 1───* users
   │ 1
   ├──* topics 1──* subtopics
   ├──* mentions ──* mention_topics *── topics
   │        │      └─* mention_municipalities *── municipalities
   │        ├── embedding vector(1024)
   │        └──* narrative_mentions *── narratives
   ├──* daily_metric_snapshots
   ├──* alert_rules 1──* alert_history
   ├──1 report_configs        ├──* report_send_log
   ├──* agency_briefings
   ├──* narratives 1── first_mention_id ─► mentions
   │        └──* narrative_edges (source/target ─► narratives)
   └──* narrative_candidates *── mentions

ingestion_cursors (por query_id de Brandwatch, sin FK a agencies)
*_cache (overview_period / metric_insights / topic_descriptions) ─► agencies
```
