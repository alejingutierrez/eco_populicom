import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Template } from 'aws-cdk-lib/assertions';
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

test('WorkersStack creates 3 Lambda functions', () => {
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
  template.resourceCountIs('AWS::Lambda::Function', 3);
});
