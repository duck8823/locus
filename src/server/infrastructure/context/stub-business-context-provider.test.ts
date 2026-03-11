import { describe, expect, it } from "vitest";
import { StubBusinessContextProvider } from "@/server/infrastructure/context/stub-business-context-provider";

describe("StubBusinessContextProvider", () => {
  it("returns candidate GitHub issue context for same-repo shorthand references", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-1",
      repositoryName: "octocat/locus",
      title: "Fix #128: Improve updateProfile validation",
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
          href: "https://github.com/octocat/locus/issues/128",
        }),
      ]),
    );
  });

  it("extracts linked issue references from URL and owner/repository shorthand", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-2",
      repositoryName: "octocat/locus",
      title:
        "Implements octocat/locus#91 and mirrors https://github.com/octocat/locus/issues/91 plus keeps #92 follow-up",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 56,
      },
    });
    const githubIssueItems = snapshot.items.filter((item) => item.sourceType === "github_issue");

    expect(githubIssueItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "linked",
          href: "https://github.com/octocat/locus/issues/91",
        }),
        expect.objectContaining({
          status: "candidate",
          href: "https://github.com/octocat/locus/issues/92",
        }),
      ]),
    );
    expect(
      githubIssueItems.filter(
        (item) => item.href === "https://github.com/octocat/locus/issues/91",
      ),
    ).toHaveLength(1);
  });

  it("returns unavailable GitHub context for non-GitHub sources", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-3",
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
