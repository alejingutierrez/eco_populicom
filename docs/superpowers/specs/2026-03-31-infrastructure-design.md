# ECO Infrastructure Design Spec

## Purpose

Provision the complete AWS infrastructure for ECO, a social listening platform for the Government of Puerto Rico. This spec covers 8 CDK stacks that together form the production-ready backend: networking, database, auth, storage, messaging, compute (ECS Fargate for Next.js), serverless workers (Lambda for ingestion/NLP/alerts), and monitoring.

## Constraints

- **Region:** us-east-1
- **Account:** 863956448838
- **IaC:** AWS CDK v2 (TypeScript)
- **Budget:** MVP target ~$150-200/month
- **Team:** 1 developer + AI agents
- **Timeline:** Infrastructure ready in 1-2 days

## Architecture Overview

```
Internet
   │
   ▼
  ALB (public subnets)
   │
   ▼
ECS Fargate — Next.js (private subnets)
   │
   ├──▶ RDS PostgreSQL (private subnets)
   ├──▶ Cognito (auth)
   └──▶ S3 (exports)

EventBridge (every 15 min)
   │
   ▼
Lambda: eco-ingestion → polls Brandwatch API
   │
   ▼
SQS: eco-ingestion-queue
   │
   ▼
Lambda: eco-processor → Claude/Bedrock NLP → RDS PostgreSQL
   │
   ▼
SQS: eco-alerts-queue
   │
   ▼
Lambda: eco-alerts → evaluates rules → SES email
```

## Stack 1: NetworkStack

Creates the VPC foundation for all other stacks.

**Resources:**
- VPC with CIDR 10.0.0.0/16
- 2 Availability Zones (us-east-1a, us-east-1b)
- 2 public subnets (10.0.1.0/24, 10.0.2.0/24)
- 2 private subnets with egress (10.0.3.0/24, 10.0.4.0/24)
- 1 NAT Gateway (cost optimization for MVP)
- Internet Gateway
- Security Groups:
  - `alb-sg`: inbound 80/443 from 0.0.0.0/0
  - `fargate-sg`: inbound from alb-sg only
  - `lambda-sg`: outbound only
  - `rds-sg`: inbound 5432 from fargate-sg + lambda-sg

**Exports:** vpcId, publicSubnetIds, privateSubnetIds, all security group IDs

## Stack 2: DatabaseStack

PostgreSQL database for all application data.

**Resources:**
- RDS PostgreSQL 16
- Instance: db.t4g.medium (2 vCPU, 4GB RAM)
- Storage: 20GB gp3, auto-scaling to 100GB
- Private subnets, rds-sg security group
- Automated backups: 7 days retention
- Deletion protection: enabled
- Credentials in Secrets Manager (auto-generated)
- No Multi-AZ (MVP cost savings)
- Database name: `eco`

**Exports:** dbEndpoint, dbPort, dbSecretArn

## Stack 3: AuthStack

User authentication and authorization.

**Resources:**
- Cognito User Pool `eco-users`
  - Sign-in: email
  - Password policy: min 8 chars, require uppercase + number
  - Auto-verify email
  - MFA: optional (TOTP)
- 3 User Pool Groups: `admin`, `analyst`, `viewer`
- User Pool App Client for Next.js (no secret, SRP auth flow)

**Exports:** userPoolId, userPoolClientId, userPoolArn

## Stack 4: StorageStack

S3 buckets for data storage.

**Resources:**
- `eco-raw-{accountId}` — Raw Brandwatch API responses
  - Lifecycle: transition to IA after 90 days, expire after 365 days
  - Versioning: disabled
  - Encryption: SSE-S3
- `eco-exports-{accountId}` — Generated reports
  - Lifecycle: expire after 90 days
  - CORS: enabled for frontend downloads

**Exports:** rawBucketArn, rawBucketName, exportsBucketArn, exportsBucketName

## Stack 5: MessagingStack

SQS queues for async processing.

**Resources:**
- `eco-ingestion-queue`
  - Visibility timeout: 300s (5 min, matching Lambda timeout)
  - Message retention: 4 days
  - DLQ: `eco-ingestion-dlq` (max receive count: 3)
- `eco-alerts-queue`
  - Visibility timeout: 60s
  - Message retention: 4 days
  - DLQ: `eco-alerts-dlq` (max receive count: 3)

**Exports:** ingestionQueueUrl, ingestionQueueArn, alertsQueueUrl, alertsQueueArn, all DLQ ARNs

## Stack 6: ComputeStack (ECS Fargate)

Next.js frontend hosted on ECS Fargate behind an ALB.

**Resources:**
- ECS Cluster: `eco-cluster`
- Fargate Service: `eco-web`
  - Task: 0.5 vCPU, 1GB RAM
  - Desired count: 1
  - Container: Next.js app (ECR image, built from apps/web)
  - Port: 3000
  - Health check: GET /api/health
  - Environment variables: DB connection (from Secrets Manager), Cognito IDs, S3 bucket names
- Application Load Balancer: `eco-alb`
  - Listener: HTTP:80 → target group
  - Target group: Fargate service, health check /api/health
- Auto-scaling: 1-3 tasks, CPU target 70%
- ECR Repository: `eco-web` for Docker images
- CloudWatch log group: /ecs/eco-web

**Exports:** albDnsName, albArn, ecsClusterArn, ecsServiceArn, ecrRepoUri

## Stack 7: WorkersStack (Lambda)

Serverless workers for data ingestion, NLP processing, and alerts.

**Resources:**

### eco-ingestion
- **Trigger:** EventBridge schedule (rate: 15 minutes)
- **Runtime:** Node.js 22
- **Memory:** 512MB, Timeout: 5 min
- **VPC:** private subnets, lambda-sg
- **Purpose:** Poll Brandwatch API for new mentions, store raw JSON in S3, push mention IDs to SQS ingestion queue
- **Env vars:** BRANDWATCH_TOKEN, BRANDWATCH_PROJECT_ID, BRANDWATCH_QUERY_ID, RAW_BUCKET, INGESTION_QUEUE_URL
- **Permissions:** S3 PutObject (raw bucket), SQS SendMessage (ingestion queue), Secrets Manager read

### eco-processor
- **Trigger:** SQS eco-ingestion-queue (batch size: 10, max concurrency: 2)
- **Runtime:** Node.js 22
- **Memory:** 512MB, Timeout: 5 min
- **VPC:** private subnets, lambda-sg
- **Purpose:** Process mentions — parse Brandwatch data, call Claude/Bedrock for sentiment re-analysis and topic/geo classification, write to PostgreSQL, push to alerts queue if rules match
- **Env vars:** DB_SECRET_ARN, ALERTS_QUEUE_URL
- **Permissions:** Bedrock InvokeModel (Claude), RDS Data (via secret), SQS SendMessage (alerts queue), SQS (consume ingestion queue), Secrets Manager read

### eco-alerts
- **Trigger:** SQS eco-alerts-queue (batch size: 1)
- **Runtime:** Node.js 22
- **Memory:** 256MB, Timeout: 60s
- **VPC:** private subnets, lambda-sg
- **Purpose:** Evaluate alert rules against processed mentions, send email notifications via SES
- **Env vars:** DB_SECRET_ARN, SES_FROM_EMAIL
- **Permissions:** SES SendEmail, RDS Data (via secret), SQS (consume alerts queue), Secrets Manager read

**Exports:** ingestionFunctionArn, processorFunctionArn, alertsFunctionArn

## Stack 8: MonitoringStack

Observability and alerting.

**Resources:**
- CloudWatch Dashboard: `eco-dashboard`
  - Widgets: RDS CPU/connections/storage, Lambda invocations/errors/duration, SQS messages/DLQ depth, ECS CPU/memory, ALB request count/latency
- CloudWatch Alarms:
  - RDS CPU > 80% for 5 min → SNS
  - Lambda errors > 5 in 5 min → SNS
  - DLQ messages > 0 → SNS
  - ALB 5xx > 10 in 5 min → SNS
  - ECS running tasks < 1 → SNS
- SNS Topic: `eco-alerts-ops` with email subscription (agutierrez@populicom.com)
- Log groups: 30 days retention for all Lambda + ECS logs

**Exports:** dashboardName, snsTopicArn

## Deploy Order

Stacks must be deployed in dependency order:

1. **NetworkStack** (no dependencies)
2. **DatabaseStack** (depends on Network)
3. **AuthStack** (no dependencies, can parallel with Database)
4. **StorageStack** (no dependencies, can parallel)
5. **MessagingStack** (no dependencies, can parallel)
6. **WorkersStack** (depends on Network, Database, Storage, Messaging)
7. **ComputeStack** (depends on Network, Database, Auth, Storage)
8. **MonitoringStack** (depends on all above)

CDK handles this via cross-stack references automatically.

## Verification Plan

After deployment, verify each layer:

1. **Network:** VPC exists, subnets in 2 AZs, NAT Gateway active
2. **Database:** RDS instance available, connect from Lambda test
3. **Auth:** Cognito pool exists, can create test user
4. **Storage:** Buckets exist, can put/get objects
5. **Messaging:** Queues exist, can send/receive test messages
6. **Compute:** ALB returns 200 from health check, Fargate task running
7. **Workers:** Ingestion Lambda runs manually, processor processes test message
8. **Monitoring:** Dashboard visible, test alarm fires

## Cost Estimate (Monthly)

| Service | Estimate |
|---------|----------|
| RDS db.t4g.medium | ~$50 |
| NAT Gateway | ~$32 |
| ECS Fargate (1 task, 0.5 vCPU) | ~$18 |
| ALB | ~$16 |
| Lambda (all workers) | ~$5-15 |
| S3 | ~$1-5 |
| SQS | ~$1 |
| Bedrock (Claude) | ~$20-50 |
| CloudWatch | ~$5 |
| SES | ~$1 |
| **Total** | **~$150-195/mo** |
