import { describe, expect, it } from "vitest";
import { PullRequestProviderUnsupportedCapabilityError } from "@/server/application/ports/pull-request-snapshot-provider";
import { GitLabPullRequestSnapshotProvider } from "@/server/infrastructure/gitlab/gitlab-pull-request-snapshot-provider";

describe("GitLabPullRequestSnapshotProvider", () => {
  it("throws typed unsupported capability diagnostics for skeleton implementation", async () => {
    const provider = new GitLabPullRequestSnapshotProvider();

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "review-1",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 42,
        },
      }),
    ).rejects.toMatchObject({
      name: "PullRequestProviderUnsupportedCapabilityError",
      provider: "gitlab",
      capability: "pull_request_snapshot_fetch",
    } satisfies Partial<PullRequestProviderUnsupportedCapabilityError>);
  });
});

