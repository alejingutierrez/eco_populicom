# Arquitectura

ECO se despliega con AWS CDK (TypeScript). El árbol de stacks se define en
`infra/bin/eco.ts:13-54`. Son **8 stacks** en la cuenta `863956448838`, región
`us-east-1` (`infra/bin/eco.ts:14`).

| Stack | ID CDK | Contenido |
|---|---|---|
| Red | `EcoNetwork` | VPC, subredes, security groups |
| Base de datos | `EcoDatabase` | RDS PostgreSQL 16 + Secrets Manager |
| Auth | `EcoAuth` | Cognito user pool + grupos + cliente |
| Almacenamiento | `EcoStorage` | Buckets S3 (raw, exports) |
| Mensajería | `EcoMessaging` | Colas SQS + DLQ |
| Workers | `EcoWorkers` | 9 Lambdas + EventBridge + Secret Brandwatch |
| Cómputo | `EcoCompute` | ECS Fargate (Next.js), ALB, ECR |
| Monitoreo | `EcoMonitoring` | Alarmas y dashboard CloudWatch, SNS |

> `cdk list` desde `infra/`:
> `EcoNetwork EcoDatabase EcoAuth EcoStorage EcoMessaging EcoWorkers EcoCompute EcoMonitoring`.

El orden de instanciación y las dependencias entre stacks se ven en el paso de
props en `infra/bin/eco.ts`: `EcoDatabase` recibe el VPC y el security group de
`EcoNetwork`; `EcoWorkers` recibe VPC, security group de Lambda, el secret de DB,
el bucket raw y las dos colas; `EcoCompute` recibe VPC, security groups, secret de
DB, IDs de Cognito y ambos buckets; `EcoMonitoring` recibe instancia RDS, tres
funciones Lambda, dos DLQ, el servicio ECS y el ALB.

---

## EcoNetwork — `infra/lib/network-stack.ts`

VPC con 2 zonas de disponibilidad y **1 NAT Gateway** (`network-stack.ts:16-31`).
Dos tipos de subred por AZ:

- **Public** (`/24`) — para el ALB.
- **Private with egress** (`/24`) — para Fargate, Lambdas y RDS. Salen a internet
  por el NAT (Brandwatch, Bedrock, SES, QuickChart, scraping de og:image).

Cuatro security groups (`network-stack.ts:34-76`):

| SG | Ingress | Egress |
|---|---|---|
| `AlbSg` | TCP 80 y 443 desde `0.0.0.0/0` | todo |
| `FargateSg` | TCP 3000 desde `AlbSg` | todo |
| `LambdaSg` | ninguno (solo salida) | todo |
| `RdsSg` | TCP 5432 desde `FargateSg` y `LambdaSg` | **ninguno** (`allowAllOutbound:false`) |

La base de datos solo es accesible desde Fargate y las Lambdas; no tiene egress.

---

## EcoDatabase — `infra/lib/database-stack.ts`

- `rds.DatabaseSecret` con username `eco_admin` (`database-stack.ts:19-21`). Su
  ARN se propaga como `DB_SECRET_ARN` a todos los consumidores.
- `rds.DatabaseInstance` PostgreSQL **16** (`database-stack.ts:24-43`):
  - Clase `t4g.medium` (Graviton).
  - `databaseName: 'eco'`.
  - Almacenamiento GP3, 20 GB con autoescalado hasta 100 GB.
  - `backupRetention: 7 días`, `deletionProtection: true`, `multiAz: false`,
    `removalPolicy: RETAIN`.
- En subredes privadas con egress, con el `RdsSg`.

La extensión **pgvector** no la crea CDK: se instala vía la Lambda `eco-migration`
(acción `add-embeddings-column` → `CREATE EXTENSION IF NOT EXISTS vector`). Ver
[Modelo de datos](modelo-de-datos.md#pgvector).

---

## EcoAuth — `infra/lib/auth-stack.ts`

- `cognito.UserPool` `eco-users` (`auth-stack.ts:15-47`):
  - Sign-in por email, auto-verificación de email.
  - Política de contraseña: min 8, requiere mayúscula y dígito; no requiere
    símbolos ni minúsculas (`auth-stack.ts:23-29`).
  - MFA **opcional**, solo TOTP (no SMS) (`auth-stack.ts:30-34`).
  - `selfSignUpEnabled: true`.
  - **Atributo custom `agency_slug`** (string, 1–50, mutable) — enruta cada
    usuario a su agencia (tenant). Sin él, el JWT no lleva `custom:agency_slug` y
    la API cae a la agencia por defecto (`auth-stack.ts:43-45`).
  - `removalPolicy: RETAIN`.
- Tres grupos: `admin`, `analyst`, `viewer` (`auth-stack.ts:50-66`).
- `UserPoolClient` con SRP, **sin secret** (`generateSecret:false`,
  `auth-stack.ts:69-75`) — pensado para un SPA/browser.

IDs deployados (referenciados como defaults en `compute-stack.ts:83-84`): pool
`us-east-1_exuhIKYQ8`, client `1t4v0kt8nn9nnmtet8t3l5g7u3`.

Ver [Autenticación y seguridad](autenticacion-seguridad.md) para el flujo
completo y la diferencia entre grupos Cognito y la tabla `users`.

---

## EcoStorage — `infra/lib/storage-stack.ts`

Dos buckets S3, ambos con cifrado S3-managed y `BLOCK_ALL` público:

- **`eco-raw-<accountId>`** (`storage-stack.ts:15-33`) — JSON crudo de Brandwatch.
  Lifecycle: transición a Infrequent Access a los 90 días, expiración a los 365.
  `removalPolicy: RETAIN`.
- **`eco-exports-<accountId>`** (`storage-stack.ts:36-56`) — exports temporales.
  CORS GET abierto, `autoDeleteObjects:true`, expiración a 90 días,
  `removalPolicy: DESTROY`.

> El mapa de partida llamaba a estos buckets "assets/exports"; en el código son
> **raw/exports**. El bucket de assets no existe.

---

## EcoMessaging — `infra/lib/messaging-stack.ts`

Dos colas con su DLQ:

| Cola | Visibility timeout | Retención | DLQ (maxReceiveCount) |
|---|---|---|---|
| `eco-ingestion` | 300 s | 4 días | `eco-ingestion-dlq` (3) |
| `eco-alerts` | 60 s | 4 días | `eco-alerts-dlq` (3) |

DLQ con retención de 14 días (`messaging-stack.ts:15-46`). El visibility timeout
de `eco-ingestion` (300 s) coincide con el timeout del consumidor `eco-processor`
(5 min). No hay SNS en este stack; el SNS de ops vive en `EcoMonitoring`.

---

## EcoWorkers — `infra/lib/workers-stack.ts`

Crea **9 funciones Lambda** (`NodejsFunction`, runtime Node 22, esbuild con
`minify`, `sourceMap`, target `node22`, externalizando `@aws-sdk/*` que el runtime
ya provee — `workers-stack.ts:58-66`):

`eco-ingestion`, `eco-processor`, `eco-alerts`, `eco-metrics-calculator`,
`eco-weekly-report`, `eco-ai-tasks`, `eco-narrative-cluster`,
`eco-narrative-edges`, `eco-narrative-drift`.

> La Lambda **`eco-migration` NO está en este stack** (ni en ningún stack CDK). Se
> despliega manualmente y reusa el role de `eco-ingestion`. Por eso el conteo real
> es 9 en CDK + 1 fuera = **10 Lambdas**. Ver [Lambdas](lambdas.md) y
> [Despliegue](despliegue.md).

Detalles transversales del stack:

- Las funciones corren en subredes privadas con el `LambdaSg`
  (`workers-stack.ts:40`).
- Importan sus CloudWatch Log Groups preexistentes por nombre
  (`importLogGroup`, `workers-stack.ts:46-47`) para las cinco originales; las tres
  de narrativas crean su propio LogGroup con retención de 1 mes.
- El token de Brandwatch se lee de Secrets Manager `eco/brandwatch-token`
  (`workers-stack.ts:52-56`), gestionado fuera del stack.
- Permisos IAM por función: `secretsmanager:GetSecretValue/DescribeSecret` sobre
  el secret de DB; `bedrock:InvokeModel` (`*`) para processor, metrics-calculator,
  weekly-report, ai-tasks, narrative-cluster, narrative-drift;
  `ses:SendEmail/SendRawEmail` (`*`) para alerts, metrics-calculator,
  weekly-report; S3 put/read para ingestion/processor; SQS send para
  ingestion/processor.
- Triggers EventBridge: ver la tabla de crons en [Lambdas](lambdas.md).

---

## EcoCompute — `infra/lib/compute-stack.ts`

App web Next.js en ECS Fargate:

- **ECR** `eco-web` (`compute-stack.ts:33-37`, `removalPolicy: DESTROY`,
  `emptyOnDelete`).
- **ECS Cluster** `eco-cluster` (`compute-stack.ts:40-43`).
- **Fargate Task Definition** `cpu:512`, `memory:1024 MiB`, **ARM64/Graviton**
  (`compute-stack.ts:46-53`).
- **Contenedor** `eco-web` desde `apps/web/Dockerfile`
  (`compute-stack.ts:79-109`): puerto 3000; build args con los IDs de Cognito;
  env vars `NEXT_PUBLIC_COGNITO_*`, `RAW_BUCKET`, `EXPORTS_BUCKET`; secrets
  inyectados `DB_SECRET` y `ECO_CRON_SECRET` (de Secrets Manager
  `eco/cron-secret`, ARN completo `...eco/cron-secret-O69oRN`,
  `compute-stack.ts:72-76`); health check `curl /api/health`.
- **Roles** (`compute-stack.ts:111-147`): task role con read del secret DB, read
  raw, read/write exports; permiso `lambda:InvokeFunction` sobre `eco-weekly-report`
  (para `/api/reports/send-test`); permiso `bedrock:InvokeModel` sobre los
  inference profiles `*claude*` (para `/api/ai/metric-insight`). El execution role
  lee secrets (`*`).
- **FargateService** `eco-web` `desiredCount:1`, sin IP pública, con circuit
  breaker + rollback (`compute-stack.ts:150-159`).
- **ALB** `eco-alb` internet-facing, listener HTTP **:80** (`compute-stack.ts:162-185`).
  Target group apunta al puerto 3000, health check `/api/health` esperando 200.
- **Auto-scaling**: 1–3 tareas, target CPU 70% (`compute-stack.ts:188-194`).

> El ALB sirve **HTTP plano** hoy (no hay listener 443 configurado en el código,
> aunque el SG lo permite). Esto condiciona las cookies `Secure` y HSTS — ver
> [Autenticación y seguridad](autenticacion-seguridad.md).

---

## EcoMonitoring — `infra/lib/monitoring-stack.ts`

- **SNS** `eco-alerts-ops` con suscripción email a `agutierrez@populicom.com`
  (`monitoring-stack.ts:29-34`).
- **Alarmas** (acción → SNS):
  - RDS CPU > 80% en 2 periodos de 5 min (`monitoring-stack.ts:39-49`).
  - Errores > 5 (1 periodo de 5 min) para `eco-ingestion`, `eco-processor`,
    `eco-alerts` (`monitoring-stack.ts:52-70`). **Solo estas tres** tienen alarma.
  - Mensajes > 0 en `eco-ingestion-dlq` y `eco-alerts-dlq`
    (`monitoring-stack.ts:73-90`).
- **Dashboard** `eco-dashboard` (`monitoring-stack.ts:93-142`): CPU y conexiones
  RDS; invocaciones y errores de las 3 Lambdas; profundidad de las 2 DLQ.

Más detalle en [Observabilidad](observabilidad.md).

---

## Relación entre stacks (resumen)

```
EcoNetwork ──vpc/sg──► EcoDatabase ──dbSecret──► EcoWorkers ──fn/dlq──► EcoMonitoring
     │                      │                         ▲                      ▲
     ├──sg──► EcoCompute ◄──dbSecret/buckets──────────┘                      │
     │            ▲                                                          │
EcoStorage ───buckets──┘        EcoAuth ──poolId/clientId──► EcoCompute      │
EcoMessaging ──queues──► EcoWorkers ──dlq──────────────────────────────────┘
```
