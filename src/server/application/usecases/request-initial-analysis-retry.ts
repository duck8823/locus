import type { AnalysisJobScheduler } from "@/server/application/ports/analysis-job-scheduler";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

export interface RequestInitialAnalysisRetryInput {
  reviewId: string;
  requestedAt?: string;
}

export interface RequestInitialAnalysisRetryDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  analysisJobScheduler: AnalysisJobScheduler;
}

export class RequestInitialAnalysisRetryUseCase {
  constructor(private readonly dependencies: RequestInitialAnalysisRetryDependencies) {}

  async execute({ reviewId, requestedAt }: RequestInitialAnalysisRetryInput): Promise<void> {
    const timestamp = requestedAt ?? new Date().toISOString();
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    const source = reviewSession.toRecord().source;

    if (!source || (source.provider !== "github" && source.provider !== "gitlab")) {
      throw new ReanalyzeSourceUnavailableError(reviewId);
    }

    reviewSession.markAnalysisQueued(timestamp);
    await this.dependencies.reviewSessionRepository.save(reviewSession);
    await this.dependencies.analysisJobScheduler.scheduleReviewAnalysis({
      reviewId,
      requestedAt: timestamp,
      reason: "initial_ingestion",
    });
  }
}
