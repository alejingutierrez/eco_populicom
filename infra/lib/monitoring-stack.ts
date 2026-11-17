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

    // ---- Salud de la ingesta (ING-01) ----
    // eco-ingestion responde 200 aunque el cortacircuitos aborte o fallen
    // todas las queries, así que Invocations/Errors no dicen si trae datos.
    // Estas alarmas miran las métricas que el propio lambda publica por EMF al
    // cierre de cada corrida (infra/lambda/ingestion/run-metrics.ts), en su
    // versión sin dimensiones: cualquier modo de corrida cuenta.
    const ingestaMetric = (metricName: string, statistic: string, period: cdk.Duration) =>
      new cloudwatch.Metric({ namespace: 'ECO/Ingesta', metricName, statistic, period });

    // Ninguna query completó su sondeo en 11 min: el lambda no corre, aborta
    // todo o no llega a la base.
    //
    // Por qué FILL y periodos de 1 min: la primera versión (2 periodos de 5 min
    // con «sin datos = fallo») tardó 19.6 min en el simulacro del 13-nov. Con
    // datos FALTANTES CloudWatch no evalúa solo los últimos periodos: espera a
    // que todo su rango de evaluación (más ancho) esté vacío. FILL(m, 0)
    // convierte el hueco en ceros, así la alarma ve datos y evalúa a tiempo.
    // 11 minutos seguidos en cero toleran una corrida saltada (el cron es cada
    // 5 min: una saltada deja 9–10 min sin dato) y avisan a los ~12–13 min de
    // la última corrida buena.
    const ingestaCallada = new cloudwatch.Alarm(this, 'IngestaCalladaAlarm', {
      alarmName: 'eco-ingesta-callada',
      metric: new cloudwatch.MathExpression({
        expression: 'FILL(sondeadas, 0)',
        usingMetrics: { sondeadas: ingestaMetric('QueriesSondeadas', 'Sum', cdk.Duration.minutes(1)) },
        period: cdk.Duration.minutes(1),
        label: 'Queries sondeadas por minuto (0 si no hubo corrida)',
      }),
      threshold: 1,
      evaluationPeriods: 11,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription:
        'eco-ingestion: ninguna query completó su sondeo en 11 min (no corre, aborta todo o no llega a la base)',
    });
    ingestaCallada.addAlarmAction(snsAction);

    // El lambda corre, pero alguna query lleva más de 1 h sin sondearse (el
    // caso del 24–26-oct: DDEC entraba y DF/Gobernadora nunca llegaban).
    const ingestaQueryDesatendida = new cloudwatch.Alarm(this, 'IngestaQueryDesatendidaAlarm', {
      alarmName: 'eco-ingesta-query-desatendida',
      metric: ingestaMetric('MinutosSinSondeoMax', 'Maximum', cdk.Duration.minutes(5)),
      threshold: 60,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'eco-ingestion: alguna query activa lleva más de 60 min sin un sondeo completado',
    });
    ingestaQueryDesatendida.addAlarmAction(snsAction);

    // 10 o más respuestas 429 en un día: la cuota compartida con BrandIQ está
    // apretada aunque la ingesta siga entrando.
    const ingesta429 = new cloudwatch.Alarm(this, 'Ingesta429DiaAlarm', {
      alarmName: 'eco-ingesta-429-dia',
      metric: ingestaMetric('Avisos429', 'Sum', cdk.Duration.days(1)),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'eco-ingestion: 10 o más respuestas 429 de Brandwatch en 24 h',
    });
    ingesta429.addAlarmAction(snsAction);

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
