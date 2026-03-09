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
} from "@/server/application/ports/pull-request-snapshot-provider";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";
import { RunScheduledAnalysisJobUseCase } from "@/server/application/usecases/run-scheduled-analysis-job";

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

class StubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  calls = 0;

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
  }): Promise<PullRequestSnapshotBundle> {
    this.calls += 1;

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
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
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
    expect(persisted?.toRecord().analysisStatus).toBe("ready");
    expect(persisted?.toRecord().groups.length).toBeGreaterThan(0);
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
    const useCase = new RunScheduledAnalysisJobUseCase({
      reviewSessionRepository,
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
});
