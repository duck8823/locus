import { GetReviewWorkspaceUseCase } from "@/server/application/usecases/get-review-workspace";
import { buildAiSuggestionPayload } from "@/server/application/ai/build-ai-suggestion-payload";
import {
  type AiSuggestion,
  type AiSuggestionPayload,
} from "@/server/application/ai/ai-suggestion-types";
import { LiveBusinessContextUnavailableError } from "@/server/application/errors/live-business-context-unavailable-error";
import {
  classifyAiSuggestionProviderError,
  type AiSuggestionProviderErrorType,
} from "@/server/application/ports/ai-suggestion-provider";
import { resolveGitHubIssueContextAccess } from "@/server/application/services/resolve-github-issue-context-access";
import { DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS } from "@/server/application/constants/analysis-job-queue-policy";
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

const AI_PROVIDER_FALLBACK_SUGGESTION_ID = "ai-provider-fallback-manual-review";
const PROVIDER_ERROR_LABEL: Record<AiSuggestionProviderErrorType, string> = {
  temporary: "AI suggestion provider temporary error",
  permanent: "AI suggestion provider permanent error",
  unknown: "AI suggestion provider unknown error",
};

function toProviderErrorSummary(errorType: AiSuggestionProviderErrorType): string {
  return PROVIDER_ERROR_LABEL[errorType];
}

function buildAiSuggestionFailureFallback(params: {
  payload: AiSuggestionPayload;
  errorType: AiSuggestionProviderErrorType;
}): AiSuggestion[] {
  const contextFallbackMessages = [
    params.payload.semanticContext.fallbackMessage,
    params.payload.architectureContext.fallbackMessage,
    params.payload.businessContext.fallbackMessage,
  ].filter((message): message is string => !!message);
  const rationale = [toProviderErrorSummary(params.errorType), ...contextFallbackMessages];

  return [
    {
      suggestionId: AI_PROVIDER_FALLBACK_SUGGESTION_ID,
      category: "general",
      confidence: "low",
      headline: "AI provider fallback applied",
      recommendation:
        "Primary AI provider failed. Continue with baseline checks while provider diagnostics are investigated.",
      rationale,
    },
  ];
}

function resolveAnalysisJobStaleRunningThresholdMs(): number {
  const value = process.env.LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS?.trim();

  if (!value || !/^\d+$/.test(value)) {
    return DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return DEFAULT_ANALYSIS_JOB_STALE_RUNNING_MS;
  }

  return parsed;
}

export async function loadReviewWorkspaceDto({ reviewId }: LoadReviewWorkspaceInput): Promise<ReviewWorkspaceDto> {
  const {
    reviewSessionRepository,
    analysisJobScheduler,
    businessContextProvider,
    connectionTokenRepository,
    aiSuggestionProvider,
  } = getDependencies();
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
    staleRunningThresholdMs: resolveAnalysisJobStaleRunningThresholdMs(),
  });
  if (analysisJobHistory.queueHealth.status === "degraded") {
    console.warn("analysis_queue_health_degraded", {
      reviewId,
      ...analysisJobHistory.queueHealth,
    });
  }
  const workspace = toReviewWorkspaceDto(reviewSession);
  const reviewRecord = reviewSession.toRecord();
  const businessContextDiagnostics: ReviewWorkspaceDto["businessContext"]["diagnostics"] = {
    status: "ok",
    retryable: true,
    message: null,
    occurredAt: null,
    cacheHit: null,
    fallbackReason: null,
  };
  const businessContext = await (async () => {
    const githubIssueContextAccess =
      reviewRecord.source?.provider === "github"
        ? await resolveGitHubIssueContextAccess({
            reviewerId: reviewRecord.viewerName,
            connectionTokenRepository,
          })
        : {
            accessToken: null,
            grantedScopes: [],
          };

    return businessContextProvider.loadSnapshotForReview({
      reviewerId: reviewRecord.viewerName,
      reviewId: reviewRecord.reviewId,
      repositoryName: reviewRecord.repositoryName,
      branchLabel: reviewRecord.branchLabel,
      title: reviewRecord.title,
      githubIssueAccessToken: githubIssueContextAccess.accessToken,
      githubIssueGrantedScopes: githubIssueContextAccess.grantedScopes,
      source: reviewRecord.source ?? null,
    });
  })().catch((error) => {
    const occurredAt = new Date().toISOString();
    businessContextDiagnostics.status = "fallback";
    businessContextDiagnostics.retryable = true;
    businessContextDiagnostics.message =
      error instanceof Error ? error.message : "Unknown business-context loading failure.";
    businessContextDiagnostics.occurredAt = occurredAt;

    if (error instanceof LiveBusinessContextUnavailableError) {
      businessContextDiagnostics.cacheHit =
        error.cacheHit ?? error.fallbackSnapshot.diagnostics.cacheHit ?? false;
      businessContextDiagnostics.fallbackReason =
        error.fallbackReason ?? error.fallbackSnapshot.diagnostics.fallbackReason ?? "live_fetch_failed";
      return {
        ...error.fallbackSnapshot,
        generatedAt: occurredAt,
      };
    }

    businessContextDiagnostics.cacheHit = false;
    businessContextDiagnostics.fallbackReason = "live_fetch_failed";

    return {
      generatedAt: occurredAt,
      provider: "stub" as const,
      diagnostics: {
        cacheHit: false,
        fallbackReason: "live_fetch_failed" as const,
      },
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
  let aiSuggestions: AiSuggestion[];

  try {
    aiSuggestions = await aiSuggestionProvider.generateSuggestions({
      payload: aiSuggestionPayload,
    });
  } catch (error) {
    const errorType = classifyAiSuggestionProviderError(error);
    console.error("ai_suggestion_provider_failed", {
      reviewId: workspace.reviewId,
      errorType,
      message: error instanceof Error ? error.message : String(error),
    });
    aiSuggestions = buildAiSuggestionFailureFallback({
      payload: aiSuggestionPayload,
      errorType,
    });
  }
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
    queueHealth: analysisJobHistory.queueHealth,
    aiSuggestionPayload,
    aiSuggestions,
    reanalysisStatus: effectiveReanalysisState.reanalysisStatus,
    lastReanalyzeRequestedAt: effectiveReanalysisState.lastReanalyzeRequestedAt,
    businessContext: {
      generatedAt: businessContext.generatedAt,
      provider: businessContextDiagnostics.status === "fallback" ? "fallback" : businessContext.provider,
      diagnostics: {
        ...businessContextDiagnostics,
        cacheHit: businessContextDiagnostics.cacheHit ?? businessContext.diagnostics.cacheHit ?? null,
        fallbackReason:
          businessContextDiagnostics.fallbackReason ??
          businessContext.diagnostics.fallbackReason ??
          null,
      },
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
