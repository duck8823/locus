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

const UNSUPPORTED_SAMPLE_LIMIT = 5;

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
  const reasonCounts = new Map<UnsupportedFileReason, number>();

  for (const entry of unsupportedFileAnalyses) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  const byReason = [...reasonCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({
      reason,
      count,
    }));

  const sampleFilePaths = unsupportedFileAnalyses
    .map((entry) => entry.filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .slice(0, UNSUPPORTED_SAMPLE_LIMIT);

  return {
    totalCount: unsupportedFileAnalyses.length,
    byReason,
    sampleFilePaths,
  };
}

function calculateAnalysisDurationMs(params: {
  analysisRequestedAt: string | null | undefined;
  analysisCompletedAt: string | null | undefined;
}): number | null {
  if (!params.analysisRequestedAt || !params.analysisCompletedAt) {
    return null;
  }

  const requestedAtEpochMs = Date.parse(params.analysisRequestedAt);
  const completedAtEpochMs = Date.parse(params.analysisCompletedAt);

  if (Number.isNaN(requestedAtEpochMs) || Number.isNaN(completedAtEpochMs)) {
    return null;
  }

  return Math.max(0, completedAtEpochMs - requestedAtEpochMs);
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
    analysisStatus: record.analysisStatus ?? "ready",
    analysisRequestedAt: record.analysisRequestedAt ?? null,
    analysisCompletedAt: record.analysisCompletedAt ?? null,
    analysisTotalFiles: record.analysisTotalFiles ?? null,
    analysisProcessedFiles: record.analysisProcessedFiles ?? null,
    analysisAttemptCount: record.analysisAttemptCount ?? 0,
    analysisDurationMs: calculateAnalysisDurationMs({
      analysisRequestedAt: record.analysisRequestedAt ?? null,
      analysisCompletedAt: record.analysisCompletedAt ?? null,
    }),
    analysisError: record.analysisError ?? null,
    reanalysisStatus: record.reanalysisStatus ?? "idle",
    lastOpenedAt: record.lastOpenedAt,
    lastReanalyzeRequestedAt: record.lastReanalyzeRequestedAt,
    lastReanalyzeCompletedAt: record.lastReanalyzeCompletedAt ?? null,
    lastReanalyzeError: record.lastReanalyzeError ?? null,
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
