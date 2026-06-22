#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AsyncTraceStack } from '../lib/async-trace-stack';

const app = new cdk.App();
new AsyncTraceStack(app, 'AsyncTraceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
