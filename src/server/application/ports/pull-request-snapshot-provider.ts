import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

export type PullRequestSourceProvider = string;

/**
 * Provider-agnostic change request reference.
 *
 * Additional provider-specific fields can be attached.
 */
export interface PullRequestSourceRef {
  provider: PullRequestSourceProvider;
  owner?: string;
  repository?: string;
  pullRequestNumber?: number;
}

export interface GitHubPullRequestRef extends PullRequestSourceRef {
  provider: "github";
  owner: string;
  repository: string;
  pullRequestNumber: number;
}

/**
 * Backward-compatible source alias for existing GitHub-oriented imports.
 */
export type PullRequestSnapshotSourceRef = PullRequestSourceRef;

export function isGitHubPullRequestRef(source: PullRequestSourceRef): source is GitHubPullRequestRef {
  return (
    source.provider === "github" &&
    typeof source.owner === "string" &&
    source.owner.length > 0 &&
    typeof source.repository === "string" &&
    source.repository.length > 0 &&
    typeof source.pullRequestNumber === "number" &&
    Number.isInteger(source.pullRequestNumber)
  );
}

export interface PullRequestSnapshotBundle<
  TSource extends PullRequestSourceRef = GitHubPullRequestRef,
> {
  title: string;
  repositoryName: string;
  branchLabel: string;
  snapshotPairs: SourceSnapshotPair[];
  source: TSource;
}

export class PullRequestProviderAuthError extends Error {
  constructor(
    readonly provider: PullRequestSourceProvider,
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

export interface PullRequestSnapshotProviderContract<
  TSource extends PullRequestSourceRef = GitHubPullRequestRef,
> {
  fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: TSource;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle<TSource>>;
}

/**
 * Backward-compatible alias for existing GitHub-focused call sites.
 */
export type PullRequestSnapshotProvider = PullRequestSnapshotProviderContract<GitHubPullRequestRef>;

/**
 * Provider-agnostic port for multi-codehost routing.
 */
export type ProviderAgnosticPullRequestSnapshotProvider =
  PullRequestSnapshotProviderContract<PullRequestSourceRef>;
