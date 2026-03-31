# ECO Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy complete AWS infrastructure for ECO via CDK — 8 stacks covering networking, database, auth, storage, messaging, compute (Fargate), workers (Lambda), and monitoring.

**Architecture:** Multi-stack CDK app (TypeScript). Each stack is a separate CloudFormation stack with cross-stack references. Deploy order: Network → Database/Auth/Storage/Messaging (parallel) → Workers/Compute → Monitoring.

**Tech Stack:** AWS CDK v2, TypeScript, Node.js 22, PostgreSQL 16, ECS Fargate, Lambda, SQS, Cognito, S3, SES, CloudWatch, Bedrock

**Spec:** `docs/superpowers/specs/2026-03-31-infrastructure-design.md`

---

## File Structure

```
infra/
├── bin/
│   └── eco.ts                      # CDK app entry point
├── lib/
│   ├── network-stack.ts            # VPC, subnets, NAT, security groups
│   ├── database-stack.ts           # RDS PostgreSQL
│   ├── auth-stack.ts               # Cognito user pool + groups
│   ├── storage-stack.ts            # S3 buckets
│   ├── messaging-stack.ts          # SQS queues + DLQs
│   ├── compute-stack.ts            # ECS Fargate + ALB + ECR
│   ├── workers-stack.ts            # Lambda functions + EventBridge
│   └── monitoring-stack.ts         # CloudWatch dashboard + alarms + SNS
├── lambda/
│   ├── ingestion/
│   │   └── index.ts                # Brandwatch polling handler
│   ├── processor/
│   │   └── index.ts                # NLP processing handler
│   └── alerts/
│       └── index.ts                # Alert evaluation handler
├── test/
│   ├── network-stack.test.ts
│   ├── database-stack.test.ts
│   ├── auth-stack.test.ts
│   ├── storage-stack.test.ts
│   ├── messaging-stack.test.ts
│   ├── compute-stack.test.ts
│   ├── workers-stack.test.ts
│   └── monitoring-stack.test.ts
├── cdk.json
├── tsconfig.json
├── jest.config.ts
└── package.json
```

---

## Chunk 1: Project Scaffolding + NetworkStack

### Task 1: Initialize CDK Project

**Files:**
- Create: `infra/bin/eco.ts`
- Create: `infra/cdk.json`
- Create: `infra/tsconfig.json`
- Create: `infra/package.json`
- Create: `infra/jest.config.ts`

- [ ] **Step 1: Initialize CDK app**

```bash
cd /Volumes/MyApps/eco_populicom
mkdir -p infra
cd infra
npx cdk init app --language typescript
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Volumes/MyApps/eco_populicom/infra
npm install aws-cdk-lib constructs
npm install -D @types/node typescript jest ts-jest @types/jest
```

- [ ] **Step 3: Configure cdk.json**

Edit `infra/cdk.json` to set:
```json
{
  "app": "npx ts-node --prefer-ts-exts bin/eco.ts",
  "context": {
    "account": "863956448838",
    "region": "us-east-1"
  }
}
```

- [ ] **Step 4: Write CDK app entry point**

Create `infra/bin/eco.ts`:
```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { MessagingStack } from '../lib/messaging-stack';
import { ComputeStack } from '../lib/compute-stack';
import { WorkersStack } from '../lib/workers-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

const env = {
  account: '863956448838',
  region: 'us-east-1',
};

const network = new NetworkStack(app, 'EcoNetwork', { env });
const database = new DatabaseStack(app, 'EcoDatabase', { env, vpc: network.vpc, rdsSecurityGroup: network.rdsSecurityGroup });
const auth = new AuthStack(app, 'EcoAuth', { env });
const storage = new StorageStack(app, 'EcoStorage', { env });
const messaging = new MessagingStack(app, 'EcoMessaging', { env });

const workers = new WorkersStack(app, 'EcoWorkers', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbSecret: database.dbSecret,
  rawBucket: storage.rawBucket,
  ingestionQueue: messaging.ingestionQueue,
  alertsQueue: messaging.alertsQueue,
});

const compute = new ComputeStack(app, 'EcoCompute', {
  env,
  vpc: network.vpc,
  fargateSecurityGroup: network.fargateSecurityGroup,
  albSecurityGroup: network.albSecurityGroup,
  dbSecret: database.dbSecret,
  userPoolId: auth.userPoolId,
  userPoolClientId: auth.userPoolClientId,
  rawBucket: storage.rawBucket,
  exportsBucket: storage.exportsBucket,
});

new MonitoringStack(app, 'EcoMonitoring', {
  env,
  dbInstance: database.dbInstance,
  ingestionFunction: workers.ingestionFunction,
  processorFunction: workers.processorFunction,
  alertsFunction: workers.alertsFunction,
  ingestionDlq: messaging.ingestionDlq,
  alertsDlq: messaging.alertsDlq,
  ecsService: compute.ecsService,
  alb: compute.alb,
});
```

- [ ] **Step 5: Commit scaffolding**

```bash
git add infra/
git commit -m "feat(infra): initialize CDK project scaffolding"
```

---

### Task 2: NetworkStack

**Files:**
- Create: `infra/lib/network-stack.ts`
- Create: `infra/test/network-stack.test.ts`

- [ ] **Step 1: Write test**

Create `infra/test/network-stack.test.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack';

test('NetworkStack creates VPC with 2 AZs and NAT Gateway', () => {
  const app = new cdk.App();
  const stack = new NetworkStack(app, 'TestNetwork', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::EC2::VPC', 1);
  template.resourceCountIs('AWS::EC2::NatGateway', 1);
  template.resourceCountIs('AWS::EC2::SecurityGroup', 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Volumes/MyApps/eco_populicom/infra && npx jest test/network-stack.test.ts
```
Expected: FAIL — `network-stack` module not found

- [ ] **Step 3: Implement NetworkStack**

Create `infra/lib/network-stack.ts`:
```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly fargateSecurityGroup: ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'EcoVpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { cidrMask: 24, name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { cidrMask: 24, name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      ],
    });

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'ALB security group',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    this.fargateSecurityGroup = new ec2.SecurityGroup(this, 'FargateSg', {
      vpc: this.vpc,
      description: 'Fargate security group',
      allowAllOutbound: true,
    });
    this.fargateSecurityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(3000), 'From ALB');

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Lambda security group',
      allowAllOutbound: true,
    });

    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'RDS security group',
      allowAllOutbound: false,
    });
    this.rdsSecurityGroup.addIngressRule(this.fargateSecurityGroup, ec2.Port.tcp(5432), 'From Fargate');
    this.rdsSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(5432), 'From Lambda');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Volumes/MyApps/eco_populicom/infra && npx jest test/network-stack.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add infra/lib/network-stack.ts infra/test/network-stack.test.ts
git commit -m "feat(infra): add NetworkStack — VPC, subnets, security groups"
```

---

## Chunk 2: Database + Auth + Storage + Messaging Stacks

### Task 3: DatabaseStack

**Files:**
- Create: `infra/lib/database-stack.ts`
- Create: `infra/test/database-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Template } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../lib/database-stack';

test('DatabaseStack creates RDS PostgreSQL instance', () => {
  const app = new cdk.App();
  const vpc = new ec2.Vpc(app as any, 'Vpc');
  const sg = new ec2.SecurityGroup(app as any, 'Sg', { vpc });
  // Use a separate stack for VPC resources
  const vpcStack = new cdk.Stack(app, 'VpcStack');
  const testVpc = new ec2.Vpc(vpcStack, 'Vpc');
  const testSg = new ec2.SecurityGroup(vpcStack, 'Sg', { vpc: testVpc });

  const stack = new DatabaseStack(app, 'TestDatabase', {
    env: { account: '123456789', region: 'us-east-1' },
    vpc: testVpc,
    rdsSecurityGroup: testSg,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::RDS::DBInstance', 1);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'postgres',
    DBInstanceClass: 'db.t4g.medium',
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement DatabaseStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  rdsSecurityGroup: ec2.SecurityGroup;
}

export class DatabaseStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.dbInstance = new rds.DatabaseInstance(this, 'EcoDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.rdsSecurityGroup],
      databaseName: 'eco',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: true,
      multiAz: false,
      credentials: rds.Credentials.fromGeneratedSecret('eco_admin'),
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    this.dbSecret = this.dbInstance.secret!;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/database-stack.ts infra/test/database-stack.test.ts
git commit -m "feat(infra): add DatabaseStack — RDS PostgreSQL 16"
```

---

### Task 4: AuthStack

**Files:**
- Create: `infra/lib/auth-stack.ts`
- Create: `infra/test/auth-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';

test('AuthStack creates Cognito User Pool with 3 groups', () => {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuth', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolGroup', 3);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement AuthStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'EcoUserPool', {
      userPoolName: 'eco-users',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    ['admin', 'analyst', 'viewer'].forEach(group => {
      new cognito.CfnUserPoolGroup(this, `${group}Group`, {
        userPoolId: this.userPool.userPoolId,
        groupName: group,
      });
    });

    this.userPoolClient = this.userPool.addClient('EcoWebClient', {
      authFlows: { userSrp: true },
      generateSecret: false,
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/auth-stack.ts infra/test/auth-stack.test.ts
git commit -m "feat(infra): add AuthStack — Cognito user pool + groups"
```

---

### Task 5: StorageStack

**Files:**
- Create: `infra/lib/storage-stack.ts`
- Create: `infra/test/storage-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/storage-stack';

test('StorageStack creates 2 S3 buckets', () => {
  const app = new cdk.App();
  const stack = new StorageStack(app, 'TestStorage', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::S3::Bucket', 2);
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement StorageStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly exportsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      bucketName: `eco-raw-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        { transitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(90) }], expiration: cdk.Duration.days(365) },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.exportsBucket = new s3.Bucket(this, 'ExportsBucket', {
      bucketName: `eco-exports-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/storage-stack.ts infra/test/storage-stack.test.ts
git commit -m "feat(infra): add StorageStack — S3 raw + exports buckets"
```

---

### Task 6: MessagingStack

**Files:**
- Create: `infra/lib/messaging-stack.ts`
- Create: `infra/test/messaging-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MessagingStack } from '../lib/messaging-stack';

test('MessagingStack creates 2 queues with DLQs', () => {
  const app = new cdk.App();
  const stack = new MessagingStack(app, 'TestMessaging', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SQS::Queue', 4); // 2 queues + 2 DLQs
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement MessagingStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class MessagingStack extends cdk.Stack {
  public readonly ingestionQueue: sqs.Queue;
  public readonly ingestionDlq: sqs.Queue;
  public readonly alertsQueue: sqs.Queue;
  public readonly alertsDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.ingestionDlq = new sqs.Queue(this, 'IngestionDlq', {
      queueName: 'eco-ingestion-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.ingestionQueue = new sqs.Queue(this, 'IngestionQueue', {
      queueName: 'eco-ingestion-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: this.ingestionDlq, maxReceiveCount: 3 },
    });

    this.alertsDlq = new sqs.Queue(this, 'AlertsDlq', {
      queueName: 'eco-alerts-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.alertsQueue = new sqs.Queue(this, 'AlertsQueue', {
      queueName: 'eco-alerts-queue',
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: this.alertsDlq, maxReceiveCount: 3 },
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/messaging-stack.ts infra/test/messaging-stack.test.ts
git commit -m "feat(infra): add MessagingStack — SQS queues + DLQs"
```

---

## Chunk 3: Workers + Compute + Monitoring Stacks

### Task 7: Lambda Handlers (Stubs)

**Files:**
- Create: `infra/lambda/ingestion/index.ts`
- Create: `infra/lambda/processor/index.ts`
- Create: `infra/lambda/alerts/index.ts`

- [ ] **Step 1: Write stub handlers**

`infra/lambda/ingestion/index.ts`:
```typescript
export const handler = async (event: any) => {
  console.log('Ingestion handler invoked', JSON.stringify(event));
  return { statusCode: 200, body: 'Ingestion stub' };
};
```

`infra/lambda/processor/index.ts`:
```typescript
export const handler = async (event: any) => {
  console.log('Processor handler invoked', JSON.stringify(event));
  return { statusCode: 200, body: 'Processor stub' };
};
```

`infra/lambda/alerts/index.ts`:
```typescript
export const handler = async (event: any) => {
  console.log('Alerts handler invoked', JSON.stringify(event));
  return { statusCode: 200, body: 'Alerts stub' };
};
```

- [ ] **Step 2: Commit**

```bash
git add infra/lambda/
git commit -m "feat(infra): add Lambda handler stubs"
```

---

### Task 8: WorkersStack

**Files:**
- Create: `infra/lib/workers-stack.ts`
- Create: `infra/test/workers-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Template } from 'aws-cdk-lib/assertions';
import { WorkersStack } from '../lib/workers-stack';

test('WorkersStack creates 3 Lambda functions', () => {
  const app = new cdk.App();
  const depStack = new cdk.Stack(app, 'DepStack');
  const vpc = new ec2.Vpc(depStack, 'Vpc');
  const sg = new ec2.SecurityGroup(depStack, 'Sg', { vpc });
  const secret = new secretsmanager.Secret(depStack, 'Secret');
  const bucket = new s3.Bucket(depStack, 'Bucket');
  const queue1 = new sqs.Queue(depStack, 'Q1');
  const queue2 = new sqs.Queue(depStack, 'Q2');

  const stack = new WorkersStack(app, 'TestWorkers', {
    env: { account: '123456789', region: 'us-east-1' },
    vpc, lambdaSecurityGroup: sg, dbSecret: secret,
    rawBucket: bucket, ingestionQueue: queue1, alertsQueue: queue2,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Lambda::Function', 3);
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement WorkersStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

export interface WorkersStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbSecret: secretsmanager.ISecret;
  rawBucket: s3.Bucket;
  ingestionQueue: sqs.Queue;
  alertsQueue: sqs.Queue;
}

export class WorkersStack extends cdk.Stack {
  public readonly ingestionFunction: lambda.Function;
  public readonly processorFunction: lambda.Function;
  public readonly alertsFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, props);

    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.lambdaSecurityGroup],
    };

    // Ingestion Lambda
    this.ingestionFunction = new lambda.Function(this, 'IngestionFunction', {
      ...commonLambdaProps,
      functionName: 'eco-ingestion',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/ingestion')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        INGESTION_QUEUE_URL: props.ingestionQueue.queueUrl,
      },
    });

    props.rawBucket.grantPut(this.ingestionFunction);
    props.ingestionQueue.grantSendMessages(this.ingestionFunction);
    props.dbSecret.grantRead(this.ingestionFunction);

    // Schedule: every 15 minutes
    new events.Rule(this, 'IngestionSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      targets: [new targets.LambdaFunction(this.ingestionFunction)],
    });

    // Processor Lambda
    this.processorFunction = new lambda.Function(this, 'ProcessorFunction', {
      ...commonLambdaProps,
      functionName: 'eco-processor',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/processor')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        ALERTS_QUEUE_URL: props.alertsQueue.queueUrl,
      },
    });

    props.dbSecret.grantRead(this.processorFunction);
    props.alertsQueue.grantSendMessages(this.processorFunction);
    this.processorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:us-east-1::foundation-model/anthropic.*'],
    }));

    this.processorFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(props.ingestionQueue, {
        batchSize: 10,
        maxConcurrency: 2,
      })
    );

    // Alerts Lambda
    this.alertsFunction = new lambda.Function(this, 'AlertsFunction', {
      ...commonLambdaProps,
      functionName: 'eco-alerts',
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/alerts')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        SES_FROM_EMAIL: 'alerts@populicom.com',
      },
    });

    props.dbSecret.grantRead(this.alertsFunction);
    this.alertsFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));

    this.alertsFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(props.alertsQueue, { batchSize: 1 })
    );
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/workers-stack.ts infra/test/workers-stack.test.ts
git commit -m "feat(infra): add WorkersStack — 3 Lambdas + EventBridge + SQS triggers"
```

---

### Task 9: ComputeStack

**Files:**
- Create: `infra/lib/compute-stack.ts`
- Create: `infra/test/compute-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Template } from 'aws-cdk-lib/assertions';
import { ComputeStack } from '../lib/compute-stack';

test('ComputeStack creates ECS cluster, Fargate service, and ALB', () => {
  const app = new cdk.App();
  const depStack = new cdk.Stack(app, 'DepStack');
  const vpc = new ec2.Vpc(depStack, 'Vpc');
  const fargateSg = new ec2.SecurityGroup(depStack, 'FargateSg', { vpc });
  const albSg = new ec2.SecurityGroup(depStack, 'AlbSg', { vpc });
  const secret = new secretsmanager.Secret(depStack, 'Secret');
  const rawBucket = new s3.Bucket(depStack, 'Raw');
  const exportsBucket = new s3.Bucket(depStack, 'Exports');

  const stack = new ComputeStack(app, 'TestCompute', {
    env: { account: '123456789', region: 'us-east-1' },
    vpc, fargateSecurityGroup: fargateSg, albSecurityGroup: albSg,
    dbSecret: secret, userPoolId: 'test-pool', userPoolClientId: 'test-client',
    rawBucket, exportsBucket,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::ECS::Cluster', 1);
  template.resourceCountIs('AWS::ECS::Service', 1);
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  template.resourceCountIs('AWS::ECR::Repository', 1);
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement ComputeStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  fargateSecurityGroup: ec2.SecurityGroup;
  albSecurityGroup: ec2.SecurityGroup;
  dbSecret: secretsmanager.ISecret;
  userPoolId: string;
  userPoolClientId: string;
  rawBucket: s3.Bucket;
  exportsBucket: s3.Bucket;
}

export class ComputeStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const repo = new ecr.Repository(this, 'EcoWebRepo', {
      repositoryName: 'eco-web',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const cluster = new ecs.Cluster(this, 'EcoCluster', {
      clusterName: 'eco-cluster',
      vpc: props.vpc,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    const logGroup = new logs.LogGroup(this, 'WebLogGroup', {
      logGroupName: '/ecs/eco-web',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    taskDef.addContainer('web', {
      image: ecs.ContainerImage.fromRegistry('public.ecr.aws/docker/library/node:22-slim'),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        RAW_BUCKET: props.rawBucket.bucketName,
        EXPORTS_BUCKET: props.exportsBucket.bucketName,
      },
      secrets: {
        DB_SECRET: ecs.Secret.fromSecretsManager(props.dbSecret),
      },
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'web' }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
    });

    props.dbSecret.grantRead(taskDef.taskRole);
    props.rawBucket.grantRead(taskDef.taskRole);
    props.exportsBucket.grantReadWrite(taskDef.taskRole);

    this.ecsService = new ecs.FargateService(this, 'WebService', {
      serviceName: 'eco-web',
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      securityGroups: [props.fargateSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
    });

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'EcoAlb', {
      loadBalancerName: 'eco-alb',
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSecurityGroup,
    });

    const listener = this.alb.addListener('HttpListener', { port: 80 });
    listener.addTargets('WebTarget', {
      port: 3000,
      targets: [this.ecsService],
      healthCheck: { path: '/api/health', interval: cdk.Duration.seconds(30) },
    });

    // Auto-scaling
    const scaling = this.ecsService.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 3 });
    scaling.scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 70 });

    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'EcrRepoUri', { value: repo.repositoryUri });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/compute-stack.ts infra/test/compute-stack.test.ts
git commit -m "feat(infra): add ComputeStack — ECS Fargate + ALB + ECR"
```

---

### Task 10: MonitoringStack

**Files:**
- Create: `infra/lib/monitoring-stack.ts`
- Create: `infra/test/monitoring-stack.test.ts`

- [ ] **Step 1: Write test**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Template } from 'aws-cdk-lib/assertions';
import { MonitoringStack } from '../lib/monitoring-stack';

test('MonitoringStack creates dashboard, alarms, and SNS topic', () => {
  const app = new cdk.App();
  const depStack = new cdk.Stack(app, 'DepStack');
  const vpc = new ec2.Vpc(depStack, 'Vpc');

  const dbInstance = new rds.DatabaseInstance(depStack, 'Db', {
    engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
    vpc,
  });

  const fn1 = new lambda.Function(depStack, 'Fn1', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.handler', code: lambda.Code.fromInline('exports.handler=()=>{}') });
  const fn2 = new lambda.Function(depStack, 'Fn2', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.handler', code: lambda.Code.fromInline('exports.handler=()=>{}') });
  const fn3 = new lambda.Function(depStack, 'Fn3', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.handler', code: lambda.Code.fromInline('exports.handler=()=>{}') });
  const dlq1 = new sqs.Queue(depStack, 'Dlq1');
  const dlq2 = new sqs.Queue(depStack, 'Dlq2');

  const cluster = new ecs.Cluster(depStack, 'Cluster', { vpc });
  const taskDef = new ecs.FargateTaskDefinition(depStack, 'TaskDef');
  taskDef.addContainer('c', { image: ecs.ContainerImage.fromRegistry('node:22'), memoryLimitMiB: 512 });
  const svc = new ecs.FargateService(depStack, 'Svc', { cluster, taskDefinition: taskDef });
  const alb = new elbv2.ApplicationLoadBalancer(depStack, 'Alb', { vpc });

  const stack = new MonitoringStack(app, 'TestMonitoring', {
    env: { account: '123456789', region: 'us-east-1' },
    dbInstance, ingestionFunction: fn1, processorFunction: fn2, alertsFunction: fn3,
    ingestionDlq: dlq1, alertsDlq: dlq2, ecsService: svc, alb,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::SNS::Topic', 1);
  template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement MonitoringStack**

```typescript
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  dbInstance: rds.DatabaseInstance;
  ingestionFunction: lambda.Function;
  processorFunction: lambda.Function;
  alertsFunction: lambda.Function;
  ingestionDlq: sqs.Queue;
  alertsDlq: sqs.Queue;
  ecsService: ecs.FargateService;
  alb: elbv2.ApplicationLoadBalancer;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const opsTopic = new sns.Topic(this, 'OpsTopic', { topicName: 'eco-alerts-ops' });
    opsTopic.addSubscription(new snsSubscriptions.EmailSubscription('agutierrez@populicom.com'));
    const snsAction = new cloudwatchActions.SnsAction(opsTopic);

    // Alarms
    props.dbInstance.metricCPUUtilization().createAlarm(this, 'RdsCpuAlarm', {
      alarmName: 'eco-rds-cpu-high',
      threshold: 80, evaluationPeriods: 2, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    }).addAlarmAction(snsAction);

    [props.ingestionFunction, props.processorFunction, props.alertsFunction].forEach((fn, i) => {
      fn.metricErrors().createAlarm(this, `LambdaErrors${i}`, {
        alarmName: `eco-lambda-errors-${fn.functionName}`,
        threshold: 5, evaluationPeriods: 1,
      }).addAlarmAction(snsAction);
    });

    [props.ingestionDlq, props.alertsDlq].forEach((dlq, i) => {
      dlq.metricApproximateNumberOfMessagesVisible().createAlarm(this, `DlqAlarm${i}`, {
        alarmName: `eco-dlq-${dlq.queueName}`,
        threshold: 0, evaluationPeriods: 1, comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      }).addAlarmAction(snsAction);
    });

    // Dashboard
    new cloudwatch.Dashboard(this, 'EcoDashboard', {
      dashboardName: 'eco-dashboard',
      widgets: [
        [
          new cloudwatch.GraphWidget({ title: 'RDS CPU', left: [props.dbInstance.metricCPUUtilization()] }),
          new cloudwatch.GraphWidget({ title: 'RDS Connections', left: [props.dbInstance.metricDatabaseConnections()] }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'Lambda Invocations', left: [props.ingestionFunction.metricInvocations(), props.processorFunction.metricInvocations(), props.alertsFunction.metricInvocations()] }),
          new cloudwatch.GraphWidget({ title: 'Lambda Errors', left: [props.ingestionFunction.metricErrors(), props.processorFunction.metricErrors(), props.alertsFunction.metricErrors()] }),
        ],
        [
          new cloudwatch.GraphWidget({ title: 'SQS Messages', left: [props.ingestionDlq.metricApproximateNumberOfMessagesVisible(), props.alertsDlq.metricApproximateNumberOfMessagesVisible()] }),
        ],
      ],
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add infra/lib/monitoring-stack.ts infra/test/monitoring-stack.test.ts
git commit -m "feat(infra): add MonitoringStack — CloudWatch dashboard + alarms + SNS"
```

---

## Chunk 4: Deploy + Verify

### Task 11: CDK Synth + Deploy

- [ ] **Step 1: Synthesize all stacks**

```bash
cd /Volumes/MyApps/eco_populicom/infra
npx cdk synth --all
```
Expected: CloudFormation templates generated in `cdk.out/` with no errors.

- [ ] **Step 2: Deploy all stacks**

```bash
cd /Volumes/MyApps/eco_populicom/infra
npx cdk deploy --all --require-approval never
```
Expected: All 8 stacks deploy successfully. RDS will take ~5-10 min.

- [ ] **Step 3: Commit cdk.out to gitignore (already done) and push**

```bash
git push
```

### Task 12: Verify Infrastructure

- [ ] **Step 1: Verify VPC and subnets**

```bash
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=*Eco*" --query 'Vpcs[*].[VpcId,CidrBlock,State]' --output table
```

- [ ] **Step 2: Verify RDS**

```bash
aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus,Engine]' --output table
```

- [ ] **Step 3: Verify Cognito**

```bash
aws cognito-idp list-user-pools --max-results 10 --query 'UserPools[*].[Name,Id]' --output table
```

- [ ] **Step 4: Verify S3 buckets**

```bash
aws s3 ls | grep eco
```

- [ ] **Step 5: Verify SQS queues**

```bash
aws sqs list-queues --queue-name-prefix eco --output table
```

- [ ] **Step 6: Verify Lambda functions**

```bash
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `eco-`)].FunctionName' --output table
```

- [ ] **Step 7: Verify ECS + ALB**

```bash
aws ecs list-clusters --query 'clusterArns' --output table
aws elbv2 describe-load-balancers --names eco-alb --query 'LoadBalancers[*].[DNSName,State.Code]' --output table
```

- [ ] **Step 8: Verify CloudWatch dashboard**

```bash
aws cloudwatch list-dashboards --dashboard-name-prefix eco --output table
```

- [ ] **Step 9: Test ingestion Lambda manually**

```bash
aws lambda invoke --function-name eco-ingestion --payload '{}' /tmp/ingestion-output.json && cat /tmp/ingestion-output.json
```

- [ ] **Step 10: Final commit and push**

```bash
git add -A && git commit -m "feat(infra): complete infrastructure deployment — all 8 stacks verified" && git push
```
