import type { AnalysisJobScheduler, ScheduleAnalysisJobInput, ScheduledAnalysisJob } from "@/server/application/ports/analysis-job-scheduler";

export class NoopAnalysisJobScheduler implements AnalysisJobScheduler {
  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    return {
      jobId: `noop-${input.reviewId}-${Date.parse(input.requestedAt)}`,
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }
}
