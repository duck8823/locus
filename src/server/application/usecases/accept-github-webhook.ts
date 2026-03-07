import type { AnalysisJobScheduler, ScheduledAnalysisJob } from "@/server/application/ports/analysis-job-scheduler";

export interface AcceptGitHubWebhookInput {
  reviewId: string;
  eventName: string;
  deliveryId: string;
  acceptedAt?: string;
}

export interface AcceptGitHubWebhookDependencies {
  analysisJobScheduler: AnalysisJobScheduler;
}

export interface AcceptGitHubWebhookResult {
  scheduledJob: ScheduledAnalysisJob;
  eventName: string;
  deliveryId: string;
  acceptedAt: string;
}

export class AcceptGitHubWebhookUseCase {
  constructor(private readonly dependencies: AcceptGitHubWebhookDependencies) {}

  async execute({
    reviewId,
    eventName,
    deliveryId,
    acceptedAt,
  }: AcceptGitHubWebhookInput): Promise<AcceptGitHubWebhookResult> {
    const timestamp = acceptedAt ?? new Date().toISOString();
    const scheduledJob = await this.dependencies.analysisJobScheduler.scheduleReviewAnalysis({
      reviewId,
      requestedAt: timestamp,
      reason: "code_host_webhook",
    });

    return {
      scheduledJob,
      eventName,
      deliveryId,
      acceptedAt: timestamp,
    };
  }
}
