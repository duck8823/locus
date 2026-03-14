import type {
  AnalysisJobHistorySnapshot,
  AnalysisJobScheduler,
} from "@/server/application/ports/analysis-job-scheduler";
import type {
  ReviewWorkspaceAnalysisHistoryItemDto,
  ReviewWorkspaceDogfoodingMetricsDto,
  ReviewWorkspaceQueueHealthDto,
} from "@/server/presentation/dto/review-workspace-dto";

export interface LoadAnalysisJobHistoryResult {
  history: ReviewWorkspaceAnalysisHistoryItemDto[];
  metrics: ReviewWorkspaceDogfoodingMetricsDto;
  queueHealth: ReviewWorkspaceQueueHealthDto;
}

const DEFAULT_STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000;

function toFixedOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function calculateAverageDurationMs(history: AnalysisJobHistorySnapshot[]): number | null {
  const durations = history
    .map((job) => job.durationMs)
    .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration) && duration >= 0);

  if (durations.length === 0) {
    return null;
  }

  const total = durations.reduce((sum, duration) => sum + duration, 0);
  return Math.round(total / durations.length);
}

function calculateFailureRatePercent(history: AnalysisJobHistorySnapshot[]): number | null {
  const terminalJobs = history.filter((job) => job.status === "succeeded" || job.status === "failed");

  if (terminalJobs.length === 0) {
    return null;
  }

  const failedJobs = terminalJobs.filter((job) => job.status === "failed");
  return toFixedOneDecimal((failedJobs.length / terminalJobs.length) * 100);
}

function calculateRecoverySuccessRatePercent(history: AnalysisJobHistorySnapshot[]): number | null {
  const manualReanalysisJobs = history.filter((job) => job.reason === "manual_reanalysis");

  if (manualReanalysisJobs.length === 0) {
    return null;
  }

  const successfulManualJobs = manualReanalysisJobs.filter((job) => job.status === "succeeded");
  return toFixedOneDecimal((successfulManualJobs.length / manualReanalysisJobs.length) * 100);
}

function mapHistory(
  history: AnalysisJobHistorySnapshot[],
): ReviewWorkspaceAnalysisHistoryItemDto[] {
  return history.map((job) => ({
    jobId: job.jobId,
    reason: job.reason,
    status: job.status,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    attempts: job.attempts,
    lastError: job.lastError,
  }));
}

function resolveStaleRunningThresholdMs(input: number | undefined): number {
  if (!Number.isSafeInteger(input) || typeof input !== "number" || input < 1) {
    return DEFAULT_STALE_RUNNING_THRESHOLD_MS;
  }

  return input;
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

function calculateQueueHealth(input: {
  history: AnalysisJobHistorySnapshot[];
  nowMs: number;
  staleRunningThresholdMs: number;
}): ReviewWorkspaceQueueHealthDto {
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
  const reasonCodes: ReviewWorkspaceQueueHealthDto["diagnostics"]["reasonCodes"] = [];

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

export async function loadAnalysisJobHistory(params: {
  analysisJobScheduler: AnalysisJobScheduler;
  reviewId: string;
  limit?: number;
  staleRunningThresholdMs?: number;
  now?: () => number;
}): Promise<LoadAnalysisJobHistoryResult> {
  const staleRunningThresholdMs = resolveStaleRunningThresholdMs(params.staleRunningThresholdMs);
  const nowMs = params.now ? params.now() : Date.now();

  if (!params.analysisJobScheduler.listRecentJobs) {
    return {
      history: [],
      metrics: {
        averageDurationMs: null,
        failureRatePercent: null,
        recoverySuccessRatePercent: null,
      },
      queueHealth: {
        status: "healthy",
        queuedJobs: 0,
        runningJobs: 0,
        staleRunningJobs: 0,
        failedTerminalJobs: 0,
        lastFailedJob: null,
        diagnostics: {
          staleRunningThresholdMs,
          reasonCodes: [],
        },
      },
    };
  }

  const rawHistory = await params.analysisJobScheduler.listRecentJobs({
    reviewId: params.reviewId,
    limit: params.limit,
  });

  return {
    history: mapHistory(rawHistory),
    metrics: {
      averageDurationMs: calculateAverageDurationMs(rawHistory),
      failureRatePercent: calculateFailureRatePercent(rawHistory),
      recoverySuccessRatePercent: calculateRecoverySuccessRatePercent(rawHistory),
    },
    queueHealth: calculateQueueHealth({
      history: rawHistory,
      nowMs,
      staleRunningThresholdMs,
    }),
  };
}
