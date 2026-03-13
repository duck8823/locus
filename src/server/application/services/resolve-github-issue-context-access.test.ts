import { describe, expect, it } from "vitest";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";
import {
  GitHubIssueContextTokenTypeUnsupportedError,
  parseGitHubOAuthScopes,
  resolveGitHubIssueContextAccess,
} from "@/server/application/services/resolve-github-issue-context-access";

class InMemoryConnectionTokenRepository implements ConnectionTokenRepository {
  private readonly tokens = new Map<string, PersistedConnectionToken>();

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const persisted: PersistedConnectionToken = {
      ...input,
    };
    this.tokens.set(this.toKey(input.reviewerId, input.provider), persisted);
    return persisted;
  }

  async findTokenByReviewerId(
    reviewerId: string,
    provider: "github",
  ): Promise<PersistedConnectionToken | null> {
    return this.tokens.get(this.toKey(reviewerId, provider)) ?? null;
  }

  private toKey(reviewerId: string, provider: "github"): string {
    return `${provider}:${reviewerId}`;
  }
}

describe("resolveGitHubIssueContextAccess", () => {
  it("returns bearer token when required scope is granted", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    await connectionTokenRepository.upsertToken({
      reviewerId: "reviewer-1",
      provider: "github",
      accessToken: "oauth-access-token",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-13T00:00:00.000Z",
    });

    await expect(
      resolveGitHubIssueContextAccess({
        reviewerId: "reviewer-1",
        connectionTokenRepository,
      }),
    ).resolves.toEqual({
      accessToken: "oauth-access-token",
      grantedScopes: ["repo", "read:org"],
    });
  });

  it("supports comma-delimited OAuth scope strings", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    await connectionTokenRepository.upsertToken({
      reviewerId: "reviewer-1",
      provider: "github",
      accessToken: "oauth-access-token",
      tokenType: "bearer",
      scope: "repo,read:org",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-13T00:00:00.000Z",
    });

    await expect(
      resolveGitHubIssueContextAccess({
        reviewerId: "reviewer-1",
        connectionTokenRepository,
      }),
    ).resolves.toEqual({
      accessToken: "oauth-access-token",
      grantedScopes: ["repo", "read:org"],
    });
  });

  it("returns anonymous access when no persisted GitHub token exists", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();

    await expect(
      resolveGitHubIssueContextAccess({
        reviewerId: "reviewer-1",
        connectionTokenRepository,
      }),
    ).resolves.toEqual({
      accessToken: null,
      grantedScopes: [],
    });
  });

  it("throws a clear error when required issue-read scope is missing", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    await connectionTokenRepository.upsertToken({
      reviewerId: "reviewer-1",
      provider: "github",
      accessToken: "oauth-access-token",
      tokenType: "bearer",
      scope: "read:org",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-13T00:00:00.000Z",
    });

    await expect(
      resolveGitHubIssueContextAccess({
        reviewerId: "reviewer-1",
        connectionTokenRepository,
      }),
    ).rejects.toMatchObject({
      name: "GitHubIssueContextScopeInsufficientError",
      message: expect.stringContaining("missing issue-read scope"),
      requiredAnyOfScopes: ["repo"],
      grantedScopes: ["read:org"],
    });
  });

  it("rejects public_repo-only scope because private-repository reads require repo scope", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    await connectionTokenRepository.upsertToken({
      reviewerId: "reviewer-1",
      provider: "github",
      accessToken: "oauth-access-token",
      tokenType: "bearer",
      scope: "public_repo",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-13T00:00:00.000Z",
    });

    await expect(
      resolveGitHubIssueContextAccess({
        reviewerId: "reviewer-1",
        connectionTokenRepository,
      }),
    ).rejects.toMatchObject({
      name: "GitHubIssueContextScopeInsufficientError",
      requiredAnyOfScopes: ["repo"],
      grantedScopes: ["public_repo"],
    });
  });

  it("throws when persisted token is not bearer", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    await connectionTokenRepository.upsertToken({
      reviewerId: "reviewer-1",
      provider: "github",
      accessToken: "oauth-access-token",
      tokenType: "basic",
      scope: "repo",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-13T00:00:00.000Z",
    });

    await expect(
      resolveGitHubIssueContextAccess({
        reviewerId: "reviewer-1",
        connectionTokenRepository,
      }),
    ).rejects.toEqual(new GitHubIssueContextTokenTypeUnsupportedError("basic"));
  });
});

describe("parseGitHubOAuthScopes", () => {
  it("normalizes and deduplicates comma/space separated scopes", () => {
    expect(parseGitHubOAuthScopes(" repo,read:org repo ")).toEqual(["repo", "read:org"]);
  });

  it("returns empty list for null/blank scope", () => {
    expect(parseGitHubOAuthScopes(null)).toEqual([]);
    expect(parseGitHubOAuthScopes("   ")).toEqual([]);
  });
});
