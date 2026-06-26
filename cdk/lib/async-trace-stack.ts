import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

// ADOT Lambda layer for Python (us-east-1) — new recommended approach with Application Signals
// Verify latest version at: https://aws-otel.github.io/docs/getting-started/lambda
const ADOT_LAYER_ARN =
  'arn:aws:lambda:us-east-1:615299751070:layer:AWSOpenTelemetryDistroPython:28';

export class AsyncTraceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── DynamoDB ──────────────────────────────────────────────────────────────
    const eventsTable = new dynamodb.Table(this, 'WebhookEvents', {
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── SQS ───────────────────────────────────────────────────────────────────
    const dlq = new sqs.Queue(this, 'WebhookDLQ', {
      retentionPeriod: cdk.Duration.days(14),
    });

    const webhookQueue = new sqs.Queue(this, 'WebhookQueue', {
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // ── ADOT Lambda Layer ─────────────────────────────────────────────────────
    const adotLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'AdotLayer',
      ADOT_LAYER_ARN,
    );

    // ── Producer Lambda ───────────────────────────────────────────────────────
    // Receives Stripe webhook from API Gateway, injects traceparent into SQS message attributes
    const producer = new lambda.Function(this, 'ProducerLambda', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/producer')),
      layers: [adotLayer],
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(15),
      environment: {
        QUEUE_URL: webhookQueue.queueUrl,
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
        OTEL_SERVICE_NAME: 'webhook-producer',
        OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true',
        OTEL_PROPAGATORS: 'xray',
        OTEL_METRICS_EXPORTER: 'none',
      },
    });

    // ── Consumer Lambda ───────────────────────────────────────────────────────
    // Pulls from SQS, extracts traceparent per message, opens child span, writes to DynamoDB
    const consumer = new lambda.Function(this, 'ConsumerLambda', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambdas/consumer')),
      layers: [adotLayer],
      tracing: lambda.Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: eventsTable.tableName,
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
        OTEL_SERVICE_NAME: 'webhook-consumer',
        OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true',
        OTEL_PROPAGATORS: 'xray',
        OTEL_METRICS_EXPORTER: 'none',
      },
    });

    // ── Permissions ───────────────────────────────────────────────────────────
    webhookQueue.grantSendMessages(producer);
    webhookQueue.grantConsumeMessages(consumer);
    eventsTable.grantWriteData(consumer);

    // Application Signals requires this managed policy on the execution role —
    // Tracing.ACTIVE only grants X-Ray permissions, not Application Signals
    const appSignalsPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName(
      'CloudWatchLambdaApplicationSignalsExecutionRolePolicy',
    );
    producer.role?.addManagedPolicy(appSignalsPolicy);
    consumer.role?.addManagedPolicy(appSignalsPolicy);

    // ── SQS → Consumer trigger (batch of up to 10) ────────────────────────────
    consumer.addEventSource(
      new lambdaEventSources.SqsEventSource(webhookQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true,
      }),
    );

    // ── API Gateway ───────────────────────────────────────────────────────────
    // X-Ray tracing on API Gateway — zero code, traces start here
    const api = new apigw.RestApi(this, 'WebhookApi', {
      restApiName: 'async-trace-webhook-api',
      deployOptions: {
        tracingEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.ERROR,
      },
    });

    const webhookRoute = api.root.addResource('webhook');
    webhookRoute.addMethod('POST', new apigw.LambdaIntegration(producer));

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: `${api.url}webhook`,
      description: 'POST your test webhook payload here',
    });

    new cdk.CfnOutput(this, 'QueueUrl', {
      value: webhookQueue.queueUrl,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: eventsTable.tableName,
    });
  }
}
