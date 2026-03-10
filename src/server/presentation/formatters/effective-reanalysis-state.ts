import type { ActiveAnalysisJobSnapshot } from "@/server/application/ports/analysis-job-scheduler";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";

interface ResolveEffectiveReanalysisStateInput {
  persistedStatus: ReviewReanalysisStatus | null | undefined;
  persistedLastReanalyzeRequestedAt: string | null | undefined;
  activeManualReanalysisJob?: ActiveAnalysisJobSnapshot | null;
}

export interface EffectiveReanalysisState {
  reanalysisStatus: ReviewReanalysisStatus;
  lastReanalyzeRequestedAt: string | null;
}

function selectMostRecentTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  const leftEpochMs = Date.parse(left);
  const rightEpochMs = Date.parse(right);

  if (!Number.isNaN(leftEpochMs) && !Number.isNaN(rightEpochMs)) {
    return rightEpochMs >= leftEpochMs ? right : left;
  }

  return right >= left ? right : left;
}

export function resolveEffectiveReanalysisState(
  input: ResolveEffectiveReanalysisStateInput,
): EffectiveReanalysisState {
  const persistedStatus = input.persistedStatus ?? "idle";
  const persistedRequestedAt = input.persistedLastReanalyzeRequestedAt ?? null;
  const activeJob = input.activeManualReanalysisJob ?? null;
  const activeRequestedAt = activeJob?.requestedAt ?? null;

  if (persistedStatus === "running") {
    return {
      reanalysisStatus: persistedStatus,
      lastReanalyzeRequestedAt: persistedRequestedAt,
    };
  }

  if (activeJob?.status === "running") {
    return {
      reanalysisStatus: "running",
      lastReanalyzeRequestedAt: selectMostRecentTimestamp(
        persistedRequestedAt,
        activeRequestedAt,
      ),
    };
  }

  if (persistedStatus === "queued") {
    return {
      reanalysisStatus: "queued",
      lastReanalyzeRequestedAt: selectMostRecentTimestamp(
        persistedRequestedAt,
        activeRequestedAt,
      ),
    };
  }

  if (!activeRequestedAt || activeJob?.status !== "queued") {
    return {
      reanalysisStatus: persistedStatus,
      lastReanalyzeRequestedAt: persistedRequestedAt,
    };
  }

  return {
    reanalysisStatus: "queued",
    lastReanalyzeRequestedAt: selectMostRecentTimestamp(
      persistedRequestedAt,
      activeRequestedAt,
    ),
  };
}
