import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";
import type {
  CodeRegionRef,
  SemanticChangeType,
  SemanticSymbolKind,
  UnsupportedFileReason,
} from "@/server/domain/value-objects/semantic-change";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";
import type { ReviewAnalysisStatus } from "@/server/domain/value-objects/analysis-status";

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
  analysisAttemptCount: number;
  analysisDurationMs: number | null;
  analysisError: string | null;
  reanalysisStatus: ReviewReanalysisStatus;
  lastOpenedAt: string;
  lastReanalyzeRequestedAt: string | null;
  lastReanalyzeCompletedAt: string | null;
  lastReanalyzeError: string | null;
  availableStatuses: ReviewGroupStatus[];
  unsupportedSummary: ReviewWorkspaceUnsupportedSummaryDto;
  groups: ReviewWorkspaceGroupDto[];
}
