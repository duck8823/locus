import type {
  AnalysisJobHistorySnapshot,
  AnalysisJobScheduler,
} from "@/server/application/ports/analysis-job-scheduler";
import { DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS } from "@/server/application/constants/analysis-job-queue-policy";
import { calculateAnalysisQueueHealth } from "@/server/application/services/calculate-analysis-queue-health";
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
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1) {
    return DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS;
  }

  return input;
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
    queueHealth: calculateAnalysisQueueHealth({
      history: rawHistory,
      nowMs,
      staleRunningThresholdMs,
    }),
  };
}
