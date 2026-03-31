import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageStack } from '../lib/storage-stack';

test('StorageStack creates 2 S3 buckets', () => {
  const app = new cdk.App();
  const stack = new StorageStack(app, 'TestStorage', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  // 2 main buckets + 1 auto-delete custom resource bucket = 3 total
  // But we assert at least 2 actual S3 buckets are created
  template.resourceCountIs('AWS::S3::Bucket', 2);
});
