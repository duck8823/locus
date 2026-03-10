import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";

const {
  getDependenciesMock,
  executeMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/application/usecases/reanalyze-review", () => ({
  ReanalyzeReviewUseCase: class {
    async execute(input: { reviewId: string }) {
      return executeMock(input);
    }
  },
}));

import { POST } from "./route";

describe("POST /api/reviews/[reviewId]/reanalyze", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
      analysisJobScheduler: {},
    });
  });

  it("returns reanalysis result payload on success", async () => {
    executeMock.mockResolvedValue({
      snapshotPairCount: 2,
      source: {
        provider: "seed_fixture",
        fixtureId: "default",
      },
      reanalysisStatus: "succeeded",
      lastReanalyzeRequestedAt: "2026-03-11T00:00:00.000Z",
      lastReanalyzeCompletedAt: "2026-03-11T00:00:03.000Z",
      errorMessage: null,
    });

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestedBy: "reviewer-a" }),
      }),
      {
        params: Promise.resolve({ reviewId: "demo-review" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith({ reviewId: "demo-review" });
    expect(payload).toMatchObject({
      reviewId: "demo-review",
      snapshotPairCount: 2,
      reanalysisStatus: "succeeded",
      source: {
        provider: "seed_fixture",
        fixtureId: "default",
      },
    });
  });

  it("returns 404 when review session is missing", async () => {
    executeMock.mockRejectedValue(new ReviewSessionNotFoundError("missing-review"));

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      {
        params: Promise.resolve({ reviewId: "missing-review" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      code: "REVIEW_SESSION_NOT_FOUND",
      message: expect.stringContaining("Review session not found"),
    });
  });

  it("returns 400 when payload is invalid", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("invalid"),
      }),
      {
        params: Promise.resolve({ reviewId: "demo-review" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      code: "INVALID_REANALYZE_REQUEST",
      message: expect.stringContaining("Reanalyze request body must be an object or null."),
    });
  });
});
