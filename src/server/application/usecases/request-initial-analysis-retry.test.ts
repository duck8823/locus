import { describe, expect, it } from "vitest";
import type { AnalysisJobScheduler, ScheduleAnalysisJobInput } from "@/server/application/ports/analysis-job-scheduler";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { RequestInitialAnalysisRetryUseCase } from "@/server/application/usecases/request-initial-analysis-retry";
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

class SpyAnalysisJobScheduler implements AnalysisJobScheduler {
  readonly calls: ScheduleAnalysisJobInput[] = [];

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput) {
    this.calls.push(input);
    return {
      jobId: "job-1",
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }
}

describe("RequestInitialAnalysisRetryUseCase", () => {
  it("queues a retry job and updates analysis status to queued", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-55",
        title: "PR #55: failed",
        repositoryName: "octocat/locus",
        branchLabel: "feature/failed → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 55,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        analysisStatus: "failed",
        analysisAttemptCount: 1,
        analysisError: "GitHub API request failed",
      }),
    );
    const analysisJobScheduler = new SpyAnalysisJobScheduler();
    const useCase = new RequestInitialAnalysisRetryUseCase({
      reviewSessionRepository,
      analysisJobScheduler,
    });

    await useCase.execute({
      reviewId: "github-octocat-locus-pr-55",
      requestedAt: "2026-03-10T00:05:00.000Z",
    });
    const persisted = await reviewSessionRepository.findByReviewId("github-octocat-locus-pr-55");

    expect(analysisJobScheduler.calls).toEqual([
      {
        reviewId: "github-octocat-locus-pr-55",
        requestedAt: "2026-03-10T00:05:00.000Z",
        reason: "initial_ingestion",
      },
    ]);
    expect(persisted?.toRecord().analysisStatus).toBe("queued");
    expect(persisted?.toRecord().analysisRequestedAt).toBe("2026-03-10T00:05:00.000Z");
    expect(persisted?.toRecord().analysisAttemptCount).toBe(1);
    expect(persisted?.toRecord().analysisError).toBeNull();
  });



  it("queues retry for gitlab-backed sessions", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "gitlab-duck8823-locus-mr-42",
        title: "MR !42: failed",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/mr-42 → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 42,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        analysisStatus: "failed",
        analysisAttemptCount: 2,
        analysisError: "GitLab API request failed",
      }),
    );
    const analysisJobScheduler = new SpyAnalysisJobScheduler();
    const useCase = new RequestInitialAnalysisRetryUseCase({
      reviewSessionRepository,
      analysisJobScheduler,
    });

    await useCase.execute({
      reviewId: "gitlab-duck8823-locus-mr-42",
      requestedAt: "2026-03-10T00:06:00.000Z",
    });

    expect(analysisJobScheduler.calls).toEqual([
      {
        reviewId: "gitlab-duck8823-locus-mr-42",
        requestedAt: "2026-03-10T00:06:00.000Z",
        reason: "initial_ingestion",
      },
    ]);
  });

  it("raises when review is missing", async () => {
    const useCase = new RequestInitialAnalysisRetryUseCase({
      reviewSessionRepository: new InMemoryReviewSessionRepository(),
      analysisJobScheduler: new SpyAnalysisJobScheduler(),
    });

    await expect(useCase.execute({ reviewId: "missing-review" })).rejects.toThrow(
      ReviewSessionNotFoundError,
    );
  });

  it("raises when source is neither github nor gitlab", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "custom-review",
        title: "Custom",
        repositoryName: "duck8823/locus",
        branchLabel: "feat/custom",
        viewerName: "Demo reviewer",
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
      }),
    );
    const useCase = new RequestInitialAnalysisRetryUseCase({
      reviewSessionRepository,
      analysisJobScheduler: new SpyAnalysisJobScheduler(),
    });

    await expect(useCase.execute({ reviewId: "custom-review" })).rejects.toThrow(
      ReanalyzeSourceUnavailableError,
    );
  });
});
