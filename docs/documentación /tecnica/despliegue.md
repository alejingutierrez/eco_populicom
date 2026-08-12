# Despliegue

Basado en el runbook operativo del repo (`CLAUDE.md`) y verificado contra el
código. Infraestructura con AWS CDK (TypeScript) en `infra/`. Cuenta
`863956448838`, región `us-east-1`.

## Credenciales y herramientas

- Las credenciales AWS, el `GITHUB_TOKEN` y demás secretos viven en el `.env` del
  monorepo principal (`/Users/alegut/MyApps/eco_populicom/.env`). El IAM user
  `agutierrez@populicom.com` tiene permisos para CDK, invoke de Lambda y SES.
- `gh` CLI **no está instalado**; los PRs se abren vía la REST API con el token.
- **Nunca** se pushea el `.env` ni archivos derivados. Al hacer `source .env`,
  hacerlo en la misma línea y sin imprimir las variables.

## Stacks CDK

`cdk list` desde `infra/`:
```
EcoNetwork EcoDatabase EcoAuth EcoStorage EcoMessaging EcoWorkers EcoCompute EcoMonitoring
```

Se despliega **solo el stack tocado**; los demás reportan "There were no
differences" pero CDK los re-evalúa. Un `cdk deploy EcoWorkers` con cambio de
código de Lambda toma ~30–45 s. Detalle de cada stack en
[Arquitectura](arquitectura.md).

```bash
cd infra
set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
cdk diff EcoWorkers
cdk deploy EcoWorkers --require-approval never
```

---

## Despliegue desde un worktree

Los worktrees (`git worktree add`) no tienen `node_modules` propio. Symlinkar al
del monorepo principal sirve para typecheck pero **no para el bundling de CDK**,
porque los workspaces (`@eco/shared`, `@eco/database`) se resuelven al monorepo
principal.

```bash
ln -sfn /Users/alegut/MyApps/eco_populicom/node_modules \
  /Users/alegut/MyApps/eco_populicom/.claude/worktrees/<worktree>/node_modules
```

### Patrón seguro (Lambdas / infra)

Copiar los archivos del worktree al monorepo principal con
`git checkout origin/<branch> -- <files>` (sin cambiar HEAD), deployar, y
restaurar con `git checkout HEAD -- <files>`. Evita re-armar `node_modules`.

```bash
# 0) Push del branch a origin
cd <worktree> && git push -u origin <branch>

# 1) Sincronizar los archivos relevantes al monorepo principal (sin tocar HEAD)
cd /Users/alegut/MyApps/eco_populicom
git fetch origin <branch>
git checkout origin/<branch> -- packages/shared/... infra/lambda/... apps/web/...

# 2) Deploy desde el worktree (cdk lee tsconfig del worktree, pero el bundling
#    resuelve npm contra el monorepo principal)
cd /Users/alegut/MyApps/eco_populicom/.claude/worktrees/<worktree>/infra
set -a && source /Users/alegut/MyApps/eco_populicom/.env && set +a
/Users/alegut/MyApps/eco_populicom/node_modules/.bin/cdk diff <Stack>
/Users/alegut/MyApps/eco_populicom/node_modules/.bin/cdk deploy <Stack> --require-approval never

# 3) Restaurar el monorepo principal a HEAD
cd /Users/alegut/MyApps/eco_populicom
git checkout HEAD -- packages/shared/... infra/lambda/... apps/web/...
```

### Alternativa con monorepo "sucio"

Cuando el monorepo principal tiene cambios ajenos al PR, en vez de `cdk deploy` se
puede bundlear con **esbuild** y `aws lambda update-function-code` directamente,
siempre con rutas del worktree (el main puede estar atrás de origin). Patrón
documentado en la memoria del proyecto.

---

## Despliegue de la app web (ECS)

`EcoCompute` construye la imagen desde `apps/web/Dockerfile`
(`compute-stack.ts:80-86`) y la publica al ECR `eco-web`. El servicio Fargate tiene
**circuit breaker + rollback** (`compute-stack.ts:158`): un deploy que no pasa el
health check (`/api/health`) se revierte solo. Build args de Cognito y secrets
(`DB_SECRET`, `ECO_CRON_SECRET`) se inyectan en el contenedor.

---

## Migraciones de DB

Drizzle vive en `packages/database/src/migrations/` pero **no corre
automáticamente** en el deploy. Tres mecanismos:

1. **Drizzle puro** (futuro, no verificado): `drizzle-kit push` desde
   `packages/database`.
2. **Lambda `eco-migration`** (hoy): multiplexor de acciones DDL/seed/backfill
   (`infra/lambda/migration/index.ts`). **No está en CDK**; se despliega manualmente
   y reusa el role de `eco-ingestion` (ver [Lambdas](lambdas.md#eco-migration-fuera-de-cdk)).
   Si añades una migración `0NNN_*.sql`, súbela como nueva acción o usa
   `custom-query` (solo SELECT). Importa `infra/lambda/lib/embeddings.ts`, que
   tampoco está en `main` (se copia desde un worktree al deployar).
3. **Self-heal idempotente** desde los lambdas principales: `eco-weekly-report`
   (`ensureReportsSchema`), `eco-metrics-calculator` (`ensureCrisisSchema`,
   `metrics-calculator/index.ts:268-323`) y `eco-ai-tasks` (`ensureBriefingsSchema`,
   `ai-tasks/index.ts:581-602`) ejecutan `CREATE TABLE IF NOT EXISTS` + UPDATEs
   idempotentes cada vez que corren. Patrón para migraciones "una sola vez":
   condicionar el UPDATE a un estado detectable (ej. `WHERE timezone =
   'America/Bogota'`) para que sea no-op tras la primera corrida.

### Aplicar una migración con eco-migration

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"create-narratives-schema"}' \
  --cli-binary-format raw-in-base64-out /tmp/out.json
cat /tmp/out.json
```

Acciones disponibles en [Lambdas · eco-migration](lambdas.md#eco-migration-fuera-de-cdk).

### Inspección rápida (solo SELECT)

```bash
aws lambda invoke --function-name eco-migration \
  --payload '{"action":"custom-query","query":"SELECT count(*) FROM mentions"}' \
  --cli-binary-format raw-in-base64-out /tmp/q.json
cat /tmp/q.json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.loads(d["body"]))'
```

---

## Recursos gestionados fuera de CDK

- Lambda `eco-migration` (deploy manual).
- `infra/lambda/lib/embeddings.ts` (no commiteado en `main`).
- Secret `eco/brandwatch-token` (`aws secretsmanager create-secret`).
- Secret `eco/cron-secret` (`openssl rand -hex 32`).
- El atributo Cognito `agency_slug` se añadió originalmente con
  `add-custom-attributes`; la declaración en CDK lo hace idempotente
  (`auth-stack.ts:40-45`).

---

## Seguridad del despliegue

- No actualizar la config de git ni correr comandos git destructivos sin
  autorización explícita.
- No pushear el `.env`.
- `report_configs.recipients`: el self-heal de `eco-weekly-report` re-añade ciertos
  destinatarios cada hora si faltan; para removerlos hay que cambiar la lógica del
  self-heal o desactivar la fila (`is_active=false`).
