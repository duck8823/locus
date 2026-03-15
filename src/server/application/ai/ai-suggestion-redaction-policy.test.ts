import { describe, expect, it } from "vitest";
import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  AI_SUGGESTION_REDACTION_POLICY_VERSION,
  redactAiSuggestionPayload,
  redactAiSuggestions,
} from "@/server/application/ai/ai-suggestion-redaction-policy";

function createPayload(): AiSuggestionPayload {
  return {
    generatedAt: "2026-03-15T00:00:00.000Z",
    review: {
      reviewId: "review-1",
      title: "Sensitive title",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/sensitive-branch",
    },
    semanticContext: {
      totalCount: 1,
      includedCount: 1,
      isTruncated: false,
      fallbackMessage: "Fallback detail",
      changes: [
        {
          semanticChangeId: "sc-1",
          symbolDisplayName: "sensitiveSymbol",
          symbolKind: "function",
          changeType: "modified",
          signatureSummary: "(input: string) => string",
          bodySummary: "contains sensitive transformation",
          location: "src/sensitive.ts",
        },
      ],
    },
    architectureContext: {
      groupId: "group-1",
      groupTitle: "Sensitive group",
      filePath: "src/sensitive.ts",
      totalUpstreamCount: 1,
      totalDownstreamCount: 1,
      includedUpstreamCount: 1,
      includedDownstreamCount: 1,
      isTruncated: false,
      fallbackMessage: "Architecture fallback",
      upstreamNodes: [
        {
          nodeId: "up-1",
          kind: "file",
          label: "src/upstream.ts",
        },
      ],
      downstreamNodes: [
        {
          nodeId: "down-1",
          kind: "file",
          label: "src/downstream.ts",
        },
      ],
    },
    businessContext: {
      totalCount: 1,
      includedCount: 1,
      isTruncated: false,
      fallbackMessage: "Business fallback",
      items: [
        {
          contextId: "ctx-1",
          sourceType: "github_issue",
          status: "linked",
          confidence: "high",
          title: "Sensitive issue title",
          summary: "Sensitive issue summary",
          href: "https://example.com/internal/secret",
        },
      ],
    },
  };
}

describe("AI suggestion redaction policy", () => {
  it("exposes a stable policy version constant", () => {
    expect(AI_SUGGESTION_REDACTION_POLICY_VERSION).toBe("ai_suggestion_redaction.v1");
  });

  it("redacts free-text fields in payload while preserving ids/counts", () => {
    const redacted = redactAiSuggestionPayload(createPayload());

    expect(redacted.review).toEqual({
      reviewId: "review-1",
      title: "[redacted:15]",
      repositoryName: "duck8823/locus",
      branchLabel: "[redacted:24]",
    });
    expect(redacted.semanticContext.changes[0]).toMatchObject({
      semanticChangeId: "sc-1",
      symbolDisplayName: "[redacted:15]",
      location: "[redacted:16]",
    });
    expect(redacted.businessContext.items[0]).toMatchObject({
      contextId: "ctx-1",
      title: "[redacted:21]",
      summary: "[redacted:23]",
      href: "[redacted:35]",
    });
  });

  it("redacts free-text fields in suggestions", () => {
    const suggestions: AiSuggestion[] = [
      {
        suggestionId: "suggestion-1",
        category: "general",
        confidence: "high",
        headline: "Sensitive headline",
        recommendation: "Sensitive recommendation",
        rationale: ["Sensitive rationale A", "Sensitive rationale B"],
      },
    ];

    expect(redactAiSuggestions(suggestions)).toEqual([
      {
        suggestionId: "suggestion-1",
        category: "general",
        confidence: "high",
        headline: "[redacted:18]",
        recommendation: "[redacted:24]",
        rationale: ["[redacted:21]", "[redacted:21]"],
      },
    ]);
  });
});
