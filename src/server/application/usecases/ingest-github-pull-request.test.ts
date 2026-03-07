import { describe, expect, it } from "vitest";
import { IngestGitHubPullRequestUseCase } from "@/server/application/usecases/ingest-github-pull-request";
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
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { ReviewSessionRepository } from "@/server/domain/repositories/review-session-repository";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

class InMemoryReviewSessionRepository implements ReviewSessionRepository {
  private readonly store = new Map<string, ReturnType<ReviewSession["toRecord"]>>();

  async findByReviewId(reviewId: string): Promise<ReviewSession | null> {
    const record = this.store.get(reviewId);
    return record ? ReviewSession.fromRecord(record) : null;
  }

  async save(reviewSession: ReviewSession): Promise<void> {
    this.store.set(reviewSession.reviewId, reviewSession.toRecord());
  }
}

class StubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  lastInput: { reviewId: string; source: GitHubPullRequestRef } | null = null;

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
  }): Promise<PullRequestSnapshotBundle> {
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

describe("IngestGitHubPullRequestUseCase", () => {
  it("creates and persists a review session from GitHub snapshot pairs", async () => {
    const repository = new InMemoryReviewSessionRepository();
    const snapshotProvider = new StubPullRequestSnapshotProvider();
    const useCase = new IngestGitHubPullRequestUseCase({
      reviewSessionRepository: repository,
      parserAdapters: [new TestParserAdapter()],
      pullRequestSnapshotProvider: snapshotProvider,
    });

    const result = await useCase.execute({
      reviewId: "github-octocat-locus-pr-12",
      viewerName: "Demo reviewer",
      owner: "octocat",
      repository: "locus",
      pullRequestNumber: 12,
      requestedAt: "2026-03-08T00:00:00.000Z",
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
    expect(record?.title).toBe("PR #12: Improve updateProfile validation");
    expect(record?.repositoryName).toBe("octocat/locus");
    expect(record?.branchLabel).toBe("feature/update-profile → main");
    expect(record?.groups.length ?? 0).toBeGreaterThan(0);
    expect(record?.semanticChanges?.length).toBe(1);
    expect(record?.semanticChanges?.[0]?.symbol.displayName).toBe("updateProfile");
    expect(record?.unsupportedFileAnalyses).toEqual([]);
  });
});
