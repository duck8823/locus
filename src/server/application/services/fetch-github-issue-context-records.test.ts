import { describe, expect, it } from "vitest";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";
import type {
  CodeHostIssueContextRef,
  IssueContextProvider,
  IssueContextRecord,
} from "@/server/application/ports/issue-context-provider";
import { FetchGitHubIssueContextRecordsService } from "@/server/application/services/fetch-github-issue-context-records";
import { GitHubIssueContextScopeInsufficientError } from "@/server/application/services/resolve-github-issue-context-access";

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

class RecordingIssueContextProvider implements IssueContextProvider {
  lastFetchIssueInput: {
    reference: CodeHostIssueContextRef;
    accessToken?: string | null;
  } | null = null;
  lastFetchIssuesInput: {
    provider: CodeHostIssueContextRef["provider"];
    owner: string;
    repository: string;
    issueNumbers: number[];
    accessToken?: string | null;
  } | null = null;

  constructor(private readonly issues: IssueContextRecord[]) {}

  async fetchIssue(input: {
    reference: CodeHostIssueContextRef;
    accessToken?: string | null;
  }): Promise<IssueContextRecord | null> {
    this.lastFetchIssueInput = input;
    const match = this.issues.find(
      (issue) =>
        issue.provider === input.reference.provider &&
        issue.owner === input.reference.owner &&
        issue.repository === input.reference.repository &&
        issue.issueNumber === input.reference.issueNumber,
    );
    return match ?? null;
  }

  async fetchIssuesByNumbers(input: {
    provider: CodeHostIssueContextRef["provider"];
    owner: string;
    repository: string;
    issueNumbers: number[];
    accessToken?: string | null;
  }): Promise<IssueContextRecord[]> {
    this.lastFetchIssuesInput = input;
    const issueNumbers = new Set(input.issueNumbers);
    return this.issues.filter(
      (issue) =>
        issue.provider === input.provider &&
        issue.owner === input.owner &&
        issue.repository === input.repository &&
        issueNumbers.has(issue.issueNumber),
    );
  }
}

describe("FetchGitHubIssueContextRecordsService", () => {
  it("wires persisted OAuth token to issue-context provider calls", async () => {
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
    const issueContextProvider = new RecordingIssueContextProvider([
      {
        provider: "github",
        owner: "duck8823",
        repository: "locus",
        issueNumber: 65,
        title: "OAuth wiring",
        body: "context access",
        state: "open",
        labels: [],
        author: null,
        htmlUrl: "https://github.com/duck8823/locus/issues/65",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    ]);
    const service = new FetchGitHubIssueContextRecordsService({
      connectionTokenRepository,
      issueContextProvider,
    });

    const records = await service.execute({
      reviewerId: "reviewer-1",
      owner: "duck8823",
      repository: "locus",
      issueNumbers: [65, 65, 0],
    });

    expect(records.map((record) => record.issueNumber)).toEqual([65]);
    expect(issueContextProvider.lastFetchIssuesInput).toEqual({
      provider: "github",
      owner: "duck8823",
      repository: "locus",
      issueNumbers: [65],
      accessToken: "oauth-access-token",
    });
  });

  it("fails with a clear error when OAuth scope is insufficient", async () => {
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
    const issueContextProvider = new RecordingIssueContextProvider([]);
    const service = new FetchGitHubIssueContextRecordsService({
      connectionTokenRepository,
      issueContextProvider,
    });

    await expect(
      service.execute({
        reviewerId: "reviewer-1",
        owner: "duck8823",
        repository: "locus",
        issueNumbers: [65],
      }),
    ).rejects.toBeInstanceOf(GitHubIssueContextScopeInsufficientError);
    expect(issueContextProvider.lastFetchIssuesInput).toBeNull();
  });

  it("supports anonymous issue fetch when token is not connected", async () => {
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    const issueContextProvider = new RecordingIssueContextProvider([]);
    const service = new FetchGitHubIssueContextRecordsService({
      connectionTokenRepository,
      issueContextProvider,
    });

    await service.execute({
      reviewerId: "reviewer-1",
      owner: "duck8823",
      repository: "locus",
      issueNumbers: [65],
    });

    expect(issueContextProvider.lastFetchIssuesInput).toEqual({
      provider: "github",
      owner: "duck8823",
      repository: "locus",
      issueNumbers: [65],
      accessToken: null,
    });
  });
});
