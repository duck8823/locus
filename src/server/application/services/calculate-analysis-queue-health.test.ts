import { describe, expect, it } from "vitest";
import { calculateAnalysisQueueHealth } from "@/server/application/services/calculate-analysis-queue-health";

describe("calculateAnalysisQueueHealth", () => {
  it("returns healthy when queue has no backlog/stale/failure signals", () => {
    const result = calculateAnalysisQueueHealth({
      history: [
        {
          jobId: "job-1",
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
      nowMs: Date.parse("2026-03-12T00:00:20.000Z"),
      staleRunningThresholdMs: 60_000,
    });

    expect(result.status).toBe("healthy");
    expect(result.diagnostics.reasonCodes).toEqual([]);
  });

  it("marks degraded for stale-running jobs and queue backlog", () => {
    const result = calculateAnalysisQueueHealth({
      history: [
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
      nowMs: Date.parse("2026-03-12T00:01:00.000Z"),
      staleRunningThresholdMs: 30_000,
    });

    expect(result.status).toBe("degraded");
    expect(result.staleRunningJobs).toBe(1);
    expect(result.diagnostics.reasonCodes).toEqual(["stale_running_job"]);
  });

  it("surfaces terminal failure metadata in degraded diagnostics", () => {
    const result = calculateAnalysisQueueHealth({
      history: [
        {
          jobId: "job-failed",
          reviewId: "review-1",
          requestedAt: "2026-03-12T00:00:00.000Z",
          reason: "manual_reanalysis",
          status: "failed",
          queuedAt: "2026-03-12T00:00:00.000Z",
          startedAt: "2026-03-12T00:00:01.000Z",
          completedAt: "2026-03-12T00:00:03.000Z",
          durationMs: 2000,
          attempts: 2,
          lastError: "temporary timeout",
        },
      ],
      nowMs: Date.parse("2026-03-12T00:01:00.000Z"),
      staleRunningThresholdMs: 30_000,
    });

    expect(result.status).toBe("degraded");
    expect(result.failedTerminalJobs).toBe(1);
    expect(result.lastFailedJob).toEqual({
      jobId: "job-failed",
      reason: "manual_reanalysis",
      completedAt: "2026-03-12T00:00:03.000Z",
      lastError: "temporary timeout",
    });
    expect(result.diagnostics.reasonCodes).toEqual(["terminal_failure_detected"]);
  });
});
