import type { Sql } from "./types";
import { ReviewSession, type ReviewSessionRecord } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

export class PgReviewSessionRepository implements ReviewSessionRepository {
  constructor(private readonly sql: Sql) {}

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const rows = await this.sql<{ data: ReviewSessionRecord }[]>`
      SELECT data FROM review_sessions WHERE review_id = ${reviewId}
    `;

    if (rows.length === 0) {
      return null;
    }

    return ReviewSession.fromRecord(rows[0].data);
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    const record = reviewSession.toRecord();

    await this.sql`
      INSERT INTO review_sessions (review_id, data, updated_at)
      VALUES (${record.reviewId}, ${JSON.stringify(record)}::jsonb, NOW())
      ON CONFLICT (review_id) DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = NOW()
    `;
  }
}
