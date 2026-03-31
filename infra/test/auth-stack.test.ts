import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack';

test('AuthStack creates Cognito User Pool with 3 groups', () => {
  const app = new cdk.App();
  const stack = new AuthStack(app, 'TestAuth', {
    env: { account: '123456789', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::Cognito::UserPool', 1);
  template.resourceCountIs('AWS::Cognito::UserPoolGroup', 3);
  template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
});
