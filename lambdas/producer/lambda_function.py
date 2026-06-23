import json
import os
import boto3

sqs = boto3.client('sqs')
QUEUE_URL = os.environ['QUEUE_URL']


def handler(event, context):
    body = json.loads(event.get('body') or '{}')

    event_id = body.get('id', 'unknown')
    event_type = body.get('type', 'unknown')

    sqs.send_message(
        QueueUrl=QUEUE_URL,
        MessageBody=json.dumps({
            'eventId': event_id,
            'type': event_type,
            'payload': body,
        }),
    )

    return {
        'statusCode': 200,
        'body': json.dumps({'received': True, 'eventId': event_id}),
    }
