# Async Trace Propagation

End-to-end distributed tracing across an async SQS boundary using ADOT and CloudWatch Application Signals.

## Problem

When a Stripe webhook flows through API Gateway → Lambda → SQS → Lambda → DynamoDB, the trace silently breaks at the SQS boundary. The consumer Lambda starts a brand-new disconnected trace, making it impossible to debug end-to-end failures.

## What This Project Demonstrates

1. **The break** — unpatched flow where consumer trace is disconnected in Application Signals
2. **The fix** — W3C `traceparent` injected into SQS message attributes on the producer, extracted per-message on the consumer
3. **The batching paradox** — a batch of N messages from N different webhooks, each linked back to its own upstream trace via per-message child spans

## Architecture

```
Stripe Webhook
    ↓
API Gateway (X-Ray tracing — zero config)
    ↓
Lambda — Producer  [ADOT layer]
    ↓  (injects traceparent + stripe_event_id into message attributes)
SQS Queue
    ↓  ← async boundary
Lambda — Consumer  [ADOT layer]
    ↓  (extracts context per message, opens child span per message)
DynamoDB
    ↓
X-Ray → CloudWatch Application Signals
```

## Stack

- **Infrastructure:** AWS CDK (Node.js)
- **Lambda runtime:** TBD
- **Instrumentation:** ADOT Lambda Layer
- **Trace backend:** AWS X-Ray
- **Dashboard:** CloudWatch Application Signals
- **Key services:** API Gateway, Lambda, SQS, DynamoDB

> Do not use the X-Ray SDK — maintenance mode as of Feb 2026. All instrumentation via ADOT.

## Project Structure

```
async-trace-propagation/
├── cdk/                  # CDK app — all infrastructure
│   ├── bin/              # CDK entry point
│   └── lib/              # Stack definition
├── lambdas/
│   ├── producer/         # Webhook receiver — injects trace context into SQS
│   └── consumer/         # SQS consumer — extracts context, writes to DynamoDB
├── scripts/              # Local test scripts
├── blog-post.md          # dev.to draft
└── README.md
```

## Sessions

| Session | Goal |
|---------|------|
| 1–2 | CDK setup — all infrastructure provisioned |
| 3–4 | Show broken trace (before) |
| 5–6 | Fix — inject + extract traceparent |
| 7–8 | Batching paradox — per-message child spans |
| 9–10 | Screenshots, README polish, blog post draft |
