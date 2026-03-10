import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import { loadActiveManualReanalysisJob } from "@/server/presentation/api/load-active-manual-reanalysis-job";
import { toReviewWorkspaceDto } from "@/server/presentation/mappers/to-review-workspace-dto";
import type { ReviewWorkspaceDto } from "@/server/presentation/dto/review-workspace-dto";
import { resolveEffectiveReanalysisState } from "@/server/presentation/formatters/effective-reanalysis-state";

export interface LoadReviewWorkspaceInput {
  reviewId: string;
}

export async function loadReviewWorkspaceDto({ reviewId }: LoadReviewWorkspaceInput): Promise<ReviewWorkspaceDto> {
  const { reviewSessionRepository, analysisJobScheduler } = getDependencies();
  const useCase = new GetReviewWorkspaceUseCase({ reviewSessionRepository });
  const reviewSession = await useCase.execute({ reviewId });
  const activeManualReanalysisJob = await loadActiveManualReanalysisJob({
    analysisJobScheduler,
    reviewId,
  });
  const workspace = toReviewWorkspaceDto(reviewSession);
  const effectiveReanalysisState = resolveEffectiveReanalysisState({
    persistedStatus: workspace.reanalysisStatus,
    persistedLastReanalyzeRequestedAt: workspace.lastReanalyzeRequestedAt,
    activeManualReanalysisJob,
  });

  return {
    ...workspace,
    reanalysisStatus: effectiveReanalysisState.reanalysisStatus,
    lastReanalyzeRequestedAt: effectiveReanalysisState.lastReanalyzeRequestedAt,
  };
}
