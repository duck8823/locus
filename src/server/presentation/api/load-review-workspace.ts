import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import { loadActiveInitialAnalysisJob } from "@/server/presentation/api/load-active-initial-analysis-job";
import { loadActiveManualReanalysisJob } from "@/server/presentation/api/load-active-manual-reanalysis-job";
import { toReviewWorkspaceDto } from "@/server/presentation/mappers/to-review-workspace-dto";
import type { ReviewWorkspaceDto } from "@/server/presentation/dto/review-workspace-dto";
import { resolveEffectiveReanalysisState } from "@/server/presentation/formatters/effective-reanalysis-state";

export interface LoadReviewWorkspaceInput {
  reviewId: string;
}

export async function loadReviewWorkspaceDto({ reviewId }: LoadReviewWorkspaceInput): Promise<ReviewWorkspaceDto> {
  const { reviewSessionRepository, analysisJobScheduler, businessContextProvider } = getDependencies();
  const useCase = new GetReviewWorkspaceUseCase({ reviewSessionRepository });
  const reviewSession = await useCase.execute({ reviewId });
  const activeInitialAnalysisJob = await loadActiveInitialAnalysisJob({
    analysisJobScheduler,
    reviewId,
  });
  const activeManualReanalysisJob = await loadActiveManualReanalysisJob({
    analysisJobScheduler,
    reviewId,
  });
  const workspace = toReviewWorkspaceDto(reviewSession);
  const reviewRecord = reviewSession.toRecord();
  const businessContext = await businessContextProvider.loadSnapshotForReview({
    reviewId: reviewRecord.reviewId,
    repositoryName: reviewRecord.repositoryName,
    title: reviewRecord.title,
    source: reviewRecord.source ?? null,
  });
  const effectiveReanalysisState = resolveEffectiveReanalysisState({
    persistedStatus: workspace.reanalysisStatus,
    persistedLastReanalyzeRequestedAt: workspace.lastReanalyzeRequestedAt,
    activeManualReanalysisJob,
  });

  return {
    ...workspace,
    activeAnalysisJob: activeInitialAnalysisJob
      ? {
          jobId: activeInitialAnalysisJob.jobId,
          reason: activeInitialAnalysisJob.reason,
          status: activeInitialAnalysisJob.status,
          requestedAt: activeInitialAnalysisJob.requestedAt,
          queuedAt: activeInitialAnalysisJob.queuedAt,
          startedAt: activeInitialAnalysisJob.startedAt ?? null,
        }
      : null,
    reanalysisStatus: effectiveReanalysisState.reanalysisStatus,
    lastReanalyzeRequestedAt: effectiveReanalysisState.lastReanalyzeRequestedAt,
    businessContext: {
      generatedAt: businessContext.generatedAt,
      provider: businessContext.provider,
      items: businessContext.items.map((item) => ({
        contextId: item.contextId,
        sourceType: item.sourceType,
        status: item.status,
        title: item.title,
        summary: item.summary,
        href: item.href,
      })),
    },
  };
}
