import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";

export interface ReviewWorkspaceGroupDto {
  groupId: string;
  title: string;
  summary: string;
  filePath: string;
  status: ReviewGroupStatus;
  isSelected: boolean;
  upstream: string[];
  downstream: string[];
}

export interface ReviewWorkspaceDto {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  lastOpenedAt: string;
  lastReanalyzeRequestedAt: string | null;
  availableStatuses: ReviewGroupStatus[];
  groups: ReviewWorkspaceGroupDto[];
}
