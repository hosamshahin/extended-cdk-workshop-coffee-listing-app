import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cfnInclude from "aws-cdk-lib/cloudformation-include";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";

interface RestApiStackProps extends cdk.StackProps {
  bucket: s3.Bucket;
  distribution: cloudfront.Distribution;
}

export class RestApiStack extends cdk.Stack {
  public readonly restApi: apigateway.LambdaRestApi;
  public readonly cfnOutApiImagesUrl: cdk.CfnOutput;
  public readonly cfnOutApiLikesUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: RestApiStackProps) {
    super(scope, id, props);

    let cfnTemplate = new cfnInclude.CfnInclude(this, "ExistingCloudFormation", {
      templateFile: require.resolve("../existing-cfn.yaml"),
      preserveLogicalIds: false,
    });
    let dynamodbLikesTableCfn = cfnTemplate.getResource("LikesTable") as dynamodb.CfnTable;
    let vpcMainVPCResourceCfn = cfnTemplate.getResource("MainVPC") as ec2.CfnVPC;
    let subnetPrivate1Cfn = cfnTemplate.getResource("VPCPrivateSubnet1Subnet") as ec2.CfnSubnet;
    let subnetPrivate2Cfn = cfnTemplate.getResource("VPCPrivateSubnet2Subnet") as ec2.CfnSubnet;
    let vpcMainVpc = ec2.Vpc.fromVpcAttributes(this, "FromMainVPCResourceCfn", {
      vpcId: vpcMainVPCResourceCfn.ref,
      availabilityZones: cdk.Fn.getAzs(),
      privateSubnetIds: [subnetPrivate1Cfn.ref, subnetPrivate2Cfn.ref],
    });

    let lambdaApiHandlerPublic = new lambdaNodeJs.NodejsFunction(this, "ApiHandlerPublic", {
      entry: require.resolve("../lambdas/coffee-listing-api-public"),
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
        BUCKER_UPLOAD_FOLDER_NAME: "uploads",
      },
    });
    props.bucket.grantReadWrite(lambdaApiHandlerPublic);

    let lambdaApiHandlerPrivate = new lambdaNodeJs.NodejsFunction(this, "ApiHandlerPrivate", {
      entry: require.resolve("../lambdas/coffee-listing-api-private"),
      environment: {
        DYNAMODB_TABLE_LIKES_NAME: dynamodbLikesTableCfn.ref,
      },
      vpc: vpcMainVpc,
    });
    lambdaApiHandlerPrivate.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [dynamodbLikesTableCfn.attrArn],
      })
    );

    let restApi = new apigateway.LambdaRestApi(this, "RestApi", {
      handler: lambdaApiHandlerPublic,
      proxy: false,
    });

    let apiImages = restApi.root.addResource("images", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    apiImages.addMethod("GET");
    apiImages.addMethod("POST");

    let apiLikes = restApi.root.addResource("likes", {
      defaultIntegration: new apigateway.LambdaIntegration(lambdaApiHandlerPrivate),
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });
    apiLikes.addMethod("POST");

    let apiLikesImage = apiLikes.addResource("{imageKeyS3}");
    apiLikesImage.addMethod("GET");

    this.restApi = restApi;

    this.cfnOutApiLikesUrl = new cdk.CfnOutput(this, "CfnOutApiLikesUrl", {
      value: restApi.urlForPath("/likes"),
      description: "Likes API URL for `frontend/.env` file",
    });
    this.cfnOutApiImagesUrl = new cdk.CfnOutput(this, "CfnOutApiImagesUrl", {
      value: restApi.urlForPath("/images"),
      description: "Images API URL for `frontend/.env` file",
    });
  }
}
