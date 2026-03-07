import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { parseGitHubWebhookRequest } from "@/server/presentation/api/parse-github-webhook-request";

const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    return;
  }

  process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
});

function createSignedRequest(body: string, overrides: HeadersInit = {}): Request {
  const signature = createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET ?? "test-secret")
    .update(body)
    .digest("hex");

  return new Request("https://example.test/api/github/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-123",
      "x-hub-signature-256": `sha256=${signature}`,
      ...overrides,
    },
    body,
  });
}

describe("parseGitHubWebhookRequest", () => {
  it("verifies the webhook signature and returns the parsed payload", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    const body = JSON.stringify({ pull_request: { number: 42 } });

    const parsed = await parseGitHubWebhookRequest(createSignedRequest(body));

    expect(parsed.deliveryId).toBe("delivery-123");
    expect(parsed.eventName).toBe("pull_request");
    expect(parsed.reviewId).toBe("github-pr-42");
  });

  it("rejects requests when the webhook secret is not configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const body = JSON.stringify({ pull_request: { number: 42 } });

    await expect(parseGitHubWebhookRequest(createSignedRequest(body))).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining("GITHUB_WEBHOOK_SECRET"),
    });
  });

  it("rejects requests with a missing delivery header", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    const body = JSON.stringify({ pull_request: { number: 42 } });
    const request = createSignedRequest(body, {
      "x-github-delivery": "",
    });

    await expect(parseGitHubWebhookRequest(request)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("x-github-delivery"),
    });
  });

  it("rejects requests with an invalid signature", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    const body = JSON.stringify({ pull_request: { number: 42 } });
    const request = new Request("https://example.test/api/github/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-123",
        "x-hub-signature-256": "sha256=deadbeef",
      },
      body,
    });

    await expect(parseGitHubWebhookRequest(request)).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining("signature verification failed"),
    });
  });
});
