import { FileReviewSessionRepository } from "@/server/infrastructure/db/file-review-session-repository";
import { NoopAnalysisJobScheduler } from "@/server/infrastructure/queue/noop-analysis-job-scheduler";

const reviewSessionRepository = new FileReviewSessionRepository();
const analysisJobScheduler = new NoopAnalysisJobScheduler();

export function getDependencies() {
  return {
    reviewSessionRepository,
    analysisJobScheduler,
  };
}
