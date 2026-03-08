import { createAnalyzedReviewSession } from "@/server/application/services/create-analyzed-review-session";
import {
  createSeedSourceSnapshotPairs,
} from "@/server/application/services/seed-source-snapshot-fixture";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type {
  PullRequestSnapshotProvider,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { ReviewSession, type ReviewSessionRecord, type ReviewGroupRecord } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";
import type { ReviewSessionSource } from "@/server/domain/value-objects/review-session-source";

export interface ReanalyzeReviewInput {
  reviewId: string;
  requestedAt?: string;
}

export interface ReanalyzeReviewDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  parserAdapters: ParserAdapter[];
  pullRequestSnapshotProvider: PullRequestSnapshotProvider;
}

export interface ReanalyzeReviewResult {
  reviewSession: ReviewSession;
  snapshotPairCount: number;
  source: ReviewSessionSource;
  lastReanalyzeRequestedAt: string;
}

function inferLegacySource(record: ReviewSessionRecord): ReviewSessionSource | null {
  const pullRequestNumberMatch = /^PR\s+#(\d+):/.exec(record.title);
  const pullRequestNumber = pullRequestNumberMatch ? Number(pullRequestNumberMatch[1]) : NaN;
  const repositoryMatch = /^([^/]+)\/([^/]+)$/.exec(record.repositoryName.trim());

  if (!repositoryMatch || !Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    return null;
  }

  return {
    provider: "github",
    owner: repositoryMatch[1],
    repository: repositoryMatch[2],
    pullRequestNumber,
  };
}

function resolveReviewSource(record: ReviewSessionRecord): ReviewSessionSource | null {
  return record.source ?? inferLegacySource(record);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported review source provider: ${JSON.stringify(value)}`);
}

function createGroupStatusLookups(
  previousGroups: ReviewGroupRecord[],
): {
  statusByGroupId: Map<string, ReviewGroupStatus>;
  statusByFilePath: Map<string, ReviewGroupStatus>;
} {
  const statusByGroupId = new Map<string, ReviewGroupStatus>();
  const statusByFilePath = new Map<string, ReviewGroupStatus>();

  for (const group of previousGroups) {
    statusByGroupId.set(group.groupId, group.status);
    if (!statusByFilePath.has(group.filePath)) {
      statusByFilePath.set(group.filePath, group.status);
    }
  }

  return {
    statusByGroupId,
    statusByFilePath,
  };
}

function mergePreviousReviewProgress(params: {
  previousRecord: ReviewSessionRecord;
  nextRecord: ReviewSessionRecord;
  requestedAt: string;
  source: ReviewSessionSource;
}): ReviewSessionRecord {
  const { previousRecord, nextRecord, requestedAt, source } = params;
  const { statusByGroupId, statusByFilePath } = createGroupStatusLookups(previousRecord.groups);
  const mergedGroups = nextRecord.groups.map((group) => ({
    ...group,
    status: statusByGroupId.get(group.groupId) ?? statusByFilePath.get(group.filePath) ?? group.status,
  }));
  const selectedGroupId =
    previousRecord.selectedGroupId && mergedGroups.some((group) => group.groupId === previousRecord.selectedGroupId)
      ? previousRecord.selectedGroupId
      : mergedGroups[0]?.groupId ?? null;

  return {
    ...nextRecord,
    groups: mergedGroups,
    selectedGroupId,
    viewerName: previousRecord.viewerName,
    source,
    lastOpenedAt: previousRecord.lastOpenedAt,
    lastReanalyzeRequestedAt: requestedAt,
  };
}

export class ReanalyzeReviewUseCase {
  constructor(private readonly dependencies: ReanalyzeReviewDependencies) {}

  async execute({ reviewId, requestedAt }: ReanalyzeReviewInput): Promise<ReanalyzeReviewResult> {
    const timestamp = requestedAt ?? new Date().toISOString();
    const existingReviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!existingReviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    const previousRecord = existingReviewSession.toRecord();
    const source = resolveReviewSource(previousRecord);

    if (!source) {
      throw new ReanalyzeSourceUnavailableError(reviewId);
    }

    let refreshedReviewSession: ReviewSession;
    let snapshotPairCount = 0;

    switch (source.provider) {
      case "github": {
        const bundle = await this.dependencies.pullRequestSnapshotProvider.fetchPullRequestSnapshots({
          reviewId,
          source,
        });
        snapshotPairCount = bundle.snapshotPairs.length;
        refreshedReviewSession = await createAnalyzedReviewSession({
          reviewId,
          title: bundle.title,
          repositoryName: bundle.repositoryName,
          branchLabel: bundle.branchLabel,
          viewerName: previousRecord.viewerName,
          source,
          createdAt: timestamp,
          snapshotPairs: bundle.snapshotPairs,
          parserAdapters: this.dependencies.parserAdapters,
        });
        break;
      }
      case "seed_fixture": {
        const snapshotPairs = createSeedSourceSnapshotPairs(reviewId);
        snapshotPairCount = snapshotPairs.length;
        refreshedReviewSession = await createAnalyzedReviewSession({
          reviewId,
          title: previousRecord.title,
          repositoryName: previousRecord.repositoryName,
          branchLabel: previousRecord.branchLabel,
          viewerName: previousRecord.viewerName,
          source,
          createdAt: timestamp,
          snapshotPairs,
          parserAdapters: this.dependencies.parserAdapters,
        });
        break;
      }
      default:
        return assertNever(source);
    }

    const mergedRecord = mergePreviousReviewProgress({
      previousRecord,
      nextRecord: refreshedReviewSession.toRecord(),
      requestedAt: timestamp,
      source,
    });
    const mergedReviewSession = ReviewSession.fromRecord(mergedRecord);

    await this.dependencies.reviewSessionRepository.save(mergedReviewSession);

    return {
      reviewSession: mergedReviewSession,
      snapshotPairCount,
      source,
      lastReanalyzeRequestedAt: timestamp,
    };
  }
}
