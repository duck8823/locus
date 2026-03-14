import { describe, expect, it } from "vitest";
import type { AnalysisJobScheduler } from "@/server/application/ports/analysis-job-scheduler";
import { loadAnalysisJobHistory } from "@/server/presentation/api/load-analysis-job-history";

describe("loadAnalysisJobHistory", () => {
  it("returns empty history and null metrics when scheduler has no history API", async () => {
    const result = await loadAnalysisJobHistory({
      analysisJobScheduler: {
        scheduleReviewAnalysis: async (input) => ({
          jobId: `job-${input.reviewId}`,
          acceptedAt: input.requestedAt,
          reason: input.reason,
        }),
      },
      reviewId: "review-1",
    });

    expect(result).toEqual({
      history: [],
      metrics: {
        averageDurationMs: null,
        failureRatePercent: null,
        recoverySuccessRatePercent: null,
      },
      queueHealth: {
        status: "healthy",
        queuedJobs: 0,
        runningJobs: 0,
        staleRunningJobs: 0,
        failedTerminalJobs: 0,
        lastFailedJob: null,
        diagnostics: {
          staleRunningThresholdMs: 600000,
          reasonCodes: [],
        },
      },
    });
  });

  it("maps history snapshots and computes dogfooding metrics", async () => {
    const scheduler: AnalysisJobScheduler = {
      scheduleReviewAnalysis: async (input) => ({
        jobId: `job-${input.reviewId}`,
        acceptedAt: input.requestedAt,
        reason: input.reason,
      }),
      listRecentJobs: async () => [
      {
        jobId: "job-3",
        reviewId: "review-1",
        requestedAt: "2026-03-12T00:00:00.000Z",
        reason: "manual_reanalysis",
        status: "failed",
        queuedAt: "2026-03-12T00:00:00.000Z",
        startedAt: "2026-03-12T00:00:01.000Z",
        completedAt: "2026-03-12T00:00:04.000Z",
        durationMs: 3000,
        attempts: 2,
        lastError: "temporary timeout",
      },
      {
        jobId: "job-2",
        reviewId: "review-1",
        requestedAt: "2026-03-12T00:10:00.000Z",
        reason: "manual_reanalysis",
        status: "succeeded",
        queuedAt: "2026-03-12T00:10:00.000Z",
        startedAt: "2026-03-12T00:10:01.000Z",
        completedAt: "2026-03-12T00:10:03.000Z",
        durationMs: 2000,
        attempts: 1,
        lastError: null,
      },
      {
        jobId: "job-1",
        reviewId: "review-1",
        requestedAt: "2026-03-12T00:20:00.000Z",
        reason: "initial_ingestion",
        status: "succeeded",
        queuedAt: "2026-03-12T00:20:00.000Z",
        startedAt: "2026-03-12T00:20:01.000Z",
        completedAt: "2026-03-12T00:20:06.000Z",
        durationMs: 5000,
        attempts: 1,
        lastError: null,
      },
      ],
    };

    const result = await loadAnalysisJobHistory({
      analysisJobScheduler: scheduler,
      reviewId: "review-1",
      limit: 10,
    });

    expect(result.history).toHaveLength(3);
    expect(result.history[0]).toMatchObject({
      jobId: "job-3",
      status: "failed",
      attempts: 2,
      lastError: "temporary timeout",
    });
    expect(result.metrics).toEqual({
      averageDurationMs: 3333,
      failureRatePercent: 33.3,
      recoverySuccessRatePercent: 50,
    });
    expect(result.queueHealth).toEqual({
      status: "degraded",
      queuedJobs: 0,
      runningJobs: 0,
      staleRunningJobs: 0,
      failedTerminalJobs: 1,
      lastFailedJob: {
        jobId: "job-3",
        reason: "manual_reanalysis",
        completedAt: "2026-03-12T00:00:04.000Z",
        lastError: "temporary timeout",
      },
      diagnostics: {
        staleRunningThresholdMs: 600000,
        reasonCodes: ["terminal_failure_detected"],
      },
    });
  });

  it("marks queue health degraded for stale running + backlog signals", async () => {
    const scheduler: AnalysisJobScheduler = {
      scheduleReviewAnalysis: async (input) => ({
        jobId: `job-${input.reviewId}`,
        acceptedAt: input.requestedAt,
        reason: input.reason,
      }),
      listRecentJobs: async () => [
        {
          jobId: "job-queued",
          reviewId: "review-1",
          requestedAt: "2026-03-12T00:00:00.000Z",
          reason: "manual_reanalysis",
          status: "queued",
          queuedAt: "2026-03-12T00:00:00.000Z",
          startedAt: null,
          completedAt: null,
          durationMs: null,
          attempts: 0,
          lastError: null,
        },
        {
          jobId: "job-running-stale",
          reviewId: "review-1",
          requestedAt: "2026-03-12T00:00:00.000Z",
          reason: "manual_reanalysis",
          status: "running",
          queuedAt: "2026-03-12T00:00:00.000Z",
          startedAt: "2026-03-12T00:00:10.000Z",
          completedAt: null,
          durationMs: null,
          attempts: 1,
          lastError: null,
        },
      ],
    };

    const result = await loadAnalysisJobHistory({
      analysisJobScheduler: scheduler,
      reviewId: "review-1",
      staleRunningThresholdMs: 30_000,
      now: () => Date.parse("2026-03-12T00:01:00.000Z"),
    });

    expect(result.queueHealth).toEqual({
      status: "degraded",
      queuedJobs: 1,
      runningJobs: 1,
      staleRunningJobs: 1,
      failedTerminalJobs: 0,
      lastFailedJob: null,
      diagnostics: {
        staleRunningThresholdMs: 30000,
        reasonCodes: ["stale_running_job"],
      },
    });
  });

  it("marks queue backlog when queued jobs exist without active runners", async () => {
    const scheduler: AnalysisJobScheduler = {
      scheduleReviewAnalysis: async (input) => ({
        jobId: `job-${input.reviewId}`,
        acceptedAt: input.requestedAt,
        reason: input.reason,
      }),
      listRecentJobs: async () => [
        {
          jobId: "job-queued",
          reviewId: "review-1",
          requestedAt: "2026-03-12T00:00:00.000Z",
          reason: "manual_reanalysis",
          status: "queued",
          queuedAt: "2026-03-12T00:00:00.000Z",
          startedAt: null,
          completedAt: null,
          durationMs: null,
          attempts: 0,
          lastError: null,
        },
      ],
    };

    const result = await loadAnalysisJobHistory({
      analysisJobScheduler: scheduler,
      reviewId: "review-1",
      staleRunningThresholdMs: 30_000,
      now: () => Date.parse("2026-03-12T00:01:00.000Z"),
    });

    expect(result.queueHealth).toEqual({
      status: "degraded",
      queuedJobs: 1,
      runningJobs: 0,
      staleRunningJobs: 0,
      failedTerminalJobs: 0,
      lastFailedJob: null,
      diagnostics: {
        staleRunningThresholdMs: 30000,
        reasonCodes: ["queue_backlog"],
      },
    });
  });
});
