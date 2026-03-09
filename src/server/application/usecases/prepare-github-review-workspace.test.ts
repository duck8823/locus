import { describe, expect, it } from "vitest";
import { PrepareGitHubReviewWorkspaceUseCase } from "@/server/application/usecases/prepare-github-review-workspace";
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

describe("PrepareGitHubReviewWorkspaceUseCase", () => {
  it("creates a queued placeholder session on cache miss", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    const useCase = new PrepareGitHubReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
      requestedAt: "2026-03-09T00:00:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(true);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("queued");
    expect(result.reviewSession.toRecord().analysisProcessedFiles).toBe(0);
    expect(result.reviewSession.toRecord().repositoryName).toBe("octocat/locus");
    expect(result.reviewSession.toRecord().source).toEqual({
      provider: "github",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
    });
  });

  it("reuses ready sessions without restarting analysis", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
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
        lastOpenedAt: "2026-03-09T00:00:00.000Z",
        analysisStatus: "ready",
      }),
    );
    const useCase = new PrepareGitHubReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
      requestedAt: "2026-03-09T00:05:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(false);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("ready");
  });

  it("requeues analysis when previous attempt failed", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-99",
        title: "PR #99: Broken demo",
        repositoryName: "octocat/locus",
        branchLabel: "feature/broken → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 99,
        },
        groups: [],
        lastOpenedAt: "2026-03-09T00:00:00.000Z",
        analysisStatus: "failed",
        analysisError: "GitHub API request failed",
      }),
    );
    const useCase = new PrepareGitHubReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-99",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 99,
      requestedAt: "2026-03-09T00:10:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(true);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("queued");
    expect(result.reviewSession.toRecord().analysisError).toBeNull();
  });

  it("requeues stale in-progress analysis after timeout", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-23",
        title: "PR #23: long parsing",
        repositoryName: "octocat/locus",
        branchLabel: "feature/slow-parse → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 23,
        },
        groups: [],
        lastOpenedAt: "2026-03-09T00:00:00.000Z",
        analysisStatus: "parsing",
        analysisRequestedAt: "2026-03-09T00:00:00.000Z",
      }),
    );
    const useCase = new PrepareGitHubReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-23",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 23,
      requestedAt: "2026-03-09T00:15:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(true);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("queued");
    expect(result.reviewSession.toRecord().analysisRequestedAt).toBe("2026-03-09T00:15:00.000Z");
  });

  it("keeps fresh in-progress analysis without duplicate restart", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-24",
        title: "PR #24: still fetching",
        repositoryName: "octocat/locus",
        branchLabel: "feature/fetching → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 24,
        },
        groups: [],
        lastOpenedAt: "2026-03-09T00:00:00.000Z",
        analysisStatus: "fetching",
        analysisRequestedAt: "2026-03-09T00:00:00.000Z",
      }),
    );
    const useCase = new PrepareGitHubReviewWorkspaceUseCase({ reviewSessionRepository });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-24",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 24,
      requestedAt: "2026-03-09T00:05:00.000Z",
    });

    expect(result.shouldStartIngestion).toBe(false);
    expect(result.reviewSession.toRecord().analysisStatus).toBe("fetching");
    expect(result.reviewSession.toRecord().analysisRequestedAt).toBe("2026-03-09T00:00:00.000Z");
  });
});
