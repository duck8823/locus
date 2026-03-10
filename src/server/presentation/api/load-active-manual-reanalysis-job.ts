import type {
  ActiveAnalysisJobSnapshot,
  AnalysisJobScheduler,
  QueuedAnalysisJobSnapshot,
} from "@/server/application/ports/analysis-job-scheduler";

export interface LoadActiveManualReanalysisJobInput {
  analysisJobScheduler: AnalysisJobScheduler;
  reviewId: string;
}

function toActiveQueuedSnapshot(
  job: QueuedAnalysisJobSnapshot | null | undefined,
): ActiveAnalysisJobSnapshot | null {
  if (!job) {
    return null;
  }

  return {
    ...job,
    status: "queued",
    startedAt: null,
  };
}

export async function loadActiveManualReanalysisJob({
  analysisJobScheduler,
  reviewId,
}: LoadActiveManualReanalysisJobInput): Promise<ActiveAnalysisJobSnapshot | null> {
  try {
    const activeJob = await analysisJobScheduler.findActiveJob?.({
      reviewId,
      reason: "manual_reanalysis",
    });

    if (activeJob) {
      return activeJob;
    }

    const queuedJob = await analysisJobScheduler.findQueuedJob?.({
      reviewId,
      reason: "manual_reanalysis",
    });

    return toActiveQueuedSnapshot(queuedJob);
  } catch {
    return null;
  }
}
