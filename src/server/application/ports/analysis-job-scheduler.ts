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

export interface AnalysisJobScheduler {
  scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob>;
  findQueuedJob?(
    input: FindQueuedAnalysisJobInput,
  ): Promise<QueuedAnalysisJobSnapshot | null>;
}
