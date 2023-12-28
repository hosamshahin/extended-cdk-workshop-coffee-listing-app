import { APIGatewayProxyEvent } from "aws-lambda";

let response: any = {};

export async function handler(event: APIGatewayProxyEvent): Promise<typeof response> {
  console.log(JSON.stringify(event, null, 2));
  response.statusCode = 200;
  return response;
}
