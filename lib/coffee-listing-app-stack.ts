import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import { AppStack } from "./app-stack";
import * as pipelines from "aws-cdk-lib/pipelines";
import * as iam from "aws-cdk-lib/aws-iam";

export class CoffeeListingAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    let appStage = new AppStage(this, "AppStage", { stackName: this.stackName });

    const config = this.node.tryGetContext("config")
    const connectionArn = config['connection_arn']
    const input: cdk.pipelines.IFileSetProducer = pipelines.CodePipelineSource.connection(
      `${config['githubOrg']}/${config['githubRepo']}`,
      config['githubBranch'],
      { connectionArn }
    )

    let pipeline = new pipelines.CodePipeline(this, "Pipeline", {
      pipelineName: `Pipeline-${this.stackName}`,
      selfMutation: false,
      publishAssetsInParallel: false,
      synth: new pipelines.ShellStep("Synth", {
        input,
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

    let appStack = new AppStack(this, "AppStack", {
      stackName: `AppStack-${props.stackName}`,
    });

    this.cfnOutApiImagesUrl = appStack.cfnOutApiImagesUrl;
    this.cfnOutCloudFrontUrl = appStack.cfnOutCloudFrontUrl;
    this.cfnOutBucketName = appStack.cfnOutBucketName;
    this.cfnOutDistributionId = appStack.cfnOutDistributionId;
    this.cfnOutApiLikesUrl = appStack.cfnOutApiLikesUrl;
  }
}