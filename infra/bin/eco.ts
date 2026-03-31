#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { MessagingStack } from '../lib/messaging-stack';
import { WorkersStack } from '../lib/workers-stack';
import { ComputeStack } from '../lib/compute-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();
const env = { account: '863956448838', region: 'us-east-1' };

const network = new NetworkStack(app, 'EcoNetwork', { env });
const database = new DatabaseStack(app, 'EcoDatabase', { env, vpc: network.vpc, rdsSecurityGroup: network.rdsSecurityGroup });
const auth = new AuthStack(app, 'EcoAuth', { env });
const storage = new StorageStack(app, 'EcoStorage', { env });
const messaging = new MessagingStack(app, 'EcoMessaging', { env });

const workers = new WorkersStack(app, 'EcoWorkers', {
  env,
  vpc: network.vpc,
  lambdaSecurityGroup: network.lambdaSecurityGroup,
  dbSecret: database.dbSecret,
  rawBucket: storage.rawBucket,
  ingestionQueue: messaging.ingestionQueue,
  alertsQueue: messaging.alertsQueue,
});

const compute = new ComputeStack(app, 'EcoCompute', {
  env,
  vpc: network.vpc,
  fargateSecurityGroup: network.fargateSecurityGroup,
  albSecurityGroup: network.albSecurityGroup,
  dbSecret: database.dbSecret,
  userPoolId: auth.userPoolId,
  userPoolClientId: auth.userPoolClientId,
  rawBucket: storage.rawBucket,
  exportsBucket: storage.exportsBucket,
});

new MonitoringStack(app, 'EcoMonitoring', {
  env,
  dbInstance: database.dbInstance,
  ingestionFunction: workers.ingestionFunction,
  processorFunction: workers.processorFunction,
  alertsFunction: workers.alertsFunction,
  ingestionDlq: messaging.ingestionDlq,
  alertsDlq: messaging.alertsDlq,
  ecsService: compute.ecsService,
  alb: compute.alb,
});
