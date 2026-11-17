import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MonitoringStack } from '../lib/monitoring-stack';

test('MonitoringStack creates SNS topic and CloudWatch dashboard', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };

  // VPC stack for cross-stack resources
  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc');

  // DB instance
  const dbStack = new cdk.Stack(app, 'DbStack', { env });
  const dbSecret = new rds.DatabaseSecret(dbStack, 'DbSecret', { username: 'eco_admin' });
  const dbSg = new ec2.SecurityGroup(vpcStack, 'DbSg', { vpc });
  const dbInstance = new rds.DatabaseInstance(dbStack, 'DbInstance', {
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_16,
    }),
    vpc,
    securityGroups: [dbSg],
    credentials: rds.Credentials.fromSecret(dbSecret),
  });

  // Lambda functions
  const lambdaStack = new cdk.Stack(app, 'LambdaStack', { env });
  const lambdaSg = new ec2.SecurityGroup(vpcStack, 'LambdaSg', { vpc });
  const ingestionFn = new lambda.Function(lambdaStack, 'IngestionFn', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
    vpc,
    securityGroups: [lambdaSg],
  });
  const processorFn = new lambda.Function(lambdaStack, 'ProcessorFn', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
    vpc,
    securityGroups: [lambdaSg],
  });
  const alertsFn = new lambda.Function(lambdaStack, 'AlertsFn', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
    vpc,
    securityGroups: [lambdaSg],
  });

  // SQS DLQs
  const msgStack = new cdk.Stack(app, 'MsgStack', { env });
  const ingestionDlq = new sqs.Queue(msgStack, 'IngestionDlq');
  const alertsDlq = new sqs.Queue(msgStack, 'AlertsDlq');

  // ECS / ALB stubs
  const computeStack = new cdk.Stack(app, 'ComputeStack', { env });
  const albSg = new ec2.SecurityGroup(vpcStack, 'AlbSg', { vpc });
  const fargateSg = new ec2.SecurityGroup(vpcStack, 'FargateSg', { vpc });
  const cluster = new ecs.Cluster(computeStack, 'Cluster', { vpc });
  const taskDef = new ecs.FargateTaskDefinition(computeStack, 'TaskDef');
  taskDef.addContainer('app', {
    image: ecs.ContainerImage.fromRegistry('node:22-slim'),
    portMappings: [{ containerPort: 3000 }],
  });
  const ecsService = new ecs.FargateService(computeStack, 'Service', {
    cluster,
    taskDefinition: taskDef,
    securityGroups: [fargateSg],
  });
  const alb = new elbv2.ApplicationLoadBalancer(computeStack, 'Alb', {
    vpc,
    internetFacing: true,
    securityGroup: albSg,
  });

  const stack = new MonitoringStack(app, 'TestMonitoring', {
    env,
    dbInstance,
    ingestionFunction: ingestionFn,
    processorFunction: processorFn,
    alertsFunction: alertsFn,
    ingestionDlq,
    alertsDlq,
    ecsService,
    alb,
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SNS::Topic', 1);
  template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);

  // Salud de la ingesta (ING-01): métricas propias del lambda, sin dimensiones.
  // FILL(…, 0) sobre periodos de 1 min: con datos faltantes a secas CloudWatch
  // tardó 19.6 min en avisar (simulacro del 13-nov).
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'eco-ingesta-callada',
    EvaluationPeriods: 11,
    Threshold: 1,
    ComparisonOperator: 'LessThanThreshold',
    TreatMissingData: 'breaching',
    Metrics: Match.arrayWith([
      Match.objectLike({ Expression: 'FILL(sondeadas, 0)', ReturnData: true }),
      Match.objectLike({
        Id: 'sondeadas',
        ReturnData: false,
        MetricStat: Match.objectLike({
          Metric: Match.objectLike({ Namespace: 'ECO/Ingesta', MetricName: 'QueriesSondeadas' }),
          Period: 60,
          Stat: 'Sum',
        }),
      }),
    ]),
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'eco-ingesta-query-desatendida',
    Namespace: 'ECO/Ingesta',
    MetricName: 'MinutosSinSondeoMax',
    Statistic: 'Maximum',
    Threshold: 60,
    ComparisonOperator: 'GreaterThanThreshold',
    TreatMissingData: 'notBreaching',
  });
  template.hasResourceProperties('AWS::CloudWatch::Alarm', {
    AlarmName: 'eco-ingesta-429-dia',
    Namespace: 'ECO/Ingesta',
    MetricName: 'Avisos429',
    Statistic: 'Sum',
    Period: 86400,
    Threshold: 10,
    ComparisonOperator: 'GreaterThanOrEqualToThreshold',
  });
});
