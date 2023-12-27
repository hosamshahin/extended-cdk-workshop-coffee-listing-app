import { APIGatewayProxyEvent, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import * as AWS from "aws-sdk";

let response: APIGatewayProxyStructuredResultV2 = {
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": true,
  },
};

export async function handler(event: APIGatewayProxyEvent): Promise<typeof response> {
  if (event.resource === "/likes/{imageKeyS3}") {
    if (event.httpMethod === "GET") {
      return getAllLikesForImageKeyS3(event);
    }
  }
  if (event.resource === "/likes") {
    if (event.httpMethod === "POST") {
      return postUpdateLikesForImageKeyS3(event);
    }
  }
  console.log(JSON.stringify(event, null, 2));
  response.statusCode = 404;
  response.body = JSON.stringify({ ok: false, payload: "Route not found" });
  return response;
}

let { DYNAMODB_TABLE_LIKES_NAME = "" } = process.env;
let ddb = new AWS.DynamoDB.DocumentClient();
async function getAllLikesForImageKeyS3(event: APIGatewayProxyEvent) {
  let imageKeyS3 = event.pathParameters && event.pathParameters.imageKeyS3;

  if (!imageKeyS3) {
    response.statusCode = 400;
    response.body = JSON.stringify({ ok: false, message: "Missing `imageKeyS3` path parameter" });
    return response;
  }

  let params = {
    ExpressionAttributeValues: {
      ":imageKeyS3": decodeURI(imageKeyS3),
    },
    KeyConditionExpression: "imageKeyS3 = :imageKeyS3",
    TableName: DYNAMODB_TABLE_LIKES_NAME,
  };
  let payload = await ddb.query(params).promise();
  response.statusCode = 200;
  response.body = JSON.stringify(payload);
  return response;
}

async function postUpdateLikesForImageKeyS3(event: APIGatewayProxyEvent) {
  let body = JSON.parse(event.body as string);
  let params = {
    ExpressionAttributeNames: {
      "#likes": "likes",
    },
    ExpressionAttributeValues: {
      ":likes": body.likes,
    },
    UpdateExpression: "ADD #likes :likes",
    TableName: DYNAMODB_TABLE_LIKES_NAME,
    ReturnValues: "ALL_NEW",
    Key: {
      imageKeyS3: body.imageKeyS3,
    },
  };
  let payload = await ddb.update(params).promise();
  response.statusCode = 200;
  response.body = JSON.stringify(payload);
  return response;
}
