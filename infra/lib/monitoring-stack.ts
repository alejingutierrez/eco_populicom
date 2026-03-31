import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
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

    // SNS Topic for ops alerts
    const alertsTopic = new sns.Topic(this, 'EcoAlertsOpsTopic', {
      topicName: 'eco-alerts-ops',
    });
    alertsTopic.addSubscription(
      new sns_subscriptions.EmailSubscription('agutierrez@populicom.com'),
    );

    const snsAction = new cloudwatch_actions.SnsAction(alertsTopic);

    // RDS CPU alarm > 80% (2 eval periods)
    const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      alarmName: 'eco-rds-cpu-high',
      metric: props.dbInstance.metricCPUUtilization({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'RDS CPU utilization exceeds 80%',
    });
    rdsCpuAlarm.addAlarmAction(snsAction);

    // Lambda error alarms > 5 (1 eval period) for each function
    const lambdaFunctions = [
      { fn: props.ingestionFunction, name: 'ingestion' },
      { fn: props.processorFunction, name: 'processor' },
      { fn: props.alertsFunction, name: 'alerts' },
    ];

    for (const { fn, name } of lambdaFunctions) {
      const errorAlarm = new cloudwatch.Alarm(this, `Lambda${name.charAt(0).toUpperCase() + name.slice(1)}ErrorAlarm`, {
        alarmName: `eco-lambda-${name}-errors`,
        metric: fn.metricErrors({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `Lambda eco-${name} errors exceed 5`,
      });
      errorAlarm.addAlarmAction(snsAction);
    }

    // DLQ message alarms > 0 (1 eval period)
    const dlqs = [
      { queue: props.ingestionDlq, name: 'ingestion' },
      { queue: props.alertsDlq, name: 'alerts' },
    ];

    for (const { queue, name } of dlqs) {
      const dlqAlarm = new cloudwatch.Alarm(this, `Dlq${name.charAt(0).toUpperCase() + name.slice(1)}Alarm`, {
        alarmName: `eco-dlq-${name}-messages`,
        metric: queue.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `DLQ eco-${name}-dlq has messages`,
      });
      dlqAlarm.addAlarmAction(snsAction);
    }

    // CloudWatch Dashboard
    new cloudwatch.Dashboard(this, 'EcoDashboard', {
      dashboardName: 'eco-dashboard',
      widgets: [
        // Row 1: RDS metrics
        [
          new cloudwatch.GraphWidget({
            title: 'RDS CPU Utilization',
            left: [props.dbInstance.metricCPUUtilization()],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'RDS Database Connections',
            left: [props.dbInstance.metricDatabaseConnections()],
            width: 12,
          }),
        ],
        // Row 2: Lambda invocations
        [
          new cloudwatch.GraphWidget({
            title: 'Lambda Invocations',
            left: [
              props.ingestionFunction.metricInvocations({ label: 'ingestion' }),
              props.processorFunction.metricInvocations({ label: 'processor' }),
              props.alertsFunction.metricInvocations({ label: 'alerts' }),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda Errors',
            left: [
              props.ingestionFunction.metricErrors({ label: 'ingestion' }),
              props.processorFunction.metricErrors({ label: 'processor' }),
              props.alertsFunction.metricErrors({ label: 'alerts' }),
            ],
            width: 12,
          }),
        ],
        // Row 3: SQS DLQ depth
        [
          new cloudwatch.GraphWidget({
            title: 'SQS DLQ Depth',
            left: [
              props.ingestionDlq.metricApproximateNumberOfMessagesVisible({ label: 'ingestion-dlq' }),
              props.alertsDlq.metricApproximateNumberOfMessagesVisible({ label: 'alerts-dlq' }),
            ],
            width: 24,
          }),
        ],
      ],
    });
  }
}
