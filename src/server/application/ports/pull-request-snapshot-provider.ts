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

export class PullRequestProviderAuthError extends Error {
  constructor(
    readonly provider: "github",
    readonly statusCode: number,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(
      `Pull request provider authentication failed (${statusCode}): ${path}\n${responseBody}`,
    );
    this.name = "PullRequestProviderAuthError";
  }
}

export interface PullRequestSnapshotProvider {
  fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle>;
}
