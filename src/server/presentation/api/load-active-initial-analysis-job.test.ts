import { describe, expect, it } from "vitest";
import type {
  ActiveAnalysisJobSnapshot,
  AnalysisJobScheduler,
  FindQueuedAnalysisJobInput,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";
import { loadActiveInitialAnalysisJob } from "@/server/presentation/api/load-active-initial-analysis-job";

class SpyScheduler implements AnalysisJobScheduler {
  readonly activeCalls: FindQueuedAnalysisJobInput[] = [];
  readonly queuedCalls: FindQueuedAnalysisJobInput[] = [];

  constructor(
    private readonly options: {
      activeByReason?: Partial<Record<FindQueuedAnalysisJobInput["reason"], ActiveAnalysisJobSnapshot | null>>;
      queuedByReason?: Partial<Record<FindQueuedAnalysisJobInput["reason"], QueuedAnalysisJobSnapshot | null>>;
      throwOnReason?: FindQueuedAnalysisJobInput["reason"];
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
    this.activeCalls.push(input);

    if (this.options.throwOnReason === input.reason) {
      throw new Error("queue store unavailable");
    }

    return this.options.activeByReason?.[input.reason] ?? null;
  }

  async findQueuedJob(input: FindQueuedAnalysisJobInput): Promise<QueuedAnalysisJobSnapshot | null> {
    this.queuedCalls.push(input);

    if (this.options.throwOnReason === input.reason) {
      throw new Error("queue store unavailable");
    }

    return this.options.queuedByReason?.[input.reason] ?? null;
  }
}

describe("loadActiveInitialAnalysisJob", () => {
  it("prefers running jobs when both running and queued jobs exist", async () => {
    const scheduler = new SpyScheduler({
      activeByReason: {
        initial_ingestion: {
          jobId: "job-queued",
          reviewId: "review-1",
          requestedAt: "2026-03-11T00:00:00.000Z",
          reason: "initial_ingestion",
          status: "queued",
          queuedAt: "2026-03-11T00:00:00.000Z",
          startedAt: null,
        },
        code_host_webhook: {
          jobId: "job-running",
          reviewId: "review-1",
          requestedAt: "2026-03-11T00:01:00.000Z",
          reason: "code_host_webhook",
          status: "running",
          queuedAt: "2026-03-11T00:00:58.000Z",
          startedAt: "2026-03-11T00:01:00.000Z",
        },
      },
    });

    const result = await loadActiveInitialAnalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-1",
    });

    expect(result?.jobId).toBe("job-running");
    expect(result?.status).toBe("running");
  });

  it("returns queued snapshot when active snapshot is unavailable", async () => {
    const scheduler = new SpyScheduler({
      queuedByReason: {
        initial_ingestion: {
          jobId: "job-queued",
          reviewId: "review-2",
          requestedAt: "2026-03-11T00:10:00.000Z",
          reason: "initial_ingestion",
          queuedAt: "2026-03-11T00:10:00.000Z",
        },
      },
    });

    const result = await loadActiveInitialAnalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-2",
    });

    expect(result).toEqual({
      jobId: "job-queued",
      reviewId: "review-2",
      requestedAt: "2026-03-11T00:10:00.000Z",
      reason: "initial_ingestion",
      status: "queued",
      queuedAt: "2026-03-11T00:10:00.000Z",
      startedAt: null,
    });
  });

  it("returns null when both reasons fail", async () => {
    const scheduler = new SpyScheduler({
      throwOnReason: "initial_ingestion",
    });

    const result = await loadActiveInitialAnalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-3",
    });

    expect(result).toBeNull();
  });
});
