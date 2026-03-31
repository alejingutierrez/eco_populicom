import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
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
  public readonly ingestionFunction: lambda.Function;
  public readonly processorFunction: lambda.Function;
  public readonly alertsFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, props);

    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    // eco-ingestion Lambda
    this.ingestionFunction = new lambda.Function(this, 'IngestionFunction', {
      functionName: 'eco-ingestion',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/ingestion')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        RAW_BUCKET: props.rawBucket.bucketName,
        INGESTION_QUEUE_URL: props.ingestionQueue.queueUrl,
      },
    });

    // Grant permissions for ingestion
    props.rawBucket.grantPut(this.ingestionFunction);
    props.ingestionQueue.grantSendMessages(this.ingestionFunction);
    this.ingestionFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // EventBridge schedule: every 15 minutes
    const ingestionRule = new events.Rule(this, 'IngestionSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });
    ingestionRule.addTarget(new targets.LambdaFunction(this.ingestionFunction));

    // eco-processor Lambda
    this.processorFunction = new lambda.Function(this, 'ProcessorFunction', {
      functionName: 'eco-processor',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/processor')),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        ALERTS_QUEUE_URL: props.alertsQueue.queueUrl,
      },
    });

    // SQS trigger for processor (batch 10, maxConcurrency 2)
    this.processorFunction.addEventSource(new SqsEventSource(props.ingestionQueue, {
      batchSize: 10,
      maxConcurrency: 2,
    }));

    // Grant permissions for processor
    this.processorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    props.alertsQueue.grantSendMessages(this.processorFunction);
    this.processorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // eco-alerts Lambda
    this.alertsFunction = new lambda.Function(this, 'AlertsFunction', {
      functionName: 'eco-alerts',
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/alerts')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        SES_FROM_EMAIL: 'noreply@populicom.com',
      },
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
  }
}
