import { describe, expect, it } from "vitest";
import { resolveEffectiveReanalysisState } from "@/server/presentation/formatters/effective-reanalysis-state";

describe("resolveEffectiveReanalysisState", () => {
  it("returns persisted running state even when queue still has follow-up job", () => {
    const result = resolveEffectiveReanalysisState({
      persistedStatus: "running",
      persistedLastReanalyzeRequestedAt: "2026-03-10T00:05:00.000Z",
      queuedManualReanalysisJob: {
        jobId: "job-1",
        reviewId: "review-1",
        requestedAt: "2026-03-10T00:06:00.000Z",
        reason: "manual_reanalysis",
        queuedAt: "2026-03-10T00:06:00.000Z",
      },
    });

    expect(result).toEqual({
      reanalysisStatus: "running",
      lastReanalyzeRequestedAt: "2026-03-10T00:05:00.000Z",
    });
  });

  it("exposes queued state from pending manual reanalysis job", () => {
    const result = resolveEffectiveReanalysisState({
      persistedStatus: "succeeded",
      persistedLastReanalyzeRequestedAt: "2026-03-10T00:04:00.000Z",
      queuedManualReanalysisJob: {
        jobId: "job-2",
        reviewId: "review-1",
        requestedAt: "2026-03-10T00:07:00.000Z",
        reason: "manual_reanalysis",
        queuedAt: "2026-03-10T00:07:01.000Z",
      },
    });

    expect(result).toEqual({
      reanalysisStatus: "queued",
      lastReanalyzeRequestedAt: "2026-03-10T00:07:00.000Z",
    });
  });

  it("keeps persisted state when no queued manual job exists", () => {
    const result = resolveEffectiveReanalysisState({
      persistedStatus: "failed",
      persistedLastReanalyzeRequestedAt: "2026-03-10T00:03:00.000Z",
      queuedManualReanalysisJob: null,
    });

    expect(result).toEqual({
      reanalysisStatus: "failed",
      lastReanalyzeRequestedAt: "2026-03-10T00:03:00.000Z",
    });
  });

  it("preserves queued status for legacy persisted records without queue metadata", () => {
    const result = resolveEffectiveReanalysisState({
      persistedStatus: "queued",
      persistedLastReanalyzeRequestedAt: "2026-03-10T00:08:00.000Z",
    });

    expect(result).toEqual({
      reanalysisStatus: "queued",
      lastReanalyzeRequestedAt: "2026-03-10T00:08:00.000Z",
    });
  });
});
