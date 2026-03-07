import { describe, expect, it } from "vitest";
import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

class CountingReviewSessionRepository implements ReviewSessionRepository {
  private readonly store = new Map<string, ReturnType<ReviewSession["toRecord"]>>();
  saveCount = 0;

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const record = this.store.get(reviewId);
    return record ? ReviewSession.fromRecord(record) : null;
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    this.saveCount += 1;
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }

  seed(reviewSession: ReviewSession): void {
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }
}

describe("GetReviewWorkspaceUseCase", () => {
  it("returns an existing workspace without rewriting last-opened state", async () => {
    const repository = new CountingReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "demo-review",
        title: "Demo",
        repositoryName: "duck8823/locus",
        branchLabel: "feat/web-shell-skeleton",
        viewerName: "Demo reviewer",
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "group-a",
            title: "Group A",
            summary: "Summary",
            filePath: "src/a.ts",
            status: "reviewed",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const useCase = new GetReviewWorkspaceUseCase({ reviewSessionRepository: repository });

    const reviewSession = await useCase.execute({ reviewId: "demo-review" });

    expect(reviewSession.toRecord().lastOpenedAt).toBe("2026-03-07T00:00:00.000Z");
    expect(repository.saveCount).toBe(0);
  });

  it("raises when the workspace has not been opened yet", async () => {
    const repository = new CountingReviewSessionRepository();
    const useCase = new GetReviewWorkspaceUseCase({ reviewSessionRepository: repository });

    await expect(useCase.execute({ reviewId: "missing-review" })).rejects.toThrow(
      "Review session not found: missing-review",
    );
  });
});
