import { describe, expect, it, vi } from "vitest";
import type {
  BusinessContextProvider,
  BusinessContextSnapshot,
} from "@/server/application/ports/business-context-provider";
import type { IssueContextProvider } from "@/server/application/ports/issue-context-provider";
import { LiveBusinessContextUnavailableError } from "@/server/application/errors/live-business-context-unavailable-error";
import { LiveBusinessContextProvider } from "@/server/infrastructure/context/live-business-context-provider";

function createFallbackSnapshot(): BusinessContextSnapshot {
  return {
    generatedAt: "2026-03-14T00:00:00.000Z",
    provider: "stub",
    items: [
      {
        contextId: "ctx-1",
        sourceType: "github_issue",
        status: "linked",
        confidence: "high",
        inferenceSource: "repo_shorthand",
        title: "Linked issue: octocat/locus#66",
        summary: "Detected from owner/repository#issue shorthand in the PR title.",
        href: "https://github.com/octocat/locus/issues/66",
      },
      {
        contextId: "ctx-2",
        sourceType: "confluence_page",
        status: "unavailable",
        confidence: "low",
        inferenceSource: "none",
        title: "No Confluence page linked",
        summary: "Confluence linking is intentionally deferred.",
        href: null,
      },
    ],
  };
}

function createInput() {
  return {
    reviewerId: "demo-reviewer",
    reviewId: "review-1",
    repositoryName: "octocat/locus",
    branchLabel: "feature/66-live-context -> main",
    title: "Implement live context",
    githubIssueAccessToken: "oauth-access-token",
    githubIssueGrantedScopes: ["repo", "read:org"],
    source: {
      provider: "github" as const,
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 66,
    },
  };
}

describe("LiveBusinessContextProvider", () => {
  it("enriches github_issue entries with live issue details when fetch succeeds", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockResolvedValue({
        provider: "github",
        owner: "octocat",
        repository: "locus",
        issueNumber: 66,
        title: "Real issue title from GitHub",
        body: "This is the live issue body loaded from GitHub API.",
        state: "open",
        labels: [{ name: "backend", color: "0052cc" }],
        author: { login: "octocat" },
        htmlUrl: "https://github.com/octocat/locus/issues/66",
        updatedAt: "2026-03-14T00:00:00.000Z",
      }),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
    });

    const snapshot = await provider.loadSnapshotForReview(createInput());

    expect(snapshot.provider).toBe("github_live");
    expect(snapshot.items[0]).toMatchObject({
      sourceType: "github_issue",
      title: "Real issue title from GitHub",
      summary: expect.stringContaining("live issue body"),
      href: "https://github.com/octocat/locus/issues/66",
    });
    expect(issueContextProvider.fetchIssue).toHaveBeenCalledWith({
      reference: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        issueNumber: 66,
      },
      accessToken: "oauth-access-token",
    });
  });

  it("throws typed unavailable error with fallback snapshot when live fetch fails", async () => {
    const fallbackSnapshot = createFallbackSnapshot();
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(fallbackSnapshot),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockRejectedValue(new Error("GitHub API timeout")),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
    });

    let thrownError: unknown;

    try {
      await provider.loadSnapshotForReview(createInput());
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(LiveBusinessContextUnavailableError);

    if (thrownError instanceof LiveBusinessContextUnavailableError) {
      expect(thrownError.fallbackSnapshot).toEqual(fallbackSnapshot);
      expect(thrownError.message).toContain("Live business-context fetch failed");
    }
  });

  it("returns stub snapshot for non-github sources", async () => {
    const fallbackSnapshot = createFallbackSnapshot();
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(fallbackSnapshot),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockResolvedValue(null),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
    });

    const snapshot = await provider.loadSnapshotForReview({
      ...createInput(),
      source: {
        provider: "seed_fixture",
        fixtureId: "default",
      },
    });

    expect(snapshot).toEqual(fallbackSnapshot);
    expect(issueContextProvider.fetchIssue).not.toHaveBeenCalled();
  });
});
