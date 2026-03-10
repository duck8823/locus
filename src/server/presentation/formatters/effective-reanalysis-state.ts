import type { QueuedAnalysisJobSnapshot } from "@/server/application/ports/analysis-job-scheduler";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";

interface ResolveEffectiveReanalysisStateInput {
  persistedStatus: ReviewReanalysisStatus | null | undefined;
  persistedLastReanalyzeRequestedAt: string | null | undefined;
  queuedManualReanalysisJob?: QueuedAnalysisJobSnapshot | null;
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
  const queuedRequestedAt = input.queuedManualReanalysisJob?.requestedAt ?? null;

  if (persistedStatus === "running") {
    return {
      reanalysisStatus: persistedStatus,
      lastReanalyzeRequestedAt: persistedRequestedAt,
    };
  }

  if (persistedStatus === "queued") {
    return {
      reanalysisStatus: "queued",
      lastReanalyzeRequestedAt: selectMostRecentTimestamp(
        persistedRequestedAt,
        queuedRequestedAt,
      ),
    };
  }

  if (!queuedRequestedAt) {
    return {
      reanalysisStatus: persistedStatus,
      lastReanalyzeRequestedAt: persistedRequestedAt,
    };
  }

  return {
    reanalysisStatus: "queued",
    lastReanalyzeRequestedAt: selectMostRecentTimestamp(
      persistedRequestedAt,
      queuedRequestedAt,
    ),
  };
}
