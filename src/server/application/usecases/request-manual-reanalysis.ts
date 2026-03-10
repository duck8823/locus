import type { AnalysisJobScheduler } from "@/server/application/ports/analysis-job-scheduler";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import {
  defaultSeedFixtureId,
  defaultSeedReviewId,
} from "@/server/application/services/review-session-seed";
import type { ReviewSessionRecord } from "@/server/domain/entities/review-session";
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

    reviewSession.requestReanalysis(timestamp);
    await this.dependencies.reviewSessionRepository.save(reviewSession);
    await this.dependencies.analysisJobScheduler.scheduleReviewAnalysis({
      reviewId,
      requestedAt: timestamp,
      reason: "manual_reanalysis",
    });
  }
}
