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
import * as logs from 'aws-cdk-lib/aws-logs';
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
  public readonly weeklyReportFunction: NodejsFunction;
  public readonly aiTasksFunction: NodejsFunction;
  public readonly narrativeClusterFunction: NodejsFunction;
  public readonly narrativeEdgesFunction: NodejsFunction;
  public readonly narrativeDriftFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: WorkersStackProps) {
    super(scope, id, props);

    const privateSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    // Adopt the pre-existing CloudWatch Log Groups (auto-created by Lambda on
    // first invocation). Newer aws-cdk-lib defaults to creating its own
    // LogGroup resources per function, which clashes with the existing ones
    // and fails the deploy. Importing by name tells CDK to use them as-is.
    const importLogGroup = (id: string, fnName: string) =>
      logs.LogGroup.fromLogGroupName(this, id, `/aws/lambda/${fnName}`);

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
      logGroup: importLogGroup('IngestionLogGroup', 'eco-ingestion'),
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

    // Daily late-arrival refresh (backfill last 48h) — Brandwatch indexa algunas
    // menciones con retraso; este cron diario las recupera sin tocar el cursor.
    const lateArrivalRule = new events.Rule(this, 'LateArrivalRefresh', {
      schedule: events.Schedule.cron({ minute: '0', hour: '7' }),
      description: 'Daily backfill of last 48h to catch Brandwatch late-indexed mentions',
    });
    lateArrivalRule.addTarget(new targets.LambdaFunction(this.ingestionFunction, {
      event: events.RuleTargetInput.fromObject({ refreshLastHours: 48 }),
    }));

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
      logGroup: importLogGroup('ProcessorLogGroup', 'eco-processor'),
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
      logGroup: importLogGroup('AlertsLogGroup', 'eco-alerts'),
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
    // Además de los snapshots diarios, este lambda evalúa reglas
    // `crisis_threshold` en alert_rules: si el Crisis Score del día supera el
    // umbral configurado, genera un editorial con Bedrock y envía un correo
    // de alerta vía SES (mismo patrón individual-por-recipient que weekly-report).
    this.metricsCalculatorFunction = new NodejsFunction(this, 'MetricsCalculatorFunction', {
      functionName: 'eco-metrics-calculator',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/metrics-calculator/index.ts'),
      handler: 'handler',
      memorySize: 512,
      // Bumpeado a 2 min porque el path de crisis añade fetch de samples +
      // llamada a Bedrock + N envíos SES individuales. El path normal
      // (sin crisis) sigue terminando en < 10 s.
      timeout: cdk.Duration.minutes(2),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        BEDROCK_FALLBACK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        SES_FROM_EMAIL: 'agutierrez@populicom.com',
        SES_FROM_NAME: 'ECO Radar',
        DASHBOARD_BASE_URL: 'https://app.populicom.com',
      },
      logGroup: importLogGroup('MetricsCalcLogGroup', 'eco-metrics-calculator'),
      bundling: bundlingOptions,
    });

    // DB + Bedrock + SES — el path de detección de crisis necesita los tres.
    this.metricsCalculatorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));
    this.metricsCalculatorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    this.metricsCalculatorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
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

    // ---- eco-weekly-report Lambda ----
    this.weeklyReportFunction = new NodejsFunction(this, 'WeeklyReportFunction', {
      functionName: 'eco-weekly-report',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/weekly-report/index.ts'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        BEDROCK_FALLBACK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        SES_FROM_EMAIL: 'agutierrez@populicom.com',
        SES_FROM_NAME: 'ECO Radar',
        REPORT_RECIPIENTS: 'agutierrez@populicom.com',
        AGENCY_SLUG: 'ddecpr',
      },
      logGroup: importLogGroup('WeeklyReportLogGroup', 'eco-weekly-report'),
      bundling: bundlingOptions,
    });

    // IAM permissions
    this.weeklyReportFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    this.weeklyReportFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }));
    this.weeklyReportFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // EventBridge schedule: cada hora en punto (UTC).
    // La Lambda itera report_configs activos y envía solo a las agencias cuya
    // hora local (según su timezone) coincide con send_hour_local en ese momento.
    // Esto permite configurar hora y timezone por agencia desde el dashboard admin.
    const weeklyReportRule = new events.Rule(this, 'WeeklyReportSchedule', {
      ruleName: 'eco-weekly-report-hourly',
      schedule: events.Schedule.cron({ minute: '0' }),
      description: 'Scan horario — la Lambda compara hora local por agencia (report_configs) contra send_hour_local y envía si coincide.',
    });
    weeklyReportRule.addTarget(new targets.LambdaFunction(this.weeklyReportFunction));

    // ---- eco-ai-tasks Lambda ----
    // Lambda multi-acción para tareas IA del dashboard:
    //   - briefing (default scheduled): genera resumen ejecutivo IA del
    //     scorecard cada 6 horas para cada agencia activa.
    //   - topic-descriptions (manual): genera descripciones IA de tópicos
    //     bajo invocación, para llenar/refrescar topics.description.
    this.aiTasksFunction = new NodejsFunction(this, 'AiTasksFunction', {
      functionName: 'eco-ai-tasks',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/ai-tasks/index.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        BEDROCK_FALLBACK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
      },
      logGroup: importLogGroup('AiTasksLogGroup', 'eco-ai-tasks'),
      bundling: bundlingOptions,
    });

    this.aiTasksFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    this.aiTasksFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // EventBridge schedule — briefing ejecutivo 4×/día (00, 06, 12, 18 hora AST
    // = 04, 10, 16, 22 UTC). El lambda sin payload corre la acción 'briefing'.
    const briefingRule = new events.Rule(this, 'AiTasksBriefingSchedule', {
      ruleName: 'eco-ai-tasks-briefing',
      schedule: events.Schedule.cron({ minute: '0', hour: '4,10,16,22' }),
      description: 'Briefing ejecutivo IA del scorecard, 4×/día (00, 06, 12, 18 AST).',
    });
    briefingRule.addTarget(new targets.LambdaFunction(this.aiTasksFunction));

    // ---- eco-narrative-cluster Lambda ----
    // Feature de narrativas (clusters emergentes de menciones). Cada hora:
    //   1. Asigna menciones nuevas (con embedding) a la narrativa más cercana
    //      por coseno (≥0.78) usando pgvector + EWMA update del centroide.
    //   2. Acumula no-matches en `narrative_candidates` y aplica DBSCAN; cada
    //      cluster denso de ≥10 menciones spawnea una narrativa nueva, nombrada
    //      con Bedrock Claude (tool-use).
    //   3. Recalcula lifecycle states (emerging/active/peaking/declining/dormant/revived).
    //   4. Calcula iniciadores (primero cronológico ya en INSERT; influencer
    //      después de 24h con mayor reach × engagement).
    // Memoria 2048 MB: el DBSCAN sobre el pool de candidatos (potencialmente
    // varios cientos de embeddings de 1024 dims) corre en JS.
    this.narrativeClusterFunction = new NodejsFunction(this, 'NarrativeClusterFunction', {
      functionName: 'eco-narrative-cluster',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/narrative-cluster/index.ts'),
      handler: 'handler',
      memorySize: 2048,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        BEDROCK_FALLBACK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        // Tunables (defaults sensatos en el código si faltan)
        NARRATIVE_THRESHOLD: '0.78',
        NARRATIVE_EWMA_ALPHA: '0.05',
        NARRATIVE_MIN_MENTIONS_BIRTH: '10',
        NARRATIVE_DBSCAN_EPS: '0.22',
        NARRATIVE_TOP_N_MATCHES: '3',
        NARRATIVE_INFLUENCE_WINDOW_HOURS: '24',
        NARRATIVE_PER_AGENCY_LIMIT: '5000',
        NARRATIVE_MAX_NEW_PER_RUN: '20',
      },
      logGroup: new logs.LogGroup(this, 'NarrativeClusterLogGroup', {
        logGroupName: '/aws/lambda/eco-narrative-cluster',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }),
      bundling: bundlingOptions,
    });

    this.narrativeClusterFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    this.narrativeClusterFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    // Cron horario en minuto 15 — corre 15 min después del weekly-report
    // (que está en minuto 0). Da margen para que ingestion + processor de la
    // hora previa terminen de poblar embeddings antes de cluster.
    const narrativeClusterRule = new events.Rule(this, 'NarrativeClusterSchedule', {
      ruleName: 'eco-narrative-cluster-hourly',
      schedule: events.Schedule.cron({ minute: '15' }),
      description: 'Clustering de menciones nuevas en narrativas: asigna a centroides existentes, spawnea con DBSCAN, recalcula lifecycle.',
    });
    narrativeClusterRule.addTarget(new targets.LambdaFunction(this.narrativeClusterFunction));

    // ---- eco-narrative-edges Lambda ----
    // Diariamente recalcula conexiones entre narrativas (co_occurrence,
    // author_overlap, semantic). Truncate + reinsert por agencia — idempotente.
    // No usa Bedrock; solo SQL agregaciones.
    this.narrativeEdgesFunction = new NodejsFunction(this, 'NarrativeEdgesFunction', {
      functionName: 'eco-narrative-edges',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/narrative-edges/index.ts'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        NARRATIVE_EDGE_MIN_STRENGTH: '0.15',
        NARRATIVE_SEMANTIC_THRESHOLD: '0.6',
        NARRATIVE_CO_OCCURRENCE_MIN_SHARED: '5',
        NARRATIVE_AUTHOR_OVERLAP_MIN_SHARED: '3',
      },
      logGroup: new logs.LogGroup(this, 'NarrativeEdgesLogGroup', {
        logGroupName: '/aws/lambda/eco-narrative-edges',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }),
      bundling: bundlingOptions,
    });

    this.narrativeEdgesFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    const narrativeEdgesRule = new events.Rule(this, 'NarrativeEdgesSchedule', {
      ruleName: 'eco-narrative-edges-daily',
      schedule: events.Schedule.cron({ minute: '0', hour: '6' }),
      description: 'Recalcula edges entre narrativas (diario, 6am UTC = 2am AST).',
    });
    narrativeEdgesRule.addTarget(new targets.LambdaFunction(this.narrativeEdgesFunction));

    // ---- eco-narrative-drift Lambda ----
    // Semanalmente detecta drift de centroides y re-namea narrativas cuyo eje
    // ha derivado >25% desde el último naming. Usa Bedrock Claude (tool-use)
    // para el re-naming. Cap MAX_RENAMES_PER_RUN evita un blast si muchas
    // narrativas derivan a la vez.
    this.narrativeDriftFunction = new NodejsFunction(this, 'NarrativeDriftFunction', {
      functionName: 'eco-narrative-drift',
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, '../lambda/narrative-drift/index.ts'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      securityGroups: [props.lambdaSecurityGroup],
      environment: {
        DB_SECRET_ARN: props.dbSecret.secretArn,
        BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
        BEDROCK_FALLBACK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        NARRATIVE_DRIFT_THRESHOLD: '0.25',
        NARRATIVE_MAX_RENAMES_PER_RUN: '15',
      },
      logGroup: new logs.LogGroup(this, 'NarrativeDriftLogGroup', {
        logGroupName: '/aws/lambda/eco-narrative-drift',
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      }),
      bundling: bundlingOptions,
    });

    this.narrativeDriftFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
    this.narrativeDriftFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: [props.dbSecret.secretArn],
    }));

    const narrativeDriftRule = new events.Rule(this, 'NarrativeDriftSchedule', {
      ruleName: 'eco-narrative-drift-weekly',
      schedule: events.Schedule.cron({ minute: '0', hour: '8', weekDay: 'MON' }),
      description: 'Detecta drift de centroides y re-namea (semanal, lunes 8am UTC = 4am AST).',
    });
    narrativeDriftRule.addTarget(new targets.LambdaFunction(this.narrativeDriftFunction));
  }
}
