import { describe, expect, it } from "vitest";
import type {
  AnalysisJobScheduler,
  FindQueuedAnalysisJobInput,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";
import { loadActiveManualReanalysisJob } from "@/server/presentation/api/load-active-manual-reanalysis-job";

class SpyScheduler implements AnalysisJobScheduler {
  findActiveJobCalls: FindQueuedAnalysisJobInput[] = [];
  findQueuedJobCalls: FindQueuedAnalysisJobInput[] = [];

  constructor(
    private readonly options: {
      activeJob?: Awaited<ReturnType<NonNullable<AnalysisJobScheduler["findActiveJob"]>>>;
      queuedJob?: QueuedAnalysisJobSnapshot | null;
      throwsOnLookup?: boolean;
      disableActiveLookup?: boolean;
    } = {},
  ) {}

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    return {
      jobId: `job-${input.reviewId}`,
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }

  async findActiveJob(input: FindQueuedAnalysisJobInput) {
    this.findActiveJobCalls.push(input);

    if (this.options.disableActiveLookup) {
      return null;
    }

    if (this.options.throwsOnLookup) {
      throw new Error("broken queue store");
    }

    return this.options.activeJob ?? null;
  }

  async findQueuedJob(input: FindQueuedAnalysisJobInput) {
    this.findQueuedJobCalls.push(input);

    if (this.options.throwsOnLookup) {
      throw new Error("broken queue store");
    }

    return this.options.queuedJob ?? null;
  }
}

describe("loadActiveManualReanalysisJob", () => {
  it("returns running job when active snapshot exists", async () => {
    const scheduler = new SpyScheduler({
      activeJob: {
        jobId: "job-active",
        reviewId: "review-1",
        requestedAt: "2026-03-10T00:00:00.000Z",
        reason: "manual_reanalysis",
        status: "running",
        queuedAt: "2026-03-10T00:00:00.000Z",
        startedAt: "2026-03-10T00:00:01.000Z",
      },
    });

    const result = await loadActiveManualReanalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-1",
    });

    expect(result).toEqual({
      jobId: "job-active",
      reviewId: "review-1",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "manual_reanalysis",
      status: "running",
      queuedAt: "2026-03-10T00:00:00.000Z",
      startedAt: "2026-03-10T00:00:01.000Z",
    });
    expect(scheduler.findQueuedJobCalls).toHaveLength(0);
  });

  it("falls back to queued snapshot when active snapshot is unavailable", async () => {
    const scheduler = new SpyScheduler({
      queuedJob: {
        jobId: "job-queued",
        reviewId: "review-2",
        requestedAt: "2026-03-10T00:02:00.000Z",
        reason: "manual_reanalysis",
        queuedAt: "2026-03-10T00:02:00.000Z",
      },
    });

    const result = await loadActiveManualReanalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-2",
    });

    expect(result).toEqual({
      jobId: "job-queued",
      reviewId: "review-2",
      requestedAt: "2026-03-10T00:02:00.000Z",
      reason: "manual_reanalysis",
      status: "queued",
      queuedAt: "2026-03-10T00:02:00.000Z",
      startedAt: null,
    });
    expect(scheduler.findQueuedJobCalls).toHaveLength(1);
  });

  it("returns null when queue lookup throws", async () => {
    const scheduler = new SpyScheduler({ throwsOnLookup: true });

    const result = await loadActiveManualReanalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-3",
    });

    expect(result).toBeNull();
  });

  it("returns null when there is no queued or running manual job", async () => {
    const scheduler = new SpyScheduler();

    const result = await loadActiveManualReanalysisJob({
      analysisJobScheduler: scheduler,
      reviewId: "review-4",
    });

    expect(result).toBeNull();
  });
});
