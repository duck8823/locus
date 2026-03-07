import { reviewGroupStatuses, type ReviewGroupStatus } from "@/server/domain/value-objects/review-status";
import { ReviewGroupNotFoundError } from "@/server/domain/errors/review-group-not-found-error";

export interface ReviewGroupRecord {
  groupId: string;
  title: string;
  summary: string;
  filePath: string;
  status: ReviewGroupStatus;
  upstream: string[];
  downstream: string[];
}

export interface ReviewSessionRecord {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  selectedGroupId: string | null;
  groups: ReviewGroupRecord[];
  lastOpenedAt: string;
  lastReanalyzeRequestedAt: string | null;
}

export interface CreateReviewSessionParams {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  groups: ReviewGroupRecord[];
  selectedGroupId?: string | null;
  lastOpenedAt: string;
  lastReanalyzeRequestedAt?: string | null;
}

function cloneGroup(group: ReviewGroupRecord): ReviewGroupRecord {
  return {
    ...group,
    upstream: [...group.upstream],
    downstream: [...group.downstream],
  };
}

function cloneRecord(record: ReviewSessionRecord): ReviewSessionRecord {
  return {
    ...record,
    groups: record.groups.map(cloneGroup),
  };
}

function assertGroups(groups: ReviewGroupRecord[]): void {
  if (groups.length === 0) {
    throw new Error("A review session requires at least one review group.");
  }

  const ids = new Set<string>();

  for (const group of groups) {
    if (ids.has(group.groupId)) {
      throw new Error(`Duplicate review group id: ${group.groupId}`);
    }

    ids.add(group.groupId);

    if (!(reviewGroupStatuses as readonly string[]).includes(group.status)) {
      throw new Error(`Invalid status on review group ${group.groupId}: ${group.status}`);
    }
  }
}

export class ReviewSession {
  private constructor(private readonly record: ReviewSessionRecord) {}

  static create(params: CreateReviewSessionParams): ReviewSession {
    assertGroups(params.groups);

    const selectedGroupId = params.selectedGroupId ?? params.groups[0]?.groupId ?? null;

    return new ReviewSession({
      reviewId: params.reviewId,
      title: params.title,
      repositoryName: params.repositoryName,
      branchLabel: params.branchLabel,
      viewerName: params.viewerName,
      selectedGroupId,
      groups: params.groups.map(cloneGroup),
      lastOpenedAt: params.lastOpenedAt,
      lastReanalyzeRequestedAt: params.lastReanalyzeRequestedAt ?? null,
    });
  }

  static fromRecord(record: ReviewSessionRecord): ReviewSession {
    assertGroups(record.groups);

    if (record.selectedGroupId && !record.groups.some((group) => group.groupId === record.selectedGroupId)) {
      throw new Error(`Selected review group not found: ${record.selectedGroupId}`);
    }

    return new ReviewSession(cloneRecord(record));
  }

  get reviewId(): string {
    return this.record.reviewId;
  }

  get selectedGroupId(): string | null {
    return this.record.selectedGroupId;
  }

  get groups(): ReadonlyArray<ReviewGroupRecord> {
    return this.record.groups.map(cloneGroup);
  }

  get viewerName(): string {
    return this.record.viewerName;
  }

  markOpened(at: string, viewerName = this.record.viewerName): void {
    this.record.lastOpenedAt = at;
    this.record.viewerName = viewerName;

    if (!this.record.selectedGroupId) {
      this.record.selectedGroupId = this.record.groups[0]?.groupId ?? null;
    }
  }

  selectGroup(groupId: string): void {
    this.getGroupById(groupId);
    this.record.selectedGroupId = groupId;
  }

  setGroupStatus(groupId: string, status: ReviewGroupStatus): void {
    const group = this.getGroupById(groupId);
    group.status = status;

    if (!this.record.selectedGroupId) {
      this.record.selectedGroupId = groupId;
    }
  }

  requestReanalysis(at: string): void {
    this.record.lastReanalyzeRequestedAt = at;
  }

  toRecord(): ReviewSessionRecord {
    return cloneRecord(this.record);
  }

  private getGroupById(groupId: string): ReviewGroupRecord {
    const group = this.record.groups.find((item) => item.groupId === groupId);

    if (!group) {
      throw new ReviewGroupNotFoundError(groupId);
    }

    return group;
  }
}
