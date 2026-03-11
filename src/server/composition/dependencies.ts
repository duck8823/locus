import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { FileConnectionStateRepository } from "@/server/infrastructure/db/file-connection-state-repository";
import { PrototypeConnectionProviderCatalog } from "@/server/application/services/connection-catalog";
import { GitHubPullRequestSnapshotProvider } from "@/server/infrastructure/github/github-pull-request-snapshot-provider";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import { RunScheduledAnalysisJobUseCase } from "@/server/application/usecases/run-scheduled-analysis-job";
import { FileAnalysisJobScheduler } from "@/server/infrastructure/queue/file-analysis-job-scheduler";

function readOptionalNonNegativeIntegerEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

const reviewSessionRepository = new FileReviewSessionRepository();
const connectionStateRepository = new FileConnectionStateRepository();
const connectionProviderCatalog = new PrototypeConnectionProviderCatalog();
const parserAdapters = [new TypeScriptParserAdapter()];
const pullRequestSnapshotProvider = new GitHubPullRequestSnapshotProvider();
const runScheduledAnalysisJobUseCase = new RunScheduledAnalysisJobUseCase({
  reviewSessionRepository,
  parserAdapters,
  pullRequestSnapshotProvider,
});
const analysisJobScheduler = new FileAnalysisJobScheduler({
  maxAttempts: readOptionalNonNegativeIntegerEnv("LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS"),
  maxRetainedTerminalJobs: readOptionalNonNegativeIntegerEnv(
    "LOCUS_ANALYSIS_JOB_MAX_RETAINED_TERMINAL_JOBS",
  ),
  staleRunningMs: readOptionalNonNegativeIntegerEnv("LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS"),
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
    connectionStateRepository,
    connectionProviderCatalog,
    analysisJobScheduler,
    parserAdapters,
    pullRequestSnapshotProvider,
  };
}
