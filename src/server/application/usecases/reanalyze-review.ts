import { createAnalyzedReviewSession } from "@/server/application/services/create-analyzed-review-session";
import {
  createSeedSourceSnapshotPairs,
} from "@/server/application/services/seed-source-snapshot-fixture";
import {
  defaultSeedFixtureId,
  defaultSeedReviewId,
} from "@/server/application/services/review-session-seed";
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
import type { ReviewReanalysisStatus } from "@/server/domain/value-objects/reanalysis-status";

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
  source: ReviewSessionSource | null;
  reanalysisStatus: ReviewReanalysisStatus;
  lastReanalyzeRequestedAt: string | null;
  lastReanalyzeCompletedAt: string | null;
  errorMessage: string | null;
}

function inferLegacySource(record: ReviewSessionRecord): ReviewSessionSource | null {
  if (record.reviewId === defaultSeedReviewId) {
    return {
      provider: "seed_fixture",
      fixtureId: defaultSeedFixtureId,
    };
  }

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

function toReanalysisErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error while reanalyzing review.";
}

function isSupersededRun(record: ReviewSessionRecord, startedAt: string): boolean {
  const latestRequestedAt = record.lastReanalyzeRequestedAt;

  if (!latestRequestedAt || latestRequestedAt === startedAt) {
    return false;
  }

  const latestRequestedAtEpochMs = Date.parse(latestRequestedAt);
  const startedAtEpochMs = Date.parse(startedAt);

  if (Number.isNaN(latestRequestedAtEpochMs) || Number.isNaN(startedAtEpochMs)) {
    return false;
  }

  return latestRequestedAtEpochMs > startedAtEpochMs;
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
    const startedAt = requestedAt ?? new Date().toISOString();
    const existingReviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!existingReviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    const previousRecord = existingReviewSession.toRecord();
    const source = resolveReviewSource(previousRecord);

    if (!source) {
      const completedAt = new Date().toISOString();
      const unavailableError = new ReanalyzeSourceUnavailableError(reviewId);
      existingReviewSession.markReanalysisFailed(completedAt, unavailableError.message, startedAt);
      await this.dependencies.reviewSessionRepository.save(existingReviewSession);

      return {
        reviewSession: existingReviewSession,
        snapshotPairCount: 0,
        source: null,
        reanalysisStatus: "failed",
        lastReanalyzeRequestedAt: startedAt,
        lastReanalyzeCompletedAt: completedAt,
        errorMessage: unavailableError.message,
      };
    }

    existingReviewSession.requestReanalysis(startedAt);
    await this.dependencies.reviewSessionRepository.save(existingReviewSession);

    let snapshotPairCount = 0;

    try {
      let refreshedReviewSession: ReviewSession;

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
            createdAt: startedAt,
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
            createdAt: startedAt,
            snapshotPairs,
            parserAdapters: this.dependencies.parserAdapters,
          });
          break;
        }
        default:
          return assertNever(source);
      }

      const completedAt = new Date().toISOString();
      const latestReviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);
      const latestProgressRecord = latestReviewSession?.toRecord() ?? previousRecord;

      if (isSupersededRun(latestProgressRecord, startedAt) && latestReviewSession) {
        return {
          reviewSession: latestReviewSession,
          snapshotPairCount,
          source: latestProgressRecord.source ?? source,
          reanalysisStatus: latestProgressRecord.reanalysisStatus ?? "idle",
          lastReanalyzeRequestedAt: latestProgressRecord.lastReanalyzeRequestedAt,
          lastReanalyzeCompletedAt: latestProgressRecord.lastReanalyzeCompletedAt ?? null,
          errorMessage: latestProgressRecord.lastReanalyzeError ?? null,
        };
      }

      const mergedRecord = mergePreviousReviewProgress({
        previousRecord: latestProgressRecord,
        nextRecord: refreshedReviewSession.toRecord(),
        requestedAt: startedAt,
        source,
      });
      const mergedReviewSession = ReviewSession.fromRecord(mergedRecord);
      mergedReviewSession.markReanalysisSucceeded(completedAt, startedAt);

      await this.dependencies.reviewSessionRepository.save(mergedReviewSession);

      return {
        reviewSession: mergedReviewSession,
        snapshotPairCount,
        source,
        reanalysisStatus: "succeeded",
        lastReanalyzeRequestedAt: startedAt,
        lastReanalyzeCompletedAt: completedAt,
        errorMessage: null,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const errorMessage = toReanalysisErrorMessage(error);
      let failedSession = existingReviewSession;
      let latestStateReloadFailed = false;

      try {
        const latestReviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);
        failedSession = latestReviewSession ?? existingReviewSession;

        if (latestReviewSession) {
          const latestRecord = latestReviewSession.toRecord();

          if (isSupersededRun(latestRecord, startedAt)) {
            return {
              reviewSession: latestReviewSession,
              snapshotPairCount,
              source: latestRecord.source ?? source,
              reanalysisStatus: latestRecord.reanalysisStatus ?? "idle",
              lastReanalyzeRequestedAt: latestRecord.lastReanalyzeRequestedAt,
              lastReanalyzeCompletedAt: latestRecord.lastReanalyzeCompletedAt ?? null,
              errorMessage: latestRecord.lastReanalyzeError ?? null,
            };
          }
        }
      } catch {
        failedSession = existingReviewSession;
        latestStateReloadFailed = true;
      }

      if (latestStateReloadFailed) {
        const fallbackRecord = existingReviewSession.toRecord();

        return {
          reviewSession: existingReviewSession,
          snapshotPairCount,
          source: fallbackRecord.source ?? source,
          reanalysisStatus: fallbackRecord.reanalysisStatus ?? "running",
          lastReanalyzeRequestedAt: fallbackRecord.lastReanalyzeRequestedAt,
          lastReanalyzeCompletedAt: fallbackRecord.lastReanalyzeCompletedAt ?? null,
          errorMessage,
        };
      }

      failedSession.markReanalysisFailed(completedAt, errorMessage, startedAt);
      await this.dependencies.reviewSessionRepository.save(failedSession);

      return {
        reviewSession: failedSession,
        snapshotPairCount,
        source,
        reanalysisStatus: "failed",
        lastReanalyzeRequestedAt: startedAt,
        lastReanalyzeCompletedAt: completedAt,
        errorMessage,
      };
    }
  }
}
