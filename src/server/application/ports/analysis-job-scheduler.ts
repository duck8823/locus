export interface ScheduleAnalysisJobInput {
  reviewId: string;
  requestedAt: string;
  reason: "initial_ingestion" | "manual_reanalysis" | "code_host_webhook";
}

export interface ScheduledAnalysisJob {
  jobId: string;
  acceptedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
}

export interface FindQueuedAnalysisJobInput {
  reviewId: string;
  reason: ScheduleAnalysisJobInput["reason"];
}

export interface QueuedAnalysisJobSnapshot {
  jobId: string;
  reviewId: string;
  requestedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
  queuedAt: string;
}

export interface ActiveAnalysisJobSnapshot {
  jobId: string;
  reviewId: string;
  requestedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
  status: "queued" | "running";
  queuedAt: string;
  startedAt: string | null;
}

export interface AnalysisJobHistorySnapshot {
  jobId: string;
  reviewId: string;
  requestedAt: string;
  reason: ScheduleAnalysisJobInput["reason"];
  status: "queued" | "running" | "succeeded" | "failed";
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempts: number;
  lastError: string | null;
}

export interface AnalysisJobScheduler {
  scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob>;
  findQueuedJob?(
    input: FindQueuedAnalysisJobInput,
  ): Promise<QueuedAnalysisJobSnapshot | null>;
  findActiveJob?(
    input: FindQueuedAnalysisJobInput,
  ): Promise<ActiveAnalysisJobSnapshot | null>;
  listRecentJobs?(input: {
    reviewId: string;
    limit?: number;
  }): Promise<AnalysisJobHistorySnapshot[]>;
}
