#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { MessagingStack } from '../lib/messaging-stack';
// import { WorkersStack } from '../lib/workers-stack';   // not yet implemented
// import { ComputeStack } from '../lib/compute-stack';   // not yet implemented
// import { MonitoringStack } from '../lib/monitoring-stack'; // not yet implemented

const app = new cdk.App();
const env = { account: '863956448838', region: 'us-east-1' };

const network = new NetworkStack(app, 'EcoNetwork', { env });
const database = new DatabaseStack(app, 'EcoDatabase', { env, vpc: network.vpc, rdsSecurityGroup: network.rdsSecurityGroup });
const auth = new AuthStack(app, 'EcoAuth', { env });
const storage = new StorageStack(app, 'EcoStorage', { env });
const messaging = new MessagingStack(app, 'EcoMessaging', { env });
