# AWS.md — ECO Platform Infrastructure

**Account:** 863956448838
**Region:** us-east-1
**IAM User:** agutierrez@populicom.com
**IaC:** AWS CDK v2 (TypeScript)

---

## Deployed Stacks (All Active)

| Stack | Status | Key Resources |
|-------|--------|---------------|
| **EcoNetwork** | CREATE_COMPLETE | VPC `vpc-0afa31c337b116cd0`, 4 subnets, 1 NAT GW, 4 SGs |
| **EcoDatabase** | CREATE_COMPLETE | RDS PostgreSQL 16 (`db.t4g.medium`, ARM64), Secrets Manager |
| **EcoAuth** | CREATE_COMPLETE | Cognito `eco-users` (`us-east-1_exuhIKYQ8`), 3 groups |
| **EcoStorage** | CREATE_COMPLETE | S3 `eco-raw-863956448838`, `eco-exports-863956448838` |
| **EcoMessaging** | CREATE_COMPLETE | 4 SQS queues |
| **EcoWorkers** | UPDATE_COMPLETE | 3 Lambdas (ingestion, processor, alerts) |
| **EcoCompute** | UPDATE_COMPLETE | ECS Fargate `eco-cluster`, ALB `eco-alb`, ECR `eco-web` |
| **EcoMonitoring** | CREATE_COMPLETE | CloudWatch dashboard, 5 alarms, SNS topic |

---

## Resource Details

### Network
| Resource | Value |
|----------|-------|
| VPC | `vpc-0afa31c337b116cd0` (10.0.0.0/16) |
| Public subnets | `subnet-0c771e21574ce2660`, `subnet-0d821c072bbb59cf0` |
| Private subnets | `subnet-02030f77abdc24ead`, `subnet-0606d388e91a95db9` |
| ALB Security Group | `sg-00a8ae17d6da9a96e` (inbound 80/443) |
| Fargate Security Group | `sg-0e7c03b262ee5276b` (inbound 3000 from ALB) |
| Lambda Security Group | `sg-0d7e06c12f1717227` (outbound only) |
| RDS Security Group | `sg-08564874bde90dbd2` (inbound 5432 from Fargate + Lambda) |

### Database
| Resource | Value |
|----------|-------|
| Instance | `ecodatabase-ecodbinstance8404a24e-wkypcvhcf7g1` |
| Endpoint | `ecodatabase-ecodbinstance8404a24e-wkypcvhcf7g1.cslg02yoa34w.us-east-1.rds.amazonaws.com` |
| Port | 5432 |
| Database name | `eco` |
| Engine | PostgreSQL 16 |
| Instance type | db.t4g.medium (ARM64 Graviton) |
| Storage | 20GB gp3 (auto-scales to 100GB) |
| Credentials | Secrets Manager: `EcoDbSecret481D8FFF-VuEFDbBUp7tO` |
| Tables | 11 (agencies, users, mentions, topics, subtopics, municipalities, mention_topics, mention_municipalities, alert_rules, alert_history, ingestion_cursors) |
| Seed data | 1 agency (AAA), 77 municipalities, 10 topics, 30 subtopics |

### Auth (Cognito)
| Resource | Value |
|----------|-------|
| User Pool ID | `us-east-1_exuhIKYQ8` |
| App Client ID | `1t4v0kt8nn9nnmtet8t3l5g7u3` |
| Groups | admin, analyst, viewer |
| Admin user | `agutierrez@populicom.com` / `EcoAdmin2026!` |

### Compute (ECS)
| Resource | Value |
|----------|-------|
| Cluster | `eco-cluster` |
| Service | `eco-web` (1 task, auto-scales 1-3) |
| Task CPU/Memory | 0.5 vCPU / 1GB (ARM64 Graviton) |
| ALB DNS | `eco-alb-1881782703.us-east-1.elb.amazonaws.com` |
| ECR | `863956448838.dkr.ecr.us-east-1.amazonaws.com/eco-web` |
| Health check | `GET /api/health` (interval 30s, start 120s) |
| Container env | NEXT_PUBLIC_COGNITO_USER_POOL_ID, NEXT_PUBLIC_COGNITO_CLIENT_ID, RAW_BUCKET, EXPORTS_BUCKET |
| Container secret | DB_SECRET (from Secrets Manager) |

### Workers (Lambda)
| Function | Trigger | Memory | Timeout | Key Env Vars |
|----------|---------|--------|---------|-------------|
| `eco-ingestion` | EventBridge (every 5 min) | 512MB | 5 min | BRANDWATCH_TOKEN, PROJECT_ID, QUERY_ID, RAW_BUCKET, INGESTION_QUEUE_URL, DB_SECRET_ARN |
| `eco-processor` | SQS eco-ingestion (batch 10, concurrency 2) | 1024MB | 5 min | DB_SECRET_ARN, ALERTS_QUEUE_URL, BEDROCK_MODEL_ID, AGENCY_ID |
| `eco-alerts` | SQS eco-alerts (batch 1) | 256MB | 60s | DB_SECRET_ARN, SES_FROM_EMAIL |
| `eco-migration` | Manual invoke | 512MB | 120s | DB_SECRET_ARN |

### Storage (S3)
| Bucket | Purpose | Lifecycle |
|--------|---------|-----------|
| `eco-raw-863956448838` | Raw Brandwatch API responses | IA after 90d, expire 365d |
| `eco-exports-863956448838` | Generated reports | Expire 90d |

### Messaging (SQS)
| Queue | Visibility | Retention | DLQ Max Receives |
|-------|-----------|-----------|-----------------|
| `eco-ingestion` | 300s | 4 days | 3 → eco-ingestion-dlq (14d) |
| `eco-alerts` | 60s | 4 days | 3 → eco-alerts-dlq (14d) |

### AI/NLP (Bedrock)
| Resource | Value |
|----------|-------|
| Model | Claude Opus 4.6 |
| Inference Profile | `us.anthropic.claude-opus-4-6-v1` |
| Tasks per mention | Sentiment (3-level), emotions (7), pertinence, topics + subtopics, municipalities |
| Latency | ~4s per mention |
| Cost | ~$0.01-0.03 per mention |

### Monitoring
| Alarm | Condition |
|-------|-----------|
| RDS CPU | > 80% for 10 min |
| Lambda errors (3 functions) | > 5 in 5 min |
| Ingestion DLQ depth | > 0 |
| Alerts DLQ depth | > 0 |
| SNS topic | `eco-alerts-ops` → agutierrez@populicom.com |

---

## Deployment Commands

```bash
# Set credentials
export AWS_ACCESS_KEY_ID=AKIA4SJ6RGZDH26ZDLDT
export AWS_SECRET_ACCESS_KEY="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"
export AWS_REGION=us-east-1

# Deploy all stacks
cd infra && npx cdk deploy --all --require-approval never

# Deploy specific stack
npx cdk deploy EcoWorkers --require-approval never
npx cdk deploy EcoCompute --require-approval never

# Run database migrations + seed
aws lambda invoke --function-name eco-migration --cli-binary-format raw-in-base64-out --payload '{"action":"migrate-and-seed"}' /tmp/result.json

# Check database status
aws lambda invoke --function-name eco-migration --cli-binary-format raw-in-base64-out --payload '{"action":"status"}' /tmp/result.json && cat /tmp/result.json

# Manually trigger ingestion
aws lambda invoke --function-name eco-ingestion --cli-binary-format raw-in-base64-out --payload '{}' /tmp/result.json

# View logs
aws logs filter-log-events --log-group-name "/aws/lambda/eco-processor" --start-time $(python3 -c "import time; print(int((time.time()-300)*1000))") --query 'events[*].message' --output text
```

---

## Estimated Monthly Cost

| Service | Estimate |
|---------|----------|
| RDS db.t4g.medium | ~$50/mo |
| ECS Fargate (0.5 vCPU, 1GB) | ~$18/mo |
| ALB | ~$16/mo |
| NAT Gateway | ~$32/mo |
| Lambda (all functions) | ~$5-15/mo |
| Bedrock (Claude Opus 4.6) | ~$5-15/mo (at 15 mentions/day) |
| S3/SQS/SES/CloudWatch | ~$8-10/mo |
| **Total** | **~$135-160/mo** |

---

## Security Notes
- RDS in private subnets, accessible only via Lambda and ECS (security groups)
- SSL required for all RDS connections (`ssl: { rejectUnauthorized: false }`)
- Cognito handles user authentication
- S3 buckets: all public access blocked
- Lambda functions: least-privilege IAM roles
- Secrets Manager for DB credentials (auto-rotated)
- `.env` file with credentials NEVER committed to git
- ALB currently HTTP only — HTTPS requires domain + ACM certificate
