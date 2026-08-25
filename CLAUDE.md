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

**⚠️ `pg` va BUNDLEADO, no externo** (verificado 12 ago 2026 en
`eco-weekly-report`): el zip desplegado es un solo `index.js` sin
`node_modules/`, así que el driver `pg` está compilado dentro (388 KB de los
cuales ~170 KB son pg). Si compilas con `--external:pg` el bundle baja a
~217 KB y el lambda **revienta en runtime** en `await import('pg')`. Externaliza
solo `@aws-sdk/*` (lo provee el runtime nodejs22) y `pg-native`.

**Cómo comparar bundles sin sourcemap** (el de weekly-report ya no lo trae):
extrae los literales de string de 14+ chars de ambos y diffea los conjuntos.
Los que solo estén en el vivo son drift real; ignora las rutas-comentario
`node_modules/...` de esbuild, que cambian según el cwd del build.

**Staleness ≠ drift**: si git tiene features que el bundle no, redeployar las
ARRASTRA. Chequea `git log <commit-del-bundle>..HEAD -- <archivos que usa el
lambda>` y decide si quieres shippearlas en tu deploy. Al 12 ago 2026 el bundle
vivo de `eco-weekly-report` correspondía a #89 y main ya iba en #93.

**Bundling desde worktree**: el symlink `node_modules/@eco/*` resuelve al
working tree del monorepo principal (sucio). Usa SIEMPRE
`--alias:@eco/shared=<worktree>/packages/shared/src/index.ts` (ídem
`@eco/shared/src/bedrock` y `@eco/database`) y rutas ABSOLUTAS del worktree
(`W=$PWD` se rompe cuando el harness resetea el cwd).

---

## Comportamientos de producto confirmados (no son bugs)

- Correos de reporte (jul 2026): el DIARIO ("[Diario] …", ventana rolante de
  7 días cerrados) se envía TODOS los días a las 6 AM PR; el SEMANAL
  comparativo ("[Semanal] …", semana vs anterior) solo los viernes a las
  3:00 PM PR (weekly_send_dow=5, weekly_send_hour_local=15, weekly_enabled).
  El viernes llegan AMBOS, cada uno a su hora.
- `admin/diagnostics` cuenta menciones SIN filtrar `is_duplicate` a propósito.
- Reglas de alerta de crisis: las 3 agencias tienen `crisis_threshold`
  (0.4/0.5/12h). aaa y gobernadora notifican solo a agutierrez@ hasta que el
  cliente confirme destinatarios (seed del QA 2026-06-10).
- Cron diario `eco-processor-reprocess-unclassified-manual` (08:30 UTC) es
  TEMPORAL: bórralo cuando un deploy de CDK EcoWorkers cree
  `ProcessorReprocessUnclassifiedDaily` (ya está en workers-stack.ts).
- `report_configs.recipients` es **UNA sola lista para el diario Y el semanal**
  (`infra/lambda/weekly-report/index.ts` la lee igual para los dos tipos). No
  hay destinatarios por tipo: meter a alguien ahí le manda AMBOS correos. Si
  alguien debe recibir solo uno, la salida es una regla de EventBridge con
  invocación dirigida y `recipients` override — el handler ignora hora y día
  cuando el payload trae `agencySlug`.
- Cron `eco-weekly-report-ddecpr-vero-manual` (viernes 19:00 UTC = 3:00 PM AST)
  es exactamente eso: manda el SEMANAL solo a `vero@eficiencia.pr.gov` (DDEC,
  clienta externa, rol analyst) sin darle el diario. Está FUERA de CDK, igual
  que el cron del processor. Bórralo si algún día existen listas por tipo, o si
  se decide meterla en `report_configs.recipients`.
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

**Arreglo para que `cdk synth`/`diff`/`deploy` funcione desde el worktree**
(ago-2026): en vez de copiar archivos al monorepo principal, poner un override
de resolución en `infra/node_modules/@eco`. Node y esbuild suben directorio por
directorio buscando `node_modules`, así que `<worktree>/infra/node_modules`
gana antes de llegar al symlink de la raíz:

```bash
W=/Users/alegut/MyApps/eco_populicom/.claude/worktrees/<worktree>
mkdir -p $W/infra/node_modules/@eco
for p in shared database brandwatch; do ln -sfn $W/packages/$p $W/infra/node_modules/@eco/$p; done
```

Sin esto, `cdk diff <cualquier-stack>` revienta al bundlear EcoWorkers —
CDK sintetiza TODA la app, así que un `@eco/shared` stale en el monorepo
principal rompe el diff de stacks que no tienen ni un lambda (ej. EcoAuth),
con errores del tipo `No matching export in packages/shared/src/index.ts`.
Ventaja sobre el patrón de `git checkout origin/<branch> -- <files>`: no toca
el working tree del monorepo principal (que suele tener trabajo sin commitear).

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

## Correos por tipo (jul 2026)

Cuatro correos, todos con chrome compartido (`@eco/shared/email/chrome.ts`:
paleta, header con badge de tipo, footer con nota de tipo) y asunto tipado
`[Tag] SIGLAS · detalle`. Indicadores SIEMPRE numéricos (%, /10, con signo —
paridad dashboard vía formatMetric/formatDelta), nunca niveles verbales.

| Tipo | Asunto | Fuente | Cuándo |
|---|---|---|---|
| Diario | `[Diario]` | `eco-weekly-report` → render-daily-report | todos los días, send_hour_local |
| Semanal | `[Semanal]` | `eco-weekly-report` → render-weekly-summary | weekly_send_dow + weekly_send_hour_local (default vie 3:00 PM) |
| Alerta reglas | `[Alerta]` | `eco-alerts` → render-simple-alert | SQS por mención |
| Alerta métrica | `[Alerta]` | `eco-metrics-calculator` → render-simple-alert | evaluación diaria |
| Crisis | `[Crisis]`/`[Alerta]` | `eco-metrics-calculator` → render-crisis-alert | umbral crisis |
| Nombramiento | `[Nombramiento]` | `eco-weekly-report` → render-appointment-report | una vez, al alta de una fila en `agency_appointments` |

## Correo de NOMBRAMIENTO (`agency_appointments`, ago 2026)

Correo de evento, no de calendario: se envía **una sola vez** cuando cambia el
titular de una agencia monitoreada, y cubre **desde el nombramiento hasta HOY**
(incluye el día en curso, parcial — al revés que el diario y el semanal, que
cierran en ayer). Badge y barra violeta (`EMAIL_COLORS.event`).

- **Disparo**: el mismo barrido horario de `eco-weekly-report`. Tras evaluar
  diario/semanal llama a `dispatchPendingAppointments()`, que busca filas con
  `notified_at IS NULL` y `coverage_start <= hoy` (TZ PR). **No** depende de
  `send_hour_local`: un cambio de titular no espera a las 6 AM, sale en el
  primer tick tras el alta. Estampa `notified_at` cuando el envío es `sent` o
  `no_data`; si falla, lo reintenta al tick siguiente.
- **Alta MANUAL a propósito** (no hay detección por NLP): un nombramiento es un
  hecho con fecha, y detectarlo por texto daría falsos positivos (rumores,
  "suena para el cargo", nombramientos de otras jurisdicciones). Este correo no
  puede dispararse con un rumor. Se registra con `exec-write`.
- **Comparación**: contra los MISMOS días inmediatamente ANTERIORES al
  nombramiento (no contra un periodo equivalente arbitrario), para separar el
  efecto del anuncio del nivel base de la agencia.
- **Destinatarios**: `agency_appointments.recipients` si viene con valores;
  si es `NULL`, se resuelven **en el envío** desde `users WHERE is_active` —
  así un usuario ECO nuevo recibe el próximo nombramiento sin tocar nada.
  Ojo: `report_configs.recipients` (6 direcciones) NO es la misma lista que
  los usuarios ECO (4); son conjuntos distintos.
- **`coverage_start` vs `announced_on`**: `announced_on` es el hecho (sale en la
  ficha del correo); `coverage_start` es el primer día del resumen. Se separan
  para poder incluir el arranque de la conversación cuando el relevo se venía
  cocinando antes del anuncio formal.
- **template_key** en `report_send_log`: `appointment-summary-v1`.

### Dar de alta un nombramiento

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"exec-write","query":"INSERT INTO agency_appointments (agency_id, person_name, position, predecessor, announced_on, coverage_start, notes) SELECT id, '"'"'Nombre Apellido'"'"', '"'"'Cargo'"'"', '"'"'Predecesor'"'"', '"'"'2026-08-10'"'"'::date, '"'"'2026-08-10'"'"'::date, '"'"'contexto'"'"' FROM agencies WHERE slug='"'"'sgpr'"'"'"}' \
  --cli-binary-format raw-in-base64-out /tmp/ins.json
```

Deja `recipients` fuera (queda NULL) para que le llegue a todos los usuarios
ECO activos; pásalo como jsonb array para restringirlo a una lista fija.

### Probar el correo de nombramiento

```bash
aws lambda invoke --function-name eco-weekly-report \
  --payload '{"agencySlug":"sgpr","reportType":"appointment","dryRun":true}' \
  --cli-binary-format raw-in-base64-out /tmp/dry.json
```

`dryRun` NO estampa `notified_at`, así que se puede repetir. Sin
`appointmentId` toma el nombramiento más reciente de la agencia. Un envío
dirigido (`"trigger":"test"` + `recipients`) tampoco marca la fila: solo el
barrido programado lo hace.

## Reportes por correo (`eco-weekly-report` — diario + semanal)

- **Trigger**: EventBridge cron `cron(0 * * * ? *)` — cada hora, minuto 0
  UTC. La lambda itera `report_configs is_active = true` y envía el DIARIO
  cuando `hourInTimeZone(nowUtc, cfg.timezone) === cfg.send_hour_local`; el
  SEMANAL cuando `weekly_enabled` Y `dowInTimeZone == weekly_send_dow`
  (default 5 = viernes, convención JS getDay) Y
  `hourInTimeZone == weekly_send_hour_local` (default 15) — hora
  independiente de la del diario.
- **Horas DDEC**: diario 6:00 AM PR = 10:00 UTC; semanal viernes 3:00 PM PR
  = 19:00 UTC (AST no tiene DST).
- **Periodo**: 7 días naturales **cerrados** terminando AYER en TZ PR. El
  semanal compara además contra los 7 días anteriores a esos.
- **Recipients**: editables vía `/settings/reports` o por SQL en
  `report_configs.recipients` (jsonb array). Misma lista para ambos tipos.
- **template_key**: el diario usa `daily-sentiment-summary` (renombrado por
  self-heal desde `weekly-sentiment-summary`); el semanal se logea en
  `report_send_log` como `weekly-comparison-v1`.

### Probar sin enviar (dryRun)

```bash
aws lambda invoke \
  --function-name eco-weekly-report \
  --payload '{"agencySlug":"ddecpr","dryRun":true}' \
  --cli-binary-format raw-in-base64-out /tmp/dry.json
# semanal: añade "reportType":"weekly" al payload
python3 -c 'import json; d=json.load(open("/tmp/dry.json")); open("/tmp/preview.html","w").write(d["html"])'
open /tmp/preview.html
```

### Enviar prueba real a un solo destinatario

```bash
aws lambda invoke \
  --function-name eco-weekly-report \
  --payload '{"agencySlug":"ddecpr","reportType":"weekly","trigger":"test","recipients":["x@populicom.com"]}' \
  --cli-binary-format raw-in-base64-out /tmp/test.json
```

`recipients` en el payload **sobreescribe** la lista del config solo para
esa invocación; no toca la DB. `reportType` acepta `daily` (default) y
`weekly`.

### Iteración local de los templates (sin Lambda)

`scripts/preview-daily-report.ts`, `scripts/preview-weekly-summary.ts`,
`scripts/preview-appointment-report.ts`,
`scripts/preview-alerts.ts` y `scripts/preview-crisis-alert.ts` generan HTML
con datos mock en `apps/web/public/emails/*-preview.html`:

```bash
cd /Users/alegut/MyApps/eco_populicom
node_modules/.bin/tsx \
  .claude/worktrees/<worktree>/scripts/preview-daily-report.ts
```

Después arranca el dev server (`npm run dev -w apps/web`) y abre
`http://localhost:3000/emails/daily-report-preview.html`. **Importante**:
QuickChart sin `&v=4` muestra leyenda duplicada porque la versión por
defecto (Chart.js v2) no respeta `plugins.legend.display=false`.

---

## SES

- **Fuera del sandbox desde el 21-ago-2026** (caso `178733164900725`,
  `ReviewDetails.Status = GRANTED`). Cuota: 50,000/día, 14/seg. Ya **no** hay
  que verificar destinatarios uno por uno: SES entrega a cualquier dirección.
  Comprobar con `aws sesv2 get-account` → `ProductionAccessEnabled`.
- Antes de eso, el sandbox era la causa de que **la activación de usuarios
  nuevos no funcionara**: la cuenta se creaba en Cognito con contraseña
  temporal, pero SES rechazaba la invitación con
  `MessageRejected: Email address is not verified` y el correo nunca salía.
  Síntoma en la DB: usuario en `FORCE_CHANGE_PASSWORD` con `last_login = NULL`.
  Síntoma en `report_send_log`: `error: partial: <emails>`.
- Remitentes: `alerts@citizenecho.com` para **todo** (reportes, alertas y
  también las invitaciones/códigos de Cognito).
- **No enviar nunca desde `@populicom.com` vía SES.** Ese dominio sigue en
  Google Workspace con SPF `include:_spf.google.com ~all` (no autoriza a
  Amazon SES) y sin CNAMEs de DKIM de SES → falla SPF *y* DKIM y cae en spam.
  `citizenecho.com` sí está alineado: Easy DKIM verificado y SPF con
  `include:amazonses.com`.
- El lambda envía un correo individual por destinatario (no `BCC`) porque
  una dirección que falle tumbaría el mensaje entero si va en TO compartido.
  El loop por destinatario permite que los demás reciban aunque uno falle.
- Pendiente de DNS (GoDaddy, no lo puede hacer el agente): **falta el registro
  DMARC** en `citizenecho.com` y en `populicom.com`. Y el SPF de
  `citizenecho.com` termina en `-all` sin `include:spf.protection.outlook.com`
  — si alguien envía desde un buzón `@citizenecho.com` (el dominio recibe por
  Microsoft 365: `MX = citizenecho-com.mail.protection.outlook.com`), ese
  correo falla SPF en duro. El correo automático de ECO no se ve afectado
  porque sale por SES.

### Cognito manda sus correos por SES (gotcha de la identity policy)

El pool `eco-users` (`us-east-1_exuhIKYQ8`) usa
`EmailSendingAccount: DEVELOPER`, o sea envía por SES y no por el correo
default de Cognito (`no-reply@verificationemail.com`, que Workspace filtra).

Para que eso funcione, la identidad remitente necesita una **policy de
recurso** que autorice a `cognito-idp.amazonaws.com`. **CloudFormation no tiene
recurso para eso**, así que NO está en CDK y hay que ponerla a mano — si se
cambia el remitente y se olvida, Cognito deja de enviar del todo:

```bash
aws sesv2 create-email-identity-policy \
  --email-identity alerts@citizenecho.com \
  --policy-name AllowCognitoUserPoolSending \
  --policy '{"Version":"2008-10-17","Statement":[{"Sid":"AllowCognitoUserPoolSending","Effect":"Allow","Principal":{"Service":"cognito-idp.amazonaws.com"},"Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"arn:aws:ses:us-east-1:863956448838:identity/alerts@citizenecho.com","Condition":{"StringEquals":{"aws:SourceAccount":"863956448838"},"ArnLike":{"aws:SourceArn":"arn:aws:cognito-idp:us-east-1:863956448838:userpool/us-east-1_exuhIKYQ8"}}}]}'
# verificar:
aws sesv2 get-email-identity-policies --email-identity alerts@citizenecho.com
```

Ya está puesta en `alerts@citizenecho.com` y en `citizenecho.com`.

### Reenviar una invitación que no llegó

La contraseña temporal se generó cuando se creó la cuenta; si el correo no
salió, hay que reenviarlo (no basta con esperar):

```bash
aws cognito-idp admin-create-user --user-pool-id us-east-1_exuhIKYQ8 \
  --username persona@populicom.com --message-action RESEND \
  --desired-delivery-mediums EMAIL
```

Solo funciona en `FORCE_CHANGE_PASSWORD`. Si ya está `CONFIRMED`, la persona
debe usar "olvidé mi contraseña" en `/sign-in`.

### Verificar entrega sin acceso al buzón

No hay configuration set con event destination, pero las métricas de cuenta
sirven de prueba objetiva:

```bash
aws cloudwatch get-metric-statistics --namespace AWS/SES \
  --metric-name Delivery --start-time "$(date -u -v-3H +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" --period 10800 --statistics Sum
```
`Send` vs `Delivery` vs `Bounce`/`Reject`. `Delivery` = el MTA destino aceptó
(no distingue bandeja de entrada de spam).

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
