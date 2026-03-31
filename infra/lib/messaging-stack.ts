import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class MessagingStack extends cdk.Stack {
  public readonly ingestionQueue: sqs.Queue;
  public readonly ingestionDlq: sqs.Queue;
  public readonly alertsQueue: sqs.Queue;
  public readonly alertsDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Ingestion DLQ
    this.ingestionDlq = new sqs.Queue(this, 'IngestionDlq', {
      queueName: 'eco-ingestion-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Ingestion Queue with DLQ
    this.ingestionQueue = new sqs.Queue(this, 'IngestionQueue', {
      queueName: 'eco-ingestion',
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.ingestionDlq,
        maxReceiveCount: 3,
      },
    });

    // Alerts DLQ
    this.alertsDlq = new sqs.Queue(this, 'AlertsDlq', {
      queueName: 'eco-alerts-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Alerts Queue with DLQ
    this.alertsQueue = new sqs.Queue(this, 'AlertsQueue', {
      queueName: 'eco-alerts',
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: this.alertsDlq,
        maxReceiveCount: 3,
      },
    });
  }
}
