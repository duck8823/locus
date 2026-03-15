import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type { ScheduleAnalysisJobInput } from "@/server/application/ports/analysis-job-scheduler";
import {
  PullRequestProviderAuthError,
  type ProviderAgnosticPullRequestSnapshotProvider,
  type PullRequestSnapshotProvider,
} from "@/server/application/ports/pull-request-snapshot-provider";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
} from "@/server/application/ports/connection-token-repository";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { RunGitHubIngestionJobUseCase } from "@/server/application/usecases/run-github-ingestion-job";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { ConnectionStateTransitionTransactionalRepository } from "@/server/domain/repositories/connection-state-transition-repository";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import { listAllowedConnectionTransitions } from "@/server/domain/value-objects/connection-lifecycle-status";

export interface RunScheduledAnalysisJobInput extends ScheduleAnalysisJobInput {
  jobId: string;
}

export interface RunScheduledAnalysisJobDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  connectionStateRepository: ConnectionStateRepository;
  connectionStateTransitionRepository: ConnectionStateTransitionTransactionalRepository;
  connectionTokenRepository: ConnectionTokenRepository;
  connectionProviderCatalog: ConnectionProviderCatalog;
  parserAdapters: ParserAdapter[];
  pullRequestSnapshotProvider: PullRequestSnapshotProvider;
  providerAgnosticPullRequestSnapshotProvider?: ProviderAgnosticPullRequestSnapshotProvider;
}

export class RunScheduledAnalysisJobUseCase {
  constructor(private readonly dependencies: RunScheduledAnalysisJobDependencies) {}

  async execute(input: RunScheduledAnalysisJobInput): Promise<void> {
    const reviewSession = await this.dependencies.reviewSessionRepository.findByReviewId(
      input.reviewId,
    );

    if (!reviewSession) {
      throw new ReviewSessionNotFoundError(input.reviewId);
    }

    if (input.reason === "initial_ingestion") {
      const source = reviewSession.toRecord().source;

      if (!source) {
        throw new ReanalyzeSourceUnavailableError(input.reviewId);
      }

      if (source.provider === "github") {
        const useCase = new RunGitHubIngestionJobUseCase({
          reviewSessionRepository: this.dependencies.reviewSessionRepository,
          parserAdapters: this.dependencies.parserAdapters,
          pullRequestSnapshotProvider: this.dependencies.pullRequestSnapshotProvider,
        });
        const accessToken = await this.resolveGitHubAccessToken(reviewSession.viewerName);

        try {
          await useCase.execute({
            reviewId: input.reviewId,
            viewerName: reviewSession.viewerName,
            owner: source.owner,
            repository: source.repository,
            pullRequestNumber: source.pullRequestNumber,
            accessToken,
            requestedAt: input.requestedAt,
          });
        } catch (error) {
          await this.markGitHubConnectionReauthRequired({
            error,
            reviewerId: reviewSession.viewerName,
          });
          throw error;
        }

        return;
      }

      if (source.provider === "seed_fixture") {
        throw new ReanalyzeSourceUnavailableError(input.reviewId);
      }

      const nonGitHubIngestionUseCase = new ReanalyzeReviewUseCase({
        reviewSessionRepository: this.dependencies.reviewSessionRepository,
        parserAdapters: this.dependencies.parserAdapters,
        pullRequestSnapshotProvider: this.dependencies.pullRequestSnapshotProvider,
        providerAgnosticPullRequestSnapshotProvider:
          this.dependencies.providerAgnosticPullRequestSnapshotProvider,
        connectionTokenRepository: this.dependencies.connectionTokenRepository,
      });

      await nonGitHubIngestionUseCase.execute({
        reviewId: input.reviewId,
        requestedAt: input.requestedAt,
      });

      return;
    }

    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: this.dependencies.reviewSessionRepository,
      parserAdapters: this.dependencies.parserAdapters,
      pullRequestSnapshotProvider: this.dependencies.pullRequestSnapshotProvider,
      providerAgnosticPullRequestSnapshotProvider:
        this.dependencies.providerAgnosticPullRequestSnapshotProvider,
      connectionTokenRepository: this.dependencies.connectionTokenRepository,
    });

    await useCase.execute({
      reviewId: input.reviewId,
      requestedAt: input.requestedAt,
    });
  }

  private async markGitHubConnectionReauthRequired(input: {
    error: unknown;
    reviewerId: string;
  }): Promise<void> {
    if (
      !(input.error instanceof PullRequestProviderAuthError) ||
      input.error.provider !== "github"
    ) {
      return;
    }

    const connectionState = await this.selectLatestProviderState({
      reviewerId: input.reviewerId,
      provider: "github",
    });
    const currentStatus = connectionState?.status ?? "not_connected";

    if (!listAllowedConnectionTransitions(currentStatus).includes("reauth_required")) {
      return;
    }

    const setConnectionStateUseCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository: this.dependencies.connectionStateTransitionRepository,
      connectionProviderCatalog: this.dependencies.connectionProviderCatalog,
    });

    await setConnectionStateUseCase.execute({
      reviewerId: input.reviewerId,
      provider: "github",
      nextStatus: "reauth_required",
      connectedAccountLabel: null,
      transitionReason: "token-expired",
      transitionActorType: "system",
      transitionActorId: `github-auth:${input.error.statusCode}`,
    });
  }

  private async selectLatestProviderState(input: {
    reviewerId: string;
    provider: string;
  }): Promise<PersistedConnectionState | null> {
    const connectionStates =
      await this.dependencies.connectionStateRepository.findByReviewerId(input.reviewerId);
    const providerStates = connectionStates.filter(
      (state) => state.provider === input.provider,
    );

    if (providerStates.length === 0) {
      return null;
    }

    return providerStates.slice(1).reduce((latest, current) => {
      if (toEpochMs(latest.statusUpdatedAt) <= toEpochMs(current.statusUpdatedAt)) {
        return current;
      }

      return latest;
    }, providerStates[0]);
  }

  private async resolveGitHubAccessToken(reviewerId: string): Promise<string | null> {
    const persistedToken =
      await this.dependencies.connectionTokenRepository.findTokenByReviewerId(
        reviewerId,
        "github",
      );

    return toBearerAccessToken(persistedToken);
  }
}

function toBearerAccessToken(token: PersistedConnectionToken | null): string | null {
  if (!token) {
    return null;
  }

  const tokenType = token.tokenType?.trim().toLowerCase();

  if (tokenType && tokenType !== "bearer") {
    return null;
  }

  const accessToken = token.accessToken.trim();
  return accessToken.length > 0 ? accessToken : null;
}

function toEpochMs(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return parsed;
}
