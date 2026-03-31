import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MessagingStack } from '../lib/messaging-stack';

test('MessagingStack creates 2 queues with DLQs', () => {
  const app = new cdk.App();
  const stack = new MessagingStack(app, 'TestMessaging', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SQS::Queue', 4);
});
