import { describe, expect, it } from "vitest";
import { StubBusinessContextProvider } from "@/server/infrastructure/context/stub-business-context-provider";

describe("StubBusinessContextProvider", () => {
  it("returns candidate GitHub issue context for GitHub review sources", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-1",
      repositoryName: "octocat/locus",
      title: "PR #12: Improve updateProfile validation",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 12,
      },
    });

    expect(snapshot.provider).toBe("stub");
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "github_issue",
          status: "candidate",
          href: "https://github.com/octocat/locus/issues/12",
        }),
      ]),
    );
  });

  it("returns unavailable GitHub context for non-GitHub sources", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-2",
      repositoryName: "seed/demo",
      title: "Seed review",
      source: {
        provider: "seed_fixture",
        fixtureId: "default",
      },
    });

    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "github_issue",
          status: "unavailable",
          href: null,
        }),
      ]),
    );
  });
});
