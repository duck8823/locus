import { describe, expect, it } from "vitest";
import { ReviewSession } from "@/server/domain/entities/review-session";
import type { SemanticChange } from "@/server/domain/value-objects/semantic-change";
import { toReviewWorkspaceDto } from "@/server/presentation/mappers/to-review-workspace-dto";

function createSemanticChange(
  semanticChangeId: string,
  overrides?: Partial<SemanticChange>,
): SemanticChange {
  return {
    semanticChangeId,
    reviewId: "review-1",
    fileId: "file-1",
    language: "typescript",
    adapterName: "typescript-parser",
    symbol: {
      stableKey: `function::<root>::${semanticChangeId}`,
      displayName: `symbol-${semanticChangeId}`,
      kind: "function",
    },
    change: {
      type: "modified",
      signatureSummary: "updateProfile(id)",
      bodySummary: "2 statement(s)",
    },
    before: {
      filePath: "src/before.ts",
      startLine: 10,
      endLine: 20,
    },
    after: {
      filePath: "src/after.ts",
      startLine: 12,
      endLine: 23,
    },
    architecture: {
      outgoingNodeIds: [],
      incomingNodeIds: [],
    },
    metadata: {
      parser: {},
      languageSpecific: {},
    },
    ...overrides,
  };
}

describe("toReviewWorkspaceDto", () => {
  it("maps semantic changes per group and summarizes unsupported files", () => {
    const primaryChange = createSemanticChange("change-1");
    const secondaryChange = createSemanticChange("change-2", {
      symbol: {
        stableKey: "method::UserService::instance::save",
        displayName: "UserService.save",
        kind: "method",
      },
      change: {
        type: "added",
      },
      before: undefined,
    });
    const reviewSession = ReviewSession.create({
      reviewId: "review-1",
      title: "Demo workspace",
      repositoryName: "duck8823/locus",
      branchLabel: "feat/semantic-analysis-spike",
      viewerName: "Duck",
      lastOpenedAt: "2026-03-08T00:00:00.000Z",
      selectedGroupId: "group-1",
      groups: [
        {
          groupId: "group-1",
          title: "Group 1",
          summary: "Primary",
          filePath: "src/a.ts",
          status: "unread",
          upstream: [],
          downstream: [],
          semanticChangeIds: ["change-1", "missing-change", "change-2"],
        },
        {
          groupId: "group-2",
          title: "Group 2",
          summary: "Secondary",
          filePath: "src/b.ts",
          status: "reviewed",
          upstream: [],
          downstream: [],
          semanticChangeIds: ["unknown-change"],
        },
      ],
      semanticChanges: [primaryChange, secondaryChange],
      unsupportedFileAnalyses: [
        {
          reviewId: "review-1",
          fileId: "u-1",
          filePath: "assets/logo.png",
          language: null,
          reason: "binary_file",
        },
        {
          reviewId: "review-1",
          fileId: "u-2",
          filePath: "src/app.vue",
          language: "vue",
          reason: "unsupported_language",
        },
        {
          reviewId: "review-1",
          fileId: "u-3",
          filePath: "src/broken.ts",
          language: "typescript",
          reason: "parser_failed",
        },
      ],
    });

    const dto = toReviewWorkspaceDto(reviewSession);

    expect(dto.groups[0]?.semanticChanges).toEqual([
      {
        semanticChangeId: "change-1",
        symbolDisplayName: "symbol-change-1",
        symbolKind: "function",
        changeType: "modified",
        signatureSummary: "updateProfile(id)",
        bodySummary: "2 statement(s)",
        before: {
          filePath: "src/before.ts",
          startLine: 10,
          endLine: 20,
        },
        after: {
          filePath: "src/after.ts",
          startLine: 12,
          endLine: 23,
        },
      },
      {
        semanticChangeId: "change-2",
        symbolDisplayName: "UserService.save",
        symbolKind: "method",
        changeType: "added",
        signatureSummary: null,
        bodySummary: null,
        before: null,
        after: {
          filePath: "src/after.ts",
          startLine: 12,
          endLine: 23,
        },
      },
    ]);
    expect(dto.groups[1]?.semanticChanges).toEqual([]);
    expect(dto.unsupportedSummary).toEqual({
      totalCount: 3,
      byReason: [
        { reason: "binary_file", count: 1 },
        { reason: "parser_failed", count: 1 },
        { reason: "unsupported_language", count: 1 },
      ],
      sampleFilePaths: ["assets/logo.png", "src/app.vue", "src/broken.ts"],
    });
  });

  it("returns an empty unsupported summary when all files were parsed", () => {
    const reviewSession = ReviewSession.create({
      reviewId: "review-2",
      title: "Demo workspace",
      repositoryName: "duck8823/locus",
      branchLabel: "main",
      viewerName: "Duck",
      lastOpenedAt: "2026-03-08T00:00:00.000Z",
      groups: [
        {
          groupId: "group-1",
          title: "Group 1",
          summary: "Primary",
          filePath: "src/a.ts",
          status: "unread",
          upstream: [],
          downstream: [],
        },
      ],
    });

    const dto = toReviewWorkspaceDto(reviewSession);

    expect(dto.unsupportedSummary).toEqual({
      totalCount: 0,
      byReason: [],
      sampleFilePaths: [],
    });
    expect(dto.groups[0]?.semanticChanges).toEqual([]);
  });
});
