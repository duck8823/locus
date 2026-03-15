import { describe, expect, it, vi } from "vitest";
import {
  PullRequestProviderUnsupportedCapabilityError,
  type GitLabPullRequestRef,
  type PullRequestSnapshotProvider,
  type PullRequestSnapshotProviderContract,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { DefaultProviderAgnosticPullRequestSnapshotProvider } from "@/server/infrastructure/code-host/provider-agnostic-pull-request-snapshot-provider";

function createGitHubProviderMock(): PullRequestSnapshotProvider {
  return {
    fetchPullRequestSnapshots: vi.fn(async (input) => ({
      title: "GitHub PR",
      repositoryName: "duck8823/locus",
      branchLabel: "feature -> main",
      snapshotPairs: [],
      source: input.source,
    })),
  };
}

function createGitLabProviderMock(): PullRequestSnapshotProviderContract<GitLabPullRequestRef> {
  return {
    fetchPullRequestSnapshots: vi.fn(async (input) => ({
      title: "GitLab MR",
      repositoryName: input.source.projectPath,
      branchLabel: "feature -> main",
      snapshotPairs: [],
      source: input.source,
    })),
  };
}

describe("DefaultProviderAgnosticPullRequestSnapshotProvider", () => {
  it("routes github source to GitHub provider", async () => {
    const githubProvider = createGitHubProviderMock();
    const provider = new DefaultProviderAgnosticPullRequestSnapshotProvider({
      githubProvider,
    });

    const result = await provider.fetchPullRequestSnapshots({
      reviewId: "review-1",
      source: {
        provider: "github",
        owner: "duck8823",
        repository: "locus",
        pullRequestNumber: 123,
      },
    });

    expect(githubProvider.fetchPullRequestSnapshots).toHaveBeenCalledTimes(1);
    expect(result.source).toMatchObject({
      provider: "github",
      pullRequestNumber: 123,
    });
  });

  it("returns typed diagnostics when gitlab adapter is disabled", async () => {
    const provider = new DefaultProviderAgnosticPullRequestSnapshotProvider({
      githubProvider: createGitHubProviderMock(),
      enableGitLabAdapter: false,
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "review-1",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 15,
        },
      }),
    ).rejects.toMatchObject({
      name: "PullRequestProviderUnsupportedCapabilityError",
      provider: "gitlab",
      capability: "pull_request_snapshot_fetch",
    } satisfies Partial<PullRequestProviderUnsupportedCapabilityError>);
  });

  it("routes gitlab source when adapter is enabled", async () => {
    const gitlabProvider = createGitLabProviderMock();
    const provider = new DefaultProviderAgnosticPullRequestSnapshotProvider({
      githubProvider: createGitHubProviderMock(),
      gitlabProvider,
      enableGitLabAdapter: true,
    });

    const result = await provider.fetchPullRequestSnapshots({
      reviewId: "review-1",
      source: {
        provider: "gitlab",
        projectPath: "duck8823/locus",
        mergeRequestIid: 15,
      },
    });

    expect(gitlabProvider.fetchPullRequestSnapshots).toHaveBeenCalledTimes(1);
    expect(result.source).toMatchObject({
      provider: "gitlab",
      mergeRequestIid: 15,
    });
  });

  it("throws typed diagnostics for unknown provider", async () => {
    const provider = new DefaultProviderAgnosticPullRequestSnapshotProvider({
      githubProvider: createGitHubProviderMock(),
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "review-1",
        source: {
          provider: "bitbucket",
          workspace: "duck8823",
        },
      }),
    ).rejects.toMatchObject({
      name: "PullRequestProviderUnsupportedCapabilityError",
      provider: "bitbucket",
      capability: "pull_request_snapshot_fetch",
    } satisfies Partial<PullRequestProviderUnsupportedCapabilityError>);
  });
});

