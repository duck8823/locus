import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import { createSeedReviewSession } from "@/server/application/services/review-session-seed";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";

export interface OpenReviewWorkspaceInput {
  reviewId: string;
  viewerName: string;
  openedAt?: string;
}

export interface OpenReviewWorkspaceDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  parserAdapters: ParserAdapter[];
}

export class OpenReviewWorkspaceUseCase {
  constructor(private readonly dependencies: OpenReviewWorkspaceDependencies) {}

  async execute({ reviewId, viewerName, openedAt }: OpenReviewWorkspaceInput): Promise<ReviewSession> {
    const timestamp = openedAt ?? new Date().toISOString();
    const { reviewSessionRepository, parserAdapters } = this.dependencies;

    let reviewSession = await reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      reviewSession = await createSeedReviewSession({
        reviewId,
        viewerName,
        createdAt: timestamp,
        parserAdapters,
      });
    }

    reviewSession.markOpened(timestamp, viewerName);
    await reviewSessionRepository.save(reviewSession);

    return reviewSession;
  }
}
