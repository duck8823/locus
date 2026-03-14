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
    diagnostics: {
      cacheHit: null,
      fallbackReason: null,
      conflictReasonCodes: [],
    },
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

function createFallbackSnapshotWithIssue(issueNumber: number): BusinessContextSnapshot {
  return {
    generatedAt: "2026-03-14T00:00:00.000Z",
    provider: "stub",
    diagnostics: {
      cacheHit: null,
      fallbackReason: null,
      conflictReasonCodes: [],
    },
    items: [
      {
        contextId: `ctx-${issueNumber}`,
        sourceType: "github_issue",
        status: "linked",
        confidence: "high",
        inferenceSource: "repo_shorthand",
        title: `Linked issue: octocat/locus#${issueNumber}`,
        summary: `Detected issue ${issueNumber}.`,
        href: `https://github.com/octocat/locus/issues/${issueNumber}`,
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
    expect(snapshot.diagnostics).toEqual({
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: [],
    });
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
      expect(thrownError.cacheHit).toBe(false);
      expect(thrownError.fallbackReason).toBe("live_fetch_failed");
      expect(thrownError.retryable).toBe(true);
      expect(thrownError.reasonCode).toBe("timeout");
      expect(thrownError.message).toContain("Live business-context fetch failed");
    }
  });

  it("surfaces conflict reason codes when mixed-provider candidates are arbitrated", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue({
        generatedAt: "2026-03-14T00:00:00.000Z",
        provider: "stub",
        diagnostics: {
          cacheHit: null,
          fallbackReason: null,
          conflictReasonCodes: [],
        },
        items: [
          {
            contextId: "ctx-gh-77",
            sourceType: "github_issue",
            status: "linked",
            confidence: "high",
            inferenceSource: "repo_shorthand",
            title: "Requirement 77",
            summary: "GitHub requirement context",
            href: "https://github.com/octocat/locus/issues/77",
          },
          {
            contextId: "ctx-cf-77",
            sourceType: "confluence_page",
            status: "linked",
            confidence: "high",
            inferenceSource: "none",
            title: "Requirement 77",
            summary: "Confluence requirement context",
            href: "https://github.com/octocat/locus/issues/77",
          },
        ],
      }),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockResolvedValue({
        provider: "github",
        owner: "octocat",
        repository: "locus",
        issueNumber: 77,
        title: "Live requirement 77",
        body: "Live body",
        state: "open",
        labels: [],
        author: { login: "octocat" },
        htmlUrl: "https://github.com/octocat/locus/issues/77",
        updatedAt: "2026-03-14T00:10:00.000Z",
      }),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
    });

    const snapshot = await provider.loadSnapshotForReview({
      ...createInput(),
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 77,
      },
    });

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).toMatchObject({
      contextId: "ctx-gh-77",
      sourceType: "github_issue",
      title: "Live requirement 77",
    });
    expect(snapshot.diagnostics.conflictReasonCodes).toEqual(["freshness_priority"]);
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

  it("uses fresh cache on subsequent requests", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockResolvedValue({
        provider: "github",
        owner: "octocat",
        repository: "locus",
        issueNumber: 66,
        title: "Cached issue title",
        body: "Cached issue body",
        state: "open",
        labels: [],
        author: { login: "octocat" },
        htmlUrl: "https://github.com/octocat/locus/issues/66",
        updatedAt: "2026-03-14T00:00:00.000Z",
      }),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      cacheTtlMs: 60_000,
      staleCacheTtlMs: 300_000,
    });

    const first = await provider.loadSnapshotForReview(createInput());
    const second = await provider.loadSnapshotForReview(createInput());

    expect(first.diagnostics).toEqual({
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: [],
    });
    expect(second.diagnostics).toEqual({
      cacheHit: true,
      fallbackReason: null,
      conflictReasonCodes: [],
    });
    expect(issueContextProvider.fetchIssue).toHaveBeenCalledTimes(1);
  });

  it("does not share cache entries across different access-token contexts", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "github",
          owner: "octocat",
          repository: "locus",
          issueNumber: 66,
          title: "Private issue title",
          body: "private issue body",
          state: "open",
          labels: [],
          author: { login: "octocat" },
          htmlUrl: "https://github.com/octocat/locus/issues/66",
          updatedAt: "2026-03-14T00:00:00.000Z",
        })
        .mockResolvedValueOnce(null),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      cacheTtlMs: 60_000,
      staleCacheTtlMs: 300_000,
    });

    const firstSnapshot = await provider.loadSnapshotForReview({
      ...createInput(),
      githubIssueAccessToken: "oauth-access-token",
    });
    const secondSnapshot = await provider.loadSnapshotForReview({
      ...createInput(),
      githubIssueAccessToken: null,
    });

    expect(firstSnapshot.provider).toBe("github_live");
    expect(secondSnapshot.provider).toBe("stub");
    expect(issueContextProvider.fetchIssue).toHaveBeenCalledTimes(2);
    expect(issueContextProvider.fetchIssue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ accessToken: "oauth-access-token" }),
    );
    expect(issueContextProvider.fetchIssue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accessToken: null }),
    );
  });

  it("retries transient fetch failures with exponential backoff", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi
        .fn()
        .mockRejectedValueOnce(new Error("GitHub issue API failed (503): timeout"))
        .mockResolvedValue({
          provider: "github",
          owner: "octocat",
          repository: "locus",
          issueNumber: 66,
          title: "Recovered issue title",
          body: "Recovered issue body",
          state: "open",
          labels: [],
          author: { login: "octocat" },
          htmlUrl: "https://github.com/octocat/locus/issues/66",
          updatedAt: "2026-03-14T00:00:00.000Z",
        }),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      maxFetchAttempts: 3,
      initialBackoffMs: 25,
      sleep,
    });

    const snapshot = await provider.loadSnapshotForReview(createInput());

    expect(snapshot.provider).toBe("github_live");
    expect(snapshot.diagnostics).toEqual({
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: [],
    });
    expect(issueContextProvider.fetchIssue).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it("retries transport failures surfaced as fetch TypeError with retryable cause code", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi
        .fn()
        .mockRejectedValueOnce(
          new TypeError("fetch failed", {
            cause: {
              code: "ENOTFOUND",
            },
          }),
        )
        .mockResolvedValue({
          provider: "github",
          owner: "octocat",
          repository: "locus",
          issueNumber: 66,
          title: "Recovered issue title",
          body: "Recovered issue body",
          state: "open",
          labels: [],
          author: { login: "octocat" },
          htmlUrl: "https://github.com/octocat/locus/issues/66",
          updatedAt: "2026-03-14T00:00:00.000Z",
        }),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      maxFetchAttempts: 3,
      initialBackoffMs: 20,
      sleep,
    });

    const snapshot = await provider.loadSnapshotForReview(createInput());

    expect(snapshot.provider).toBe("github_live");
    expect(issueContextProvider.fetchIssue).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(20);
  });

  it("falls back to stale cache when retries fail after cache expiry", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "github",
          owner: "octocat",
          repository: "locus",
          issueNumber: 66,
          title: "Initially cached issue",
          body: "Cached body",
          state: "open",
          labels: [],
          author: { login: "octocat" },
          htmlUrl: "https://github.com/octocat/locus/issues/66",
          updatedAt: "2026-03-14T00:00:00.000Z",
        })
        .mockRejectedValue(new Error("GitHub issue API failed (503): upstream timeout")),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    let nowMs = Date.parse("2026-03-14T00:00:00.000Z");
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      cacheTtlMs: 1_000,
      staleCacheTtlMs: 20_000,
      maxFetchAttempts: 2,
      initialBackoffMs: 0,
      now: () => nowMs,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const firstSnapshot = await provider.loadSnapshotForReview(createInput());
    nowMs += 5_000;
    const secondSnapshot = await provider.loadSnapshotForReview(createInput());

    expect(firstSnapshot.diagnostics).toEqual({
      cacheHit: false,
      fallbackReason: null,
      conflictReasonCodes: [],
    });
    expect(secondSnapshot.provider).toBe("github_live");
    expect(secondSnapshot.diagnostics).toEqual({
      cacheHit: true,
      fallbackReason: "stale_cache",
      conflictReasonCodes: [],
    });
  });

  it("does not use stale cache when terminal failure is non-retryable", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi
        .fn()
        .mockResolvedValueOnce({
          provider: "github",
          owner: "octocat",
          repository: "locus",
          issueNumber: 66,
          title: "Initially cached issue",
          body: "Cached body",
          state: "open",
          labels: [],
          author: { login: "octocat" },
          htmlUrl: "https://github.com/octocat/locus/issues/66",
          updatedAt: "2026-03-14T00:00:00.000Z",
        })
        .mockRejectedValue(new Error("GitHub issue API failed (403): forbidden")),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    let nowMs = Date.parse("2026-03-14T00:00:00.000Z");
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      cacheTtlMs: 1_000,
      staleCacheTtlMs: 20_000,
      maxFetchAttempts: 2,
      initialBackoffMs: 0,
      now: () => nowMs,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await provider.loadSnapshotForReview(createInput());
    nowMs += 5_000;

    let thrown: unknown;

    try {
      await provider.loadSnapshotForReview(createInput());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LiveBusinessContextUnavailableError);

    if (thrown instanceof LiveBusinessContextUnavailableError) {
      expect(thrown.retryable).toBe(false);
      expect(thrown.reasonCode).toBe("auth");
    }
  });

  it("fails fast without retry on terminal not-found failures", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi.fn().mockResolvedValue(createFallbackSnapshot()),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockRejectedValue(
        new Error("GitHub issue API failed (404): not found"),
      ),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      maxFetchAttempts: 4,
      initialBackoffMs: 20,
      sleep,
    });

    await expect(provider.loadSnapshotForReview(createInput())).rejects.toMatchObject({
      reasonCode: "not_found",
      retryable: false,
    });
    expect(issueContextProvider.fetchIssue).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("evicts oldest cache entries when max cache size is exceeded", async () => {
    const fallbackProvider: BusinessContextProvider = {
      loadSnapshotForReview: vi
        .fn()
        .mockResolvedValueOnce(createFallbackSnapshotWithIssue(66))
        .mockResolvedValueOnce(createFallbackSnapshotWithIssue(67))
        .mockResolvedValueOnce(createFallbackSnapshotWithIssue(66)),
    };
    const issueContextProvider: IssueContextProvider = {
      fetchIssue: vi.fn().mockImplementation(async ({ reference }) => ({
        provider: "github",
        owner: reference.owner,
        repository: reference.repository,
        issueNumber: reference.issueNumber,
        title: `Issue ${reference.issueNumber}`,
        body: `Body ${reference.issueNumber}`,
        state: "open",
        labels: [],
        author: { login: "octocat" },
        htmlUrl: `https://github.com/${reference.owner}/${reference.repository}/issues/${reference.issueNumber}`,
        updatedAt: "2026-03-14T00:00:00.000Z",
      })),
      fetchIssuesByNumbers: vi.fn().mockResolvedValue([]),
    };
    const provider = new LiveBusinessContextProvider({
      fallbackProvider,
      issueContextProvider,
      cacheTtlMs: 60_000,
      staleCacheTtlMs: 300_000,
      maxCacheEntries: 1,
    });

    await provider.loadSnapshotForReview(createInput());
    await provider.loadSnapshotForReview(createInput());
    await provider.loadSnapshotForReview(createInput());

    expect(issueContextProvider.fetchIssue).toHaveBeenCalledTimes(3);
  });
});
