import type { AnalysisJobHistorySnapshot } from "@/server/application/ports/analysis-job-scheduler";
import { DEFAULT_ANALYSIS_QUEUE_BACKLOG_GRACE_MS } from "@/server/application/constants/analysis-job-queue-policy";

export type AnalysisQueueHealthReasonCode =
  | "queue_backlog"
  | "stale_running_job"
  | "terminal_failure_detected";

export interface AnalysisQueueHealthSnapshot {
  status: "healthy" | "degraded";
  queuedJobs: number;
  runningJobs: number;
  staleRunningJobs: number;
  failedTerminalJobs: number;
  lastFailedJob: {
    jobId: string;
    reason: "initial_ingestion" | "manual_reanalysis" | "code_host_webhook";
    completedAt: string | null;
    lastError: string | null;
  } | null;
  diagnostics: {
    staleRunningThresholdMs: number;
    reasonCodes: AnalysisQueueHealthReasonCode[];
  };
}

function isStaleRunningJob(input: {
  job: AnalysisJobHistorySnapshot;
  nowMs: number;
  staleRunningThresholdMs: number;
}): boolean {
  if (input.job.status !== "running") {
    return false;
  }

  const startedAtEpochMs = Date.parse(input.job.startedAt ?? input.job.queuedAt);

  if (Number.isNaN(startedAtEpochMs) || !Number.isFinite(input.nowMs)) {
    return false;
  }

  return input.nowMs - startedAtEpochMs >= input.staleRunningThresholdMs;
}

export function calculateAnalysisQueueHealth(input: {
  history: AnalysisJobHistorySnapshot[];
  nowMs: number;
  staleRunningThresholdMs: number;
  backlogGracePeriodMs?: number;
}): AnalysisQueueHealthSnapshot {
  const backlogGracePeriodMs =
    typeof input.backlogGracePeriodMs === "number" &&
    Number.isSafeInteger(input.backlogGracePeriodMs) &&
    input.backlogGracePeriodMs >= 0
      ? input.backlogGracePeriodMs
      : DEFAULT_ANALYSIS_QUEUE_BACKLOG_GRACE_MS;
  const queuedJobRecords = input.history.filter((job) => job.status === "queued");
  const queuedJobs = queuedJobRecords.length;
  const runningJobs = input.history.filter((job) => job.status === "running").length;
  const staleRunningJobs = input.history.filter((job) =>
    isStaleRunningJob({
      job,
      nowMs: input.nowMs,
      staleRunningThresholdMs: input.staleRunningThresholdMs,
    }),
  ).length;
  const failedJobs = input.history.filter((job) => job.status === "failed");
  const failedTerminalJobs = failedJobs.length;
  const latestTerminalJob = [...input.history]
    .filter((job) => job.status === "succeeded" || job.status === "failed")
    .sort((left, right) => {
      const leftEpochMs = Date.parse(left.completedAt ?? left.queuedAt);
      const rightEpochMs = Date.parse(right.completedAt ?? right.queuedAt);
      const normalizedLeftEpochMs = Number.isNaN(leftEpochMs) ? 0 : leftEpochMs;
      const normalizedRightEpochMs = Number.isNaN(rightEpochMs) ? 0 : rightEpochMs;

      return normalizedRightEpochMs - normalizedLeftEpochMs;
    })[0] ?? null;
  const lastFailedJob = [...failedJobs]
    .sort((left, right) => {
      const leftEpochMs = Date.parse(left.completedAt ?? left.queuedAt);
      const rightEpochMs = Date.parse(right.completedAt ?? right.queuedAt);
      const normalizedLeftEpochMs = Number.isNaN(leftEpochMs) ? 0 : leftEpochMs;
      const normalizedRightEpochMs = Number.isNaN(rightEpochMs) ? 0 : rightEpochMs;

      return normalizedRightEpochMs - normalizedLeftEpochMs;
    })[0] ?? null;
  const reasonCodes: AnalysisQueueHealthReasonCode[] = [];

  const oldestQueuedEpochMs = queuedJobRecords
    .map((job) => Date.parse(job.queuedAt))
    .filter((epochMs) => Number.isFinite(epochMs))
    .reduce<number | null>((oldest, epochMs) => {
      if (oldest === null) {
        return epochMs;
      }

      return Math.min(oldest, epochMs);
    }, null);
  const shouldMarkQueueBacklog =
    queuedJobs > 0 &&
    runningJobs === 0 &&
    (oldestQueuedEpochMs === null || input.nowMs - oldestQueuedEpochMs >= backlogGracePeriodMs);

  if (shouldMarkQueueBacklog) {
    reasonCodes.push("queue_backlog");
  }

  if (staleRunningJobs > 0) {
    reasonCodes.push("stale_running_job");
  }

  if (latestTerminalJob?.status === "failed") {
    reasonCodes.push("terminal_failure_detected");
  }

  return {
    status: reasonCodes.length > 0 ? "degraded" : "healthy",
    queuedJobs,
    runningJobs,
    staleRunningJobs,
    failedTerminalJobs,
    lastFailedJob: lastFailedJob
      ? {
          jobId: lastFailedJob.jobId,
          reason: lastFailedJob.reason,
          completedAt: lastFailedJob.completedAt,
          lastError: lastFailedJob.lastError,
        }
      : null,
    diagnostics: {
      staleRunningThresholdMs: input.staleRunningThresholdMs,
      reasonCodes,
    },
  };
}
