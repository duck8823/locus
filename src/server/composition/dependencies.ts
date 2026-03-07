import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";
import { NoopAnalysisJobScheduler } from "@/server/infrastructure/queue/noop-analysis-job-scheduler";

const reviewSessionRepository = new FileReviewSessionRepository();
const analysisJobScheduler = new NoopAnalysisJobScheduler();
const parserAdapters = [new TypeScriptParserAdapter()];

export function getDependencies() {
  return {
    reviewSessionRepository,
    analysisJobScheduler,
    parserAdapters,
  };
}
