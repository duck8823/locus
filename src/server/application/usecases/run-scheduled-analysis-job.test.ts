import { describe, expect, it } from "vitest";
import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type {
  GitHubPullRequestRef,
  PullRequestSnapshotBundle,
  PullRequestSnapshotProvider,
  ProviderAgnosticPullRequestSnapshotProvider,
  PullRequestSourceRef,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { PullRequestProviderAuthError } from "@/server/application/ports/pull-request-snapshot-provider";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";
import type { ConnectionCatalogEntry } from "@/server/application/services/connection-catalog";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type {
  ConnectionStateTransitionRepository,
  ConnectionStateTransitionTransactionalRepository,
} from "@/server/domain/repositories/connection-state-transition-repository";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";
import type {
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";
import { RunScheduledAnalysisJobUseCase } from "@/server/application/usecases/run-scheduled-analysis-job";
import {
  defaultSeedFixtureId,
  defaultSeedReviewId,
} from "@/server/application/services/review-session-seed";

class InMemoryReviewSessionRepository implements ReviewSessionRepository {
  private readonly store = new Map<string, ReturnType<ReviewSession["toRecord"]>>();

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const record = this.store.get(reviewId);
    return record ? ReviewSession.fromRecord(record) : null;
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }

  seed(reviewSession: ReviewSession): void {
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }
}

class InMemoryConnectionStateRepository implements ConnectionStateRepository {
  constructor(
    private readonly recordsByReviewerId: Record<string, PersistedConnectionState[]> = {},
  ) {}

  async findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    return this.recordsByReviewerId[reviewerId] ?? [];
  }

  async saveForReviewerId(
    reviewerId: string,
    states: PersistedConnectionState[],
  ): Promise<void> {
    this.recordsByReviewerId[reviewerId] = states;
  }

  async updateForReviewerId(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => PersistedConnectionState[],
  ): Promise<PersistedConnectionState[]> {
    const nextStates = updater(this.recordsByReviewerId[reviewerId] ?? []);
    this.recordsByReviewerId[reviewerId] = nextStates;
    return nextStates;
  }
}

class InMemoryConnectionTokenRepository implements ConnectionTokenRepository {
  private readonly tokens = new Map<string, PersistedConnectionToken>();

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const token: PersistedConnectionToken = { ...input };
    this.tokens.set(`${input.reviewerId}:${input.provider}`, token);
    return token;
  }

  async findTokenByReviewerId(
    reviewerId: string,
    provider: "github",
  ): Promise<PersistedConnectionToken | null> {
    return this.tokens.get(`${reviewerId}:${provider}`) ?? null;
  }
}

class InMemoryConnectionStateTransitionRepository
  implements
    ConnectionStateTransitionRepository,
    ConnectionStateTransitionTransactionalRepository
{
  constructor(
    private readonly connectionStateRepository: InMemoryConnectionStateRepository,
    private readonly transitionsByReviewerId: Record<
      string,
      PersistedConnectionStateTransition[]
    > = {},
  ) {}

  async appendTransition(
    transition: PersistedConnectionStateTransitionDraft,
  ): Promise<PersistedConnectionStateTransition> {
    const saved: PersistedConnectionStateTransition = {
      transitionId: `transition-${Math.random().toString(36).slice(2, 8)}`,
      ...transition,
    };
    const current = this.transitionsByReviewerId[transition.reviewerId] ?? [];
    this.transitionsByReviewerId[transition.reviewerId] = [...current, saved];
    return saved;
  }

  async listRecentByReviewerId(
    reviewerId: string,
    options: {
      provider?: string;
      reason?: "manual" | "token-expired" | "webhook";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<PersistedConnectionStateTransition[]> {
    const provider = options.provider?.trim() || null;
    const reason = options.reason ?? null;
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;

    return (this.transitionsByReviewerId[reviewerId] ?? [])
      .filter((transition) => {
        if (provider && transition.provider !== provider) {
          return false;
        }

        if (reason && transition.reason !== reason) {
          return false;
        }

        return true;
      })
      .slice(offset, offset + limit);
  }

  async countByReviewerId(
    reviewerId: string,
    options: { provider?: string; reason?: "manual" | "token-expired" | "webhook" } = {},
  ): Promise<number> {
    const provider = options.provider?.trim() || null;
    const reason = options.reason ?? null;

    return (this.transitionsByReviewerId[reviewerId] ?? []).filter((transition) => {
      if (provider && transition.provider !== provider) {
        return false;
      }

      if (reason && transition.reason !== reason) {
        return false;
      }

      return true;
    }).length;
  }

  async updateStateAndAppendTransition(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => {
      states: PersistedConnectionState[];
      transition: PersistedConnectionStateTransitionDraft | null;
    },
  ): Promise<{
    states: PersistedConnectionState[];
    transition: PersistedConnectionStateTransition | null;
  }> {
    const current = await this.connectionStateRepository.findByReviewerId(reviewerId);
    const next = updater(current);
    await this.connectionStateRepository.saveForReviewerId(reviewerId, next.states);

    if (!next.transition) {
      return {
        states: next.states,
        transition: null,
      };
    }

    return {
      states: next.states,
      transition: await this.appendTransition(next.transition),
    };
  }
}

class InMemoryConnectionProviderCatalog implements ConnectionProviderCatalog {
  listProviders(): ConnectionCatalogEntry[] {
    return [
      {
        provider: "github",
        status: "not_connected",
        authMode: "oauth",
        capabilities: {
          supportsWebhook: true,
          supportsIssueContext: true,
        },
      },
      {
        provider: "confluence",
        status: "planned",
        authMode: "oauth",
        capabilities: {
          supportsWebhook: false,
          supportsIssueContext: true,
        },
      },
      {
        provider: "jira",
        status: "planned",
        authMode: "oauth",
        capabilities: {
          supportsWebhook: false,
          supportsIssueContext: true,
        },
      },
    ];
  }
}

class StubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  calls = 0;
  lastInput: { reviewId: string; source: GitHubPullRequestRef; accessToken?: string | null } | null =
    null;

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle> {
    this.calls += 1;
    this.lastInput = input;

    return {
      title: "PR #12: Improve updateProfile validation",
      repositoryName: `${input.source.owner}/${input.source.repository}`,
      branchLabel: "feature/update-profile → main",
      source: input.source,
      snapshotPairs: [
        {
          fileId: "file-user-service",
          filePath: "src/user-service.ts",
          before: {
            snapshotId: `${input.reviewId}:file-user-service:before`,
            fileId: "file-user-service",
            filePath: "src/user-service.ts",
            language: "typescript",
            revision: "before",
            content: "export const before = true;",
            metadata: {
              codeHost: "github",
            },
          },
          after: {
            snapshotId: `${input.reviewId}:file-user-service:after`,
            fileId: "file-user-service",
            filePath: "src/user-service.ts",
            language: "typescript",
            revision: "after",
            content: "export const after = true;",
            metadata: {
              codeHost: "github",
            },
          },
        },
      ],
    };
  }
}



class StubProviderAgnosticPullRequestSnapshotProvider
  implements ProviderAgnosticPullRequestSnapshotProvider
{
  calls = 0;
  lastInput:
    | { reviewId: string; source: PullRequestSourceRef; accessToken?: string | null }
    | null = null;

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: PullRequestSourceRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle<PullRequestSourceRef>> {
    this.calls += 1;
    this.lastInput = input;

    if (input.source.provider !== "gitlab") {
      throw new Error("unexpected provider");
    }

    const source = input.source as {
      provider: "gitlab";
      projectPath: string;
      mergeRequestIid: number;
    };

    return {
      title: `MR !${source.mergeRequestIid}: Normalize parser flow`,
      repositoryName: source.projectPath,
      branchLabel: "feature/mr-42 → main",
      source,
      snapshotPairs: [
        {
          fileId: "file-user-service",
          filePath: "src/user-service.ts",
          before: {
            snapshotId: `${input.reviewId}:file-user-service:before`,
            fileId: "file-user-service",
            filePath: "src/user-service.ts",
            language: "typescript",
            revision: "before",
            content: "export const before = true;",
            metadata: {
              codeHost: "gitlab",
            },
          },
          after: {
            snapshotId: `${input.reviewId}:file-user-service:after`,
            fileId: "file-user-service",
            filePath: "src/user-service.ts",
            language: "typescript",
            revision: "after",
            content: "export const after = true;",
            metadata: {
              codeHost: "gitlab",
            },
          },
        },
      ],
    };
  }
}


class AuthFailingPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  constructor(private readonly error: PullRequestProviderAuthError) {}

  async fetchPullRequestSnapshots(): Promise<PullRequestSnapshotBundle> {
    throw this.error;
  }
}

class TestParserAdapter implements ParserAdapter {
  readonly language = "typescript";
  readonly adapterName = "test-parser-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "typescript";
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      raw: snapshot,
    };
  }

  async diff(input: { before: ParsedSnapshot | null; after: ParsedSnapshot | null }): Promise<ParserDiffResult> {
    const beforeSnapshot = input.before?.raw as SourceSnapshot | undefined;
    const afterSnapshot = input.after?.raw as SourceSnapshot | undefined;
    const filePath = afterSnapshot?.filePath ?? beforeSnapshot?.filePath ?? "src/unknown.ts";

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [
        {
          symbolKey: "function::<root>::updateProfile",
          displayName: "updateProfile",
          kind: "function",
          changeType: "modified",
          beforeRegion: {
            filePath,
            startLine: 1,
            endLine: 1,
          },
          afterRegion: {
            filePath,
            startLine: 1,
            endLine: 1,
          },
        },
      ],
    };
  }

  capabilities(): ParserCapabilities {
    return {
      callableDiff: true,
      importGraph: false,
      renameDetection: false,
      moveDetection: false,
      typeAwareSummary: false,
    };
  }
}

describe("RunScheduledAnalysisJobUseCase", () => {
  it("runs initial ingestion for initial_ingestion jobs", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Loading analysis...",
        repositoryName: "octocat/locus",
        branchLabel: "loading",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        analysisStatus: "queued",
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    const connectionStateRepository = new InMemoryConnectionStateRepository();
    const connectionStateTransitionRepository =
      new InMemoryConnectionStateTransitionRepository(connectionStateRepository);
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository,
      connectionStateTransitionRepository,
      connectionTokenRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    await useCase.execute({
      jobId: "job-1",
      reviewId: "github-octocat-locus-pr-12",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "initial_ingestion",
    });

    const persisted = await reviewSessionRepository.findByReviewId("github-octocat-locus-pr-12");
    expect(snapshotProvider.calls).toBe(1);
    expect(snapshotProvider.lastInput?.accessToken).toBeNull();
    expect(persisted?.toRecord().analysisStatus).toBe("ready");
    expect(persisted?.toRecord().groups.length).toBeGreaterThan(0);
  });

  it("passes persisted bearer token to ingestion fetches", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-token",
        title: "PR #55: Loading analysis...",
        repositoryName: "octocat/locus",
        branchLabel: "loading",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 55,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        analysisStatus: "queued",
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    await connectionTokenRepository.upsertToken({
      reviewerId: "Demo reviewer",
      provider: "github",
      accessToken: "oauth-bearer-token",
      tokenType: "bearer",
      scope: "repo",
      refreshToken: null,
      expiresAt: null,
      updatedAt: "2026-03-12T00:00:00.000Z",
    });
    const connectionStateRepository = new InMemoryConnectionStateRepository();
    const connectionStateTransitionRepository =
      new InMemoryConnectionStateTransitionRepository(connectionStateRepository);
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository,
      connectionStateTransitionRepository,
      connectionTokenRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    await useCase.execute({
      jobId: "job-token",
      reviewId: "github-octocat-locus-pr-token",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "initial_ingestion",
    });

    expect(snapshotProvider.lastInput?.accessToken).toBe("oauth-bearer-token");
  });



  it("runs initial ingestion for gitlab sources via provider-agnostic orchestration", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "gitlab-duck8823-locus-mr-42",
        title: "MR !42: Loading analysis...",
        repositoryName: "duck8823/locus",
        branchLabel: "loading",
        viewerName: "Demo reviewer",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 42,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        analysisStatus: "queued",
      }),
    );
    const githubSnapshotProvider = new StubPullRequestSnapshotProvider();
    const providerAgnosticSnapshotProvider =
      new StubProviderAgnosticPullRequestSnapshotProvider();
    const connectionStateRepository = new InMemoryConnectionStateRepository();
    const connectionStateTransitionRepository =
      new InMemoryConnectionStateTransitionRepository(connectionStateRepository);
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository,
      connectionStateTransitionRepository,
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: githubSnapshotProvider,
      providerAgnosticPullRequestSnapshotProvider: providerAgnosticSnapshotProvider,
    });

    await useCase.execute({
      jobId: "job-gitlab-ingestion",
      reviewId: "gitlab-duck8823-locus-mr-42",
      requestedAt: "2026-03-10T00:00:00.000Z",
      reason: "initial_ingestion",
    });

    const persisted = await reviewSessionRepository.findByReviewId("gitlab-duck8823-locus-mr-42");
    expect(githubSnapshotProvider.calls).toBe(0);
    expect(providerAgnosticSnapshotProvider.calls).toBe(1);
    expect(persisted?.toRecord().analysisStatus).toBe("ready");
    expect(persisted?.toRecord().reanalysisStatus).toBe("succeeded");
  });


  it("runs reanalysis for webhook jobs", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-13",
        title: "PR #13: existing",
        repositoryName: "octocat/locus",
        branchLabel: "feature/existing → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 13,
        },
        groups: [
          {
            groupId: "group-1",
            title: "Group",
            summary: "Summary",
            filePath: "src/user-service.ts",
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const connectionStateRepository = new InMemoryConnectionStateRepository();
    const connectionStateTransitionRepository =
      new InMemoryConnectionStateTransitionRepository(connectionStateRepository);
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository,
      connectionStateTransitionRepository,
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    await useCase.execute({
      jobId: "job-2",
      reviewId: "github-octocat-locus-pr-13",
      requestedAt: "2026-03-10T00:01:00.000Z",
      reason: "code_host_webhook",
    });

    const persisted = await reviewSessionRepository.findByReviewId("github-octocat-locus-pr-13");
    expect(persisted?.toRecord().reanalysisStatus).toBe("succeeded");
    expect(persisted?.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-10T00:01:00.000Z");
  });

  it("runs reanalysis for seed sessions", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: defaultSeedReviewId,
        title: "Fixture review",
        repositoryName: "duck8823/locus",
        branchLabel: "seed",
        viewerName: "Demo reviewer",
        source: {
          provider: "seed_fixture",
          fixtureId: defaultSeedFixtureId,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const connectionStateRepository = new InMemoryConnectionStateRepository();
    const connectionStateTransitionRepository =
      new InMemoryConnectionStateTransitionRepository(connectionStateRepository);
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository,
      connectionStateTransitionRepository,
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    await useCase.execute({
      jobId: "job-seed",
      reviewId: defaultSeedReviewId,
      requestedAt: "2026-03-10T00:03:00.000Z",
      reason: "manual_reanalysis",
    });

    const persisted = await reviewSessionRepository.findByReviewId(defaultSeedReviewId);
    expect(snapshotProvider.calls).toBe(0);
    expect(persisted?.toRecord().reanalysisStatus).toBe("succeeded");
    expect(persisted?.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-10T00:03:00.000Z");
  });

  it("raises when source is unavailable", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "custom-review",
        title: "custom",
        repositoryName: "duck8823/locus",
        branchLabel: "feat/custom",
        viewerName: "Demo reviewer",
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
      }),
    );
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository: new InMemoryConnectionStateRepository(),
      connectionStateTransitionRepository:
        new InMemoryConnectionStateTransitionRepository(
          new InMemoryConnectionStateRepository(),
        ),
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new StubPullRequestSnapshotProvider(),
    });

    await expect(
      useCase.execute({
        jobId: "job-3",
        reviewId: "custom-review",
        requestedAt: "2026-03-10T00:02:00.000Z",
        reason: "initial_ingestion",
      }),
    ).rejects.toThrow(ReanalyzeSourceUnavailableError);
  });

  it("marks GitHub connection as reauth_required when ingestion fails with auth error", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    reviewSessionRepository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-auth",
        title: "PR #17: Loading analysis...",
        repositoryName: "octocat/locus",
        branchLabel: "loading",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 17,
        },
        groups: [],
        lastOpenedAt: "2026-03-10T00:00:00.000Z",
        analysisStatus: "queued",
      }),
    );
    const connectionStateRepository = new InMemoryConnectionStateRepository({
      "Demo reviewer": [
        {
          provider: "github",
          status: "connected",
          statusUpdatedAt: "2026-03-10T00:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
      ],
    });
    const connectionStateTransitionRepository =
      new InMemoryConnectionStateTransitionRepository(connectionStateRepository);
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
      connectionStateRepository,
      connectionStateTransitionRepository,
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new AuthFailingPullRequestSnapshotProvider(
        new PullRequestProviderAuthError(
          "github",
          401,
          "/repos/octocat/locus/pulls/17",
          '{"message":"Bad credentials"}',
        ),
      ),
    });

    await expect(
      useCase.execute({
        jobId: "job-auth",
        reviewId: "github-octocat-locus-pr-auth",
        requestedAt: "2026-03-10T00:10:00.000Z",
        reason: "initial_ingestion",
      }),
    ).rejects.toBeInstanceOf(PullRequestProviderAuthError);

    await expect(
      connectionStateRepository.findByReviewerId("Demo reviewer"),
    ).resolves.toEqual([
      {
        provider: "github",
        status: "reauth_required",
        statusUpdatedAt: expect.any(String),
        connectedAccountLabel: "duck8823",
      },
    ]);
    await expect(
      connectionStateTransitionRepository.listRecentByReviewerId("Demo reviewer"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "github",
          previousStatus: "connected",
          nextStatus: "reauth_required",
          reason: "token-expired",
          actorType: "system",
          actorId: "github-auth:401",
        }),
      ]),
    );
  });
});
