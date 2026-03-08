import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";
import type {
  CodeRegionRef,
  SemanticChangeType,
  SemanticSymbolKind,
  UnsupportedFileReason,
} from "@/server/domain/value-objects/semantic-change";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";

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
  semanticChanges: ReviewWorkspaceSemanticChangeDto[];
}

export interface ReviewWorkspaceDto {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  reanalysisStatus: ReviewReanalysisStatus;
  lastOpenedAt: string;
  lastReanalyzeRequestedAt: string | null;
  lastReanalyzeCompletedAt: string | null;
  lastReanalyzeError: string | null;
  availableStatuses: ReviewGroupStatus[];
  unsupportedSummary: ReviewWorkspaceUnsupportedSummaryDto;
  groups: ReviewWorkspaceGroupDto[];
}
