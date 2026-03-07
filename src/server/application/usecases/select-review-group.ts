import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import { ReviewSessionNotFoundError } from "@/server/application/usecases/mark-review-group-status";

export interface SelectReviewGroupInput {
  reviewId: string;
  groupId: string;
}

export interface SelectReviewGroupDependencies {
  reviewSessionRepository: ReviewSessionRepository;
}

export class SelectReviewGroupUseCase {
  constructor(private readonly dependencies: SelectReviewGroupDependencies) {}

  async execute({ reviewId, groupId }: SelectReviewGroupInput): Promise<ReviewSession> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    reviewSession.selectGroup(groupId);
    await this.dependencies.reviewSessionRepository.save(reviewSession);

    return reviewSession;
  }
}
