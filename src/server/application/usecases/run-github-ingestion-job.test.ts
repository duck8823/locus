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
import { RunGitHubIngestionJobUseCase } from "@/server/application/usecases/run-github-ingestion-job";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

class InMemoryReviewSessionRepository implements ReviewSessionRepository {
  private readonly store = new Map<string, ReturnType<ReviewSession["toRecord"]>>();
  readonly savedRecords: Array<ReturnType<ReviewSession["toRecord"]>> = [];

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const record = this.store.get(reviewId);
    return record ? ReviewSession.fromRecord(record) : null;
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    const record = reviewSession.toRecord();
    this.savedRecords.push(record);
    this.store.set(reviewSession.reviewId, record);
  }
}

class StubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
  }): Promise<PullRequestSnapshotBundle> {
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
            content: "export const after = true;",
            metadata: {
              codeHost: "github",
              repositoryRef: `${input.source.owner}/${input.source.repository}`,
              changeRequestRef: `pulls/${input.source.pullRequestNumber}`,
              commitSha: "head-sha",
            },
          },
        },
        {
          fileId: "file-user-controller",
          filePath: "src/user-controller.ts",
          before: {
            snapshotId: `${input.reviewId}:file-user-controller:before`,
            fileId: "file-user-controller",
            filePath: "src/user-controller.ts",
            language: "typescript",
            revision: "before",
            content: "export const oldController = true;",
            metadata: {
              codeHost: "github",
              repositoryRef: `${input.source.owner}/${input.source.repository}`,
              changeRequestRef: `pulls/${input.source.pullRequestNumber}`,
              commitSha: "base-sha",
            },
          },
          after: {
            snapshotId: `${input.reviewId}:file-user-controller:after`,
            fileId: "file-user-controller",
            filePath: "src/user-controller.ts",
            language: "typescript",
            revision: "after",
            content: "export const newController = true;",
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

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [
        {
          symbolKey: `function::<root>::${filePath}`,
          displayName: filePath,
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

describe("RunGitHubIngestionJobUseCase", () => {
  it("stores analysis phase transitions and final ready state", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    const useCase = new RunGitHubIngestionJobUseCase({
      reviewSessionRepository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new StubPullRequestSnapshotProvider(),
    });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
      requestedAt: "2026-03-09T00:00:00.000Z",
    });

    const record = result.reviewSession.toRecord();
    expect(result.snapshotPairCount).toBe(2);
    expect(record.analysisStatus).toBe("ready");
    expect(record.analysisTotalFiles).toBe(2);
    expect(record.analysisProcessedFiles).toBe(2);
    expect(record.analysisError).toBeNull();
    expect(record.groups.length).toBeGreaterThan(0);

    expect(
      reviewSessionRepository.savedRecords.some(
        (savedRecord) =>
          savedRecord.analysisStatus === "parsing" &&
          savedRecord.analysisProcessedFiles != null &&
          savedRecord.analysisProcessedFiles > 0,
      ),
    ).toBe(true);
  });

  it("marks analysis as failed when snapshot fetch fails", async () => {
    const reviewSessionRepository = new InMemoryReviewSessionRepository();
    const useCase = new RunGitHubIngestionJobUseCase({
      reviewSessionRepository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: new FailingPullRequestSnapshotProvider(),
    });

    await expect(
      useCase.execute({
        reviewId: "github-octocat-locus-pr-99",
        viewerName: "Demo reviewer",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 99,
      }),
    ).rejects.toThrow("GitHub API request failed (500): upstream");

    const persisted = await reviewSessionRepository.findByReviewId("github-octocat-locus-pr-99");
    expect(persisted?.toRecord().analysisStatus).toBe("failed");
    expect(persisted?.toRecord().analysisError).toContain("GitHub API request failed");
  });
});
