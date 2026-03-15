import type {
  GitLabPullRequestRef,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { ReviewAnalysisStatus } from "@/server/domain/value-objects/analysis-status";

export interface PrepareGitLabReviewWorkspaceInput {
  reviewId: string;
  viewerName: string;
  projectPath: string;
  mergeRequestIid: number;
  requestedAt?: string;
}

export interface PrepareGitLabReviewWorkspaceDependencies {
  reviewSessionRepository: ReviewSessionRepository;
}

export interface PrepareGitLabReviewWorkspaceResult {
  reviewSession: ReviewSession;
  shouldStartIngestion: boolean;
  source: GitLabPullRequestRef;
}

const STALE_IN_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;

function isStaleInProgressAnalysis(params: {
  status: ReviewAnalysisStatus;
  analysisRequestedAt: string | null | undefined;
  now: string;
}): boolean {
  if (
    params.status !== "queued" &&
    params.status !== "fetching" &&
    params.status !== "parsing"
  ) {
    return false;
  }

  if (!params.analysisRequestedAt) {
    return true;
  }

  const nowEpochMs = Date.parse(params.now);
  const requestedAtEpochMs = Date.parse(params.analysisRequestedAt);

  if (Number.isNaN(nowEpochMs) || Number.isNaN(requestedAtEpochMs)) {
    return true;
  }

  return nowEpochMs - requestedAtEpochMs >= STALE_IN_PROGRESS_TIMEOUT_MS;
}

function shouldRestartAnalysis(params: {
  status: ReviewAnalysisStatus;
  analysisRequestedAt: string | null | undefined;
  now: string;
}): boolean {
  if (params.status === "failed") {
    return true;
  }

  return isStaleInProgressAnalysis(params);
}

export class PrepareGitLabReviewWorkspaceUseCase {
  constructor(private readonly dependencies: PrepareGitLabReviewWorkspaceDependencies) {}

  async execute({
    reviewId,
    viewerName,
    projectPath,
    mergeRequestIid,
    requestedAt,
  }: PrepareGitLabReviewWorkspaceInput): Promise<PrepareGitLabReviewWorkspaceResult> {
    const timestamp = requestedAt ?? new Date().toISOString();
    const source: GitLabPullRequestRef = {
      provider: "gitlab",
      projectPath,
      mergeRequestIid,
    };
    const existing = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!existing) {
      const reviewSession = ReviewSession.create({
        reviewId,
        title: `MR !${mergeRequestIid}: Loading analysis...`,
        repositoryName: projectPath,
        branchLabel: "fetching merge request metadata...",
        viewerName,
        source,
        groups: [],
        selectedGroupId: null,
        lastOpenedAt: timestamp,
        analysisStatus: "queued",
        analysisRequestedAt: timestamp,
        analysisCompletedAt: null,
        analysisTotalFiles: null,
        analysisProcessedFiles: 0,
        analysisError: null,
        lastReanalyzeRequestedAt: null,
      });

      await this.dependencies.reviewSessionRepository.save(reviewSession);

      return {
        reviewSession,
        shouldStartIngestion: true,
        source,
      };
    }

    existing.markOpened(timestamp, viewerName);
    const existingRecord = existing.toRecord();
    existing.updateSummary({
      title: existingRecord.title,
      repositoryName: projectPath,
      branchLabel: existingRecord.branchLabel,
      source,
      viewerName,
    });
    const status = existingRecord.analysisStatus ?? "ready";
    const shouldStartIngestion = shouldRestartAnalysis({
      status,
      analysisRequestedAt: existingRecord.analysisRequestedAt,
      now: timestamp,
    });

    if (shouldStartIngestion) {
      existing.markAnalysisQueued(timestamp);
    }

    await this.dependencies.reviewSessionRepository.save(existing);

    return {
      reviewSession: existing,
      shouldStartIngestion,
      source,
    };
  }
}
