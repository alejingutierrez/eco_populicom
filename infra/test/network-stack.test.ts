import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack';

test('NetworkStack creates VPC with 2 AZs and NAT Gateway', () => {
  const app = new cdk.App();
  const stack = new NetworkStack(app, 'TestNetwork', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::EC2::VPC', 1);
  template.resourceCountIs('AWS::EC2::NatGateway', 1);
  template.resourceCountIs('AWS::EC2::SecurityGroup', 4);
});
