import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";

export class ReviewSessionNotFoundError extends Error {
  constructor(reviewId: string) {
    super(`Review session not found: ${reviewId}`);
    this.name = "ReviewSessionNotFoundError";
  }
}

export interface MarkReviewGroupStatusInput {
  reviewId: string;
  groupId: string;
  status: ReviewGroupStatus;
}

export interface MarkReviewGroupStatusDependencies {
  reviewSessionRepository: ReviewSessionRepository;
}

export class MarkReviewGroupStatusUseCase {
  constructor(private readonly dependencies: MarkReviewGroupStatusDependencies) {}

  async execute({ reviewId, groupId, status }: MarkReviewGroupStatusInput): Promise<ReviewSession> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    reviewSession.setGroupStatus(groupId, status);
    await this.dependencies.reviewSessionRepository.save(reviewSession);

    return reviewSession;
  }
}
