"""Input models only. No client, credentials, endpoint or provider request."""
import json
from awscli.botocore.session import Session
from awscli.botocore.validate import validate_parameters

session = Session()
requests = [
    ('sts', 'GetCallerIdentity', {}),
    ('ecr', 'DescribeImages', {'repositoryName': 'arc-backend', 'imageIds': [{'imageTag': 'pi-worker-format-legacy-r1-20261101'}]}),
    ('ecr', 'GetAuthorizationToken', {}),
]
for service, operation, value in requests:
    validate_parameters(value, session.get_service_model(service).operation_model(operation).input_shape)
print(json.dumps({'inputModels': len(requests), 'providerCalls': 0, 'clientsCreated': 0, 'kind': 'OFFLINE_SHAPES_NOT_PERMISSION_OR_BUILD_QUALIFICATION'}))
