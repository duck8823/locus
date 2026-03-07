import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

export interface GitHubPullRequestRef {
  provider: "github";
  owner: string;
  repository: string;
  pullRequestNumber: number;
}

export interface PullRequestSnapshotBundle {
  title: string;
  repositoryName: string;
  branchLabel: string;
  snapshotPairs: SourceSnapshotPair[];
  source: GitHubPullRequestRef;
}

export interface PullRequestSnapshotProvider {
  fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
  }): Promise<PullRequestSnapshotBundle>;
}
