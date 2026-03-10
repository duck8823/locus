import { describe, expect, it } from "vitest";
import type {
  AnalysisJobScheduler,
  ScheduleAnalysisJobInput,
  ScheduledAnalysisJob,
} from "@/server/application/ports/analysis-job-scheduler";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import {
  defaultSeedFixtureId,
  defaultSeedReviewId,
} from "@/server/application/services/review-session-seed";
import { RequestManualReanalysisUseCase } from "@/server/application/usecases/request-manual-reanalysis";
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

class FailingAnalysisJobScheduler implements AnalysisJobScheduler {
  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    void input;
    throw new Error("failed to persist job");
  }
}

describe("RequestManualReanalysisUseCase", () => {
  it("marks reanalysis running and enqueues manual_reanalysis job", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-88",
        title: "PR #88: ready",
        repositoryName: "octocat/locus",
        branchLabel: "feature/reanalysis → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 88,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        reanalysisStatus: "idle",
      }),
    );
    const analysisJobScheduler = new SpyAnalysisJobScheduler();
    const useCase = new RequestManualReanalysisUseCase({
      reviewSessionRepository,
      analysisJobScheduler,
    });

    await useCase.execute({
      reviewId: "github-octocat-locus-pr-88",
      requestedAt: "2026-03-10T00:05:00.000Z",
    });
    const persisted = await reviewSessionRepository.findByReviewId("github-octocat-locus-pr-88");

    expect(analysisJobScheduler.calls).toEqual([
      {
        reviewId: "github-octocat-locus-pr-88",
        requestedAt: "2026-03-10T00:05:00.000Z",
        reason: "manual_reanalysis",
      },
    ]);
    expect(persisted?.toRecord().reanalysisStatus).toBe("running");
    expect(persisted?.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-10T00:05:00.000Z");
    expect(persisted?.toRecord().lastReanalyzeCompletedAt).toBeNull();
    expect(persisted?.toRecord().lastReanalyzeError).toBeNull();
  });

  it("accepts seed fixture sessions", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: defaultSeedReviewId,
        title: "Fixture review",
        repositoryName: "duck8823/locus",
        branchLabel: "seed",
        viewerName: "Demo reviewer",
        source: {
          provider: "seed_fixture",
          fixtureId: defaultSeedFixtureId,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
      }),
    );
    const analysisJobScheduler = new SpyAnalysisJobScheduler();
    const useCase = new RequestManualReanalysisUseCase({
      reviewSessionRepository,
      analysisJobScheduler,
    });

    await useCase.execute({
      reviewId: defaultSeedReviewId,
      requestedAt: "2026-03-10T00:05:00.000Z",
    });
    const persisted = await reviewSessionRepository.findByReviewId(defaultSeedReviewId);

    expect(analysisJobScheduler.calls).toEqual([
      {
        reviewId: defaultSeedReviewId,
        requestedAt: "2026-03-10T00:05:00.000Z",
        reason: "manual_reanalysis",
      },
    ]);
    expect(persisted?.toRecord().reanalysisStatus).toBe("running");
  });

  it("raises when review is missing", async () => {
    const useCase = new RequestManualReanalysisUseCase({
      reviewSessionRepository: new InMemoryReviewSessionRepository(),
      analysisJobScheduler: new SpyAnalysisJobScheduler(),
    });

    await expect(useCase.execute({ reviewId: "missing-review" })).rejects.toThrow(
      ReviewSessionNotFoundError,
    );
  });

  it("raises when source cannot be resolved", async () => {
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
    const useCase = new RequestManualReanalysisUseCase({
      reviewSessionRepository,
      analysisJobScheduler: new SpyAnalysisJobScheduler(),
    });

    await expect(useCase.execute({ reviewId: "custom-review" })).rejects.toThrow(
      ReanalyzeSourceUnavailableError,
    );
  });

  it("does not persist running state when enqueue fails", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-99",
        title: "PR #99: base",
        repositoryName: "octocat/locus",
        branchLabel: "feature/base → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 99,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        reanalysisStatus: "idle",
      }),
    );
    const useCase = new RequestManualReanalysisUseCase({
      reviewSessionRepository,
      analysisJobScheduler: new FailingAnalysisJobScheduler(),
    });

    await expect(
      useCase.execute({
        reviewId: "github-octocat-locus-pr-99",
        requestedAt: "2026-03-10T00:05:00.000Z",
      }),
    ).rejects.toThrow("failed to persist job");

    const persisted = await reviewSessionRepository.findByReviewId("github-octocat-locus-pr-99");
    expect(persisted?.toRecord().reanalysisStatus).toBe("idle");
    expect(persisted?.toRecord().lastReanalyzeRequestedAt).toBeNull();
  });
});
