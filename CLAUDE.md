# Notas para Claude Code (este repo)

Esta guía evita re-descubrir el flujo de despliegue cada vez. Está enfocada al
agente, no al humano. Si algo cambia, actualízalo aquí.

---

## ⚠️ Drift bundle-vs-git (léelo antes de redeployar un lambda)

Los bundles desplegados pueden contener código que NO existe en ninguna rama
(deploys desde worktrees nunca pusheados). Casos conocidos (QA 2026-06-10):

- `eco-ingestion`: la versión live (runProgressiveBackfill, makeRateLimiter,
  bw_request_log, backfill_cursors) no tiene fuente TS en git. Snapshot
  verbatim en `infra/lambda/ingestion/deployed-snapshot/index.deployed.js`.
  NO deployees `infra/lambda/ingestion/index.ts` (239 líneas, versión vieja)
  sin portar primero el snapshot.
- `eco-migration`: el bundle live tiene acciones extra (`backfill-topics`,
  `seed-default-alert-rules`, …) que el fuente no tiene. Para añadir una
  acción: descargar bundle (`aws lambda get-function … Code.Location` + curl
  + unzip), editar el JS, `node --check`, re-zip, `update-function-code`.

**Antes de redeployar cualquier lambda**: descarga el bundle vigente y compara
contra tu rama; busca features que solo existan en el bundle.

**Bundling desde worktree**: el symlink `node_modules/@eco/*` resuelve al
working tree del monorepo principal (sucio). Usa SIEMPRE
`--alias:@eco/shared=<worktree>/packages/shared/src/index.ts` (ídem
`@eco/shared/src/bedrock` y `@eco/database`) y rutas ABSOLUTAS del worktree
(`W=$PWD` se rompe cuando el harness resetea el cwd).

---

## Comportamientos de producto confirmados (no son bugs)

- El "reporte semanal" se envía TODOS los días a las 6 AM PR (ventana rolante
  de 7 días cerrados). No hay gate de día de semana; decisión de facto desde
  mayo 2026 — no lo "arregles" sin que lo pida el usuario.
- `admin/diagnostics` cuenta menciones SIN filtrar `is_duplicate` a propósito.
- Reglas de alerta de crisis: las 3 agencias tienen `crisis_threshold`
  (0.4/0.5/12h). aaa y gobernadora notifican solo a agutierrez@ hasta que el
  cliente confirme destinatarios (seed del QA 2026-06-10).
- Cron diario `eco-processor-reprocess-unclassified-manual` (08:30 UTC) es
  TEMPORAL: bórralo cuando un deploy de CDK EcoWorkers cree
  `ProcessorReprocessUnclassifiedDaily` (ya está en workers-stack.ts).
- `eco-narrative-cluster` corre con timeout 900s y env
  `NARRATIVE_CANDIDATE_POOL_LIMIT=12000` (cap del DBSCAN O(n²)).

---

## Stacks AWS

CDK gestiona ocho stacks en `us-east-1`, cuenta `863956448838`. Ver
`infra/lib/`:

| Stack | Contenido |
|---|---|
| `EcoNetwork` | VPC, subredes, security groups |
| `EcoDatabase` | RDS PostgreSQL + Secrets Manager (`DB_SECRET_ARN`) |
| `EcoAuth` | Cognito user pool |
| `EcoStorage` | S3 buckets (assets, exports) |
| `EcoMessaging` | SQS, SNS |
| `EcoWorkers` | Lambdas: `eco-ingestion`, `eco-processor`, `eco-weekly-report`, `eco-alerts`, `eco-metrics-calculator`, `eco-migration` |
| `EcoCompute` | ECS service (Next.js web app) |
| `EcoMonitoring` | CloudWatch alarmas y dashboards |

---

## Despliegue desde un worktree

Las credenciales AWS, GitHub token y demás secretos están en `.env` del
monorepo principal (`/Users/alegut/MyApps/eco_populicom/.env`). El usuario
autorizó usarlos directamente. Resumen de variables relevantes:

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` — IAM user
  `agutierrez@populicom.com` con permisos para CDK, Lambda invoke, SES.
- `GITHUB_TOKEN` — para push y abrir PRs vía REST API (`gh` CLI no está
  instalado).

### Setup inicial del worktree (una vez)

Los worktrees creados con `git worktree add` no tienen `node_modules` propio.
Symlinkar al del monorepo principal funciona para typecheck pero **no para
CDK bundling** porque los workspaces (`@eco/shared`, `@eco/database`) se
resuelven al monorepo principal y no al worktree.

```bash
ln -sfn /Users/alegut/MyApps/eco_populicom/node_modules \
  /Users/alegut/MyApps/eco_populicom/.claude/worktrees/<worktree>/node_modules
```

### Deploy de un cambio del worktree (Lambdas, infra)

Patrón seguro: copiar los archivos del worktree al monorepo principal con
`git checkout origin/<branch> -- <files>` (sin cambiar HEAD), deployar, y
restaurar con `git checkout HEAD -- <files>`. Esto evita re-engineering de
node_modules.

```bash
# 0) Push tu branch para que esté en origin
cd <worktree> && git push -u origin <branch>

# 1) Sincronizar los archivos relevantes al monorepo principal sin tocar HEAD
cd /Users/alegut/MyApps/eco_populicom
git fetch origin <branch>
git checkout origin/<branch> -- \
  packages/shared/... \
  infra/lambda/... \
  apps/web/...
# ↑ lista los archivos que CDK necesita bundlear

# 2) Deploy desde el worktree (cdk lee tsconfig del worktree, pero bundling
#    resuelve npm packages contra /Users/alegut/MyApps/eco_populicom)
cd /Users/alegut/MyApps/eco_populicom/.claude/worktrees/<worktree>/infra
set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
/Users/alegut/MyApps/eco_populicom/node_modules/.bin/cdk diff <Stack>
/Users/alegut/MyApps/eco_populicom/node_modules/.bin/cdk deploy <Stack> \
  --require-approval never

# 3) Limpiar el monorepo principal (revierte los archivos a HEAD/main)
cd /Users/alegut/MyApps/eco_populicom
git checkout HEAD -- packages/shared/... infra/lambda/... apps/web/...
```

`cdk list` desde `infra/`:
```
EcoNetwork EcoDatabase EcoAuth EcoStorage EcoMessaging EcoWorkers EcoCompute EcoMonitoring
```

Deployar solo el stack que tocaste; los demás dicen "There were no
differences" pero CDK los re-evalúa. Tiempo típico de un `cdk deploy
EcoWorkers` con cambio de código de Lambda: 30–45 segundos.

---

## Migraciones de DB

Drizzle vive en `packages/database/src/migrations/`. **NO** corre
automáticamente en deploy: es un sistema separado. La forma actual de
aplicar cambios:

1. **Drizzle puro** (futuro): `drizzle-kit push` desde `packages/database`.
   No verificado en este repo todavía.

2. **Lambda `eco-migration`** (hoy): tiene acciones hardcoded
   (`migrate-and-seed`, `create-reports-schema`, etc.). Si añades una
   migración 0NNN_*.sql, súbela también como nueva acción aquí o usa
   `custom-query` (solo SELECT).

3. **Self-heal idempotente desde el lambda principal** (lo que usamos
   para el reporte semanal): el lambda `eco-weekly-report` tiene
   `ensureReportsSchema()` que ejecuta UPDATEs idempotentes condicionados
   al estado antiguo. Se ejecuta cada hora con el cron de EventBridge.
   Patrón para futuras migraciones DDL/DML "una sola vez": condiciona el
   UPDATE a un estado detectable (ej. `WHERE timezone = 'America/Bogota'`)
   para que sea no-op tras la primera corrida.

### Inspección rápida de la DB

```bash
aws lambda invoke \
  --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT ..."}' \
  --cli-binary-format raw-in-base64-out /tmp/q.json
cat /tmp/q.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.loads(d["body"]))'
```

Solo SELECT. Para UPDATE/INSERT, agrega una acción al `eco-migration` o
usa el self-heal pattern descrito arriba.

---

## Reporte semanal por correo (`eco-weekly-report`)

- **Trigger**: EventBridge cron `cron(0 * * * ? *)` — cada hora, minuto 0
  UTC. La lambda itera `report_configs is_active = true` y envía solo
  cuando `hourInTimeZone(nowUtc, cfg.timezone) === cfg.send_hour_local`.
- **Hora de envío DDEC**: 6:00 AM `America/Puerto_Rico` = 10:00 UTC.
- **Periodo**: 7 días naturales **cerrados** terminando AYER en TZ PR. No
  incluye el día actual parcial.
- **Recipients**: editables vía `/settings/reports` o por SQL en
  `report_configs.recipients` (jsonb array).

### Probar sin enviar (dryRun)

```bash
aws lambda invoke \
  --function-name eco-weekly-report \
  --payload '{"agencySlug":"ddecpr","dryRun":true}' \
  --cli-binary-format raw-in-base64-out /tmp/dry.json
python3 -c 'import json; d=json.load(open("/tmp/dry.json")); open("/tmp/preview.html","w").write(d["html"])'
open /tmp/preview.html
```

### Enviar prueba real a un solo destinatario

```bash
aws lambda invoke \
  --function-name eco-weekly-report \
  --payload '{"agencySlug":"ddecpr","trigger":"test","recipients":["x@populicom.com"]}' \
  --cli-binary-format raw-in-base64-out /tmp/test.json
```

`recipients` en el payload **sobreescribe** la lista del config solo para
esa invocación; no toca la DB.

### Iteración local del template (sin Lambda)

`scripts/preview-weekly-report.ts` genera HTML con datos mock y lo escribe
a `apps/web/public/emails/weekly-report-real.html`. Útil para iterar diseño
sin redeployar:

```bash
cd /Users/alegut/MyApps/eco_populicom
node_modules/.bin/tsx \
  .claude/worktrees/<worktree>/scripts/preview-weekly-report.ts
```

Después arranca el dev server (`npm run dev -w apps/web`) y abre
`http://localhost:3000/emails/weekly-report-real.html`. **Importante**:
QuickChart sin `&v=4` muestra leyenda duplicada porque la versión por
defecto (Chart.js v2) no respeta `plugins.legend.display=false`.

---

## SES

- Sender verificado: `agutierrez@populicom.com`. Para usar otro hay que
  verificarlo desde la consola SES primero.
- El lambda envía un correo individual por destinatario (no `BCC`) porque
  en SES sandbox una dirección no verificada tumba el mensaje entero si
  va en TO compartido. El loop por destinatario permite que los
  verificados reciban aunque otros fallen.

---

## Notas de seguridad

- `.env` contiene secretos sensibles (BRANDWATCH_PASSWORD, AWS keys,
  GitHub token). Cuando `source` el `.env`, hazlo en la misma línea y no
  imprimas las variables.
- Nunca pushees el `.env` ni archivos derivados de él.
- Si tocas `report_configs.recipients`, recuerda que el self-heal del
  lambda añade `lquinones@` y `grosado@` cada hora si faltan — para
  removerlos definitivamente, hay que cambiar la lógica del self-heal o
  desactivar la fila (`is_active=false`).
