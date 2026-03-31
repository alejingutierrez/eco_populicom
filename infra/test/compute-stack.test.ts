import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Template } from 'aws-cdk-lib/assertions';
import { ComputeStack } from '../lib/compute-stack';

test('ComputeStack creates ECS cluster, Fargate service, ALB, and ECR repo', () => {
  const app = new cdk.App();
  const env = { account: '123456789012', region: 'us-east-1' };

  const vpcStack = new cdk.Stack(app, 'VpcStack', { env });
  const vpc = new ec2.Vpc(vpcStack, 'Vpc');
  const fargateSg = new ec2.SecurityGroup(vpcStack, 'FargateSg', { vpc });
  const albSg = new ec2.SecurityGroup(vpcStack, 'AlbSg', { vpc });

  const storageStack = new cdk.Stack(app, 'StorageStack', { env });
  const rawBucket = new s3.Bucket(storageStack, 'RawBucket');
  const exportsBucket = new s3.Bucket(storageStack, 'ExportsBucket');

  const dbStack = new cdk.Stack(app, 'DbStack', { env });
  const dbSecret = new rds.DatabaseSecret(dbStack, 'DbSecret', { username: 'eco_admin' });

  const stack = new ComputeStack(app, 'TestCompute', {
    env,
    vpc,
    fargateSecurityGroup: fargateSg,
    albSecurityGroup: albSg,
    dbSecret,
    userPoolId: 'us-east-1_testPoolId',
    userPoolClientId: 'testClientId',
    rawBucket,
    exportsBucket,
  });

  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::ECS::Cluster', 1);
  template.resourceCountIs('AWS::ECS::Service', 1);
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  template.resourceCountIs('AWS::ECR::Repository', 1);
});
