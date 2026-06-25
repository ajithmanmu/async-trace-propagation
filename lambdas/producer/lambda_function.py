import json
import os
import boto3
from opentelemetry import propagate, trace

sqs = boto3.client('sqs')
QUEUE_URL = os.environ['QUEUE_URL']
tracer = trace.get_tracer(__name__)


def handler(event, context):
    body = json.loads(event.get('body') or '{}')

    event_id = body.get('id', 'unknown')
    event_type = body.get('type', 'unknown')

    # Inject current trace context into carrier so it travels with the SQS message
    carrier = {}
    propagate.inject(carrier)

    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({
            'eventId': event_id,
            'type': event_type,
            'payload': body,
        }),
        MessageAttributes={
            'X-Amzn-Trace-Id': {
                'DataType': 'String',
                'StringValue': carrier.get('X-Amzn-Trace-Id', ''),
            },
        },
    )

    return {
        'statusCode': 200,
        'body': json.dumps({'received': True, 'eventId': event_id}),
    }
