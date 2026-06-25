import json
import os
import boto3
from opentelemetry import propagate, trace

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']
table = dynamodb.Table(TABLE_NAME)
tracer = trace.get_tracer(__name__)


def handler(event, context):
    batch_item_failures = []

    for message in event['Records']:
        message_id = message['messageId']
        try:
            process_message(message)
        except Exception as e:
            print(f"Failed to process message {message_id}: {e}")
            batch_item_failures.append({'itemIdentifier': message_id})

    return {'batchItemFailures': batch_item_failures}


def process_message(message):
    # Extract traceparent from SQS message attributes — stitches the trace
    # back to the producer span across the async boundary
    carrier = {}
    attrs = message.get('messageAttributes', {})
    if 'X-Amzn-Trace-Id' in attrs:
        carrier['X-Amzn-Trace-Id'] = attrs['X-Amzn-Trace-Id']['stringValue']

    ctx = propagate.extract(carrier)

    with tracer.start_as_current_span('process-webhook', context=ctx) as span:
        body = json.loads(message['body'])
        event_id = body.get('eventId', 'unknown')
        event_type = body.get('type', 'unknown')

        span.set_attribute('webhook.event_id', event_id)
        span.set_attribute('webhook.type', event_type)

        table.put_item(Item={
            'eventId': event_id,
            'type': event_type,
            'payload': json.dumps(body.get('payload', {})),
        })
