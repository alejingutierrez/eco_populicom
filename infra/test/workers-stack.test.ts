import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { WorkersStack } from '../lib/workers-stack';

// Mock esbuild bundling for NodejsFunction in tests
jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const original = jest.requireActual('aws-cdk-lib/aws-lambda-nodejs');
  const lambda = jest.requireActual('aws-cdk-lib/aws-lambda');
  const path = jest.requireActual('path');

  return {
    ...original,
    NodejsFunction: class MockNodejsFunction extends lambda.Function {
      constructor(scope: any, id: string, props: any) {
        super(scope, id, {
          ...props,
          code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/ingestion')),
          handler: 'index.handler',
          entry: undefined,
          bundling: undefined,
        });
      }
    },
  };
});

test('WorkersStack creates 4 Lambda functions', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };

  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc');
  const lambdaSg = new ec2.SecurityGroup(vpcStack, 'LambdaSg', { vpc });

  const storageStack = new cdk.Stack(app, 'StorageStack', { env });
  const rawBucket = new s3.Bucket(storageStack, 'RawBucket');

  const messagingStack = new cdk.Stack(app, 'MessagingStack', { env });
  const ingestionQueue = new sqs.Queue(messagingStack, 'IngestionQueue');
  const alertsQueue = new sqs.Queue(messagingStack, 'AlertsQueue');

  const dbStack = new cdk.Stack(app, 'DbStack', { env });
  const dbSecret = new rds.DatabaseSecret(dbStack, 'DbSecret', { username: 'eco_admin' });

  const stack = new WorkersStack(app, 'TestWorkers', {
    env,
    vpc,
    lambdaSecurityGroup: lambdaSg,
    dbSecret,
    rawBucket,
    ingestionQueue,
    alertsQueue,
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Lambda::Function', 4);
});

function buildWorkers() {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };
  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc');
  const lambdaSg = new ec2.SecurityGroup(vpcStack, 'LambdaSg', { vpc });
  const rawBucket = new s3.Bucket(new cdk.Stack(app, 'StorageStack', { env }), 'RawBucket');
  const messagingStack = new cdk.Stack(app, 'MessagingStack', { env });
  const ingestionQueue = new sqs.Queue(messagingStack, 'IngestionQueue');
  const alertsQueue = new sqs.Queue(messagingStack, 'AlertsQueue');
  const dbSecret = new rds.DatabaseSecret(new cdk.Stack(app, 'DbStack', { env }), 'DbSecret', { username: 'eco_admin' });
  const stack = new WorkersStack(app, 'TestWorkers', { env, vpc, lambdaSecurityGroup: lambdaSg, dbSecret, rawBucket, ingestionQueue, alertsQueue });
  return Template.fromStack(stack);
}

describe('eco-advisor (asesor de crisis, camino 3)', () => {
  const template = buildWorkers();

  test('lambda con 900 s, 1024 MB, concurrencia 5 y sin reintentos automáticos', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'eco-advisor',
      Timeout: 900,
      MemorySize: 1024,
      ReservedConcurrentExecutions: 5,
      Environment: { Variables: Match.objectLike({ ADVISOR_LLM_BACKEND: 'runtime', ADVISOR_MODEL_DEEP: 'us.anthropic.claude-opus-5-5' }) },
    });
    // Un reintento automático duplicaría el consejo y su costo (spec §11.1).
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', { MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 900 });
  });

  test('reaper cada 10 minutos con el evento { reaper: true }', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      Name: 'eco-advisor-reaper-10min',
      ScheduleExpression: 'rate(10 minutes)',
      Targets: Match.arrayWith([Match.objectLike({ Input: JSON.stringify({ reaper: true }) })]),
    });
  });

  test('IAM: Bedrock sobre perfiles claude, secreto de la base y reinvocación propia', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('bedrock:InvokeModel');
    expect(json).toContain('inference-profile/*claude*');
    expect(json).toContain('function:eco-advisor');
  });
});
