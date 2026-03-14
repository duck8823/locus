import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";
import type {
  CodeRegionRef,
  SemanticChangeType,
  SemanticSymbolKind,
  UnsupportedFileReason,
} from "@/server/domain/value-objects/semantic-change";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";
import type { ReviewAnalysisStatus } from "@/server/domain/value-objects/analysis-status";

export interface ReviewWorkspaceActiveAnalysisJobDto {
  jobId: string;
  reason: "initial_ingestion" | "code_host_webhook";
  status: "queued" | "running";
  requestedAt: string;
  queuedAt: string;
  startedAt: string | null;
}

export interface ReviewWorkspaceAnalysisHistoryItemDto {
  jobId: string;
  reason: "initial_ingestion" | "manual_reanalysis" | "code_host_webhook";
  status: "queued" | "running" | "succeeded" | "failed";
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempts: number;
  lastError: string | null;
}

export interface ReviewWorkspaceDogfoodingMetricsDto {
  averageDurationMs: number | null;
  failureRatePercent: number | null;
  recoverySuccessRatePercent: number | null;
}

export interface ReviewWorkspaceQueueHealthDto {
  status: "healthy" | "degraded";
  queuedJobs: number;
  runningJobs: number;
  staleRunningJobs: number;
  failedTerminalJobs: number;
  lastFailedJob: {
    jobId: string;
    reason: "initial_ingestion" | "manual_reanalysis" | "code_host_webhook";
    completedAt: string | null;
    lastError: string | null;
  } | null;
  diagnostics: {
    staleRunningThresholdMs: number;
    reasonCodes: Array<"queue_backlog" | "stale_running_job" | "terminal_failure_detected">;
  };
}

export interface ReviewWorkspaceAiSuggestionPayloadDto {
  generatedAt: string;
  review: {
    reviewId: string;
    title: string;
    repositoryName: string;
    branchLabel: string;
  };
  semanticContext: {
    totalCount: number;
    includedCount: number;
    isTruncated: boolean;
    fallbackMessage: string | null;
    changes: Array<{
      semanticChangeId: string;
      symbolDisplayName: string;
      symbolKind: SemanticSymbolKind;
      changeType: SemanticChangeType;
      signatureSummary: string | null;
      bodySummary: string | null;
      location: string;
    }>;
  };
  architectureContext: {
    groupId: string | null;
    groupTitle: string | null;
    filePath: string | null;
    totalUpstreamCount: number;
    totalDownstreamCount: number;
    includedUpstreamCount: number;
    includedDownstreamCount: number;
    isTruncated: boolean;
    fallbackMessage: string | null;
    upstreamNodes: Array<{
      nodeId: string;
      kind: "layer" | "file" | "symbol" | "unknown";
      label: string;
    }>;
    downstreamNodes: Array<{
      nodeId: string;
      kind: "layer" | "file" | "symbol" | "unknown";
      label: string;
    }>;
  };
  businessContext: {
    totalCount: number;
    includedCount: number;
    isTruncated: boolean;
    fallbackMessage: string | null;
    items: Array<{
      contextId: string;
      sourceType: "github_issue" | "confluence_page";
      status: "linked" | "candidate" | "unavailable";
      confidence: "high" | "medium" | "low";
      title: string;
      summary: string | null;
      href: string | null;
    }>;
  };
}

export interface ReviewWorkspaceAiSuggestionDto {
  suggestionId: string;
  category: "semantic" | "architecture" | "business" | "general";
  confidence: "high" | "medium" | "low";
  headline: string;
  recommendation: string;
  rationale: string[];
}

export interface ReviewWorkspaceSemanticChangeDto {
  semanticChangeId: string;
  symbolDisplayName: string;
  symbolKind: SemanticSymbolKind;
  changeType: SemanticChangeType;
  signatureSummary: string | null;
  bodySummary: string | null;
  before: CodeRegionRef | null;
  after: CodeRegionRef | null;
}

export interface ReviewWorkspaceUnsupportedReasonDto {
  reason: UnsupportedFileReason;
  count: number;
}

export interface ReviewWorkspaceUnsupportedSummaryDto {
  totalCount: number;
  byReason: ReviewWorkspaceUnsupportedReasonDto[];
  sampleFilePaths: string[];
}

export interface ReviewWorkspaceUnsupportedFileDto {
  filePath: string;
  language: string | null;
  reason: UnsupportedFileReason;
  detail: string | null;
}

export interface ReviewWorkspaceGroupDto {
  groupId: string;
  title: string;
  summary: string;
  filePath: string;
  status: ReviewGroupStatus;
  isSelected: boolean;
  upstream: string[];
  downstream: string[];
  architectureGraph: ReviewWorkspaceArchitectureGraphDto;
  semanticChanges: ReviewWorkspaceSemanticChangeDto[];
}

export interface ReviewWorkspaceArchitectureNodeDto {
  nodeId: string;
  kind: "layer" | "file" | "symbol" | "unknown";
  label: string;
  role: "center" | "upstream" | "downstream";
  linkedGroupId: string | null;
}

export interface ReviewWorkspaceArchitectureEdgeDto {
  fromNodeId: string;
  toNodeId: string;
  relation: "imports" | "calls" | "implements" | "uses";
}

export interface ReviewWorkspaceArchitectureGraphDto {
  nodes: ReviewWorkspaceArchitectureNodeDto[];
  edges: ReviewWorkspaceArchitectureEdgeDto[];
}

export interface ReviewWorkspaceBusinessContextItemDto {
  contextId: string;
  sourceType: "github_issue" | "confluence_page";
  status: "linked" | "candidate" | "unavailable";
  confidence: "high" | "medium" | "low";
  inferenceSource:
    | "issue_url"
    | "repo_shorthand"
    | "same_repo_shorthand"
    | "same_repo_closing_keyword"
    | "branch_pattern"
    | "pull_request_fallback"
    | "none";
  title: string;
  summary: string | null;
  href: string | null;
}

export interface ReviewWorkspaceBusinessContextDto {
  generatedAt: string;
  provider: "stub" | "github_live" | "fallback";
  diagnostics: {
    status: "ok" | "fallback";
    retryable: boolean;
    message: string | null;
    occurredAt: string | null;
    cacheHit: boolean | null;
    fallbackReason: "stale_cache" | "live_fetch_failed" | null;
  };
  items: ReviewWorkspaceBusinessContextItemDto[];
}

export interface ReviewWorkspaceDto {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  analysisStatus: ReviewAnalysisStatus;
  analysisRequestedAt: string | null;
  analysisCompletedAt: string | null;
  analysisTotalFiles: number | null;
  analysisProcessedFiles: number | null;
  analysisSupportedFiles: number | null;
  analysisUnsupportedFiles: number;
  analysisCoveragePercent: number | null;
  analysisAttemptCount: number;
  analysisDurationMs: number | null;
  analysisError: string | null;
  activeAnalysisJob: ReviewWorkspaceActiveAnalysisJobDto | null;
  analysisHistory: ReviewWorkspaceAnalysisHistoryItemDto[];
  dogfoodingMetrics: ReviewWorkspaceDogfoodingMetricsDto;
  queueHealth: ReviewWorkspaceQueueHealthDto | null;
  aiSuggestionPayload: ReviewWorkspaceAiSuggestionPayloadDto | null;
  aiSuggestions: ReviewWorkspaceAiSuggestionDto[];
  reanalysisStatus: ReviewReanalysisStatus;
  lastOpenedAt: string;
  lastReanalyzeRequestedAt: string | null;
  lastReanalyzeCompletedAt: string | null;
  lastReanalyzeError: string | null;
  availableStatuses: ReviewGroupStatus[];
  unsupportedSummary: ReviewWorkspaceUnsupportedSummaryDto;
  unsupportedFiles: ReviewWorkspaceUnsupportedFileDto[];
  businessContext: ReviewWorkspaceBusinessContextDto;
  groups: ReviewWorkspaceGroupDto[];
}
