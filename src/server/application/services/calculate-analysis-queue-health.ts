import type { AnalysisJobHistorySnapshot } from "@/server/application/ports/analysis-job-scheduler";

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

  const startedAtEpochMs = Date.parse(input.job.startedAt ?? "");

  if (Number.isNaN(startedAtEpochMs) || !Number.isFinite(input.nowMs)) {
    return true;
  }

  return input.nowMs - startedAtEpochMs >= input.staleRunningThresholdMs;
}

export function calculateAnalysisQueueHealth(input: {
  history: AnalysisJobHistorySnapshot[];
  nowMs: number;
  staleRunningThresholdMs: number;
}): AnalysisQueueHealthSnapshot {
  const queuedJobs = input.history.filter((job) => job.status === "queued").length;
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
  const lastFailedJob = [...failedJobs]
    .sort((left, right) => {
      const leftEpochMs = Date.parse(left.completedAt ?? left.queuedAt);
      const rightEpochMs = Date.parse(right.completedAt ?? right.queuedAt);
      const normalizedLeftEpochMs = Number.isNaN(leftEpochMs) ? 0 : leftEpochMs;
      const normalizedRightEpochMs = Number.isNaN(rightEpochMs) ? 0 : rightEpochMs;

      return normalizedRightEpochMs - normalizedLeftEpochMs;
    })[0] ?? null;
  const reasonCodes: AnalysisQueueHealthReasonCode[] = [];

  if (queuedJobs > 0 && runningJobs === 0) {
    reasonCodes.push("queue_backlog");
  }

  if (staleRunningJobs > 0) {
    reasonCodes.push("stale_running_job");
  }

  if (failedTerminalJobs > 0) {
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
