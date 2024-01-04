import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamo from 'aws-cdk-lib/aws-dynamodb';
import * as iam from "aws-cdk-lib/aws-iam";

export class AppStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly cfnOutCloudFrontUrl: cdk.CfnOutput;
  public readonly cfnOutBucketName: cdk.CfnOutput;
  public readonly cfnOutDistributionId: cdk.CfnOutput;
  public readonly restApi: apigateway.LambdaRestApi;
  public readonly cfnOutApiImagesUrl: cdk.CfnOutput;
  public readonly cfnOutApiLikesUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Remediating AwsSolutions-S10 by enforcing SSL on the bucket.
    this.bucket = new s3.Bucket(this, "Bucket", {
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST],
          allowedOrigins: ["*"],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: new cloudfrontOrigins.S3Origin(this.bucket, {
          originPath: "/frontend",
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/uploads/*": {
          origin: new cloudfrontOrigins.S3Origin(this.bucket, {
            originPath: "/",
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
    });

    this.cfnOutCloudFrontUrl = new cdk.CfnOutput(this, "CfnOutCloudFrontUrl", {
      value: `https://${this.distribution.distributionDomainName}`,
      description: "URL for CLOUDFRONT_URL in `frontend/.env` file",
    });

    this.cfnOutDistributionId = new cdk.CfnOutput(this, "CfnOutDistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront Distribution Id",
    });

    this.cfnOutBucketName = new cdk.CfnOutput(this, "CfnOutBucketName", {
      value: this.bucket.bucketName,
      description: "Website Hosting Bucket Name",
    });

    const likesTable = new dynamo.Table(this, 'LikesTable', {
      billingMode: dynamo.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: 'imageKeyS3',
        type: dynamo.AttributeType.STRING,
      },
    });

    let lambdaApiHandlerPublic = new lambdaNodeJs.NodejsFunction(this, "ApiHandlerPublic", {
      entry: require.resolve("../lambdas/coffee-listing-api-public"),
      environment: {
        BUCKET_NAME: this.bucket.bucketName,
        BUCKER_UPLOAD_FOLDER_NAME: "uploads",
      },
    });

    this.bucket.grantReadWrite(lambdaApiHandlerPublic);

    let lambdaApiHandlerPrivate = new lambdaNodeJs.NodejsFunction(this, "ApiHandlerPrivate", {
      entry: require.resolve("../lambdas/coffee-listing-api-private"),
      environment: {
        DYNAMODB_TABLE_LIKES_NAME: likesTable.tableName,
      }
    });

    lambdaApiHandlerPrivate.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
        resources: [likesTable.tableArn],
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
