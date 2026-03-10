import type {
  ActiveAnalysisJobSnapshot,
  AnalysisJobScheduler,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
} from "@/server/application/ports/analysis-job-scheduler";

type InitialAnalysisJobReason = Extract<
  ScheduleAnalysisJobInput["reason"],
  "initial_ingestion" | "code_host_webhook"
>;

export type ActiveInitialAnalysisJobSnapshot = Omit<
  ActiveAnalysisJobSnapshot,
  "reason"
> & {
  reason: InitialAnalysisJobReason;
};

export interface LoadActiveInitialAnalysisJobInput {
  analysisJobScheduler: AnalysisJobScheduler;
  reviewId: string;
}

function toActiveQueuedSnapshot(
  job: QueuedAnalysisJobSnapshot | null | undefined,
  reason: InitialAnalysisJobReason,
): ActiveInitialAnalysisJobSnapshot | null {
  if (!job || job.reason !== reason) {
    return null;
  }

  return {
    ...job,
    reason,
    status: "queued",
    startedAt: null,
  };
}

function toActiveRunningSnapshot(
  job: ActiveAnalysisJobSnapshot | null | undefined,
  reason: InitialAnalysisJobReason,
): ActiveInitialAnalysisJobSnapshot | null {
  if (!job || job.reason !== reason) {
    return null;
  }

  return {
    ...job,
    reason,
  };
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareActiveJobs(
  left: ActiveInitialAnalysisJobSnapshot,
  right: ActiveInitialAnalysisJobSnapshot,
): number {
  if (left.status !== right.status) {
    return left.status === "running" ? -1 : 1;
  }

  const leftEpochMs = toEpochMs(left.requestedAt);
  const rightEpochMs = toEpochMs(right.requestedAt);

  return rightEpochMs - leftEpochMs;
}

async function loadReasonSnapshot(params: {
  analysisJobScheduler: AnalysisJobScheduler;
  reviewId: string;
  reason: InitialAnalysisJobReason;
}): Promise<ActiveInitialAnalysisJobSnapshot | null> {
  const activeJob = await params.analysisJobScheduler.findActiveJob?.({
    reviewId: params.reviewId,
    reason: params.reason,
  });

  const runningSnapshot = toActiveRunningSnapshot(activeJob, params.reason);

  if (runningSnapshot) {
    return runningSnapshot;
  }

  const queuedJob = await params.analysisJobScheduler.findQueuedJob?.({
    reviewId: params.reviewId,
    reason: params.reason,
  });

  return toActiveQueuedSnapshot(queuedJob, params.reason);
}

export async function loadActiveInitialAnalysisJob({
  analysisJobScheduler,
  reviewId,
}: LoadActiveInitialAnalysisJobInput): Promise<ActiveInitialAnalysisJobSnapshot | null> {
  const reasons: InitialAnalysisJobReason[] = ["initial_ingestion", "code_host_webhook"];
  const snapshots = await Promise.all(
    reasons.map(async (reason) => {
      try {
        return await loadReasonSnapshot({
          analysisJobScheduler,
          reviewId,
          reason,
        });
      } catch {
        return null;
      }
    }),
  );
  const activeSnapshots = snapshots.filter(
    (snapshot): snapshot is ActiveInitialAnalysisJobSnapshot => !!snapshot,
  );

  if (activeSnapshots.length === 0) {
    return null;
  }

  return [...activeSnapshots].sort(compareActiveJobs)[0] ?? null;
}
