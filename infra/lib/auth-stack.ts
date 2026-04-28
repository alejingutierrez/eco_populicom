import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'EcoUserPool', {
      userPoolName: 'eco-users',
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        requireLowercase: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      selfSignUpEnabled: true,
      // Routes the dashboard to the right tenant per-user. Without this the
      // JWT lacks `custom:agency_slug`, the API falls back to the default
      // agency, and different widgets can show different tenants — exactly
      // the bug seen on 2026-04-27 (chart aaa, drilldown ddecpr). Mutable
      // so an admin can move users between agencies without recreating the
      // account. Already added to the deployed pool via add-custom-attributes
      // on 2026-04-27; this declaration just makes future deploys idempotent.
      customAttributes: {
        agency_slug: new cognito.StringAttribute({ minLen: 1, maxLen: 50, mutable: true }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // User groups
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrator group',
    });

    new cognito.CfnUserPoolGroup(this, 'AnalystGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'analyst',
      description: 'Analyst group',
    });

    new cognito.CfnUserPoolGroup(this, 'ViewerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'viewer',
      description: 'Viewer group',
    });

    // App client — SRP auth, no secret
    this.userPoolClient = new cognito.UserPoolClient(this, 'EcoUserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;
  }
}
