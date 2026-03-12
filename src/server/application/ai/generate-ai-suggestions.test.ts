import { describe, expect, it } from "vitest";
import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import { generateAiSuggestionsFromPayload } from "@/server/application/ai/generate-ai-suggestions";

function createPayload(overrides: Partial<AiSuggestionPayload> = {}): AiSuggestionPayload {
  return {
    generatedAt: "2026-03-12T00:00:00.000Z",
    review: {
      reviewId: "review-1",
      title: "Demo review",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/demo",
    },
    semanticContext: {
      totalCount: 0,
      includedCount: 0,
      isTruncated: false,
      fallbackMessage: null,
      changes: [],
    },
    architectureContext: {
      groupId: "group-1",
      groupTitle: "Group 1",
      filePath: "src/demo.ts",
      totalUpstreamCount: 0,
      totalDownstreamCount: 0,
      includedUpstreamCount: 0,
      includedDownstreamCount: 0,
      isTruncated: false,
      fallbackMessage: null,
      upstreamNodes: [],
      downstreamNodes: [],
    },
    businessContext: {
      totalCount: 0,
      includedCount: 0,
      isTruncated: false,
      fallbackMessage: null,
      items: [],
    },
    ...overrides,
  };
}

describe("generateAiSuggestionsFromPayload", () => {
  it("generates semantic + architecture + business suggestions from high-signal payload", () => {
    const payload = createPayload({
      semanticContext: {
        totalCount: 3,
        includedCount: 3,
        isTruncated: false,
        fallbackMessage: null,
        changes: [
          {
            semanticChangeId: "sc-1",
            symbolDisplayName: "legacyHandler",
            symbolKind: "function",
            changeType: "removed",
            signatureSummary: null,
            bodySummary: null,
            location: "src/demo.ts:10-20",
          },
          {
            semanticChangeId: "sc-2",
            symbolDisplayName: "runWorkflow",
            symbolKind: "function",
            changeType: "modified",
            signatureSummary: "runWorkflow(input)",
            bodySummary: "Body changed",
            location: "src/demo.ts:30-44",
          },
          {
            semanticChangeId: "sc-3",
            symbolDisplayName: "validateRequest",
            symbolKind: "function",
            changeType: "added",
            signatureSummary: "validateRequest(payload)",
            bodySummary: null,
            location: "src/demo.ts:60-88",
          },
        ],
      },
      architectureContext: {
        groupId: "group-1",
        groupTitle: "Group 1",
        filePath: "src/demo.ts",
        totalUpstreamCount: 2,
        totalDownstreamCount: 3,
        includedUpstreamCount: 2,
        includedDownstreamCount: 3,
        isTruncated: false,
        fallbackMessage: null,
        upstreamNodes: [],
        downstreamNodes: [],
      },
      businessContext: {
        totalCount: 1,
        includedCount: 1,
        isTruncated: false,
        fallbackMessage: null,
        items: [
          {
            contextId: "ctx-1",
            sourceType: "github_issue",
            status: "linked",
            confidence: "high",
            title: "Issue #64",
            summary: "Context bridge contract",
            href: "https://github.com/duck8823/locus/issues/64",
          },
        ],
      },
    });

    const suggestions = generateAiSuggestionsFromPayload(payload);

    expect(suggestions.map((suggestion) => suggestion.suggestionId)).toEqual([
      "verify-removed-symbol-references",
      "check-downstream-callers",
      "review-input-validation",
      "trace-requirement-context",
    ]);
  });

  it("returns baseline manual review suggestion for low-signal payload", () => {
    const payload = createPayload({
      semanticContext: {
        totalCount: 0,
        includedCount: 0,
        isTruncated: false,
        fallbackMessage: "No semantic changes were found.",
        changes: [],
      },
      architectureContext: {
        groupId: null,
        groupTitle: null,
        filePath: null,
        totalUpstreamCount: 0,
        totalDownstreamCount: 0,
        includedUpstreamCount: 0,
        includedDownstreamCount: 0,
        isTruncated: false,
        fallbackMessage: "No architecture neighbors found.",
        upstreamNodes: [],
        downstreamNodes: [],
      },
      businessContext: {
        totalCount: 0,
        includedCount: 0,
        isTruncated: false,
        fallbackMessage: "No business context links were found.",
        items: [],
      },
    });

    const suggestions = generateAiSuggestionsFromPayload(payload);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      suggestionId: "baseline-manual-review",
      category: "general",
      confidence: "low",
    });
  });
});
