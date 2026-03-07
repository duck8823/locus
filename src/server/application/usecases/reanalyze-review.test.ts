import { describe, expect, it } from "vitest";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import type { AnalysisJobScheduler, ScheduleAnalysisJobInput, ScheduledAnalysisJob } from "@/server/application/ports/analysis-job-scheduler";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
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

class RecordingAnalysisJobScheduler implements AnalysisJobScheduler {
  lastInput: ScheduleAnalysisJobInput | null = null;

  async scheduleReviewAnalysis(input: ScheduleAnalysisJobInput): Promise<ScheduledAnalysisJob> {
    this.lastInput = input;

    return {
      jobId: `job-${input.reviewId}`,
      acceptedAt: input.requestedAt,
      reason: input.reason,
    };
  }
}

describe("ReanalyzeReviewUseCase", () => {
  it("updates the review session and schedules a manual reanalysis job", async () => {
    const repository = new InMemoryReviewSessionRepository();
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
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const analysisJobScheduler = new RecordingAnalysisJobScheduler();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      analysisJobScheduler,
    });

    const result = await useCase.execute({
      reviewId: "demo-review",
      requestedAt: "2026-03-07T01:00:00.000Z",
    });

    expect(result.reviewSession.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-07T01:00:00.000Z");
    expect(analysisJobScheduler.lastInput).toEqual({
      reviewId: "demo-review",
      requestedAt: "2026-03-07T01:00:00.000Z",
      reason: "manual_reanalysis",
    });
  });

  it("raises when the review session does not exist", async () => {
    const repository = new InMemoryReviewSessionRepository();
    const analysisJobScheduler = new RecordingAnalysisJobScheduler();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      analysisJobScheduler,
    });

    await expect(useCase.execute({ reviewId: "missing-review" })).rejects.toThrow(
      ReviewSessionNotFoundError,
    );
  });
});
