import * as crypto from "crypto";

let response: any = { statusCode: 200 };
const WEBHOOK_SECRET: string = process.env.WEBHOOK_SECRET || '';

export async function handler(event: any): Promise<typeof response> {
  console.log(event);
  console.log(WEBHOOK_SECRET)
  if (!verify_signature(event)) {
    response.statusCode = 401;
  }
  return response;
}

const verify_signature = (event: any) => {
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(event['body'])
    .digest("hex");
  let trusted = Buffer.from(`sha256=${signature}`, 'ascii');
  let untrusted = Buffer.from(event['headers']['x-hub-signature-256'], 'ascii');
  return crypto.timingSafeEqual(trusted, untrusted);
};