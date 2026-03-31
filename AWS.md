# AWS.md — ECO Platform Infrastructure

**Account:** 863956448838
**Region:** us-east-1
**IAM User:** agutierrez@populicom.com
**IaC:** AWS CDK (TypeScript)

---

## Target Architecture

### Compute
| Service | Resource | Purpose |
|---------|----------|---------|
| Lambda | `eco-ingestion` | Poll Brandwatch API every 15-30 min, store raw mentions |
| Lambda | `eco-processing` | Process mentions: Claude/Bedrock NLP, topic classification, geo tagging |
| Lambda | `eco-alerts` | Evaluate alert rules against new mentions, trigger notifications |
| Lambda | `eco-exports` | Generate report exports (PDF, Excel) |
| Lambda | `eco-api` | Next.js API routes (or API Gateway + individual functions) |

### Database
| Service | Resource | Purpose |
|---------|----------|---------|
| RDS | `eco-db` (PostgreSQL) | Primary database — mentions, users, agencies, topics, alerts |
| | Instance: `db.t4g.medium` | ~2 vCPU, 4GB RAM — sufficient for MVP |
| | Multi-AZ: No (MVP) | Enable for production |

### Storage
| Service | Resource | Purpose |
|---------|----------|---------|
| S3 | `eco-raw` | Raw Brandwatch API responses |
| S3 | `eco-exports` | Generated report files for download |
| S3 | `eco-assets` | CDK deployment assets |

### Auth
| Service | Resource | Purpose |
|---------|----------|---------|
| Cognito | `eco-users` | User authentication (email/password) |
| | User groups | Admin, Analyst, Viewer roles |

### Messaging
| Service | Resource | Purpose |
|---------|----------|---------|
| SQS | `eco-ingestion-queue` | Buffer between ingestion and processing |
| SQS | `eco-ingestion-dlq` | Dead letter queue for failed ingestions |
| SQS | `eco-alerts-queue` | Buffer for alert evaluation |
| SQS | `eco-alerts-dlq` | Dead letter queue for failed alerts |

### AI/ML
| Service | Resource | Purpose |
|---------|----------|---------|
| Bedrock | Claude (Anthropic) | Sentiment analysis, topic classification, geo extraction |
| | Model: claude-sonnet or haiku | Cost-optimized for high-volume mention processing |

### Email
| Service | Resource | Purpose |
|---------|----------|---------|
| SES | `eco-alerts@populicom.com` | Alert email notifications |

### Frontend Hosting
| Service | Resource | Purpose |
|---------|----------|---------|
| CloudFront | Distribution | CDN for Next.js static assets |
| S3 | `eco-frontend` | Next.js static export (or use Amplify) |
| *Alternative* | Amplify Hosting | Managed Next.js deployment with SSR |

### Monitoring
| Service | Resource | Purpose |
|---------|----------|---------|
| CloudWatch | Logs + Metrics | Lambda logs, RDS metrics, custom dashboards |
| CloudWatch Alarms | Critical alerts | DB connections, Lambda errors, queue depth |

---

## CDK Stack Structure

```
infra/
├── bin/
│   └── eco.ts                    # CDK app entry point
├── lib/
│   ├── network-stack.ts          # VPC, subnets, security groups
│   ├── database-stack.ts         # RDS PostgreSQL
│   ├── auth-stack.ts             # Cognito user pool + groups
│   ├── storage-stack.ts          # S3 buckets
│   ├── messaging-stack.ts        # SQS queues
│   ├── ingestion-stack.ts        # Ingestion Lambda + EventBridge schedule
│   ├── processing-stack.ts       # Processing Lambda + Bedrock access
│   ├── alerts-stack.ts           # Alert processing Lambda + SES
│   ├── api-stack.ts              # API Lambda(s) or API Gateway
│   └── frontend-stack.ts         # CloudFront + S3 or Amplify
├── cdk.json
├── tsconfig.json
└── package.json
```

---

## Estimated Monthly Cost (MVP)

| Service | Estimate |
|---------|----------|
| RDS db.t4g.medium | ~$50/mo |
| Lambda (all functions) | ~$5-15/mo |
| S3 storage | ~$1-5/mo |
| SQS | ~$1/mo |
| Cognito | Free tier (50K MAU) |
| Bedrock (Claude) | ~$20-100/mo (depends on volume) |
| CloudFront | ~$5-10/mo |
| SES | ~$1/mo |
| **Total** | **~$85-185/mo** |

---

## Current State

### Active Resources (as of 2026-03-31)
- **SacPlatformProd stack:** DELETE_IN_PROGRESS (being torn down)
- **CDKToolkit stack:** Active (bootstrap, can be reused)

### After Cleanup
- Only CDKToolkit bootstrap stack should remain
- All application resources will be recreated with the new architecture above

---

## Security Notes
- RDS should be in private subnets, accessible only via Lambda
- Cognito handles all user authentication — no custom auth
- S3 buckets: block all public access
- Lambda functions: least-privilege IAM roles
- Bedrock: IAM policy to invoke specific Claude models only
- .env file with credentials should NEVER be committed to git
