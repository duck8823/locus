import {
  PullRequestProviderUnsupportedCapabilityError,
  isGitHubPullRequestRef,
  isGitLabPullRequestRef,
  type ProviderAgnosticPullRequestSnapshotProvider,
  type PullRequestSnapshotBundle,
  type PullRequestSnapshotProvider,
  type PullRequestSnapshotProviderContract,
  type PullRequestSourceRef,
  type GitLabPullRequestRef,
} from "@/server/application/ports/pull-request-snapshot-provider";

export interface ProviderAgnosticPullRequestSnapshotProviderOptions {
  githubProvider: PullRequestSnapshotProvider;
  gitlabProvider?: PullRequestSnapshotProviderContract<GitLabPullRequestRef>;
  enableGitLabAdapter?: boolean;
}

export class DefaultProviderAgnosticPullRequestSnapshotProvider
  implements ProviderAgnosticPullRequestSnapshotProvider
{
  private readonly githubProvider: PullRequestSnapshotProvider;
  private readonly gitlabProvider?: PullRequestSnapshotProviderContract<GitLabPullRequestRef>;
  private readonly enableGitLabAdapter: boolean;

  constructor(options: ProviderAgnosticPullRequestSnapshotProviderOptions) {
    this.githubProvider = options.githubProvider;
    this.gitlabProvider = options.gitlabProvider;
    this.enableGitLabAdapter = options.enableGitLabAdapter ?? false;
  }

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: PullRequestSourceRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle<PullRequestSourceRef>> {
    if (input.source.provider === "github") {
      if (!isGitHubPullRequestRef(input.source)) {
        throw new PullRequestProviderUnsupportedCapabilityError(
          "github",
          "pull_request_snapshot_fetch",
          "GitHub source reference is invalid. Expected owner/repository/pullRequestNumber.",
        );
      }

      return this.githubProvider.fetchPullRequestSnapshots({
        reviewId: input.reviewId,
        source: input.source,
        accessToken: input.accessToken,
      });
    }

    if (input.source.provider === "gitlab") {
      if (!this.enableGitLabAdapter) {
        throw new PullRequestProviderUnsupportedCapabilityError(
          "gitlab",
          "pull_request_snapshot_fetch",
          "GitLab adapter is disabled by LOCUS_ENABLE_GITLAB_ADAPTER.",
        );
      }

      if (!this.gitlabProvider) {
        throw new PullRequestProviderUnsupportedCapabilityError(
          "gitlab",
          "pull_request_snapshot_fetch",
          "GitLab adapter is enabled but no provider implementation is registered.",
        );
      }

      if (!isGitLabPullRequestRef(input.source)) {
        throw new PullRequestProviderUnsupportedCapabilityError(
          "gitlab",
          "pull_request_snapshot_fetch",
          "GitLab source reference is invalid. Expected projectPath/mergeRequestIid.",
        );
      }

      return this.gitlabProvider.fetchPullRequestSnapshots({
        reviewId: input.reviewId,
        source: input.source,
        accessToken: input.accessToken,
      });
    }

    throw new PullRequestProviderUnsupportedCapabilityError(
      input.source.provider,
      "pull_request_snapshot_fetch",
      "No code-host adapter is registered for this provider.",
    );
  }
}
