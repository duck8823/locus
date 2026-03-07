import { describe, expect, it } from "vitest";
import { OpenReviewWorkspaceUseCase } from "@/server/application/usecases/open-review-workspace";
import { SelectReviewGroupUseCase } from "@/server/application/usecases/select-review-group";
import { MarkReviewGroupStatusUseCase } from "@/server/application/usecases/mark-review-group-status";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

class InMemoryReviewSessionRepository implements ReviewSessionRepository {
  private readonly store = new Map<string, ReturnType<ReviewSession["toRecord"]>>();

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const record = this.store.get(reviewId);
    return record ? ReviewSession.fromRecord(record) : null;
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }
}

describe("OpenReviewWorkspaceUseCase", () => {
  it("seeds the first workspace when it does not exist", async () => {
    const repository = new InMemoryReviewSessionRepository();
    const useCase = new OpenReviewWorkspaceUseCase({ reviewSessionRepository: repository });

    const session = await useCase.execute({
      reviewId: "demo-review",
      viewerName: "Demo reviewer",
      openedAt: "2026-03-07T00:00:00.000Z",
    });

    expect(session.toRecord().groups).toHaveLength(3);
    expect(session.toRecord().selectedGroupId).toBe("workspace-route");
  });

  it("persists selection and status across reopen", async () => {
    const repository = new InMemoryReviewSessionRepository();
    const openUseCase = new OpenReviewWorkspaceUseCase({ reviewSessionRepository: repository });
    const selectUseCase = new SelectReviewGroupUseCase({ reviewSessionRepository: repository });
    const markUseCase = new MarkReviewGroupStatusUseCase({ reviewSessionRepository: repository });

    await openUseCase.execute({
      reviewId: "demo-review",
      viewerName: "Demo reviewer",
      openedAt: "2026-03-07T00:00:00.000Z",
    });
    await selectUseCase.execute({ reviewId: "demo-review", groupId: "file-repository" });
    await markUseCase.execute({
      reviewId: "demo-review",
      groupId: "file-repository",
      status: "reviewed",
    });

    const reopened = await openUseCase.execute({
      reviewId: "demo-review",
      viewerName: "Demo reviewer",
      openedAt: "2026-03-07T01:30:00.000Z",
    });

    const record = reopened.toRecord();
    expect(record.selectedGroupId).toBe("file-repository");
    expect(record.groups.find((group) => group.groupId === "file-repository")?.status).toBe(
      "reviewed",
    );
    expect(record.lastOpenedAt).toBe("2026-03-07T01:30:00.000Z");
  });
});
