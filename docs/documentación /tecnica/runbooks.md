# Runbooks

Operaciones comunes. Asume credenciales AWS cargadas desde el `.env` del monorepo
(`set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a`). Ver
[Despliegue](despliegue.md) y [Lambdas](lambdas.md).

---

## Backfill de ingesta (menciones tardías)

Brandwatch indexa algunas menciones con retraso. El cron diario 07:00 UTC ya
re-escanea 48h, pero para una ventana específica:

```bash
# Por ventana explícita (no toca el cursor)
aws lambda invoke --function-name eco-ingestion \
  --payload '{"backfillStartDate":"2026-05-01T00:00:00Z","backfillEndDate":"2026-05-07T00:00:00Z"}' \
  --cli-binary-format raw-in-base64-out /tmp/bf.json

# Últimas N horas
aws lambda invoke --function-name eco-ingestion \
  --payload '{"refreshLastHours":48}' \
  --cli-binary-format raw-in-base64-out /tmp/bf.json
```

Opcional `backfillQueryIds:[...]` para limitar a ciertas queries. El cursor solo
avanza; el backfill no lo retrocede (`ingestion/index.ts:159-163`).

---

## Backfill de métricas (recomputar snapshots)

Cuando llegan menciones tardías o tras un outage, los snapshots históricos quedan
con valores viejos. Recompute todos los días con menciones:

```bash
aws lambda invoke --function-name eco-metrics-calculator \
  --payload '{"backfill":true}' \
  --cli-binary-format raw-in-base64-out /tmp/mc.json
```

Si cambiaste una fórmula y quieres reconstruir desde cero:

```bash
# 1) Vaciar snapshots (NO toca mentions)
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"reset-snapshots"}' \
  --cli-binary-format raw-in-base64-out /tmp/r.json
# 2) Recalcular
aws lambda invoke --function-name eco-metrics-calculator \
  --payload '{"backfill":true}' --cli-binary-format raw-in-base64-out /tmp/mc.json
```

---

## Backfill de embeddings (narrativas)

Las menciones nuevas no traen embedding (el processor no lo genera). Pueblalos en
lotes idempotentes:

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"backfill-embeddings","agencySlug":"ddecpr","limit":1000}' \
  --cli-binary-format raw-in-base64-out /tmp/emb.json
cat /tmp/emb.json   # reporta processed/succeeded/remaining; repetir hasta remaining=0
```

Luego el cron de `eco-narrative-cluster` (minuto 15) los asignará/clusterizará.
También se puede invocar a mano:

```bash
aws lambda invoke --function-name eco-narrative-cluster \
  --payload '{"agencySlug":"ddecpr","dryRun":true}' \
  --cli-binary-format raw-in-base64-out /tmp/cl.json
```

`dryRun` no escribe; `skipNaming` evita el coste de Bedrock.

---

## Reporte semanal

### Dry-run (sin enviar)

```bash
aws lambda invoke --function-name eco-weekly-report \
  --payload '{"agencySlug":"ddecpr","dryRun":true}' \
  --cli-binary-format raw-in-base64-out /tmp/dry.json
python3 -c 'import json; d=json.load(open("/tmp/dry.json")); open("/tmp/preview.html","w").write(d["html"])'
open /tmp/preview.html
```

### Prueba real a un solo destinatario

```bash
aws lambda invoke --function-name eco-weekly-report \
  --payload '{"agencySlug":"ddecpr","trigger":"test","recipients":["x@populicom.com"]}' \
  --cli-binary-format raw-in-base64-out /tmp/test.json
```

`recipients` en el payload **sobreescribe** la lista del config solo para esa
invocación; no toca la DB. Recordatorio: el cron horario solo envía a las agencias
cuya hora local coincide con `send_hour_local` (DDEC: 06:00 AST = 10:00 UTC).

### Iteración local del template (sin Lambda)

`scripts/preview-weekly-report.ts` genera HTML con datos mock a
`apps/web/public/emails/weekly-report-real.html`:

```bash
cd /Users/alegut/MyApps/eco_populicom
node_modules/.bin/tsx .claude/worktrees/<worktree>/scripts/preview-weekly-report.ts
npm run dev -w apps/web   # abrir http://localhost:3000/emails/weekly-report-real.html
```

QuickChart sin `&v=4` muestra leyenda duplicada (Chart.js v2 no respeta
`legend.display=false`).

---

## Inspección de DB (solo SELECT)

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT slug, count(*) FROM mentions m JOIN agencies a ON a.id=m.agency_id GROUP BY slug"}' \
  --cli-binary-format raw-in-base64-out /tmp/q.json
cat /tmp/q.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.loads(d["body"]))'
```

Para UPDATE/INSERT hay que añadir una acción a `eco-migration` o usar el patrón
self-heal (ver [Despliegue](despliegue.md#migraciones)).

### Diagnóstico de calidad del pipeline

Vía el endpoint admin (header con `ECO_CRON_SECRET`):

```bash
curl -s -H "x-eco-cron-secret: $ECO_CRON_SECRET" \
  http://<alb-dns>/api/admin/diagnostics | python3 -m json.tool
```

Devuelve cobertura NLP, distribución y matriz de confusión BW vs NLP, freshness de
snapshots, cursores e ingesta diaria (`admin/diagnostics/route.ts`). Equivalente
SQL: la acción `qa-date-alignment` de `eco-migration` (AST vs UTC, detección del
bug NOW()).

---

## Ante una crisis (qué revisar)

1. **¿El score es real?** Inspecciona el snapshot del día y sus subcomponentes:
   ```bash
   aws lambda invoke --function-name eco-migration \
     --payload '{"action":"custom-query","query":"SELECT date, crisis_risk_score, crisis_severity, crisis_velocity, crisis_relevance, crisis_confidence, total_mentions, negative_count FROM daily_metric_snapshots ORDER BY date DESC LIMIT 5"}' \
     --cli-binary-format raw-in-base64-out /tmp/c.json
   ```
   Recuerda la banda: NORMAL <0.25, ELEVADO 0.25–0.40, ALERTA 0.40–0.60, CRISIS
   ≥0.60. Ver [Métricas](metricas.md#crisis-risk--v3-mayo-2026).
2. **¿Se envió la alerta?** Revisa `alert_history` (`notification_sent`,
   `recipients_sent/failed`, `details`).
3. **Forzar el editorial / re-enviar test** (brinca umbral y cooldown):
   ```bash
   aws lambda invoke --function-name eco-metrics-calculator \
     --payload '{"forceCrisis":true,"agencySlug":"ddecpr","recipientsOverride":["x@populicom.com"]}' \
     --cli-binary-format raw-in-base64-out /tmp/fc.json
   ```
4. **Drivers**: los top tópicos/municipios negativos y la muestra de menciones que
   alimentan el editorial se calculan en `fireCrisisAlert`
   (`metrics-calculator/index.ts:453-812`).

---

## Limpieza de duplicados de narrativas

Si una corrida concurrente dejó duplicados `is_primary` (bug previo a
`reservedConcurrentExecutions=1`):

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"cleanup-narrative-duplicates"}' \
  --cli-binary-format raw-in-base64-out /tmp/dup.json
```

Idempotente; mantiene la asignación más antigua como primary.

---

## Rotación de secretos

- **Token de Brandwatch** (`eco/brandwatch-token`): actualiza el valor en Secrets
  Manager; `eco-ingestion` lo cachea por invocación y lo recoge en el siguiente
  cold start, **sin redeploy** (`ingestion/index.ts:192-208`).
- **Credenciales RDS** (`EcoDbSecret`): gestionadas por CDK; cada Lambda y ECS las
  leen al arrancar.
- **`eco/cron-secret`**: regenerar con `openssl rand -hex 32` y actualizar el
  secret; ECS lo inyecta como `ECO_CRON_SECRET` en el próximo despliegue del
  servicio.

---

## Reset de cursores de ingesta

Para re-ingestar desde cero ciertas queries:

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"reset-cursors","queryIds":[123456]}' \
  --cli-binary-format raw-in-base64-out /tmp/rc.json
```
