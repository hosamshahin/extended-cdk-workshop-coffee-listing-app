import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { RestApiStack } from "./rest-api-stack";
import { WebsiteHostingStack } from "./website-hosting-stack";
import * as pipelines from "aws-cdk-lib/pipelines";
import * as iam from "aws-cdk-lib/aws-iam";
import { GithubWebhook } from '@cloudcomponents/cdk-github-webhook';
import { SecretKey } from '@cloudcomponents/cdk-secret-key';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as python from '@aws-cdk/aws-lambda-python-alpha';
import { GenerateUUID } from './generate-uuid';

export class CoffeeListingAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const webhookSecret = new GenerateUUID(this, 'ApiKeyOperationUsersUUID').node.defaultChild as cdk.CustomResource;
    const webhookSecretValue = webhookSecret.getAtt('uuid').toString();
    new cdk.CfnOutput(this, 'webhookSecretOutput',
      {
        exportName: `webhookSecret`,
        value: webhookSecretValue
      }
    );

    let appStage = new AppStage(this, "AppStage", { stackName: this.stackName });
    let secretValue: cdk.SecretValue = cdk.SecretValue.secretsManager('lambda_container_cdk_pipeline_github')
    let secret: sm.ISecret = sm.Secret.fromSecretCompleteArn(this, 'secret', 'arn:aws:secretsmanager:us-east-1:114752328202:secret:lambda_container_cdk_pipeline_github-VH6KT0')

    let pipeline = new pipelines.CodePipeline(this, "Pipeline", {
      pipelineName: `Pipeline-${this.stackName}`,
      selfMutation: false,
      publishAssetsInParallel: false,
      synth: new pipelines.ShellStep("Synth", {
        input: pipelines.CodePipelineSource.gitHub('hosamshahin/extended-cdk-workshop-coffee-listing-app', 'main', {
          authentication: secretValue
        }),
        installCommands: ["npm i -g npm@9.9.2"],
        commands: ["npm ci", "npm run build", "npx cdk synth"],
      }),
      codeBuildDefaults: {
        rolePolicy: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["s3:*"],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["cloudfront:*"],
            resources: ["*"],
          }),
        ],
      },
    });

    pipeline.addStage(appStage, {
      post: [
        new pipelines.ShellStep("DeployFrontEnd", {
          envFromCfnOutputs: {
            SNOWPACK_PUBLIC_CLOUDFRONT_URL: appStage.cfnOutCloudFrontUrl,
            SNOWPACK_PUBLIC_API_IMAGES_URL: appStage.cfnOutApiImagesUrl,
            BUCKET_NAME: appStage.cfnOutBucketName,
            DISTRIBUTION_ID: appStage.cfnOutDistributionId,
            SNOWPACK_PUBLIC_API_LIKES_URL: appStage.cfnOutApiLikesUrl
          },
          commands: [
            "cd frontend",
            "npm ci",
            "npm run build",
            "aws s3 cp ./src/build s3://$BUCKET_NAME/frontend --recursive",
            `aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"`,
          ],
        }),
      ],
    });

    const myFunctionPy = new python.PythonFunction(this, 'myFunctionPy', {
      entry: 'lambdas/github_webhook_handler',
      runtime: lambda.Runtime.PYTHON_3_9,
      index: 'index.py',
      // role: stepFunctionInvokerExecutionRole,
      tracing: lambda.Tracing.ACTIVE,
    });


    // lambda function
    // let myFunction = new lambdaNodeJs.NodejsFunction(this, "myFunction", {
    //   entry: require.resolve("../lambdas/github-webhook"),
    //   environment: {
    //     WEBHOOK_SECRET: webhookSecretValue
    //   }
    // });

    const myFunctionUrl = myFunctionPy.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
      }
    });

    new GithubWebhook(this, 'GithubWebhook', {
      githubApiToken: SecretKey.fromSecretsManager(secret),
      githubRepoUrl: 'https://github.com/hosamshahin/extended-cdk-workshop-coffee-listing-app',
      payloadUrl: myFunctionUrl.url,
      events: ['*'],
      logLevel: 'debug',
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: myFunctionUrl.url,
    });

  }
}

interface AppStageProps extends cdk.StageProps {
  stackName: string;
}

class AppStage extends cdk.Stage {
  public readonly cfnOutApiImagesUrl: cdk.CfnOutput;
  public readonly cfnOutCloudFrontUrl: cdk.CfnOutput;
  public readonly cfnOutBucketName: cdk.CfnOutput;
  public readonly cfnOutDistributionId: cdk.CfnOutput;
  public readonly cfnOutApiLikesUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);
    let websiteHosting = new WebsiteHostingStack(this, "WebsiteHostingStack", {
      stackName: `WebsiteHostingStack-${props.stackName}`,
    });
    let restApi = new RestApiStack(this, "RestApiStack", {
      stackName: `RestApiStack-${props.stackName}`,
      bucket: websiteHosting.bucket,
      distribution: websiteHosting.distribution,
    });

    this.cfnOutApiImagesUrl = restApi.cfnOutApiImagesUrl;
    this.cfnOutCloudFrontUrl = websiteHosting.cfnOutCloudFrontUrl;
    this.cfnOutBucketName = websiteHosting.cfnOutBucketName;
    this.cfnOutDistributionId = websiteHosting.cfnOutDistributionId;
    this.cfnOutApiLikesUrl = restApi.cfnOutApiLikesUrl;
  }
}