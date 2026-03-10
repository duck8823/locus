import type { AnalysisJobScheduler } from "@/server/application/ports/analysis-job-scheduler";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import {
  defaultSeedFixtureId,
  defaultSeedReviewId,
} from "@/server/application/services/review-session-seed";
import type { ReviewSession, ReviewSessionRecord } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { ReviewSessionSource } from "@/server/domain/value-objects/review-session-source";

export interface RequestManualReanalysisInput {
  reviewId: string;
  requestedAt?: string;
}

export interface RequestManualReanalysisDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  analysisJobScheduler: AnalysisJobScheduler;
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

function isTimestampAtOrAfter(current: string | null | undefined, threshold: string): boolean {
  if (!current) {
    return false;
  }

  const currentEpochMs = Date.parse(current);
  const thresholdEpochMs = Date.parse(threshold);

  if (!Number.isNaN(currentEpochMs) && !Number.isNaN(thresholdEpochMs)) {
    return currentEpochMs >= thresholdEpochMs;
  }

  return current >= threshold;
}

function shouldSkipQueuedTransition(
  reviewSession: ReviewSession,
  requestedAt: string,
): boolean {
  const record = reviewSession.toRecord();
  const reanalysisStatus = record.reanalysisStatus ?? "idle";

  if (isTimestampAtOrAfter(record.lastReanalyzeRequestedAt, requestedAt)) {
    return true;
  }

  if (
    (reanalysisStatus === "running" ||
      reanalysisStatus === "succeeded" ||
      reanalysisStatus === "failed") &&
    !record.lastReanalyzeRequestedAt
  ) {
    return true;
  }

  return false;
}

export class RequestManualReanalysisUseCase {
  constructor(private readonly dependencies: RequestManualReanalysisDependencies) {}

  async execute({ reviewId, requestedAt }: RequestManualReanalysisInput): Promise<void> {
    const timestamp = requestedAt ?? new Date().toISOString();
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(reviewId);
    }

    const record = reviewSession.toRecord();
    const source = resolveReviewSource(record);

    if (!source) {
      throw new ReanalyzeSourceUnavailableError(reviewId);
    }

    await this.dependencies.analysisJobScheduler.scheduleReviewAnalysis({
      reviewId,
      requestedAt: timestamp,
      reason: "manual_reanalysis",
    });

    const latestSession = await this.dependencies.reviewSessionRepository.findByReviewId(reviewId);

    if (!latestSession || shouldSkipQueuedTransition(latestSession, timestamp)) {
      return;
    }

    latestSession.markReanalysisQueued(timestamp);
    await this.dependencies.reviewSessionRepository.save(latestSession);
  }
}
