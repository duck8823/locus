import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import { loadActiveInitialAnalysisJob } from "@/server/presentation/api/load-active-initial-analysis-job";
import { loadActiveManualReanalysisJob } from "@/server/presentation/api/load-active-manual-reanalysis-job";
import { loadAnalysisJobHistory } from "@/server/presentation/api/load-analysis-job-history";
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
  const analysisJobHistory = await loadAnalysisJobHistory({
    analysisJobScheduler,
    reviewId,
  });
  const workspace = toReviewWorkspaceDto(reviewSession);
  const reviewRecord = reviewSession.toRecord();
  const businessContextDiagnostics: ReviewWorkspaceDto["businessContext"]["diagnostics"] = {
    status: "ok",
    retryable: true,
    message: null,
    occurredAt: null,
  };
  const businessContext = await businessContextProvider.loadSnapshotForReview({
    reviewId: reviewRecord.reviewId,
    repositoryName: reviewRecord.repositoryName,
    branchLabel: reviewRecord.branchLabel,
    title: reviewRecord.title,
    source: reviewRecord.source ?? null,
  }).catch((error) => {
    const occurredAt = new Date().toISOString();
    businessContextDiagnostics.status = "fallback";
    businessContextDiagnostics.retryable = true;
    businessContextDiagnostics.message =
      error instanceof Error ? error.message : "Unknown business-context loading failure.";
    businessContextDiagnostics.occurredAt = occurredAt;

    return {
      generatedAt: occurredAt,
      provider: "stub" as const,
      items: [
        {
          contextId: `ctx-business-context-fallback-${reviewId}`,
          sourceType: "github_issue" as const,
          status: "unavailable" as const,
          confidence: "low" as const,
          inferenceSource: "none" as const,
          title: "Business context temporarily unavailable",
          summary: "Failed to load context provider output. Retry is available.",
          href: null,
        },
      ],
    };
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
    analysisHistory: analysisJobHistory.history,
    dogfoodingMetrics: analysisJobHistory.metrics,
    reanalysisStatus: effectiveReanalysisState.reanalysisStatus,
    lastReanalyzeRequestedAt: effectiveReanalysisState.lastReanalyzeRequestedAt,
    businessContext: {
      generatedAt: businessContext.generatedAt,
      provider: businessContextDiagnostics.status === "fallback" ? "fallback" : businessContext.provider,
      diagnostics: businessContextDiagnostics,
      items: businessContext.items.map((item) => ({
        contextId: item.contextId,
        sourceType: item.sourceType,
        status: item.status,
        confidence: item.confidence,
        inferenceSource: item.inferenceSource,
        title: item.title,
        summary: item.summary,
        href: item.href,
      })),
    },
  };
}
