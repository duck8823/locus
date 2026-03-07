import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { GitHubPullRequestSnapshotProvider } from "@/server/infrastructure/github/github-pull-request-snapshot-provider";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import { NoopAnalysisJobScheduler } from "@/server/infrastructure/queue/noop-analysis-job-scheduler";

const reviewSessionRepository = new FileReviewSessionRepository();
const analysisJobScheduler = new NoopAnalysisJobScheduler();
const parserAdapters = [new TypeScriptParserAdapter()];
const pullRequestSnapshotProvider = new GitHubPullRequestSnapshotProvider();

export function getDependencies() {
  return {
    reviewSessionRepository,
    analysisJobScheduler,
    parserAdapters,
    pullRequestSnapshotProvider,
  };
}
