import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fargateSecurityGroup: ec2.ISecurityGroup;
  albSecurityGroup: ec2.ISecurityGroup;
  dbSecret: rds.DatabaseSecret;
  userPoolId: string;
  userPoolClientId: string;
  rawBucket: s3.IBucket;
  exportsBucket: s3.IBucket;
}

export class ComputeStack extends cdk.Stack {
  public readonly ecsService: ecs.FargateService;
  public readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // ECR Repository
    const ecrRepo = new ecr.Repository(this, 'EcoWebRepo', {
      repositoryName: 'eco-web',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'EcoCluster', {
      clusterName: 'eco-cluster',
      vpc: props.vpc,
    });

    // Fargate Task Definition (ARM64/Graviton for cost savings)
    const taskDef = new ecs.FargateTaskDefinition(this, 'EcoWebTaskDef', {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // CloudWatch log group
    const logGroup = new logs.LogGroup(this, 'EcoWebLogGroup', {
      logGroupName: '/ecs/eco-web',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Shared secret for cron-triggered admin endpoints
    // (/api/admin/diagnostics, /api/admin/invited-users-cleanup). Without it
    // those endpoints return 403 and the diagnostics tool — the only
    // browser-accessible view into pipeline data quality — is silently
    // disabled. Managed outside this stack:
    //   aws secretsmanager create-secret --name eco/cron-secret \
    //     --secret-string "$(openssl rand -hex 32)"
    // We use the COMPLETE ARN (with the random suffix) because ECS passes
    // valueFrom as-is to Secrets Manager, and a partial ARN comes back as
    // ResourceNotFoundException at task-start time.
    const cronSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'CronSecret',
      'arn:aws:secretsmanager:us-east-1:863956448838:secret:eco/cron-secret-O69oRN',
    );

    // Container definition
    const container = taskDef.addContainer('eco-web', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../'), {
        file: 'apps/web/Dockerfile',
        buildArgs: {
          NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID ?? 'us-east-1_exuhIKYQ8',
          NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? '1t4v0kt8nn9nnmtet8t3l5g7u3',
        },
      }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NEXT_PUBLIC_COGNITO_USER_POOL_ID: props.userPoolId,
        NEXT_PUBLIC_COGNITO_CLIENT_ID: props.userPoolClientId,
        RAW_BUCKET: props.rawBucket.bucketName,
        EXPORTS_BUCKET: props.exportsBucket.bucketName,
      },
      secrets: {
        DB_SECRET: ecs.Secret.fromSecretsManager(props.dbSecret),
        ECO_CRON_SECRET: ecs.Secret.fromSecretsManager(cronSecret),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'eco-web',
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
    });

    // Grant permissions to task role
    props.dbSecret.grantRead(taskDef.taskRole);
    props.rawBucket.grantRead(taskDef.taskRole);
    props.exportsBucket.grantReadWrite(taskDef.taskRole);
    // Execution role needs explicit read on the imported cron secret so ECS
    // can fetch it before container start. fromSecretNameV2 generates a
    // wildcard ARN (?????-shaped) that AWS sometimes fails to match against
    // the task's resolved ARN, so use a broader explicit wildcard. Use
    // addToExecutionRolePolicy (not obtainExecutionRole().addToPrincipalPolicy)
    // so CFN orders the policy update before the service rolls — otherwise
    // tasks try to start before the new permission is in place.
    taskDef.addToExecutionRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
      resources: ['*'],  // narrow later once basic deploy works; ECS deployment circuit breaker is too noisy with partial-arn matching
    }));

    // Permite a la API /api/reports/send-test invocar la Lambda eco-weekly-report
    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [
        `arn:aws:lambda:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:function:eco-weekly-report`,
      ],
    }));

    // Fargate Service
    this.ecsService = new ecs.FargateService(this, 'EcoWebService', {
      serviceName: 'eco-web',
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.fargateSecurityGroup],
      assignPublicIp: false,
      circuitBreaker: { enable: true, rollback: true },
    });

    // Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'EcoAlb', {
      loadBalancerName: 'eco-alb',
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTP listener on port 80
    const listener = this.alb.addListener('HttpListener', {
      port: 80,
      open: false,
    });

    listener.addTargets('EcoWebTargets', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.ecsService],
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: '200',
      },
    });

    // Auto-scaling: 1-3 tasks at CPU 70%
    const scaling = this.ecsService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 3,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'ALB DNS Name',
    });

    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: ecrRepo.repositoryUri,
      description: 'ECR Repository URI',
    });
  }
}
