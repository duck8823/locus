import { createHmac, timingSafeEqual } from "node:crypto";

export interface ParsedGitHubWebhookRequest {
  eventName: string;
  deliveryId: string;
  reviewId: string;
  payload: unknown;
}

export class GitHubWebhookRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 401 | 500,
  ) {
    super(message);
    this.name = "GitHubWebhookRequestError";
  }
}

export async function parseGitHubWebhookRequest(request: Request): Promise<ParsedGitHubWebhookRequest> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    throw new GitHubWebhookRequestError(
      "GITHUB_WEBHOOK_SECRET must be configured before accepting GitHub webhooks.",
      500,
    );
  }

  const eventName = readRequiredHeader(request, "x-github-event");
  const deliveryId = readRequiredHeader(request, "x-github-delivery");
  const signature = readRequiredHeader(request, "x-hub-signature-256");
  const rawBody = await request.text();
  assertValidSignature(rawBody, signature, secret);
  const payload = parsePayload(rawBody);

  const reviewId = inferReviewId(payload);

  return {
    eventName,
    deliveryId,
    reviewId,
    payload,
  };
}

function readRequiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name);

  if (!value) {
    throw new GitHubWebhookRequestError(`${name} header is required.`, 400);
  }

  return value;
}

function assertValidSignature(rawBody: string, receivedSignature: string, secret: string): void {
  if (!receivedSignature.startsWith("sha256=")) {
    throw new GitHubWebhookRequestError("x-hub-signature-256 must use the sha256= format.", 401);
  }

  const expectedSignature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(`sha256=${expectedSignature}`);
  const receivedBuffer = Buffer.from(receivedSignature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new GitHubWebhookRequestError("GitHub webhook signature verification failed.", 401);
  }
}

function parsePayload(rawBody: string): unknown {
  if (rawBody.length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return { raw: rawBody };
  }
}

function inferReviewId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "github-webhook-demo";
  }

  const pullRequest = Reflect.get(payload, "pull_request");

  if (!pullRequest || typeof pullRequest !== "object") {
    return "github-webhook-demo";
  }

  const number = Reflect.get(pullRequest, "number");

  if (typeof number === "number" && Number.isFinite(number)) {
    return `github-pr-${number}`;
  }

  return "github-webhook-demo";
}
