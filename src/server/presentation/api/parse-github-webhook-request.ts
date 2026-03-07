export interface ParsedGitHubWebhookRequest {
  eventName: string;
  deliveryId: string;
  reviewId: string;
  payload: unknown;
}

export async function parseGitHubWebhookRequest(request: Request): Promise<ParsedGitHubWebhookRequest> {
  const eventName = request.headers.get("x-github-event") ?? "unknown";
  const deliveryId = request.headers.get("x-github-delivery") ?? crypto.randomUUID();
  const rawBody = await request.text();
  const payload = parsePayload(rawBody);

  const reviewId = inferReviewId(payload);

  return {
    eventName,
    deliveryId,
    reviewId,
    payload,
  };
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
