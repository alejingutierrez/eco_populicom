import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Template } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../lib/database-stack';

test('DatabaseStack creates RDS PostgreSQL instance', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };

  // Create a VPC stack in the same account/region as the database stack
  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const testVpc = new ec2.Vpc(vpcStack, 'Vpc');
  const testSg = new ec2.SecurityGroup(vpcStack, 'Sg', { vpc: testVpc });

  const stack = new DatabaseStack(app, 'TestDatabase', {
    env,
    vpc: testVpc,
    rdsSecurityGroup: testSg,
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::RDS::DBInstance', 1);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    Engine: 'postgres',
    DBInstanceClass: 'db.t4g.medium',
  });
});
