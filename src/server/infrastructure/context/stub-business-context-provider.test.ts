import { describe, expect, it } from "vitest";
import { StubBusinessContextProvider } from "@/server/infrastructure/context/stub-business-context-provider";

describe("StubBusinessContextProvider", () => {
  it("returns candidate GitHub issue context for plain same-repo shorthand references", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-1",
      repositoryName: "octocat/locus",
      branchLabel: "feature/128-profile-validation -> main",
      title: "Ref #128: Improve updateProfile validation",
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
          confidence: "medium",
          inferenceSource: "same_repo_shorthand",
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
      branchLabel: "feature/92-follow-up -> main",
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
          confidence: "high",
          href: "https://github.com/octocat/locus/issues/91",
        }),
        expect.objectContaining({
          status: "candidate",
          confidence: "medium",
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

  it("promotes closing-keyword references to linked status for same-repo issues", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-3",
      repositoryName: "octocat/locus",
      branchLabel: "feature/777-cleanup -> main",
      title: "Fixes #777 by hardening OAuth callback retries",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 90,
      },
    });
    const githubIssueItems = snapshot.items.filter((item) => item.sourceType === "github_issue");

    expect(githubIssueItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "linked",
          confidence: "high",
          inferenceSource: "same_repo_closing_keyword",
          href: "https://github.com/octocat/locus/issues/777",
        }),
      ]),
    );
    expect(
      githubIssueItems.filter(
        (item) => item.href === "https://github.com/octocat/locus/issues/777",
      ),
    ).toHaveLength(1);
  });

  it("extracts issue candidates from head branch naming conventions", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-4",
      repositoryName: "octocat/locus",
      branchLabel: "feature/451-review-map-improvements -> main",
      title: "Improve review map rendering",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 100,
      },
    });
    const githubIssueItems = snapshot.items.filter((item) => item.sourceType === "github_issue");

    expect(githubIssueItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "candidate",
          confidence: "medium",
          inferenceSource: "branch_pattern",
          href: "https://github.com/octocat/locus/issues/451",
        }),
      ]),
    );
  });

  it("returns unavailable GitHub context for non-GitHub sources", async () => {
    const provider = new StubBusinessContextProvider();

    const snapshot = await provider.loadSnapshotForReview({
      reviewId: "review-5",
      repositoryName: "seed/demo",
      branchLabel: "seed/default -> main",
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
          confidence: "low",
          inferenceSource: "none",
          href: null,
        }),
      ]),
    );
  });
});
