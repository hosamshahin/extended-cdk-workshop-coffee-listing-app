from __future__ import print_function
import logging
import uuid
import json

logger = logging.getLogger(__name__)

def on_event(event, ctx):
    print(json.dumps(event))
    if 'PhysicalResourceId' in event:
        return {
            'Data': {'uuid': event['PhysicalResourceId'].lower()}
        }
    uuid_str = str(uuid.uuid4())
    print('uuid_str')
    print(uuid_str)
    return {
        'Data': {'uuid': uuid_str}
    }