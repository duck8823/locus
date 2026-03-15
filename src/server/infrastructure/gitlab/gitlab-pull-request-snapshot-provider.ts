import {
  PullRequestProviderUnsupportedCapabilityError,
  type GitLabPullRequestRef,
  type PullRequestSnapshotBundle,
  type PullRequestSnapshotProviderContract,
} from "@/server/application/ports/pull-request-snapshot-provider";

export class GitLabPullRequestSnapshotProvider
  implements PullRequestSnapshotProviderContract<GitLabPullRequestRef>
{
  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitLabPullRequestRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle<GitLabPullRequestRef>> {
    throw new PullRequestProviderUnsupportedCapabilityError(
      "gitlab",
      "pull_request_snapshot_fetch",
      `GitLab adapter skeleton is wired but not implemented yet (projectPath=${input.source.projectPath}, mergeRequestIid=${input.source.mergeRequestIid}).`,
    );
  }
}

