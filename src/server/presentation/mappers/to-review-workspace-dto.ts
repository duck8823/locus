import { reviewGroupStatuses } from "@/server/domain/value-objects/review-status";
import type { ReviewSession } from "@/server/domain/entities/review-session";
import type {
  SemanticChange,
  UnsupportedFileAnalysis,
  UnsupportedFileReason,
} from "@/server/domain/value-objects/semantic-change";
import type {
  ReviewWorkspaceDto,
  ReviewWorkspaceSemanticChangeDto,
  ReviewWorkspaceUnsupportedSummaryDto,
} from "@/server/presentation/dto/review-workspace-dto";

const unsupportedReasonOrder: UnsupportedFileReason[] = [
  "unsupported_language",
  "parser_failed",
  "binary_file",
];

function toSemanticChangeDto(change: SemanticChange): ReviewWorkspaceSemanticChangeDto {
  return {
    semanticChangeId: change.semanticChangeId,
    symbolDisplayName: change.symbol.displayName,
    symbolKind: change.symbol.kind,
    changeType: change.change.type,
    signatureSummary: change.change.signatureSummary ?? null,
    bodySummary: change.change.bodySummary ?? null,
    before: change.before ? { ...change.before } : null,
    after: change.after ? { ...change.after } : null,
  };
}

function toUnsupportedSummary(
  unsupportedFileAnalyses: UnsupportedFileAnalysis[],
): ReviewWorkspaceUnsupportedSummaryDto {
  const byReason = unsupportedReasonOrder
    .map((reason) => ({
      reason,
      count: unsupportedFileAnalyses.filter((entry) => entry.reason === reason).length,
    }))
    .filter((entry) => entry.count > 0);

  const sampleFilePaths = unsupportedFileAnalyses.slice(0, 5).map((entry) => entry.filePath);

  return {
    totalCount: unsupportedFileAnalyses.length,
    byReason,
    sampleFilePaths,
  };
}

export function toReviewWorkspaceDto(reviewSession: ReviewSession): ReviewWorkspaceDto {
  const record = reviewSession.toRecord();
  const semanticChangeMap = new Map(
    (record.semanticChanges ?? []).map((change) => [change.semanticChangeId, change] as const),
  );

  return {
    reviewId: record.reviewId,
    title: record.title,
    repositoryName: record.repositoryName,
    branchLabel: record.branchLabel,
    viewerName: record.viewerName,
    lastOpenedAt: record.lastOpenedAt,
    lastReanalyzeRequestedAt: record.lastReanalyzeRequestedAt,
    availableStatuses: [...reviewGroupStatuses],
    unsupportedSummary: toUnsupportedSummary(record.unsupportedFileAnalyses ?? []),
    groups: record.groups.map((group) => ({
      groupId: group.groupId,
      title: group.title,
      summary: group.summary,
      filePath: group.filePath,
      status: group.status,
      isSelected: group.groupId === record.selectedGroupId,
      upstream: [...group.upstream],
      downstream: [...group.downstream],
      semanticChanges: (group.semanticChangeIds ?? [])
        .map((semanticChangeId) => semanticChangeMap.get(semanticChangeId))
        .filter((semanticChange): semanticChange is SemanticChange => !!semanticChange)
        .map(toSemanticChangeDto),
    })),
  };
}
