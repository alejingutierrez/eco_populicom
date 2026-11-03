import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Template } from 'aws-cdk-lib/assertions';
import { WorkersStack } from '../lib/workers-stack';

// eco-weekly-report (WP-6): timeout de 15 min y permiso para invocarse a sí
// mismo (composición anticipada asíncrona). Mismo mock de bundling que
// workers-stack.test.ts.
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

test('eco-weekly-report: timeout 900 s y lambda:InvokeFunction sobre sí mismo', () => {
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
  template.hasResourceProperties('AWS::Lambda::Function', { FunctionName: 'eco-weekly-report', Timeout: 900 });
  const policies = template.findResources('AWS::IAM::Policy');
  const statements = Object.values(policies).flatMap((p: any) => p.Properties.PolicyDocument.Statement);
  const selfInvoke = statements.filter((s: any) => s.Action === 'lambda:InvokeFunction'
    && JSON.stringify(s.Resource).includes(':function:eco-weekly-report'));
  expect(selfInvoke).toHaveLength(1);
  const roles = Object.values(policies).filter((p: any) => p.Properties.PolicyDocument.Statement.includes(selfInvoke[0]))
    .map((p: any) => JSON.stringify(p.Properties.Roles));
  expect(roles.join(' ')).toMatch(/WeeklyReportFunction/);
  // El horario sigue siendo UNO (cada hora): la composición anticipada no añade reglas.
  const rules = Object.values(template.findResources('AWS::Events::Rule')).filter((r: any) => r.Properties.Name === 'eco-weekly-report-hourly');
  expect(rules).toHaveLength(1);
  expect((rules[0] as any).Properties.ScheduleExpression).toBe('cron(0 * * * ? *)');
});
