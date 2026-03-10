import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type { ScheduleAnalysisJobInput } from "@/server/application/ports/analysis-job-scheduler";
import type { PullRequestSnapshotProvider } from "@/server/application/ports/pull-request-snapshot-provider";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { RunGitHubIngestionJobUseCase } from "@/server/application/usecases/run-github-ingestion-job";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

export interface RunScheduledAnalysisJobInput extends ScheduleAnalysisJobInput {
  jobId: string;
}

export interface RunScheduledAnalysisJobDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  parserAdapters: ParserAdapter[];
  pullRequestSnapshotProvider: PullRequestSnapshotProvider;
}

export class RunScheduledAnalysisJobUseCase {
  constructor(private readonly dependencies: RunScheduledAnalysisJobDependencies) {}

  async execute(input: RunScheduledAnalysisJobInput): Promise<void> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(
      input.reviewId,
    );

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(input.reviewId);
    }

    if (input.reason === "initial_ingestion") {
      const source = reviewSession.toRecord().source;

      if (!source || source.provider !== "github") {
        throw new ReanalyzeSourceUnavailableError(input.reviewId);
      }

      const useCase = new RunGitHubIngestionJobUseCase({
        reviewSessionRepository: this.dependencies.reviewSessionRepository,
        parserAdapters: this.dependencies.parserAdapters,
        pullRequestSnapshotProvider: this.dependencies.pullRequestSnapshotProvider,
      });

      await useCase.execute({
        reviewId: input.reviewId,
        viewerName: reviewSession.viewerName,
        owner: source.owner,
        repository: source.repository,
        pullRequestNumber: source.pullRequestNumber,
        requestedAt: input.requestedAt,
      });
      return;
    }

    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: this.dependencies.reviewSessionRepository,
      parserAdapters: this.dependencies.parserAdapters,
      pullRequestSnapshotProvider: this.dependencies.pullRequestSnapshotProvider,
    });

    await useCase.execute({
      reviewId: input.reviewId,
      requestedAt: input.requestedAt,
    });
  }
}
