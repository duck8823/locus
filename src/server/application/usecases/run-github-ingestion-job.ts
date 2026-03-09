import { createAnalyzedReviewSession } from "@/server/application/services/create-analyzed-review-session";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type {
  PullRequestSnapshotProvider,
  GitHubPullRequestRef,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { ReviewSession, type ReviewSessionRecord } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

export interface RunGitHubIngestionJobInput {
  reviewId: string;
  viewerName: string;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  requestedAt?: string;
}

export interface RunGitHubIngestionJobDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  parserAdapters: ParserAdapter[];
  pullRequestSnapshotProvider: PullRequestSnapshotProvider;
}

export interface RunGitHubIngestionJobResult {
  reviewSession: ReviewSession;
  snapshotPairCount: number;
  source: GitHubPullRequestRef;
}

function isSupersededAnalysisRun(record: ReviewSessionRecord, startedAt: string): boolean {
  const latestRequestedAt = record.analysisRequestedAt;

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

function createResultFromLatest(params: {
  reviewSession: ReviewSession;
  snapshotPairCount: number;
  fallbackSource: GitHubPullRequestRef;
}): RunGitHubIngestionJobResult {
  const record = params.reviewSession.toRecord();

  return {
    reviewSession: params.reviewSession,
    snapshotPairCount: params.snapshotPairCount,
    source:
      record.source && record.source.provider === "github"
        ? record.source
        : params.fallbackSource,
  };
}

function mergeLatestReanalysisState(params: {
  next: ReviewSession;
  latest: ReviewSession;
}): ReviewSession {
  const nextRecord = params.next.toRecord();
  const latestRecord = params.latest.toRecord();

  return ReviewSession.fromRecord({
    ...nextRecord,
    lastReanalyzeRequestedAt: latestRecord.lastReanalyzeRequestedAt,
    reanalysisStatus: latestRecord.reanalysisStatus,
    lastReanalyzeCompletedAt: latestRecord.lastReanalyzeCompletedAt ?? null,
    lastReanalyzeError: latestRecord.lastReanalyzeError ?? null,
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error while ingesting GitHub pull request.";
}

function createPlaceholderRecord(params: {
  reviewId: string;
  viewerName: string;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  requestedAt: string;
}): ReviewSessionRecord {
  return {
    reviewId: params.reviewId,
    title: `PR #${params.pullRequestNumber}: Loading analysis...`,
    repositoryName: `${params.owner}/${params.repository}`,
    branchLabel: "fetching pull request metadata...",
    viewerName: params.viewerName,
    source: {
      provider: "github",
      owner: params.owner,
      repository: params.repository,
      pullRequestNumber: params.pullRequestNumber,
    },
    selectedGroupId: null,
    groups: [],
    semanticChanges: [],
    unsupportedFileAnalyses: [],
    lastOpenedAt: params.requestedAt,
    analysisStatus: "queued",
    analysisRequestedAt: params.requestedAt,
    analysisCompletedAt: null,
    analysisTotalFiles: null,
    analysisProcessedFiles: 0,
    analysisError: null,
    lastReanalyzeRequestedAt: null,
    reanalysisStatus: "idle",
    lastReanalyzeCompletedAt: null,
    lastReanalyzeError: null,
  };
}

export class RunGitHubIngestionJobUseCase {
  constructor(private readonly dependencies: RunGitHubIngestionJobDependencies) {}

  async execute({
    reviewId,
    viewerName,
    owner,
    repository,
    pullRequestNumber,
    requestedAt,
  }: RunGitHubIngestionJobInput): Promise<RunGitHubIngestionJobResult> {
    const timestamp = requestedAt ?? new Date().toISOString();
    let snapshotPairCount = 0;
    const source: GitHubPullRequestRef = {
      provider: "github",
      owner,
      repository,
      pullRequestNumber,
    };
    const reviewSessionRepository = this.dependencies.reviewSessionRepository;
    const existing = await reviewSessionRepository.findByReviewId(reviewId);
    const runningSession = existing ?? ReviewSession.fromRecord(
      createPlaceholderRecord({
        reviewId,
        viewerName,
        owner,
        repository,
        pullRequestNumber,
        requestedAt: timestamp,
      }),
    );

    runningSession.markOpened(timestamp, viewerName);
    const runningRecord = runningSession.toRecord();
    runningSession.updateSummary({
      title: runningRecord.title,
      repositoryName: `${owner}/${repository}`,
      branchLabel: runningRecord.branchLabel,
      source,
      viewerName,
    });
    runningSession.markAnalysisFetching(timestamp);
    await reviewSessionRepository.save(runningSession);

    try {
      const bundle = await this.dependencies.pullRequestSnapshotProvider.fetchPullRequestSnapshots({
        reviewId,
        source,
      });
      snapshotPairCount = bundle.snapshotPairs.length;
      const latestBeforeParsing = await reviewSessionRepository.findByReviewId(reviewId);
      const latestBeforeParsingRecord = latestBeforeParsing?.toRecord();

      if (
        latestBeforeParsing &&
        latestBeforeParsingRecord &&
        isSupersededAnalysisRun(latestBeforeParsingRecord, timestamp)
      ) {
        return createResultFromLatest({
          reviewSession: latestBeforeParsing,
          snapshotPairCount,
          fallbackSource: source,
        });
      }

      const parsingSession = latestBeforeParsing ?? runningSession;

      parsingSession.updateSummary({
        title: bundle.title,
        repositoryName: bundle.repositoryName,
        branchLabel: bundle.branchLabel,
        source: bundle.source,
        viewerName,
      });
      parsingSession.markAnalysisParsing(bundle.snapshotPairs.length, timestamp);
      await reviewSessionRepository.save(parsingSession);

      const reviewSession = await createAnalyzedReviewSession({
        reviewId,
        title: bundle.title,
        repositoryName: bundle.repositoryName,
        branchLabel: bundle.branchLabel,
        viewerName,
        source: bundle.source,
        createdAt: timestamp,
        snapshotPairs: bundle.snapshotPairs,
        parserAdapters: this.dependencies.parserAdapters,
        onAnalysisProgress: async (progress) => {
          const latest = await reviewSessionRepository.findByReviewId(reviewId);

          if (!latest) {
            return;
          }

          const latestRecord = latest.toRecord();

          if (isSupersededAnalysisRun(latestRecord, timestamp)) {
            return;
          }

          latest.updateAnalysisProgress(progress.processedCount, progress.totalCount);
          await reviewSessionRepository.save(latest);
        },
      });

      const latestBeforeReady = await reviewSessionRepository.findByReviewId(reviewId);
      let reviewSessionToSave = reviewSession;

      if (latestBeforeReady) {
        const latestBeforeReadyRecord = latestBeforeReady.toRecord();

        if (isSupersededAnalysisRun(latestBeforeReadyRecord, timestamp)) {
          return createResultFromLatest({
            reviewSession: latestBeforeReady,
            snapshotPairCount,
            fallbackSource: source,
          });
        }

        reviewSessionToSave = mergeLatestReanalysisState({
          next: reviewSession,
          latest: latestBeforeReady,
        });
      }

      const completedAt = new Date().toISOString();
      reviewSessionToSave.markAnalysisReady(completedAt, bundle.snapshotPairs.length);
      await reviewSessionRepository.save(reviewSessionToSave);

      return {
        reviewSession: reviewSessionToSave,
        snapshotPairCount,
        source: bundle.source,
      };
    } catch (error) {
      const latest = await reviewSessionRepository.findByReviewId(reviewId);
      const latestRecord = latest?.toRecord();

      if (latest && latestRecord && isSupersededAnalysisRun(latestRecord, timestamp)) {
        return createResultFromLatest({
          reviewSession: latest,
          snapshotPairCount,
          fallbackSource: source,
        });
      }

      const failedSession = latest ?? runningSession;
      const failedAt = new Date().toISOString();

      failedSession.markAnalysisFailed(failedAt, toErrorMessage(error));
      await reviewSessionRepository.save(failedSession);
      throw error;
    }
  }
}
