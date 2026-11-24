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

/** Nombre completo del balanceador de la web (dimensión `LoadBalancer` de CloudWatch). */
const ECO_ALB_FULL_NAME = 'app/eco-alb/95764472687f6b7d';

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

    // El lambda corre, pero alguna query lleva más de 15 min sin sondearse (el
    // caso del 24–26-oct: DDEC entraba y DF/Gobernadora nunca llegaban).
    //
    // Este es el aviso INMEDIATO de «una agencia dejó de recibir» (OPS-04): no
    // espera a que falten menciones, mira si el sondeo de su query se completó,
    // y eso vale igual de madrugada. Era 60 min; del 19 al 24-nov (1,369
    // lecturas) lo normal fue 5 min y el máximo 10, así que 15 avisa en la
    // tercera corrida fallida sin ruido. `eco-agencia-sin-menciones` queda
    // como red para lo que esto no ve: el sondeo responde bien pero vacío.
    const ingestaQueryDesatendida = new cloudwatch.Alarm(this, 'IngestaQueryDesatendidaAlarm', {
      alarmName: 'eco-ingesta-query-desatendida',
      metric: ingestaMetric('MinutosSinSondeoMax', 'Maximum', cdk.Duration.minutes(5)),
      threshold: 15,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'eco-ingestion: alguna query activa lleva más de 15 min sin un sondeo completado',
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

    // ---- Errores del resto de procesos (OPS-04) ----
    // Hasta nov-2026 solo ingesta, processor y alerts tenían alarma de
    // errores. Estos nueve se referencian por NOMBRE, no por objeto: así el
    // stack de monitoreo no importa nada nuevo de EcoWorkers y se despliega
    // solo. Umbral: un error en una hora. En los 14 días previos al 24-nov
    // ninguno tuvo errores salvo eco-migration, que es una herramienta manual
    // (una consulta mal escrita cuenta como error) y por eso tolera 10.
    const otrosProcesos: Array<{ name: string; errores: number }> = [
      { name: 'metrics-calculator', errores: 1 },
      { name: 'weekly-report', errores: 1 },
      { name: 'ai-tasks', errores: 1 },
      { name: 'article-fetch', errores: 1 },
      { name: 'mention-import', errores: 1 },
      { name: 'narrative-cluster', errores: 1 },
      { name: 'narrative-drift', errores: 1 },
      { name: 'narrative-edges', errores: 1 },
      { name: 'migration', errores: 10 },
    ];
    for (const { name, errores } of otrosProcesos) {
      const id = name.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
      const alarm = new cloudwatch.Alarm(this, `Lambda${id}ErrorAlarm`, {
        alarmName: `eco-lambda-${name}-errors`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: { FunctionName: `eco-${name}` },
          statistic: 'Sum',
          period: cdk.Duration.hours(1),
        }),
        threshold: errores,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `eco-${name}: ${errores === 1 ? 'al menos un error' : `${errores} o más errores`} en una hora`,
      });
      alarm.addAlarmAction(snsAction);
    }

    // ---- Salud de los datos (OPS-04) ----
    // eco-metrics-calculator publica por EMF, al cierre de cada corrida de 5
    // minutos, cuántos snapshots de hoy calculó y cuántas agencias llevan
    // demasiado sin menciones (packages/shared/src/ops/freshness.ts).
    const datosMetric = (metricName: string, statistic: string) =>
      new cloudwatch.Metric({ namespace: 'ECO/Datos', metricName, statistic, period: cdk.Duration.minutes(5) });

    // Las métricas del día no se están calculando: 20 minutos sin un solo
    // snapshot. Vale a cualquier hora, así que cubre «faltan las métricas del
    // día a las 10:00 UTC» (la hora del correo diario) y también el resto del
    // día. FILL por la misma razón que en la ingesta callada: sin datos,
    // CloudWatch tarda mucho más en evaluar.
    const metricasDelDia = new cloudwatch.Alarm(this, 'MetricasDelDiaAlarm', {
      alarmName: 'eco-metricas-del-dia',
      metric: new cloudwatch.MathExpression({
        expression: 'FILL(calculados, 0)',
        usingMetrics: { calculados: datosMetric('SnapshotsCalculados', 'Sum') },
        period: cdk.Duration.minutes(5),
        label: 'Snapshots de hoy calculados (0 si no hubo corrida)',
      }),
      threshold: 1,
      evaluationPeriods: 4,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: 'eco-metrics-calculator: 20 min sin calcular las métricas del día de ninguna agencia',
    });
    metricasDelDia.addAlarmAction(snsAction);

    // Una agencia activa lleva más de 4 horas hábiles sin recibir menciones
    // (la madrugada no cuenta y el fin de semana cuenta la mitad). Dos
    // lecturas seguidas para no avisar por una corrida aislada. El correo no
    // nombra la agencia: está en el log del lambda («[salud] <agencia> lleva…»)
    // y en la métrica MinutosHabilesSinMenciones por agencia.
    const agenciaSinMenciones = new cloudwatch.Alarm(this, 'AgenciaSinMencionesAlarm', {
      alarmName: 'eco-agencia-sin-menciones',
      metric: datosMetric('AgenciasCalladas', 'Maximum'),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        'Alguna agencia activa lleva más de 4 horas hábiles sin menciones nuevas. Cuál: log de eco-metrics-calculator, líneas «[salud]»',
    });
    agenciaSinMenciones.addAlarmAction(snsAction);

    // ---- Pantallas (OPS-04) ----
    // El balanceador va por su nombre completo, no por `props.alb`: usar el
    // objeto obliga a EcoCompute a exportar un valor nuevo, y EcoCompute no se
    // despliega por CDK (el primer intento, 24-nov, falló con «No export named
    // EcoCompute:…LoadBalancerFullName» y revirtió limpio). Si el balanceador
    // se recrea, este nombre cambia: `aws elbv2 describe-load-balancers`.
    const albMetric = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName,
        dimensionsMap: { LoadBalancer: ECO_ALB_FULL_NAME },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });

    // Respuestas 5xx de la aplicación web: 10 o más en 5 minutos.
    const web5xx = new cloudwatch.Alarm(this, 'Web5xxAlarm', {
      alarmName: 'eco-web-5xx',
      metric: albMetric('HTTPCode_Target_5XX_Count'),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Web de ECO: 10 o más respuestas 5xx en 5 minutos',
    });
    web5xx.addAlarmAction(snsAction);

    // El balanceador responde 5xx por su cuenta: no hay instancia sana detrás.
    const webBalanceador5xx = new cloudwatch.Alarm(this, 'WebBalanceador5xxAlarm', {
      alarmName: 'eco-web-5xx-balanceador',
      metric: albMetric('HTTPCode_ELB_5XX_Count'),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Web de ECO: el balanceador devolvió 10 o más 5xx en 5 minutos (sin instancia sana detrás)',
    });
    webBalanceador5xx.addAlarmAction(snsAction);

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
