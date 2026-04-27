import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export interface WorkersStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  lambdaSecurityGroup: ec2.ISecurityGroup;
  dbSecret: rds.DatabaseSecret;
  rawBucket: s3.IBucket;
  ingestionQueue: sqs.IQueue;
  alertsQueue: sqs.IQueue;
}

export class WorkersStack extends cdk.Stack {
  public readonly ingestionFunction: NodejsFunction;
  public readonly processorFunction: NodejsFunction;
  public readonly alertsFunction: NodejsFunction;
  public readonly metricsCalculatorFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, props);

    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    // Brandwatch API token — stored in Secrets Manager so rotation does not
    // require a CDK redeploy. The secret itself is managed outside this stack
    // (create once with `aws secretsmanager create-secret --name eco/brandwatch-token`).
    const brandwatchTokenSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'BrandwatchTokenSecret',
      'eco/brandwatch-token',
    );

    const bundlingOptions = {
      minify: true,
      sourceMap: true,
      target: 'node22',
      // Bundle everything except AWS SDK (provided in Lambda runtime)
      externalModules: [
        '@aws-sdk/*',
      ],
    };

    // ---- eco-ingestion Lambda ----
    // Reserved concurrency = 1: the EventBridge cron fires every minute, but a
    // single invocation can take 5–10 min when Brandwatch rate-limits us (10
    // retries × exponential backoff up to 45 s). Without serialization,
    // concurrent lambdas pile up, every one hits 429s, and the pipeline
    // collapses into a self-reinforcing failure cascade. With concurrency 1,
    // surplus EventBridge invocations are throttled (cheap, expected) and
    // Brandwatch sees one caller at a time.
    this.ingestionFunction = new NodejsFunction(this, 'IngestionFunction', {
      functionName: 'eco-ingestion',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/ingestion/index.ts'),
      handler: 'handler',
      memorySize: 512,
      // Backfill mode (eeb22fe) can legitimately run long — 15 min matches prod.
      timeout: cdk.Duration.minutes(15),
      reservedConcurrentExecutions: 1,
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        INGESTION_QUEUE_URL: props.ingestionQueue.queueUrl,
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BRANDWATCH_TOKEN_SECRET_ARN: brandwatchTokenSecret.secretArn,
      },
      bundling: bundlingOptions,
    });

    // Grant permissions for ingestion
    props.rawBucket.grantPut(this.ingestionFunction);
    props.ingestionQueue.grantSendMessages(this.ingestionFunction);
    this.ingestionFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));
    brandwatchTokenSecret.grantRead(this.ingestionFunction);

    // EventBridge schedule: every 1 minute
    const ingestionRule = new events.Rule(this, 'IngestionSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
    });
    ingestionRule.addTarget(new targets.LambdaFunction(this.ingestionFunction));

    // ---- eco-processor Lambda ----
    this.processorFunction = new NodejsFunction(this, 'ProcessorFunction', {
      functionName: 'eco-processor',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/processor/index.ts'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        ALERTS_QUEUE_URL: props.alertsQueue.queueUrl,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
      },
      bundling: bundlingOptions,
    });

    // SQS trigger for processor (batch 10, maxConcurrency 10)
    this.processorFunction.addEventSource(new SqsEventSource(props.ingestionQueue, {
      batchSize: 10,
      maxConcurrency: 10,
    }));

    // Grant permissions for processor
    this.processorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    this.processorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['aws-marketplace:ViewSubscriptions', 'aws-marketplace:Subscribe'],
      resources: ['*'],
    }));
    props.rawBucket.grantRead(this.processorFunction);
    props.alertsQueue.grantSendMessages(this.processorFunction);
    this.processorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // ---- eco-alerts Lambda ----
    this.alertsFunction = new NodejsFunction(this, 'AlertsFunction', {
      functionName: 'eco-alerts',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/alerts/index.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        SES_FROM_EMAIL: 'noreply@populicom.com',
      },
      bundling: bundlingOptions,
    });

    // SQS trigger for alerts (batch 1)
    this.alertsFunction.addEventSource(new SqsEventSource(props.alertsQueue, {
      batchSize: 1,
    }));

    // Grant permissions for alerts
    this.alertsFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
    this.alertsFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // ---- eco-metrics-calculator Lambda ----
    this.metricsCalculatorFunction = new NodejsFunction(this, 'MetricsCalculatorFunction', {
      functionName: 'eco-metrics-calculator',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/metrics-calculator/index.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
      },
      bundling: bundlingOptions,
    });

    // Grant DB access for metrics calculator
    this.metricsCalculatorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // EventBridge schedule: every 10 minutes (computes today's snapshot only)
    const metricsRule = new events.Rule(this, 'MetricsCalculatorSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
    });
    metricsRule.addTarget(new targets.LambdaFunction(this.metricsCalculatorFunction));

    // Daily backfill at 09:00 UTC (05:00 AST). Recomputes snapshots for ALL
    // historical days that have mentions. Without this, late-arriving mentions
    // (or any catch-up after an ingestion outage) silently leave the chart's
    // historical bars at the value they had when first computed — exactly the
    // bug that surfaced on 2026-04-27 when 25-26/04 snapshots stayed at 0.
    const metricsBackfillRule = new events.Rule(this, 'MetricsCalculatorBackfillDaily', {
      schedule: events.Schedule.cron({ minute: '0', hour: '9' }),
    });
    metricsBackfillRule.addTarget(new targets.LambdaFunction(this.metricsCalculatorFunction, {
      event: events.RuleTargetInput.fromObject({ backfill: true }),
    }));
  }
}
