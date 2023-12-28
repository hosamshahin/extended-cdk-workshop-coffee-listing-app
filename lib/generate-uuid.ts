import * as path from 'path';
import { CustomResource, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct, Node } from 'constructs';

export class GenerateUUID extends Construct {

  constructor(scope: Construct, id: string) {
    super(scope, id);

    new CustomResource(this, 'Resource', {
      serviceToken: generateUUIDProvider.getOrCreate(this),
      resourceType: 'Custom::GenerateUUIDProvider',
    });
  }
}

class generateUUIDProvider extends Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: Construct) {
    const providerId = 'GenerateUUIDProvider';
    const stack = Stack.of(scope);
    const group = Node.of(stack).tryFindChild(providerId) as generateUUIDProvider || new generateUUIDProvider(stack, providerId);
    return group.provider.serviceToken;
  }

  private readonly provider: cr.Provider;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const onEvent = new lambda.Function(this, 'GenerateUUIDFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambdas/utils')),
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'generate_uuid.on_event',
    });

    this.provider = new cr.Provider(this, 'uuid-provider', {
      onEventHandler: onEvent,
    });
  }
}
