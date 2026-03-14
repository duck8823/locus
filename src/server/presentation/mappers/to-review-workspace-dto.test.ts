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
      analysisStatus: "parsing",
      analysisRequestedAt: "2026-03-08T00:30:00.000Z",
      analysisCompletedAt: null,
      analysisTotalFiles: 12,
      analysisProcessedFiles: 4,
      analysisAttemptCount: 2,
      analysisError: null,
      lastReanalyzeRequestedAt: "2026-03-08T01:00:00.000Z",
      reanalysisStatus: "failed",
      lastReanalyzeCompletedAt: "2026-03-08T01:00:09.000Z",
      lastReanalyzeError: "GitHub API request failed",
      selectedGroupId: "group-1",
      groups: [
        {
          groupId: "group-1",
          title: "Group 1",
          summary: "Primary",
          filePath: "src/a.ts",
          status: "unread",
          upstream: ["layer:domain", "file:src/b.ts", "symbol:function:UserService::findUser"],
          downstream: ["layer:infrastructure", "file:src/b.ts"],
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

    expect(dto.analysisStatus).toBe("parsing");
    expect(dto.analysisRequestedAt).toBe("2026-03-08T00:30:00.000Z");
    expect(dto.analysisCompletedAt).toBeNull();
    expect(dto.analysisTotalFiles).toBe(12);
    expect(dto.analysisProcessedFiles).toBe(4);
    expect(dto.analysisSupportedFiles).toBe(9);
    expect(dto.analysisUnsupportedFiles).toBe(3);
    expect(dto.analysisCoveragePercent).toBe(75);
    expect(dto.analysisAttemptCount).toBe(2);
    expect(dto.analysisDurationMs).toBeNull();
    expect(dto.analysisError).toBeNull();
    expect(dto.analysisHistory).toEqual([]);
    expect(dto.dogfoodingMetrics).toEqual({
      averageDurationMs: null,
      failureRatePercent: null,
      recoverySuccessRatePercent: null,
    });
    expect(dto.queueHealth).toBeNull();
    expect(dto.aiSuggestionPayload).toBeNull();
    expect(dto.aiSuggestions).toEqual([]);
    expect(dto.reanalysisStatus).toBe("failed");
    expect(dto.lastReanalyzeRequestedAt).toBe("2026-03-08T01:00:00.000Z");
    expect(dto.lastReanalyzeCompletedAt).toBe("2026-03-08T01:00:09.000Z");
    expect(dto.lastReanalyzeError).toBe("GitHub API request failed");

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
    expect(dto.groups[0]?.architectureGraph).toEqual({
      nodes: [
        {
          nodeId: "group:group-1",
          kind: "file",
          label: "src/a.ts",
          role: "center",
          linkedGroupId: "group-1",
        },
        {
          nodeId: "layer:domain",
          kind: "layer",
          label: "domain",
          role: "upstream",
          linkedGroupId: null,
        },
        {
          nodeId: "file:src/b.ts",
          kind: "file",
          label: "src/b.ts",
          role: "upstream",
          linkedGroupId: "group-2",
        },
        {
          nodeId: "symbol:function:UserService::findUser",
          kind: "symbol",
          label: "UserService.findUser (function)",
          role: "upstream",
          linkedGroupId: null,
        },
        {
          nodeId: "layer:infrastructure",
          kind: "layer",
          label: "infrastructure",
          role: "downstream",
          linkedGroupId: null,
        },
      ],
      edges: [
        {
          fromNodeId: "file:src/b.ts",
          toNodeId: "group:group-1",
          relation: "imports",
        },
        {
          fromNodeId: "group:group-1",
          toNodeId: "file:src/b.ts",
          relation: "imports",
        },
        {
          fromNodeId: "group:group-1",
          toNodeId: "layer:infrastructure",
          relation: "uses",
        },
        {
          fromNodeId: "layer:domain",
          toNodeId: "group:group-1",
          relation: "uses",
        },
        {
          fromNodeId: "symbol:function:UserService::findUser",
          toNodeId: "group:group-1",
          relation: "calls",
        },
      ],
    });
    expect(dto.unsupportedSummary).toEqual({
      totalCount: 3,
      byReason: [
        { reason: "binary_file", count: 1 },
        { reason: "parser_failed", count: 1 },
        { reason: "unsupported_language", count: 1 },
      ],
      sampleFilePaths: ["assets/logo.png", "src/app.vue", "src/broken.ts"],
    });
    expect(dto.unsupportedFiles).toEqual([
      {
        filePath: "assets/logo.png",
        language: null,
        reason: "binary_file",
        detail: null,
      },
      {
        filePath: "src/app.vue",
        language: "vue",
        reason: "unsupported_language",
        detail: null,
      },
      {
        filePath: "src/broken.ts",
        language: "typescript",
        reason: "parser_failed",
        detail: null,
      },
    ]);
    expect(dto.businessContext.provider).toBe("stub");
    expect(dto.businessContext.diagnostics).toEqual({
      status: "ok",
      retryable: true,
      message: null,
      occurredAt: null,
      cacheHit: null,
      fallbackReason: null,
    });
    expect(dto.businessContext.items).toEqual([]);
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

    expect(dto.analysisStatus).toBe("ready");
    expect(dto.analysisRequestedAt).toBeNull();
    expect(dto.analysisCompletedAt).toBeNull();
    expect(dto.analysisTotalFiles).toBeNull();
    expect(dto.analysisProcessedFiles).toBeNull();
    expect(dto.analysisSupportedFiles).toBeNull();
    expect(dto.analysisUnsupportedFiles).toBe(0);
    expect(dto.analysisCoveragePercent).toBeNull();
    expect(dto.analysisAttemptCount).toBe(0);
    expect(dto.analysisDurationMs).toBeNull();
    expect(dto.analysisError).toBeNull();
    expect(dto.analysisHistory).toEqual([]);
    expect(dto.dogfoodingMetrics).toEqual({
      averageDurationMs: null,
      failureRatePercent: null,
      recoverySuccessRatePercent: null,
    });
    expect(dto.queueHealth).toBeNull();
    expect(dto.aiSuggestionPayload).toBeNull();
    expect(dto.aiSuggestions).toEqual([]);
    expect(dto.reanalysisStatus).toBe("idle");
    expect(dto.lastReanalyzeRequestedAt).toBeNull();
    expect(dto.lastReanalyzeCompletedAt).toBeNull();
    expect(dto.lastReanalyzeError).toBeNull();
    expect(dto.businessContext.provider).toBe("stub");
    expect(dto.businessContext.diagnostics).toEqual({
      status: "ok",
      retryable: true,
      message: null,
      occurredAt: null,
      cacheHit: null,
      fallbackReason: null,
    });
    expect(dto.businessContext.items).toEqual([]);

    expect(dto.unsupportedSummary).toEqual({
      totalCount: 0,
      byReason: [],
      sampleFilePaths: [],
    });
    expect(dto.unsupportedFiles).toEqual([]);
    expect(dto.groups[0]?.semanticChanges).toEqual([]);
    expect(dto.groups[0]?.architectureGraph).toEqual({
      nodes: [
        {
          nodeId: "group:group-1",
          kind: "file",
          label: "src/a.ts",
          role: "center",
          linkedGroupId: "group-1",
        },
      ],
      edges: [],
    });
  });

  it("orders semantic changes by impact priority with deterministic tie-breakers", () => {
    const reviewSession = ReviewSession.create({
      reviewId: "review-4",
      title: "Ordering demo",
      repositoryName: "duck8823/locus",
      branchLabel: "main",
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
          semanticChangeIds: [
            "change-g",
            "change-c",
            "change-a",
            "change-f",
            "change-b",
            "change-d",
            "change-e",
          ],
        },
      ],
      semanticChanges: [
        createSemanticChange("change-a", {
          symbol: {
            stableKey: "function::<root>::RenameTask",
            displayName: "RenameTask",
            kind: "function",
          },
          change: {
            type: "renamed",
          },
        }),
        createSemanticChange("change-b", {
          symbol: {
            stableKey: "function::<root>::AddTask",
            displayName: "AddTask",
            kind: "function",
          },
          change: {
            type: "added",
          },
        }),
        createSemanticChange("change-c", {
          symbol: {
            stableKey: "function::<root>::CoreTask",
            displayName: "CoreTask",
            kind: "function",
          },
          change: {
            type: "modified",
          },
        }),
        createSemanticChange("change-d", {
          symbol: {
            stableKey: "function::<root>::RemoveTask",
            displayName: "RemoveTask",
            kind: "function",
          },
          change: {
            type: "removed",
          },
        }),
        createSemanticChange("change-e", {
          symbol: {
            stableKey: "function::<root>::MoveTask",
            displayName: "MoveTask",
            kind: "function",
          },
          change: {
            type: "moved",
          },
        }),
        createSemanticChange("change-f", {
          symbol: {
            stableKey: "function::<root>::CoreTaskAlias",
            displayName: "CoreTask",
            kind: "function",
          },
          change: {
            type: "modified",
          },
        }),
        createSemanticChange("change-g", {
          symbol: {
            stableKey: "function::<root>::CoreTaskAlias2",
            displayName: "CoreTask",
            kind: "function",
          },
          change: {
            type: "modified",
          },
        }),
      ],
    });

    const dto = toReviewWorkspaceDto(reviewSession);

    expect(dto.groups[0]?.semanticChanges.map((change) => change.symbolDisplayName)).toEqual([
      "CoreTask",
      "CoreTask",
      "CoreTask",
      "AddTask",
      "RemoveTask",
      "MoveTask",
      "RenameTask",
    ]);
    expect(dto.groups[0]?.semanticChanges.map((change) => change.semanticChangeId)).toEqual([
      "change-c",
      "change-f",
      "change-g",
      "change-b",
      "change-d",
      "change-e",
      "change-a",
    ]);
  });

  it("calculates analysis duration from requested/completed timestamps", () => {
    const reviewSession = ReviewSession.create({
      reviewId: "review-3",
      title: "Duration demo",
      repositoryName: "duck8823/locus",
      branchLabel: "main",
      viewerName: "Duck",
      lastOpenedAt: "2026-03-08T00:00:00.000Z",
      analysisStatus: "ready",
      analysisRequestedAt: "2026-03-08T00:00:00.000Z",
      analysisCompletedAt: "2026-03-08T00:00:02.500Z",
      analysisAttemptCount: 1,
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

    expect(dto.analysisSupportedFiles).toBeNull();
    expect(dto.analysisUnsupportedFiles).toBe(0);
    expect(dto.analysisCoveragePercent).toBeNull();
    expect(dto.analysisAttemptCount).toBe(1);
    expect(dto.analysisDurationMs).toBe(2500);
  });

  it("limits unsupported file details to the first 100 rows while keeping summary counts", () => {
    const unsupportedFileAnalyses = Array.from({ length: 120 }, (_, index) => ({
      reviewId: "review-4",
      fileId: `u-${index + 1}`,
      filePath: `generated/file-${index + 1}.bin`,
      language: null,
      reason: "binary_file" as const,
    }));
    const reviewSession = ReviewSession.create({
      reviewId: "review-4",
      title: "Coverage limit",
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
      unsupportedFileAnalyses,
    });

    const dto = toReviewWorkspaceDto(reviewSession);

    expect(dto.analysisSupportedFiles).toBeNull();
    expect(dto.analysisUnsupportedFiles).toBe(120);
    expect(dto.analysisCoveragePercent).toBeNull();
    expect(dto.unsupportedSummary.totalCount).toBe(120);
    expect(dto.unsupportedFiles).toHaveLength(100);
    expect(dto.unsupportedFiles[0]?.filePath).toBe("generated/file-1.bin");
    expect(dto.unsupportedFiles[99]?.filePath).toBe("generated/file-100.bin");
  });

  it("keeps unsupported reason buckets deterministic regardless of input order", () => {
    const reviewSession = ReviewSession.create({
      reviewId: "review-6",
      title: "Unsupported ordering",
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
      unsupportedFileAnalyses: [
        {
          reviewId: "review-6",
          fileId: "u-1",
          filePath: "src/unknown.vue",
          language: "vue",
          reason: "unsupported_language",
        },
        {
          reviewId: "review-6",
          fileId: "u-2",
          filePath: "assets/logo.png",
          language: null,
          reason: "binary_file",
        },
        {
          reviewId: "review-6",
          fileId: "u-3",
          filePath: "src/broken.ts",
          language: "typescript",
          reason: "parser_failed",
        },
        {
          reviewId: "review-6",
          fileId: "u-4",
          filePath: "src/second.vue",
          language: "vue",
          reason: "unsupported_language",
        },
      ],
    });

    const dto = toReviewWorkspaceDto(reviewSession);

    expect(dto.unsupportedSummary.byReason).toEqual([
      { reason: "binary_file", count: 1 },
      { reason: "parser_failed", count: 1 },
      { reason: "unsupported_language", count: 2 },
    ]);
  });

  it("caps partial coverage below 100 percent", () => {
    const unsupportedFileAnalyses = [
      {
        reviewId: "review-5",
        fileId: "u-1",
        filePath: "assets/ignored.bin",
        language: null,
        reason: "binary_file" as const,
      },
    ];
    const reviewSession = ReviewSession.create({
      reviewId: "review-5",
      title: "Coverage precision",
      repositoryName: "duck8823/locus",
      branchLabel: "main",
      viewerName: "Duck",
      lastOpenedAt: "2026-03-08T00:00:00.000Z",
      analysisTotalFiles: 1000,
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
      unsupportedFileAnalyses,
    });

    const dto = toReviewWorkspaceDto(reviewSession);

    expect(dto.analysisSupportedFiles).toBe(999);
    expect(dto.analysisUnsupportedFiles).toBe(1);
    expect(dto.analysisCoveragePercent).toBe(99.9);
  });
});
