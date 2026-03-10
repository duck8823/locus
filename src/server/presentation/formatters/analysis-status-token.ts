import type { ReviewAnalysisStatus } from "@/server/domain/value-objects/analysis-status";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";

export interface AnalysisStatusTokenInput {
  analysisStatus?: ReviewAnalysisStatus | null;
  analysisRequestedAt?: string | null;
  analysisCompletedAt?: string | null;
  analysisProcessedFiles?: number | null;
  analysisTotalFiles?: number | null;
  analysisAttemptCount?: number | null;
  analysisError?: string | null;
  reanalysisStatus?: ReviewReanalysisStatus | null;
  lastReanalyzeRequestedAt?: string | null;
  lastReanalyzeCompletedAt?: string | null;
  lastReanalyzeError?: string | null;
}

function normalizeCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}

export function isActiveAnalysisStatus(
  status: ReviewAnalysisStatus | null | undefined,
): boolean {
  return status === "queued" || status === "fetching" || status === "parsing";
}

export function isActiveWorkspaceRefreshStatus(params: {
  analysisStatus: ReviewAnalysisStatus | null | undefined;
  reanalysisStatus: ReviewReanalysisStatus | null | undefined;
}): boolean {
  return isActiveAnalysisStatus(params.analysisStatus) || params.reanalysisStatus === "running";
}

export function createAnalysisStatusToken(input: AnalysisStatusTokenInput): string {
  return JSON.stringify({
    status: input.analysisStatus ?? "ready",
    requestedAt: input.analysisRequestedAt ?? null,
    completedAt: input.analysisCompletedAt ?? null,
    processedFiles: normalizeCount(input.analysisProcessedFiles),
    totalFiles: normalizeCount(input.analysisTotalFiles),
    attemptCount: normalizeCount(input.analysisAttemptCount),
    error: input.analysisError ?? null,
    reanalysisStatus: input.reanalysisStatus ?? "idle",
    lastReanalyzeRequestedAt: input.lastReanalyzeRequestedAt ?? null,
    lastReanalyzeCompletedAt: input.lastReanalyzeCompletedAt ?? null,
    lastReanalyzeError: input.lastReanalyzeError ?? null,
  });
}
