import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";

export interface GetReviewWorkspaceInput {
  reviewId: string;
}

export interface GetReviewWorkspaceDependencies {
  reviewSessionRepository: ReviewSessionRepository;
}

export class GetReviewWorkspaceUseCase {
  constructor(private readonly dependencies: GetReviewWorkspaceDependencies) {}

  async execute({ reviewId }: GetReviewWorkspaceInput): Promise<ReviewSession> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    return reviewSession;
  }
}
