import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReviewSessionAccessDeniedError } from "@/server/domain/errors/review-session-access-denied-error";

export interface GetReviewWorkspaceInput {
  reviewId: string;
  userId?: string;
}

export interface GetReviewWorkspaceDependencies {
  reviewSessionRepository: ReviewSessionRepository;
}

export class GetReviewWorkspaceUseCase {
  constructor(private readonly dependencies: GetReviewWorkspaceDependencies) {}

  async execute({ reviewId, userId }: GetReviewWorkspaceInput): Promise<ReviewSession> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    // Access control: if session is owned by a user, only that user can access it.
    // Sessions without userId are accessible to anyone (demo mode).
    if (reviewSession.userId && userId && reviewSession.userId !== userId) {
      throw new ReviewSessionAccessDeniedError(reviewId);
    }

    return reviewSession;
  }
}
