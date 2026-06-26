# Async Trace Propagation

End-to-end distributed tracing across an async SQS boundary using AWS Distro for OpenTelemetry (ADOT) and CloudWatch Application Signals.

**Blog post:** [Async Tracing on AWS Lambda: Carrying Context Across SQS with OpenTelemetry](https://dev.to/ajithmanmu/async-tracing-on-aws-lambda-carrying-context-across-sqs-with-opentelemetry-595j)

---

## The Problem

SQS doesn't carry trace context. When a webhook flows through API Gateway → Lambda → SQS → Lambda → DynamoDB, the trace silently breaks at the queue. The consumer Lambda starts a disconnected trace — no link back to the upstream request, no way to debug end-to-end failures.

## What This Demonstrates

- **Async trace stitching** — producer injects `X-Amzn-Trace-Id` into SQS message attributes; consumer extracts it per message and opens a child span linked to the original trace
- **Batching** — a batch of N messages from N different producer traces, each correctly linked back to its own upstream via per-message context extraction
- **Graceful degradation** — messages without trace context (legacy producers, manual inserts) start a fresh root span without failing; `trace.has_upstream_context` attribute tracks coverage
- **Error reporting** — failed messages mark their span with `ERROR` status via `span.record_exception()` so Application Signals registers accurate error rates

## Architecture

```
API Gateway (X-Ray tracing enabled)
    ↓  HTTP POST /webhook
Lambda — webhook-producer  [ADOT layer]
    ↓  SQS SendMessage + X-Amzn-Trace-Id attribute
SQS Queue  ← async boundary
    ↓  batch trigger (up to 10 messages)
Lambda — webhook-consumer  [ADOT layer]
    ↓  per-message context extraction → child span → PutItem
DynamoDB
    ↓
CloudWatch Application Signals + X-Ray
```

## Stack

- **Infrastructure:** AWS CDK (TypeScript)
- **Lambda runtime:** Python 3.12
- **Instrumentation:** ADOT Lambda Layer (`AWSOpenTelemetryDistroPython`)
- **Trace backend:** AWS X-Ray
- **Observability:** CloudWatch Application Signals, Transaction Search
- **Key services:** API Gateway, Lambda, SQS, DynamoDB

## Project Structure

```
async-trace-propagation/
├── cdk/                  # CDK app — all infrastructure
│   ├── bin/
│   └── lib/              # Stack definition (Lambda, SQS, DynamoDB, API GW)
├── lambdas/
│   ├── producer/         # Receives webhook, injects trace context into SQS
│   └── consumer/         # Extracts trace context per message, writes to DynamoDB
└── scripts/              # Test scripts for triggering webhooks and batches
```

## Key Configuration

Both Lambdas require these environment variables:

```typescript
AWS_LAMBDA_EXEC_WRAPPER: '/opt/otel-instrument',
OTEL_SERVICE_NAME: 'webhook-producer',       // or webhook-consumer
OTEL_AWS_APPLICATION_SIGNALS_ENABLED: 'true',
OTEL_PROPAGATORS: 'xray',
OTEL_METRICS_EXPORTER: 'none',
```

And the Application Signals IAM policy (separate from `Tracing.ACTIVE`):

```typescript
const appSignalsPolicy = iam.ManagedPolicy.fromAwsManagedPolicyName(
  'CloudWatchLambdaApplicationSignalsExecutionRolePolicy',
);
producer.role?.addManagedPolicy(appSignalsPolicy);
consumer.role?.addManagedPolicy(appSignalsPolicy);
```

> Do not set `OTEL_TRACES_EXPORTER=xray` — it causes a cold start failure. The ADOT layer doesn't expose that entry point; Application Signals handles the export path internally.

## Deploy

```bash
cd cdk
npm install
npx cdk deploy
```
