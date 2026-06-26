import json
import os
import boto3
from opentelemetry import propagate, trace

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ['TABLE_NAME']
table = dynamodb.Table(TABLE_NAME)
tracer = trace.get_tracer(__name__)


def handler(event, context):
    records = event['Records']
    print(f"[batch] size={len(records)}")

    batch_item_failures = []

    for message in records:
        message_id = message['messageId']
        try:
            process_message(message)
        except Exception as e:
            print(f"Failed to process message {message_id}: {e}")
            batch_item_failures.append({'itemIdentifier': message_id})

    return {'batchItemFailures': batch_item_failures}


def process_message(message):
    carrier = {}
    attrs = message.get('messageAttributes', {})
    has_trace_context = 'X-Amzn-Trace-Id' in attrs

    if has_trace_context:
        carrier['X-Amzn-Trace-Id'] = attrs['X-Amzn-Trace-Id']['stringValue']
    else:
        print(f"[trace] no upstream context for message {message['messageId']} — starting fresh span")

    ctx = propagate.extract(carrier)

    with tracer.start_as_current_span('process-webhook', context=ctx) as span:
        try:
            body = json.loads(message['body'])
            event_id = body.get('eventId', 'unknown')
            event_type = body.get('type', 'unknown')

            span.set_attribute('webhook.event_id', event_id)
            span.set_attribute('webhook.type', event_type)
            span.set_attribute('trace.has_upstream_context', has_trace_context)

            print(f"[process] event_id={event_id} message_id={message['messageId']} has_context={has_trace_context}")

            table.put_item(Item={
                'eventId': event_id,
                'type': event_type,
                'payload': json.dumps(body.get('payload', {})),
            })
        except Exception as e:
            span.record_exception(e)
            span.set_status(trace.StatusCode.ERROR, str(e))
            raise
