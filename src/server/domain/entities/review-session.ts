import { reviewGroupStatuses, type ReviewGroupStatus } from "@/server/domain/value-objects/review-status";
import { ReviewGroupNotFoundError } from "@/server/domain/errors/review-group-not-found-error";
import type {
  SemanticChange,
  UnsupportedFileAnalysis,
} from "@/server/domain/value-objects/semantic-change";
import type { ReviewSessionSource } from "@/server/domain/value-objects/review-session-source";
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";
import type { ReviewAnalysisStatus } from "@/server/domain/value-objects/analysis-status";

export interface ReviewGroupRecord {
  groupId: string;
  title: string;
  summary: string;
  filePath: string;
  status: ReviewGroupStatus;
  upstream: string[];
  downstream: string[];
  dominantLayer?: string;
  fileIds?: string[];
  semanticChangeIds?: string[];
}

export interface ReviewSessionRecord {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  userId?: string;
  source?: ReviewSessionSource;
  selectedGroupId: string | null;
  groups: ReviewGroupRecord[];
  semanticChanges?: SemanticChange[];
  unsupportedFileAnalyses?: UnsupportedFileAnalysis[];
  lastOpenedAt: string;
  analysisStatus?: ReviewAnalysisStatus;
  analysisRequestedAt?: string | null;
  analysisCompletedAt?: string | null;
  analysisTotalFiles?: number | null;
  analysisProcessedFiles?: number | null;
  analysisAttemptCount?: number | null;
  analysisError?: string | null;
  lastReanalyzeRequestedAt: string | null;
  reanalysisStatus?: ReviewReanalysisStatus;
  lastReanalyzeCompletedAt?: string | null;
  lastReanalyzeError?: string | null;
}

export interface CreateReviewSessionParams {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  userId?: string;
  source?: ReviewSessionSource;
  groups: ReviewGroupRecord[];
  semanticChanges?: SemanticChange[];
  unsupportedFileAnalyses?: UnsupportedFileAnalysis[];
  selectedGroupId?: string | null;
  lastOpenedAt: string;
  analysisStatus?: ReviewAnalysisStatus;
  analysisRequestedAt?: string | null;
  analysisCompletedAt?: string | null;
  analysisTotalFiles?: number | null;
  analysisProcessedFiles?: number | null;
  analysisAttemptCount?: number | null;
  analysisError?: string | null;
  lastReanalyzeRequestedAt?: string | null;
  reanalysisStatus?: ReviewReanalysisStatus;
  lastReanalyzeCompletedAt?: string | null;
  lastReanalyzeError?: string | null;
}

function cloneGroup(group: ReviewGroupRecord): ReviewGroupRecord {
  return {
    ...group,
    upstream: [...group.upstream],
    downstream: [...group.downstream],
    fileIds: group.fileIds ? [...group.fileIds] : undefined,
    semanticChangeIds: group.semanticChangeIds ? [...group.semanticChangeIds] : undefined,
  };
}

function cloneSemanticChange(semanticChange: SemanticChange): SemanticChange {
  return {
    ...semanticChange,
    symbol: { ...semanticChange.symbol },
    change: { ...semanticChange.change },
    before: semanticChange.before ? { ...semanticChange.before } : undefined,
    after: semanticChange.after ? { ...semanticChange.after } : undefined,
    architecture: semanticChange.architecture
      ? {
          outgoingNodeIds: [...semanticChange.architecture.outgoingNodeIds],
          incomingNodeIds: [...semanticChange.architecture.incomingNodeIds],
        }
      : undefined,
    metadata: {
      parser: { ...semanticChange.metadata.parser },
      languageSpecific: { ...semanticChange.metadata.languageSpecific },
    },
  };
}

function cloneUnsupportedFileAnalysis(record: UnsupportedFileAnalysis): UnsupportedFileAnalysis {
  return {
    ...record,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported review session source provider: ${JSON.stringify(value)}`);
}

function cloneSource(source: ReviewSessionSource | undefined): ReviewSessionSource | undefined {
  if (!source) {
    return undefined;
  }

  switch (source.provider) {
    case "github":
      return {
        provider: "github",
        owner: source.owner,
        repository: source.repository,
        pullRequestNumber: source.pullRequestNumber,
      };
    case "gitlab":
      return {
        provider: "gitlab",
        projectPath: source.projectPath,
        mergeRequestIid: source.mergeRequestIid,
      };
    case "seed_fixture":
      return {
        provider: "seed_fixture",
        fixtureId: source.fixtureId,
      };
  }

  return assertNever(source);
}

function cloneRecord(record: ReviewSessionRecord): ReviewSessionRecord {
  return {
    ...record,
    source: cloneSource(record.source),
    groups: record.groups.map(cloneGroup),
    semanticChanges: (record.semanticChanges ?? []).map(cloneSemanticChange),
    unsupportedFileAnalyses: (record.unsupportedFileAnalyses ?? []).map(cloneUnsupportedFileAnalysis),
  };
}

function assertGroups(groups: ReviewGroupRecord[]): void {
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

function normalizeReanalysisStatus(
  status: ReviewReanalysisStatus | undefined,
  lastReanalyzeRequestedAt: string | null,
): ReviewReanalysisStatus {
  if (status) {
    return status;
  }

  return lastReanalyzeRequestedAt ? "succeeded" : "idle";
}

function normalizeAnalysisStatus(status: ReviewAnalysisStatus | undefined): ReviewAnalysisStatus {
  return status ?? "ready";
}

function normalizeAnalysisCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.floor(value);
}

function normalizeAnalysisAttemptCount(value: number | null | undefined): number {
  const normalized = normalizeAnalysisCount(value);
  return normalized ?? 0;
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
      userId: params.userId,
      source: cloneSource(params.source),
      selectedGroupId,
      groups: params.groups.map(cloneGroup),
      semanticChanges: (params.semanticChanges ?? []).map(cloneSemanticChange),
      unsupportedFileAnalyses: (params.unsupportedFileAnalyses ?? []).map(cloneUnsupportedFileAnalysis),
      lastOpenedAt: params.lastOpenedAt,
      analysisStatus: normalizeAnalysisStatus(params.analysisStatus),
      analysisRequestedAt: params.analysisRequestedAt ?? null,
      analysisCompletedAt: params.analysisCompletedAt ?? null,
      analysisTotalFiles: normalizeAnalysisCount(params.analysisTotalFiles),
      analysisProcessedFiles: normalizeAnalysisCount(params.analysisProcessedFiles),
      analysisAttemptCount: normalizeAnalysisAttemptCount(params.analysisAttemptCount),
      analysisError: params.analysisError ?? null,
      lastReanalyzeRequestedAt: params.lastReanalyzeRequestedAt ?? null,
      reanalysisStatus: normalizeReanalysisStatus(
        params.reanalysisStatus,
        params.lastReanalyzeRequestedAt ?? null,
      ),
      lastReanalyzeCompletedAt: params.lastReanalyzeCompletedAt ?? null,
      lastReanalyzeError: params.lastReanalyzeError ?? null,
    });
  }

  static fromRecord(record: ReviewSessionRecord): ReviewSession {
    const normalizedRecord: ReviewSessionRecord = {
      ...record,
      semanticChanges: record.semanticChanges ?? [],
      unsupportedFileAnalyses: record.unsupportedFileAnalyses ?? [],
      analysisStatus: normalizeAnalysisStatus(record.analysisStatus),
      analysisRequestedAt: record.analysisRequestedAt ?? null,
      analysisCompletedAt: record.analysisCompletedAt ?? null,
      analysisTotalFiles: normalizeAnalysisCount(record.analysisTotalFiles),
      analysisProcessedFiles: normalizeAnalysisCount(record.analysisProcessedFiles),
      analysisAttemptCount: normalizeAnalysisAttemptCount(record.analysisAttemptCount),
      analysisError: record.analysisError ?? null,
      reanalysisStatus: normalizeReanalysisStatus(
        record.reanalysisStatus,
        record.lastReanalyzeRequestedAt ?? null,
      ),
      lastReanalyzeCompletedAt: record.lastReanalyzeCompletedAt ?? null,
      lastReanalyzeError: record.lastReanalyzeError ?? null,
    };

    assertGroups(normalizedRecord.groups);

    if (
      normalizedRecord.selectedGroupId &&
      !normalizedRecord.groups.some((group) => group.groupId === normalizedRecord.selectedGroupId)
    ) {
      throw new Error(`Selected review group not found: ${normalizedRecord.selectedGroupId}`);
    }

    return new ReviewSession(cloneRecord(normalizedRecord));
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

  get userId(): string | undefined {
    return this.record.userId;
  }

  setUserId(userId: string): void {
    this.record.userId = userId;
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

  updateSummary(params: {
    title: string;
    repositoryName: string;
    branchLabel: string;
    source?: ReviewSessionSource;
    viewerName?: string;
  }): void {
    this.record.title = params.title;
    this.record.repositoryName = params.repositoryName;
    this.record.branchLabel = params.branchLabel;
    this.record.source = cloneSource(params.source) ?? this.record.source;
    this.record.viewerName = params.viewerName ?? this.record.viewerName;
  }

  markAnalysisQueued(at: string): void {
    this.record.analysisStatus = "queued";
    this.record.analysisRequestedAt = at;
    this.record.analysisCompletedAt = null;
    this.record.analysisTotalFiles = null;
    this.record.analysisProcessedFiles = 0;
    this.record.analysisError = null;
  }

  markAnalysisFetching(at?: string): void {
    if (at) {
      this.record.analysisRequestedAt = at;
    }

    this.record.analysisStatus = "fetching";
    this.record.analysisAttemptCount = (this.record.analysisAttemptCount ?? 0) + 1;
    this.record.analysisCompletedAt = null;
    this.record.analysisError = null;

    if (this.record.analysisProcessedFiles === null || this.record.analysisProcessedFiles === undefined) {
      this.record.analysisProcessedFiles = 0;
    }
  }

  markAnalysisParsing(totalFiles: number, at?: string): void {
    if (at) {
      this.record.analysisRequestedAt = at;
    }

    this.record.analysisStatus = "parsing";
    this.record.analysisTotalFiles = normalizeAnalysisCount(totalFiles) ?? 0;
    this.record.analysisProcessedFiles = 0;
    this.record.analysisCompletedAt = null;
    this.record.analysisError = null;
  }

  updateAnalysisProgress(processedFiles: number, totalFiles?: number): void {
    this.record.analysisStatus = "parsing";
    const normalizedTotal = normalizeAnalysisCount(totalFiles);
    const normalizedProcessed = normalizeAnalysisCount(processedFiles) ?? 0;

    if (normalizedTotal !== null) {
      this.record.analysisTotalFiles = normalizedTotal;
      this.record.analysisProcessedFiles = Math.min(normalizedProcessed, normalizedTotal);
      return;
    }

    this.record.analysisProcessedFiles = normalizedProcessed;
  }

  markAnalysisReady(at: string, totalFiles?: number): void {
    this.record.analysisStatus = "ready";
    this.record.analysisCompletedAt = at;
    this.record.analysisError = null;
    const normalizedTotal = normalizeAnalysisCount(totalFiles);

    if (normalizedTotal !== null) {
      this.record.analysisTotalFiles = normalizedTotal;
      this.record.analysisProcessedFiles = normalizedTotal;
      return;
    }

    if (this.record.analysisTotalFiles !== null && this.record.analysisTotalFiles !== undefined) {
      this.record.analysisProcessedFiles = this.record.analysisTotalFiles;
    }
  }

  markAnalysisFailed(at: string, errorMessage: string): void {
    this.record.analysisStatus = "failed";
    this.record.analysisCompletedAt = at;
    this.record.analysisError = errorMessage;
  }

  markReanalysisQueued(at: string): void {
    this.record.lastReanalyzeRequestedAt = at;
    this.record.reanalysisStatus = "queued";
    this.record.lastReanalyzeCompletedAt = null;
    this.record.lastReanalyzeError = null;
  }

  requestReanalysis(at: string): void {
    this.record.lastReanalyzeRequestedAt = at;
    this.record.reanalysisStatus = "running";
    this.record.lastReanalyzeCompletedAt = null;
    this.record.lastReanalyzeError = null;
  }

  markReanalysisSucceeded(at: string, requestedAt?: string): void {
    if (requestedAt) {
      this.record.lastReanalyzeRequestedAt = requestedAt;
    }

    this.record.reanalysisStatus = "succeeded";
    this.record.lastReanalyzeCompletedAt = at;
    this.record.lastReanalyzeError = null;
  }

  markReanalysisFailed(at: string, errorMessage: string, requestedAt?: string): void {
    if (requestedAt) {
      this.record.lastReanalyzeRequestedAt = requestedAt;
    }

    this.record.reanalysisStatus = "failed";
    this.record.lastReanalyzeCompletedAt = at;
    this.record.lastReanalyzeError = errorMessage;
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
