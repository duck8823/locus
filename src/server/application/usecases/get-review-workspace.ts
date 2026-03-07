import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import { createSeedReviewSession } from "@/server/application/services/review-session-seed";

export interface GetReviewWorkspaceInput {
  reviewId: string;
  viewerName: string;
  loadedAt?: string;
}

export interface GetReviewWorkspaceDependencies {
  reviewSessionRepository: ReviewSessionRepository;
}

export class GetReviewWorkspaceUseCase {
  constructor(private readonly dependencies: GetReviewWorkspaceDependencies) {}

  async execute({ reviewId, viewerName, loadedAt }: GetReviewWorkspaceInput): Promise<ReviewSession> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (reviewSession) {
      return reviewSession;
    }

    const seededReviewSession = createSeedReviewSession({
      reviewId,
      viewerName,
      createdAt: loadedAt ?? new Date().toISOString(),
    });

    await this.dependencies.reviewSessionRepository.save(seededReviewSession);

    return seededReviewSession;
  }
}
