import { describe, expect, it } from "vitest";
import { PrepareGitLabReviewWorkspaceUseCase } from "@/server/application/usecases/prepare-gitlab-review-workspace";
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

  seed(reviewSession: ReviewSession): void {
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }
}

describe("PrepareGitLabReviewWorkspaceUseCase", () => {
  it("creates a queued placeholder session on cache miss", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    const useCase = new PrepareGitLabReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "gitlab-duck8823-locus-mr-42",
      viewerName: "Demo reviewer",
      projectPath: "duck8823/locus",
      mergeRequestIid: 42,
      requestedAt: "2026-03-15T00:00:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(true);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("queued");
    expect(result.reviewSession.toRecord().analysisProcessedFiles).toBe(0);
    expect(result.reviewSession.toRecord().repositoryName).toBe("duck8823/locus");
    expect(result.reviewSession.toRecord().source).toEqual({
      provider: "gitlab",
      projectPath: "duck8823/locus",
      mergeRequestIid: 42,
    });
  });

  it("reuses ready sessions without restarting analysis", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "gitlab-duck8823-locus-mr-42",
        title: "MR !42: Improve parser behavior",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/parser → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 42,
        },
        groups: [
          {
            groupId: "group-1",
            title: "Group 1",
            summary: "Summary",
            filePath: "src/user-service.ts",
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
        lastOpenedAt: "2026-03-15T00:00:00.000Z",
        analysisStatus: "ready",
      }),
    );
    const useCase = new PrepareGitLabReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "gitlab-duck8823-locus-mr-42",
      viewerName: "Demo reviewer",
      projectPath: "duck8823/locus",
      mergeRequestIid: 42,
      requestedAt: "2026-03-15T00:05:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(false);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("ready");
  });

  it("requeues analysis when previous attempt failed", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "gitlab-duck8823-locus-mr-99",
        title: "MR !99: Broken demo",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/broken → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 99,
        },
        groups: [],
        lastOpenedAt: "2026-03-15T00:00:00.000Z",
        analysisStatus: "failed",
        analysisError: "GitLab API request failed",
      }),
    );
    const useCase = new PrepareGitLabReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "gitlab-duck8823-locus-mr-99",
      viewerName: "Demo reviewer",
      projectPath: "duck8823/locus",
      mergeRequestIid: 99,
      requestedAt: "2026-03-15T00:10:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(true);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("queued");
    expect(result.reviewSession.toRecord().analysisError).toBeNull();
  });

  it("requeues stale in-progress analysis after timeout", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "gitlab-duck8823-locus-mr-23",
        title: "MR !23: long parsing",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/slow-parse → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 23,
        },
        groups: [],
        lastOpenedAt: "2026-03-15T00:00:00.000Z",
        analysisStatus: "parsing",
        analysisRequestedAt: "2026-03-15T00:00:00.000Z",
      }),
    );
    const useCase = new PrepareGitLabReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "gitlab-duck8823-locus-mr-23",
      viewerName: "Demo reviewer",
      projectPath: "duck8823/locus",
      mergeRequestIid: 23,
      requestedAt: "2026-03-15T00:15:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(true);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("queued");
    expect(result.reviewSession.toRecord().analysisRequestedAt).toBe("2026-03-15T00:15:00.000Z");
  });

  it("keeps fresh in-progress analysis without duplicate restart", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "gitlab-duck8823-locus-mr-24",
        title: "MR !24: still fetching",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/fetching → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 24,
        },
        groups: [],
        lastOpenedAt: "2026-03-15T00:00:00.000Z",
        analysisStatus: "fetching",
        analysisRequestedAt: "2026-03-15T00:00:00.000Z",
      }),
    );
    const useCase = new PrepareGitLabReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "gitlab-duck8823-locus-mr-24",
      viewerName: "Demo reviewer",
      projectPath: "duck8823/locus",
      mergeRequestIid: 24,
      requestedAt: "2026-03-15T00:05:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(false);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("fetching");
    expect(result.reviewSession.toRecord().analysisRequestedAt).toBe("2026-03-15T00:00:00.000Z");
  });
});
