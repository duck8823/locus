import { describe, expect, it } from "vitest";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
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
} from "@/server/application/ports/pull-request-snapshot-provider";
import { ReanalyzeReviewUseCase } from "@/server/application/usecases/reanalyze-review";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

class InMemoryReviewSessionRepository implements ReviewSessionRepository {
  private readonly store = new Map<string, ReturnType<ReviewSession["toRecord"]>>();
  private findByReviewIdCallCount = 0;
  readonly failOnFindByReviewIdCalls = new Set<number>();

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    this.findByReviewIdCallCount += 1;
    if (this.failOnFindByReviewIdCalls.has(this.findByReviewIdCallCount)) {
      throw new Error("findByReviewId failed");
    }

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

class StubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  lastInput: { reviewId: string; source: GitHubPullRequestRef } | null = null;
  calls = 0;
  onFetch: (() => Promise<void>) | null = null;

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
  }): Promise<PullRequestSnapshotBundle> {
    this.lastInput = input;
    this.calls += 1;

    if (this.onFetch) {
      await this.onFetch();
    }

    return {
      title: `PR #${input.source.pullRequestNumber}: Improve updateProfile validation`,
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
            content: `
export function updateProfile(phone: string): string {
  return phone.trim();
}
`.trim(),
            metadata: {
              codeHost: "github",
              repositoryRef: `${input.source.owner}/${input.source.repository}`,
              changeRequestRef: `pulls/${input.source.pullRequestNumber}`,
              commitSha: "base-sha",
            },
          },
          after: {
            snapshotId: `${input.reviewId}:file-user-service:after`,
            fileId: "file-user-service",
            filePath: "src/user-service.ts",
            language: "typescript",
            revision: "after",
            content: `
export function updateProfile(phone: string): string {
  const normalizedPhone = phone.trim();
  return normalizedPhone.replaceAll("-", "");
}
`.trim(),
            metadata: {
              codeHost: "github",
              repositoryRef: `${input.source.owner}/${input.source.repository}`,
              changeRequestRef: `pulls/${input.source.pullRequestNumber}`,
              commitSha: "head-sha",
            },
          },
        },
      ],
    };
  }
}

class FailingPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  async fetchPullRequestSnapshots(): Promise<PullRequestSnapshotBundle> {
    throw new Error("GitHub API request failed (500): upstream");
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

  async diff(input: {
    before: ParsedSnapshot | null;
    after: ParsedSnapshot | null;
  }): Promise<ParserDiffResult> {
    const beforeSnapshot = input.before?.raw as SourceSnapshot | undefined;
    const afterSnapshot = input.after?.raw as SourceSnapshot | undefined;
    const filePath = afterSnapshot?.filePath ?? beforeSnapshot?.filePath ?? "src/unknown.ts";

    if (!beforeSnapshot || !afterSnapshot || beforeSnapshot.content === afterSnapshot.content) {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [],
      };
    }

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [
        {
          symbolKey: "function::<root>::updateProfile",
          displayName: "updateProfile",
          kind: "function",
          changeType: "modified",
          bodySummary: "Body changed",
          beforeRegion: {
            filePath,
            startLine: 1,
            endLine: 3,
          },
          afterRegion: {
            filePath,
            startLine: 1,
            endLine: 4,
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

describe("ReanalyzeReviewUseCase", () => {
  it("reanalyzes GitHub-backed sessions and preserves review progress", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
        },
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        selectedGroupId: "legacy-group",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "reviewed",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      requestedAt: "2026-03-08T01:00:00.000Z",
    });
    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");
    const record = persisted?.toRecord();

    expect(snapshotProvider.lastInput).toEqual({
      reviewId: "github-octocat-locus-pr-12",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 12,
      },
    });
    expect(result.snapshotPairCount).toBe(1);
    expect(result.reanalysisStatus).toBe("succeeded");
    expect(result.errorMessage).toBeNull();
    expect(result.source).toEqual({
      provider: "github",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
    });
    expect(record?.lastReanalyzeRequestedAt).toBe("2026-03-08T01:00:00.000Z");
    expect(record?.lastReanalyzeCompletedAt).toBeTruthy();
    expect(record?.reanalysisStatus).toBe("succeeded");
    expect(record?.lastReanalyzeError).toBeNull();
    expect(record?.groups[0]?.status).toBe("reviewed");
    expect(record?.selectedGroupId).toBe(record?.groups[0]?.groupId);
    expect(record?.source).toEqual({
      provider: "github",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
    });
  });

  it("infers GitHub source from legacy records when source metadata is absent", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "in_progress",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    await useCase.execute({ reviewId: "github-octocat-locus-pr-12" });

    expect(snapshotProvider.lastInput?.source).toEqual({
      provider: "github",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
    });
    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");
    expect(persisted?.toRecord().source).toEqual({
      provider: "github",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
    });
  });

  it("keeps progress updates that happen while reanalysis is running", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
        },
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    snapshotProvider.onFetch = async () => {
      const liveSession = await repository.findByReviewId("github-octocat-locus-pr-12");

      if (!liveSession) {
        throw new Error("expected a live session");
      }

      liveSession.setGroupStatus("legacy-group", "in_progress");
      await repository.save(liveSession);
    };
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    await useCase.execute({ reviewId: "github-octocat-locus-pr-12" });

    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");

    expect(
      persisted
        ?.toRecord()
        .groups.find((group) => group.filePath === "src/user-service.ts")
        ?.status,
    ).toBe("in_progress");
  });

  it("does not overwrite a newer reanalysis run that started later", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
        },
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });
    let hasSpawnedSecondRun = false;
    snapshotProvider.onFetch = async () => {
      if (hasSpawnedSecondRun) {
        return;
      }

      hasSpawnedSecondRun = true;
      await useCase.execute({
        reviewId: "github-octocat-locus-pr-12",
        requestedAt: "2026-03-08T03:00:01.000Z",
      });
    };

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      requestedAt: "2026-03-08T03:00:00.000Z",
    });
    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");
    const record = persisted?.toRecord();

    expect(result.lastReanalyzeRequestedAt).toBe("2026-03-08T03:00:01.000Z");
    expect(record?.lastReanalyzeRequestedAt).toBe("2026-03-08T03:00:01.000Z");
    expect(record?.reanalysisStatus).toBe("succeeded");
    expect(record?.lastReanalyzeError).toBeNull();
  });

  it("does not treat stale non-reanalysis saves as newer runs", async () => {
    const repository = new InMemoryReviewSessionRepository();
    const initialSession = ReviewSession.create({
      reviewId: "github-octocat-locus-pr-12",
      title: "PR #12: Improve updateProfile validation",
      repositoryName: "octocat/locus",
      branchLabel: "feature/update-profile → main",
      viewerName: "Demo reviewer",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 12,
      },
      lastOpenedAt: "2026-03-07T00:00:00.000Z",
      groups: [
        {
          groupId: "legacy-group",
          title: "Legacy group",
          summary: "Legacy summary",
          filePath: "src/user-service.ts",
          status: "unread",
          upstream: [],
          downstream: [],
        },
      ],
    });
    repository.seed(initialSession);
    const staleRecord = initialSession.toRecord();
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    snapshotProvider.onFetch = async () => {
      const staleSession = ReviewSession.fromRecord(staleRecord);
      staleSession.setGroupStatus("legacy-group", "reviewed");
      await repository.save(staleSession);
    };
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      requestedAt: "2026-03-08T03:10:00.000Z",
    });
    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");
    const record = persisted?.toRecord();

    expect(result.reanalysisStatus).toBe("succeeded");
    expect(record?.lastReanalyzeRequestedAt).toBe("2026-03-08T03:10:00.000Z");
    expect(record?.lastReanalyzeCompletedAt).toBeTruthy();
    expect(record?.reanalysisStatus).toBe("succeeded");
    expect(
      record?.groups.find((group) => group.filePath === "src/user-service.ts")?.status,
    ).toBe("reviewed");
  });

  it("rebuilds seed fixture sessions without calling the GitHub provider", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "demo-review",
        title: "Demo semantic review workspace",
        repositoryName: "duck8823/locus",
        branchLabel: "feat/semantic-analysis-spike",
        viewerName: "Demo reviewer",
        source: {
          provider: "seed_fixture",
          fixtureId: "default",
        },
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/core/user-service.ts",
            status: "in_progress",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    const result = await useCase.execute({
      reviewId: "demo-review",
      requestedAt: "2026-03-08T01:00:00.000Z",
    });

    expect(snapshotProvider.calls).toBe(0);
    expect(result.snapshotPairCount).toBe(3);
    expect(result.reanalysisStatus).toBe("succeeded");
    expect(result.source).toEqual({
      provider: "seed_fixture",
      fixtureId: "default",
    });
    const persisted = await repository.findByReviewId("demo-review");
    expect(persisted?.toRecord().source).toEqual({
      provider: "seed_fixture",
      fixtureId: "default",
    });
    expect(persisted?.toRecord().lastReanalyzeRequestedAt).toBe("2026-03-08T01:00:00.000Z");
  });

  it("infers legacy seed fixture source metadata for demo sessions", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "demo-review",
        title: "Demo semantic review workspace",
        repositoryName: "duck8823/locus",
        branchLabel: "feat/semantic-analysis-spike",
        viewerName: "Demo reviewer",
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/core/user-service.ts",
            status: "reviewed",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    const result = await useCase.execute({ reviewId: "demo-review" });

    expect(snapshotProvider.calls).toBe(0);
    expect(result.reanalysisStatus).toBe("succeeded");
    expect(result.source).toEqual({
      provider: "seed_fixture",
      fixtureId: "default",
    });
    const persisted = await repository.findByReviewId("demo-review");
    expect(persisted?.toRecord().source).toEqual({
      provider: "seed_fixture",
      fixtureId: "default",
    });
    expect(
      persisted
        ?.toRecord()
        .groups.find((group) => group.filePath === "src/core/user-service.ts")
        ?.status,
    ).toBe("reviewed");
  });

  it("records failed status and error details when snapshot refresh fails", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
        },
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "reviewed",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new FailingPullRequestSnapshotProvider(),
    });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      requestedAt: "2026-03-08T02:00:00.000Z",
    });
    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");
    const record = persisted?.toRecord();

    expect(result.reanalysisStatus).toBe("failed");
    expect(result.errorMessage).toContain("GitHub API request failed");
    expect(record?.lastReanalyzeRequestedAt).toBe("2026-03-08T02:00:00.000Z");
    expect(record?.lastReanalyzeCompletedAt).toBeTruthy();
    expect(record?.reanalysisStatus).toBe("failed");
    expect(record?.lastReanalyzeError).toContain("GitHub API request failed");
  });

  it("falls back to in-memory session when loading latest state fails in catch", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "github-octocat-locus-pr-12",
        title: "PR #12: Improve updateProfile validation",
        repositoryName: "octocat/locus",
        branchLabel: "feature/update-profile → main",
        viewerName: "Demo reviewer",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 12,
        },
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    repository.failOnFindByReviewIdCalls.add(2);
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new FailingPullRequestSnapshotProvider(),
    });

    const result = await useCase.execute({ reviewId: "github-octocat-locus-pr-12" });

    expect(result.reanalysisStatus).toBe("failed");
    const persisted = await repository.findByReviewId("github-octocat-locus-pr-12");
    expect(persisted?.toRecord().reanalysisStatus).toBe("failed");
    expect(persisted?.toRecord().lastReanalyzeError).toContain("GitHub API request failed");
  });

  it("records failed status when source cannot be resolved", async () => {
    const repository = new InMemoryReviewSessionRepository();
    repository.seed(
      ReviewSession.create({
        reviewId: "custom-review",
        title: "Ad-hoc review",
        repositoryName: "duck8823/locus",
        branchLabel: "feat/custom",
        viewerName: "Demo reviewer",
        lastOpenedAt: "2026-03-07T00:00:00.000Z",
        groups: [
          {
            groupId: "legacy-group",
            title: "Legacy group",
            summary: "Legacy summary",
            filePath: "src/user-service.ts",
            status: "unread",
            upstream: [],
            downstream: [],
          },
        ],
      }),
    );
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new StubPullRequestSnapshotProvider(),
    });

    const result = await useCase.execute({
      reviewId: "custom-review",
      requestedAt: "2026-03-08T02:30:00.000Z",
    });
    const persisted = await repository.findByReviewId("custom-review");

    expect(result.reanalysisStatus).toBe("failed");
    expect(result.source).toBeNull();
    expect(result.errorMessage).toContain("Reanalysis source is not available");
    expect(persisted?.toRecord().reanalysisStatus).toBe("failed");
    expect(persisted?.toRecord().lastReanalyzeError).toContain(
      "Reanalysis source is not available",
    );
  });

  it("raises when the review session does not exist", async () => {
    const repository = new InMemoryReviewSessionRepository();
    const useCase = new ReanalyzeReviewUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new StubPullRequestSnapshotProvider(),
    });

    await expect(useCase.execute({ reviewId: "missing-review" })).rejects.toThrow(
      ReviewSessionNotFoundError,
    );
  });
});
