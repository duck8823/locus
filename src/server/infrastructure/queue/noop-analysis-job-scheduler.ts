import type {
  ActiveAnalysisJobSnapshot,
  AnalysisJobScheduler,
  FindQueuedAnalysisJobInput,
  QueuedAnalysisJobSnapshot,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";

export class NoopAnalysisJobScheduler implements AnalysisJobScheduler {
  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    return {
      jobId: `noop-${input.reviewId}-${Date.parse(input.requestedAt)}`,
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }

  async findQueuedJob(
    input: FindQueuedAnalysisJobInput,
  ): Promise<QueuedAnalysisJobSnapshot | null> {
    void input;
    return null;
  }

  async findActiveJob(
    input: FindQueuedAnalysisJobInput,
  ): Promise<ActiveAnalysisJobSnapshot | null> {
    void input;
    return null;
  }
}
