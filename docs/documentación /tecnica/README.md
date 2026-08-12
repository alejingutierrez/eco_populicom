# Documentación Técnica de ECO

Documentación para **desarrolladores y analistas de datos**. Describe cómo está
construida la plataforma ECO: infraestructura, pipeline de datos, fórmulas de
métricas, motor de narrativas, API interna, seguridad y operación.

El enfoque aquí es **técnico y verificado contra el código fuente**. Cada dato
relevante (IDs de modelo, crons, umbrales, columnas, fórmulas) cita su origen con
`ruta/archivo.ts:línea`. Para las explicaciones conceptuales en lenguaje claro,
esta sección enlaza a [Fundamentos](../fundamentos/README.md); aquí se aporta el
detalle de implementación.

> Plataforma multi-cliente ("agencia") sobre AWS, cuenta `863956448838`, región
> `us-east-1`. Cliente de referencia: **DDEC** de Puerto Rico (slug `ddecpr`).

## Índice

1. [Arquitectura](arquitectura.md) — los 8 stacks CDK, recursos AWS que provisiona
   cada uno y cómo se relacionan.
2. [Pipeline de datos](pipeline-datos.md) — flujo end-to-end (ingesta →
   procesamiento → métricas → narrativas → UI) con cadencias.
3. [Lambdas](lambdas.md) — las 10 funciones Lambda: trigger, entrada/salida,
   lógica clave, concurrencia y timeout.
4. [Modelo de datos](modelo-de-datos.md) — las ~22 tablas PostgreSQL, columnas
   clave, relaciones, índices y la extensión pgvector.
5. [Métricas](metricas.md) — las fórmulas exactas con código y `file_path:línea`,
   rangos, ventanas y bandas. **Destino de los enlaces desde Fundamentos.**
6. [Motor de narrativas](narrativas-motor.md) — embeddings, similitud coseno,
   DBSCAN, EWMA, máquina de estados del ciclo de vida, drift y edges.
7. [Integraciones](integraciones.md) — Brandwatch, Bedrock, SES, Cognito, Secrets
   Manager.
8. [API interna](api-interna.md) — rutas bajo `apps/web/src/app/api/`: método,
   parámetros, respuesta y rate limiting.
9. [Frontend](frontend.md) — app Next.js (App Router), el prototipo SPA, los
   componentes de narrativas, theming y contexto de agencia.
10. [Autenticación y seguridad](autenticacion-seguridad.md) — Cognito, middleware,
    headers/CSP, rate limiting, roles y la brecha de enforcement de roles.
11. [Despliegue](despliegue.md) — deploy de stacks CDK, patrón de worktrees,
    deploy de Lambdas y migraciones.
12. [Runbooks](runbooks.md) — backfills, dry-run del reporte, inspección de DB,
    respuesta a crisis y rotación de secretos.
13. [Observabilidad](observabilidad.md) — alarmas CloudWatch, dashboards, DLQ y
    logging.

## Diagrama de arquitectura

```
                          ┌────────────────────────┐
                          │  Brandwatch (proveedor  │
                          │  de datos de medios)    │
                          └───────────┬────────────┘
                                      │ HTTPS (token Secrets Manager)
                                      ▼
   EventBridge cron 1 min  ┌────────────────────────┐   raw JSON   ┌──────────────┐
   ───────────────────────►│  eco-ingestion (Lambda) │─────────────►│  S3 eco-raw  │
                           └───────────┬────────────┘              └──────────────┘
                                       │ SendMessageBatch
                                       ▼
                              ┌──────────────────┐
                              │ SQS eco-ingestion │──► DLQ eco-ingestion-dlq
                              └────────┬─────────┘
                                       │ batch 10, maxConcurrency 10
                                       ▼
                        ┌────────────────────────────┐  bedrock:InvokeModel
                        │   eco-processor (Lambda)    │──────────────► AWS Bedrock
                        │   NLP: sentimiento, emoción │   (Claude Opus 4.6 /
                        │   pertinencia, tópicos, geo │    fallback Sonnet 4.6)
                        └──────────┬─────────────────┘
                                   │ INSERT mentions (+ junctions)
                                   │ si negativo+alta pertinencia → SQS eco-alerts
                                   ▼
                    ┌───────────────────────────────────────────────┐
                    │      RDS PostgreSQL 16 (pgvector)              │
                    │  mentions · daily_metric_snapshots · topics    │
                    │  narratives · narrative_* · alert_* · reports  │
                    └───────┬───────────────┬───────────────┬───────┘
                            │               │               │
        EventBridge 10 min  │       cron    │      crons     │  lecturas
        ────────────────────▼──     ────────▼──     ─────────▼────────────
        ┌──────────────────────┐  ┌───────────────┐  ┌─────────────────────┐
        │ eco-metrics-calculator│  │ eco-narrative-│  │  ECS Fargate         │
        │ snapshots diarios +   │  │ cluster (1h)  │  │  Next.js (app web)   │
        │ alertas de crisis SES │  │ edges (24h)   │  │  /api/* + dashboard  │
        └──────────┬───────────┘  │ drift (sem.)  │  └──────────┬──────────┘
                   │ SES          └───────────────┘             │ ALB :80
                   ▼                                            ▼
        ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
        │ eco-weekly-report│   │   eco-alerts     │   │  Usuarios (web)  │
        │ correo semanal   │   │  email por regla │   │  Cognito sign-in │
        │ (1h, por TZ) SES │   │  (SQS) SES       │   └──────────────────┘
        └──────────────────┘   └──────────────────┘
        ┌──────────────────┐   ┌──────────────────┐
        │  eco-ai-tasks     │   │  eco-migration   │
        │ briefings 4x/día  │   │ DDL/seed/backfill│
        │ topic-desc (man.) │   │ (manual, fuera   │
        │ (Bedrock) SES no  │   │  de CDK)         │
        └──────────────────┘   └──────────────────┘
```

Las rutas de notificación **reales** son `eco-alerts` (vía SQS) y las alertas de
crisis de `eco-metrics-calculator` (SES). La consola de alertas del frontend
contiene datos mock que no persisten — ver
[Pipeline de datos](pipeline-datos.md#alertas-real-vs-mock) y
[API interna](api-interna.md).

## Convenciones del repositorio

- **Monorepo** con workspaces npm: `apps/web` (Next.js), `infra` (CDK + Lambdas),
  `packages/shared` (`@eco/shared`), `packages/database` (`@eco/database`),
  `packages/brandwatch` (`@eco/brandwatch`).
- **Zona horaria canónica**: `America/Puerto_Rico` (AST, UTC-4 sin horario de
  verano). Toda agregación diaria bucketiza por fecha calendario AST. Ver
  `packages/shared/src/dates.ts`.
- **Fecha de la mención**: las agregaciones usan `published_at` (cuándo se
  publicó), nunca `ingested_at` (cuándo ECO la recibió).
- **Sentimiento efectivo**: `COALESCE(nlp_sentiment, bw_sentiment)` — se usa el
  del clasificador propio y, si aún no procesó, el de Brandwatch.
