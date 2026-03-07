import { reviewGroupStatuses } from "@/server/domain/value-objects/review-status";
import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewWorkspaceDto } from "@/server/presentation/dto/review-workspace-dto";

export function toReviewWorkspaceDto(reviewSession: ReviewSession): ReviewWorkspaceDto {
  const record = reviewSession.toRecord();

  return {
    reviewId: record.reviewId,
    title: record.title,
    repositoryName: record.repositoryName,
    branchLabel: record.branchLabel,
    viewerName: record.viewerName,
    lastOpenedAt: record.lastOpenedAt,
    lastReanalyzeRequestedAt: record.lastReanalyzeRequestedAt,
    availableStatuses: [...reviewGroupStatuses],
    groups: record.groups.map((group) => ({
      groupId: group.groupId,
      title: group.title,
      summary: group.summary,
      filePath: group.filePath,
      status: group.status,
      isSelected: group.groupId === record.selectedGroupId,
      upstream: [...group.upstream],
      downstream: [...group.downstream],
    })),
  };
}
