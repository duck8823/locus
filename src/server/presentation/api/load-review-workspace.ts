import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { buildAiSuggestionPayload } from "@/server/application/ai/build-ai-suggestion-payload";
import {
  type AiSuggestion,
  type AiSuggestionPayload,
} from "@/server/application/ai/ai-suggestion-types";
import { generateAiSuggestionsFromPayload } from "@/server/application/ai/generate-ai-suggestions";
import { classifyAiSuggestionProviderError } from "@/server/application/ports/ai-suggestion-provider";
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

function toProviderErrorSummary(errorType: ReturnType<typeof classifyAiSuggestionProviderError>): string {
  if (errorType === "temporary") {
    return "AI suggestion provider temporary error";
  }

  if (errorType === "permanent") {
    return "AI suggestion provider permanent error";
  }

  return "AI suggestion provider unknown error";
}

function buildAiSuggestionFailureFallback(params: {
  payload: AiSuggestionPayload;
  errorType: ReturnType<typeof classifyAiSuggestionProviderError>;
  error: unknown;
}): AiSuggestion[] {
  return [
    {
      suggestionId: "ai-provider-fallback-manual-review",
      category: "general",
      confidence: "low",
      headline: "AI provider fallback applied",
      recommendation:
        "Primary AI provider failed. Continue with baseline checks while provider diagnostics are investigated.",
      rationale: [
        toProviderErrorSummary(params.errorType),
        params.error instanceof Error ? params.error.message : "Unknown provider failure.",
        params.payload.semanticContext.fallbackMessage ?? "Semantic context was limited.",
      ],
    },
  ];
}

function resolveAiSuggestionsWithFallback(params: {
  payload: AiSuggestionPayload;
  providerSuggestions: AiSuggestion[];
}): AiSuggestion[] {
  if (params.providerSuggestions.length > 0) {
    return params.providerSuggestions;
  }

  return generateAiSuggestionsFromPayload(params.payload);
}

export async function loadReviewWorkspaceDto({ reviewId }: LoadReviewWorkspaceInput): Promise<ReviewWorkspaceDto> {
  const { reviewSessionRepository, analysisJobScheduler, businessContextProvider, aiSuggestionProvider } =
    getDependencies();
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
  const selectedGroup =
    workspace.groups.find((group) => group.isSelected) ?? workspace.groups[0] ?? null;
  const aiSuggestionPayload = buildAiSuggestionPayload({
    review: {
      reviewId: workspace.reviewId,
      title: workspace.title,
      repositoryName: workspace.repositoryName,
      branchLabel: workspace.branchLabel,
    },
    selectedGroup: selectedGroup
      ? {
          groupId: selectedGroup.groupId,
          title: selectedGroup.title,
          filePath: selectedGroup.filePath,
          semanticChanges: selectedGroup.semanticChanges.map((change) => ({
            semanticChangeId: change.semanticChangeId,
            symbolDisplayName: change.symbolDisplayName,
            symbolKind: change.symbolKind,
            changeType: change.changeType,
            signatureSummary: change.signatureSummary,
            bodySummary: change.bodySummary,
            before: change.before,
            after: change.after,
          })),
          architectureGraph: {
            nodes: selectedGroup.architectureGraph.nodes.map((node) => ({
              nodeId: node.nodeId,
              kind: node.kind,
              label: node.label,
              role: node.role,
            })),
            edges: selectedGroup.architectureGraph.edges.map((edge) => ({
              fromNodeId: edge.fromNodeId,
              toNodeId: edge.toNodeId,
            })),
          },
        }
      : null,
    businessContextItems: businessContext.items.map((item) => ({
      contextId: item.contextId,
      sourceType: item.sourceType,
      status: item.status,
      confidence: item.confidence,
      title: item.title,
      summary: item.summary,
      href: item.href,
    })),
  });
  const aiSuggestions = await aiSuggestionProvider
    .generateSuggestions({ payload: aiSuggestionPayload })
    .then((providerSuggestions) =>
      resolveAiSuggestionsWithFallback({
        payload: aiSuggestionPayload,
        providerSuggestions,
      }),
    )
    .catch((error) => {
      const errorType = classifyAiSuggestionProviderError(error);

      try {
        return generateAiSuggestionsFromPayload(aiSuggestionPayload);
      } catch {
        return buildAiSuggestionFailureFallback({
          payload: aiSuggestionPayload,
          errorType,
          error,
        });
      }
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
    aiSuggestionPayload,
    aiSuggestions,
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
