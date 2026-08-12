# Observabilidad

El monitoreo se define en `EcoMonitoring` (`infra/lib/monitoring-stack.ts`),
complementado por logs estructurados, las DLQ de SQS y el endpoint de diagnóstico.

## Alarmas CloudWatch

Todas las alarmas accionan el topic SNS `eco-alerts-ops`, suscrito por email a
`agutierrez@populicom.com` (`monitoring-stack.ts:29-36`).

| Alarma | Métrica | Umbral | Periodos |
|---|---|---|---|
| `eco-rds-cpu-high` | RDS CPUUtilization | > 80% | 2 × 5 min |
| `eco-lambda-ingestion-errors` | Errores `eco-ingestion` | > 5 | 1 × 5 min |
| `eco-lambda-processor-errors` | Errores `eco-processor` | > 5 | 1 × 5 min |
| `eco-lambda-alerts-errors` | Errores `eco-alerts` | > 5 | 1 × 5 min |
| `eco-dlq-ingestion-messages` | Mensajes visibles `eco-ingestion-dlq` | > 0 | 1 × 5 min |
| `eco-dlq-alerts-messages` | Mensajes visibles `eco-alerts-dlq` | > 0 | 1 × 5 min |

`monitoring-stack.ts:39-90`.

> **Cobertura parcial**: solo `eco-ingestion`, `eco-processor` y `eco-alerts` tienen
> alarma de errores (`monitoring-stack.ts:52-56`). Las otras Lambdas
> (`eco-metrics-calculator`, `eco-weekly-report`, `eco-ai-tasks`,
> `eco-narrative-*`, `eco-migration`) **no** tienen alarma — sus fallos solo se ven
> en logs. Punto a mejorar.

---

## Dashboard CloudWatch

`eco-dashboard` (`monitoring-stack.ts:93-142`), tres filas:

1. **RDS**: CPUUtilization y DatabaseConnections.
2. **Lambdas**: Invocations y Errors de `eco-ingestion`, `eco-processor`,
   `eco-alerts`.
3. **SQS DLQ**: profundidad (`ApproximateNumberOfMessagesVisible`) de
   `eco-ingestion-dlq` y `eco-alerts-dlq`.

---

## Colas y DLQ

`EcoMessaging` (`messaging-stack.ts`):

- `eco-ingestion` → DLQ `eco-ingestion-dlq` tras `maxReceiveCount: 3`. Visibility
  300 s, retención 4 días; DLQ retiene 14 días.
- `eco-alerts` → DLQ `eco-alerts-dlq` tras `maxReceiveCount: 3`. Visibility 60 s.

Un mensaje en una DLQ significa que el consumidor falló 3 veces. Causas típicas:
- `eco-ingestion-dlq`: rara (la cola la alimenta el lambda, no SQS→lambda
  directo).
- En `eco-processor`: una mención con `queryId` desconocido o sin `published_at`
  usable se relanza y termina en DLQ para inspección manual
  (`processor/index.ts:129-131`, `426-441`).

Inspección de DLQ:

```bash
aws sqs receive-message --queue-url <dlq-url> --max-number-of-messages 10
```

---

## Logging

- **Lambdas**: `console.log/warn/error`. Las cinco originales importan sus Log
  Groups preexistentes por nombre (`/aws/lambda/<fn>`, `workers-stack.ts:46-47`);
  las tres de narrativas crean su Log Group con **retención 1 mes**
  (`workers-stack.ts:396-400`, etc.). Prefijos por etapa: `[narrative-cluster]`,
  `[crisis]`, `[ai-tasks]`, `[bedrock]`, `[embeddings]`, etc.
- **App web**: helper `apps/web/src/lib/log.ts` (`log.info/error`) con contexto
  estructurado; logs de ECS en `/ecs/eco-web` (retención 1 mes,
  `compute-stack.ts:56-60`).
- **Stop reasons de Bedrock**: `invokeClaudeWithTool` registra y propaga
  `stop_reason` anómalo (truncamiento/filtro) en vez de silenciarlo
  (`bedrock.ts:100-106`).

---

## Health checks

- **Contenedor ECS**: `curl -f http://localhost:3000/api/health`, intervalo 30 s,
  3 reintentos, start period 120 s (`compute-stack.ts:102-108`).
- **ALB target group**: `GET /api/health` esperando 200 cada 30 s
  (`compute-stack.ts:180-184`).
- El **circuit breaker** del servicio Fargate revierte un deploy que no pasa el
  health check (`compute-stack.ts:158`).

---

## Diagnóstico de calidad de datos

`GET /api/admin/diagnostics` (header `ECO_CRON_SECRET`) es la vista de
observabilidad **de negocio/datos** (no de infra): cobertura de NLP, distribución y
matriz de confusión Brandwatch vs NLP, tasa de acuerdo, freshness de snapshots por
agencia, estado de cursores e ingesta diaria de los últimos 14 días
(`admin/diagnostics/route.ts`). Útil para detectar gaps entre Brandwatch y el
dashboard sin abrir un cliente de DB. Ver [Runbooks](runbooks.md#diagnóstico-de-calidad-del-pipeline).

Complemento SQL: la acción `qa-date-alignment` de `eco-migration` compara conteos
AST vs UTC y marca menciones con `published_at ≈ ingested_at` (candidatas al viejo
bug del fallback `NOW()`).

---

## Señales operativas a vigilar

| Señal | Dónde | Qué indica |
|---|---|---|
| RDS CPU > 80% | alarma + dashboard | carga de queries/agregaciones |
| Errores Lambda > 5 | alarma (3 fns) | fallo en ingesta/processor/alerts |
| DLQ > 0 | alarma + dashboard | menciones/alertas sin procesar |
| `INGESTION_STATUS` viejo | `/api/eco-data` | ingesta detenida |
| Cobertura NLP baja | `/api/admin/diagnostics` | processor atrasado o fallando |
| `report_send_log.status=failed` | DB | SES o config de reporte |
| `alert_history` sin filas en crisis | DB | alerta de crisis no disparó |
| Snapshots viejos por agencia | `/api/admin/diagnostics` | metrics-calculator atrasado |
