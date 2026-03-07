import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { AnalysisJobScheduler, ScheduledAnalysisJob } from "@/server/application/ports/analysis-job-scheduler";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";

export interface ReanalyzeReviewInput {
  reviewId: string;
  requestedAt?: string;
}

export interface ReanalyzeReviewDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  analysisJobScheduler: AnalysisJobScheduler;
}

export interface ReanalyzeReviewResult {
  reviewSession: ReviewSession;
  scheduledJob: ScheduledAnalysisJob;
}

export class ReanalyzeReviewUseCase {
  constructor(private readonly dependencies: ReanalyzeReviewDependencies) {}

  async execute({ reviewId, requestedAt }: ReanalyzeReviewInput): Promise<ReanalyzeReviewResult> {
    const timestamp = requestedAt ?? new Date().toISOString();
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    reviewSession.requestReanalysis(timestamp);
    await this.dependencies.reviewSessionRepository.save(reviewSession);

    const scheduledJob = await this.dependencies.analysisJobScheduler.scheduleReviewAnalysis({
      reviewId,
      requestedAt: timestamp,
      reason: "manual_reanalysis",
    });

    return {
      reviewSession,
      scheduledJob,
    };
  }
}
