import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveAnalysisJobSnapshot,
  AnalysisJobScheduler,
  FindQueuedAnalysisJobInput,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";

const { getDependenciesMock } = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

import { GET } from "./route";

interface ReviewSessionRecordLike {
  analysisAttemptCount?: number | null;
  analysisCompletedAt?: string | null;
  analysisError?: string | null;
  analysisProcessedFiles?: number | null;
  analysisRequestedAt?: string | null;
  analysisStatus?: "ready" | "queued" | "fetching" | "parsing" | "failed";
  analysisTotalFiles?: number | null;
  lastReanalyzeCompletedAt?: string | null;
  lastReanalyzeError?: string | null;
  lastReanalyzeRequestedAt?: string | null;
  reanalysisStatus?: "idle" | "queued" | "running" | "succeeded" | "failed";
}

class InMemoryReviewSessionRepository {
  private readonly store = new Map<string, ReviewSessionRecordLike>();

  seed(reviewId: string, record: ReviewSessionRecordLike): void {
    this.store.set(reviewId, record);
  }

  async findByReviewId(reviewId: string): Promise<{ toRecord(): ReviewSessionRecordLike } | null> {
    const record = this.store.get(reviewId);

    if (!record) {
      return null;
    }

    return {
      toRecord() {
        return record;
      },
    };
  }
}

class StubAnalysisJobScheduler implements AnalysisJobScheduler {
  constructor(
    private readonly snapshots: {
      activeJob?: ActiveAnalysisJobSnapshot | null;
      queuedJob?: QueuedAnalysisJobSnapshot | null;
    } = {},
  ) {}

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    return {
      jobId: `job-${input.reviewId}`,
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }

  async findActiveJob(input: FindQueuedAnalysisJobInput): Promise<ActiveAnalysisJobSnapshot | null> {
    void input;
    return this.snapshots.activeJob ?? null;
  }

  async findQueuedJob(input: FindQueuedAnalysisJobInput): Promise<QueuedAnalysisJobSnapshot | null> {
    void input;
    return this.snapshots.queuedJob ?? null;
  }
}

describe("GET /api/reviews/[reviewId]/analysis-status", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
  });

  it("returns workspace analysis status payload for existing review sessions", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed("review-1", {
      analysisStatus: "parsing",
      analysisRequestedAt: "2026-03-11T00:01:00.000Z",
      analysisProcessedFiles: 2,
      analysisTotalFiles: 5,
      analysisAttemptCount: 1,
      lastReanalyzeRequestedAt: null,
      reanalysisStatus: "idle",
    });
    const analysisJobScheduler = new StubAnalysisJobScheduler({
      activeJob: {
        jobId: "job-running",
        reviewId: "review-1",
        requestedAt: "2026-03-11T00:02:00.000Z",
        reason: "manual_reanalysis",
        status: "running",
        queuedAt: "2026-03-11T00:02:00.000Z",
        startedAt: "2026-03-11T00:02:01.000Z",
      },
    });

    getDependenciesMock.mockReturnValue({
      reviewSessionRepository,
      analysisJobScheduler,
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
    });

    const response = await GET(new Request("https://example.test"), {
      params: Promise.resolve({ reviewId: "review-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toMatchObject({
      reviewId: "review-1",
      analysisStatus: "parsing",
      analysisProcessedFiles: 2,
      analysisTotalFiles: 5,
      analysisAttemptCount: 1,
      reanalysisStatus: "running",
      active: true,
    });
    expect(typeof payload.token).toBe("string");
  });

  it("returns 404 when review session is missing", async () => {
    getDependenciesMock.mockReturnValue({
      reviewSessionRepository: new InMemoryReviewSessionRepository(),
      analysisJobScheduler: new StubAnalysisJobScheduler(),
      parserAdapters: [],
      pullRequestSnapshotProvider: {},
    });

    const response = await GET(new Request("https://example.test"), {
      params: Promise.resolve({ reviewId: "missing-review" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({
      code: "REVIEW_SESSION_NOT_FOUND",
      message: expect.stringContaining("Review session not found"),
    });
  });
});
