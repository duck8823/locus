import { describe, expect, it } from "vitest";
import {
  createAnalysisStatusToken,
  isActiveAnalysisStatus,
  isActiveWorkspaceRefreshStatus,
} from "@/server/presentation/formatters/analysis-status-token";

describe("analysis-status-token", () => {
  it("detects active analysis states", () => {
    expect(isActiveAnalysisStatus("queued")).toBe(true);
    expect(isActiveAnalysisStatus("fetching")).toBe(true);
    expect(isActiveAnalysisStatus("parsing")).toBe(true);
    expect(isActiveAnalysisStatus("ready")).toBe(false);
    expect(isActiveAnalysisStatus("failed")).toBe(false);
    expect(isActiveAnalysisStatus(undefined)).toBe(false);
  });

  it("activates workspace refresh while reanalysis is running", () => {
    expect(
      isActiveWorkspaceRefreshStatus({
        analysisStatus: "ready",
        reanalysisStatus: "running",
      }),
    ).toBe(true);
    expect(
      isActiveWorkspaceRefreshStatus({
        analysisStatus: "ready",
        reanalysisStatus: "queued",
      }),
    ).toBe(true);
    expect(
      isActiveWorkspaceRefreshStatus({
        analysisStatus: "failed",
        reanalysisStatus: "idle",
      }),
    ).toBe(false);
  });

  it("normalizes invalid counts while creating token", () => {
    const token = createAnalysisStatusToken({
      analysisStatus: "parsing",
      analysisRequestedAt: "2026-03-10T00:00:00.000Z",
      analysisCompletedAt: null,
      analysisProcessedFiles: 12.8,
      analysisTotalFiles: -1,
      analysisAttemptCount: Number.NaN,
      analysisError: null,
      reanalysisStatus: "running",
      lastReanalyzeRequestedAt: "2026-03-10T00:00:00.000Z",
      lastReanalyzeCompletedAt: null,
      lastReanalyzeError: null,
    });

    expect(token).toBe(
      JSON.stringify({
        status: "parsing",
        requestedAt: "2026-03-10T00:00:00.000Z",
        completedAt: null,
        processedFiles: 12,
        totalFiles: null,
        attemptCount: null,
        error: null,
        reanalysisStatus: "running",
        lastReanalyzeRequestedAt: "2026-03-10T00:00:00.000Z",
        lastReanalyzeCompletedAt: null,
        lastReanalyzeError: null,
      }),
    );
  });
});
