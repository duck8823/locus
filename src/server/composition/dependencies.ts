import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { GitHubPullRequestSnapshotProvider } from "@/server/infrastructure/github/github-pull-request-snapshot-provider";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import { RunScheduledAnalysisJobUseCase } from "@/server/application/usecases/run-scheduled-analysis-job";
import { FileAnalysisJobScheduler } from "@/server/infrastructure/queue/file-analysis-job-scheduler";

const reviewSessionRepository = new FileReviewSessionRepository();
const parserAdapters = [new TypeScriptParserAdapter()];
const pullRequestSnapshotProvider = new GitHubPullRequestSnapshotProvider();
const runScheduledAnalysisJobUseCase = new RunScheduledAnalysisJobUseCase({
  reviewSessionRepository,
  parserAdapters,
  pullRequestSnapshotProvider,
});
const analysisJobScheduler = new FileAnalysisJobScheduler({
  onJob: async (job) => {
    await runScheduledAnalysisJobUseCase.execute({
      jobId: job.jobId,
      reviewId: job.reviewId,
      requestedAt: job.requestedAt,
      reason: job.reason,
    });
  },
});

export function getDependencies() {
  return {
    reviewSessionRepository,
    analysisJobScheduler,
    parserAdapters,
    pullRequestSnapshotProvider,
  };
}
