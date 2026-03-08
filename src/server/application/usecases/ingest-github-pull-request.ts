import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type {
  PullRequestSnapshotProvider,
  GitHubPullRequestRef,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { createAnalyzedReviewSession } from "@/server/application/services/create-analyzed-review-session";
import type { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";

export interface IngestGitHubPullRequestInput {
  reviewId: string;
  viewerName: string;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  requestedAt?: string;
}

export interface IngestGitHubPullRequestDependencies {
  reviewSessionRepository: ReviewSessionRepository;
  parserAdapters: ParserAdapter[];
  pullRequestSnapshotProvider: PullRequestSnapshotProvider;
}

export interface IngestGitHubPullRequestResult {
  reviewSession: ReviewSession;
  snapshotPairCount: number;
  source: GitHubPullRequestRef;
}

export class IngestGitHubPullRequestUseCase {
  constructor(private readonly dependencies: IngestGitHubPullRequestDependencies) {}

  async execute({
    reviewId,
    viewerName,
    owner,
    repository,
    pullRequestNumber,
    requestedAt,
  }: IngestGitHubPullRequestInput): Promise<IngestGitHubPullRequestResult> {
    const timestamp = requestedAt ?? new Date().toISOString();
    const source: GitHubPullRequestRef = {
      provider: "github",
      owner,
      repository,
      pullRequestNumber,
    };
    const bundle = await this.dependencies.pullRequestSnapshotProvider.fetchPullRequestSnapshots({
      reviewId,
      source,
    });
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
    });

    await this.dependencies.reviewSessionRepository.save(reviewSession);

    return {
      reviewSession,
      snapshotPairCount: bundle.snapshotPairs.length,
      source: bundle.source,
    };
  }
}
