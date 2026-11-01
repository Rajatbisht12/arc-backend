"""Build-only request input shapes, without a client, credentials or network."""
import json
from awscli.botocore.session import Session
from awscli.botocore.validate import validate_parameters
session = Session()
for service, operation, value in [
    ('sts', 'GetCallerIdentity', {}),
    ('ecr', 'DescribeImages', {'repositoryName': 'arc-backend', 'imageIds': [{'imageTag': 'pi-all-user-session-api-r1-20261101'}]}),
    ('ecr', 'GetAuthorizationToken', {}),
]:
    validate_parameters(value, session.get_service_model(service).operation_model(operation).input_shape)
print(json.dumps({'models': 3, 'clientsCreated': 0, 'providerCalls': 0}))
