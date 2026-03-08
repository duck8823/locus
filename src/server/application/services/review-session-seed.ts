import { createAnalyzedReviewSession } from "@/server/application/services/create-analyzed-review-session";
import { createSeedSourceSnapshotPairs } from "@/server/application/services/seed-source-snapshot-fixture";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type { ReviewSession } from "@/server/domain/entities/review-session";

export interface CreateSeedReviewSessionInput {
  reviewId: string;
  viewerName: string;
  createdAt: string;
  parserAdapters: ParserAdapter[];
}

export const defaultSeedFixtureId = "default";

export async function createSeedReviewSession({
  reviewId,
  viewerName,
  createdAt,
  parserAdapters,
}: CreateSeedReviewSessionInput): Promise<ReviewSession> {
  return createAnalyzedReviewSession({
    reviewId,
    title: "Demo semantic review workspace",
    repositoryName: "duck8823/locus",
    branchLabel: "feat/semantic-analysis-spike",
    viewerName,
    source: {
      provider: "seed_fixture",
      fixtureId: defaultSeedFixtureId,
    },
    createdAt,
    snapshotPairs: createSeedSourceSnapshotPairs(reviewId),
    parserAdapters,
  });
}
