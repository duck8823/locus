import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisJobScheduler,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";

const {
  getDependenciesMock,
  parseGitHubWebhookRequestMock,
  GitHubWebhookRequestErrorMock,
} = vi.hoisted(() => {
  class MockGitHubWebhookRequestError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
      this.name = "GitHubWebhookRequestError";
    }
  }

  return {
    getDependenciesMock: vi.fn(),
    parseGitHubWebhookRequestMock: vi.fn(),
    GitHubWebhookRequestErrorMock: MockGitHubWebhookRequestError,
  };
});

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/presentation/api/parse-github-webhook-request", () => ({
  parseGitHubWebhookRequest: parseGitHubWebhookRequestMock,
  GitHubWebhookRequestError: GitHubWebhookRequestErrorMock,
}));

import { POST } from "./route";

class SpyAnalysisJobScheduler implements AnalysisJobScheduler {
  readonly calls: ScheduleAnalysisJobInput[] = [];

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    this.calls.push(input);
    return {
      jobId: "scheduled-job-1",
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }
}

describe("POST /api/github/webhooks", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    parseGitHubWebhookRequestMock.mockReset();
  });

  it("accepts webhook events and schedules analysis jobs", async () => {
    const analysisJobScheduler = new SpyAnalysisJobScheduler();
    getDependenciesMock.mockReturnValue({
      analysisJobScheduler,
      reviewSessionRepository: {},
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
    });
    parseGitHubWebhookRequestMock.mockResolvedValue({
      reviewId: "github-pr-42",
      eventName: "pull_request",
      deliveryId: "delivery-123",
    });

    const response = await POST(
      new Request("https://example.test/api/github/webhooks", {
        method: "POST",
        body: JSON.stringify({ pull_request: { number: 42 } }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({
      accepted: true,
      reviewId: "github-pr-42",
      eventName: "pull_request",
      deliveryId: "delivery-123",
      jobId: "scheduled-job-1",
    });
    expect(analysisJobScheduler.calls).toHaveLength(1);
    expect(analysisJobScheduler.calls[0]).toMatchObject({
      reviewId: "github-pr-42",
      reason: "code_host_webhook",
    });
  });

  it("maps webhook request parsing errors to their HTTP status code", async () => {
    getDependenciesMock.mockReturnValue({
      analysisJobScheduler: new SpyAnalysisJobScheduler(),
      reviewSessionRepository: {},
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
    });
    parseGitHubWebhookRequestMock.mockRejectedValue(
      new GitHubWebhookRequestErrorMock("signature verification failed", 401),
    );

    const response = await POST(
      new Request("https://example.test/api/github/webhooks", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toContain("signature verification failed");
  });

  it("returns 400 for unexpected failures", async () => {
    getDependenciesMock.mockReturnValue({
      analysisJobScheduler: new SpyAnalysisJobScheduler(),
      reviewSessionRepository: {},
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
    });
    parseGitHubWebhookRequestMock.mockRejectedValue(new Error("unexpected failure"));

    const response = await POST(
      new Request("https://example.test/api/github/webhooks", {
        method: "POST",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("unexpected failure");
  });
});
