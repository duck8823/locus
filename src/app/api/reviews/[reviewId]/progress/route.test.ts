import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReviewGroupNotFoundError } from "@/server/presentation/errors/review-group-not-found-error";

const {
  getDependenciesMock,
  executeMock,
  toReviewWorkspaceDtoMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
  toReviewWorkspaceDtoMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/application/usecases/mark-review-group-status", () => ({
  MarkReviewGroupStatusUseCase: class {
    async execute(input: { reviewId: string; groupId: string; status: string }) {
      return executeMock(input);
    }
  },
}));

vi.mock("@/server/presentation/mappers/to-review-workspace-dto", () => ({
  toReviewWorkspaceDto: toReviewWorkspaceDtoMock,
}));

import { POST } from "./route";

describe("POST /api/reviews/[reviewId]/progress", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    toReviewWorkspaceDtoMock.mockReset();
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: {},
      analysisJobScheduler: {},
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
    });
  });

  it("updates review group status and returns workspace dto", async () => {
    executeMock.mockResolvedValue({
      id: "review-session",
    });
    toReviewWorkspaceDtoMock.mockReturnValue({
      groups: [{ groupId: "group-1", status: "reviewed" }],
    });

    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: " group-1 ",
          status: " reviewed ",
        }),
      }),
      {
        params: Promise.resolve({ reviewId: "review-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith({
      reviewId: "review-1",
      groupId: "group-1",
      status: "reviewed",
    });
    expect(payload).toMatchObject({
      reviewId: "review-1",
      groupId: "group-1",
      status: "reviewed",
    });
    expect(payload.workspace.groups[0]?.status).toBe("reviewed");
  });

  it("returns 404 when use case raises known not-found errors", async () => {
    executeMock.mockRejectedValueOnce(new ReviewSessionNotFoundError("missing-review"));
    let response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: "group-1",
          status: "reviewed",
        }),
      }),
      {
        params: Promise.resolve({ reviewId: "missing-review" }),
      },
    );
    let payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      code: "REVIEW_SESSION_NOT_FOUND",
      message: expect.stringContaining("Review session not found"),
    });

    executeMock.mockRejectedValueOnce(new ReviewGroupNotFoundError("group-2"));
    response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: "group-2",
          status: "reviewed",
        }),
      }),
      {
        params: Promise.resolve({ reviewId: "review-1" }),
      },
    );
    payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      code: "REVIEW_GROUP_NOT_FOUND",
      message: expect.stringContaining("Review group not found"),
    });
  });

  it("returns 400 on invalid payload", async () => {
    const response = await POST(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: "",
          status: "reviewed",
        }),
      }),
      {
        params: Promise.resolve({ reviewId: "review-1" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      code: "INVALID_PROGRESS_REQUEST",
      message: expect.stringContaining("groupId must be a non-empty string"),
    });
  });
});
