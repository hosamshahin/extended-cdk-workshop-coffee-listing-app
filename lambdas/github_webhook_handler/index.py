import os
import boto3
import logging
import json
import re
import uuid
import hashlib
import hmac

codecommit = boto3.client('codecommit')

logger = logging.getLogger()
logging.basicConfig()
logger.setLevel("DEBUG")

# override boto3 logging configuration
logging.getLogger('boto3').setLevel(logging.ERROR)
logging.getLogger('boto3').propagate = False
logging.getLogger('botocore').setLevel(logging.ERROR)
logging.getLogger('botocore').propagate = False

client = boto3.client('stepfunctions')
sar = boto3.client('serverlessrepo')
cfn = boto3.resource('cloudformation')

# pipeline_state_machine_arn = os.environ['SAAS_PIPELINE_STATE_MACHINE']
# app_id = os.environ['APP_ID']
# aws_account_id = os.environ.get('AWS_ACCOUNT_ID')
# aws_region = os.environ.get('AWS_REGION')
# repo_name = os.environ.get('REPO_NAME')
# repo_url = os.environ.get('REPO_URL')
# application_id = 'arn:aws:serverlessrepo:{}:{}:applications/serverless-saas'.format(aws_region, aws_account_id)
# repo_prefix = 'saas-solution-cdk-app/src'

def verify_signature(payload_body, secret_token, signature_header):
    """Verify that the payload was sent from GitHub by validating SHA256.

    Raise and return 403 if not authorized.

    Args:
        payload_body: original request body to verify (request.body())
        secret_token: GitHub app webhook token (WEBHOOK_SECRET)
        signature_header: header received from GitHub (x-hub-signature-256)
    """
    if not signature_header:
        raise Exception(status_code=403, detail="x-hub-signature-256 header is missing!")
    hash_object = hmac.new(secret_token.encode('utf-8'), msg=payload_body, digestmod=hashlib.sha256)
    expected_signature = "sha256=" + hash_object.hexdigest()
    if not hmac.compare_digest(expected_signature, signature_header):
        raise Exception(status_code=403, detail="Request signatures didn't match!")


def sanitize_branch_name(branch):
    return re.sub('[^0-9a-zA-Z]+', '-', branch)


def getLastCommitLog(repository, commitId):
    response = codecommit.get_commit(
        repositoryName=repository,
        commitId=commitId
    )
    return response['commit']


def getFileDifferences(repository_name, lastCommitID, previous_commit):
    response = None

    if previous_commit != None:
        response = codecommit.get_differences(
            repositoryName=repository_name,
            beforeCommitSpecifier=previous_commit,
            afterCommitSpecifier=lastCommitID
        )
    else:
        # The case of getting initial commit (Without beforeCommitSpecifier)
        response = codecommit.get_differences(
            repositoryName=repository_name,
            afterCommitSpecifier=lastCommitID
        )

    differences = []

    if response == None:
        return differences

    while "nextToken" in response:
        response = codecommit.get_differences(
            repositoryName=repository_name,
            beforeCommitSpecifier=previous_commit,
            afterCommitSpecifier=lastCommitID,
            nextToken=response["nextToken"]
        )
        differences += response.get("differences", [])
    else:
        differences += response["differences"]

    return differences


def getLastCommitID(repository, branch_name="main"):
    response = codecommit.get_branch(
        repositoryName=repository,
        branchName=branch_name
    )
    commitId = response['branch']['commitId']
    return commitId


def checkFileChanges(changed_file, stack_name, prefix):
    '''
    Checks if the changed file in any of Baseline or tenant stack file paths
    '''
    print('changed_file: {} stack_name: {} prefix: {}'.format(changed_file, stack_name, prefix))

    baseline_paths = [
        '/saas-baseline.ts',
        '/lambda/layer',
        '/lambda/custom_resources',
        '/lambda/authorizer',
        '/lambda/tenant_management_service']

    tenant_paths = [
        '/saas-serverless-app.ts',
        '/lambda/layer',
        '/lambda/custom_resources',
        '/lambda/product_service',
        '/lambda/order_service',
        '/statemachine/tenant-pipeline.asl.json']

    if stack_name == 'baseline':
        for path in baseline_paths:
            if changed_file.startswith('{}{}'.format(prefix, path)):
                return True
    elif stack_name == 'tenant':
        for path in tenant_paths:
            if changed_file.startswith('{}{}'.format(prefix, path)):
                return True
    return False


def handler_old(event, context):
    logger.info('event:{}'.format(json.dumps(event)))
    file_extension_allowed = [".pyo", ".npy", ".py", ".json", ".html", ".css", ".js", ".ts", ".sh"]
    fileNames_allowed = ["DockerFile", "Dockerfile"]
    build_admin = False
    build_client = False
    build_landing = False
    build_baseline = False
    build_tenant = False

    for record in event['Records']:
        for reference in record['codecommit']['references']:
            logger.info('reference:{}'.format(json.dumps(reference)))
            if reference['ref'].split('/')[1] == 'heads':
                commit_id = reference.get('commit')
                branch_raw = reference['ref'].split('/', 2)[-1]
                branch_name = sanitize_branch_name(branch_raw)
                short_commit = commit_id[0:8]
                uuid_init = str(uuid.uuid1())
                sf_execute_name = "-".join(['{0}-{1}'.format(app_id, branch_name), commit_id[0:5], uuid_init])

                if (commit_id == None) or (commit_id == '0000000000000000000000000000000000000000'):
                    commit_id = getLastCommitID(repo_name, branch_name)

                last_commit = getLastCommitLog(repo_name, commit_id)

                previous_commit = None
                if len(last_commit['parents']) > 0:
                    previous_commit = last_commit['parents'][0]

                print('lastCommitID: {0} previous_commit: {1}'.format(commit_id, previous_commit))

                differences = getFileDifferences(repo_name, commit_id, previous_commit)
                print(json.dumps(differences))

                for diff in differences:
                    path = diff.get('afterBlob').get('path') if diff.get('afterBlob')!= None else ""
                    root, extension = os.path.splitext(path)
                    fileName = os.path.basename(path)
                    if ((extension in file_extension_allowed) or (fileName in fileNames_allowed)):
                        if path.startswith('clients/Admin'):
                            build_admin = True
                        if path.startswith('clients/Application'):
                            build_client = True
                        if path.startswith('clients/Landing'):
                            build_landing = True
                        if checkFileChanges(path, 'baseline', repo_prefix):
                            build_baseline = True
                        if checkFileChanges(path, 'tenant', repo_prefix):
                            build_tenant = True

                response = {"commit_id": commit_id,
                            "branch_name": branch_name,
                            "app_id": '{0}-{1}'.format(app_id, branch_name),
                            "repo_name": repo_name,
                            "repo_url": repo_url,
                            "build_admin": build_admin,
                            "build_client": build_client,
                            "build_landing": build_landing,
                            "build_baseline": build_baseline,
                            "build_tenant": build_tenant,
                            "cdk_app_name": "saas-solution-cdk-app"}

                print(json.dumps(response, indent=4, sort_keys=True))

                if reference.get('created'):
                    response['action'] = "create"
                    response["build_admin"]= True
                    response["build_client"]= True
                    response["build_landing"]= True
                    response["build_baseline"]= True
                    response["build_tenant"]= True
                    logger.info('created new branch:{}'.format(branch_name))

                    client.start_execution(
                        stateMachineArn=pipeline_state_machine_arn,
                        name='create-{}'.format(sf_execute_name),
                        input= json.dumps(response))

                elif reference.get('deleted'):
                    logger.info('deleted old branch:{}'.format(branch_name))
                    response['action'] = "delete"
                    stacks = cfn.stacks.all()
                    sub_stacks = []
                    for stack in stacks:
                        for tag in stack.tags:
                            if tag.get('Key') == 'AppId' and tag.get('Value') == '{}-{}'.format(app_id, branch_name):
                                sub_stacks.append(stack.stack_name)

                    response['input'] = sub_stacks

                    client.start_execution(
                        stateMachineArn=pipeline_state_machine_arn,
                        name='delete-{}'.format(sf_execute_name),
                        input= json.dumps(response))

                else:
                    logger.info('update branch:{}'.format(branch_name))
                    response['action'] = "update"

                    client.start_execution(
                        stateMachineArn=pipeline_state_machine_arn,
                        name='update-{}'.format(sf_execute_name),
                        input= json.dumps(response))


def handler(event, context):
    logger.info('event:{}'.format(json.dumps(event)))
    return {'statusCode':200}
