import type { ReviewSession } from "@/server/domain/entities/review-session";

export interface ReviewSessionRepository {
  findByReviewId(reviewId: string): Promise<ReviewSession | null>;
  save(reviewSession: ReviewSession): Promise<void>;
}
