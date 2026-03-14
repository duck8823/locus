import { describe, expect, it } from "vitest";
import { buildAiSuggestionPayload } from "@/server/application/ai/build-ai-suggestion-payload";
import {
  createMixedContextItemsFixtureShuffled,
} from "@/server/application/testing/mixed-context-fixtures";

describe("buildAiSuggestionPayload (mixed context fixtures)", () => {
  it("keeps deterministic ordering and truncation for mixed provider-style context rows", () => {
    const payload = buildAiSuggestionPayload({
      review: {
        reviewId: "review-mixed-context",
        title: "Mixed context review",
        repositoryName: "octocat/locus",
        branchLabel: "feature/mixed-context",
      },
      selectedGroup: null,
      businessContextItems: createMixedContextItemsFixtureShuffled().map((item) => ({
        contextId: item.contextId,
        sourceType: item.sourceType,
        status: item.status,
        confidence: item.confidence,
        title: item.title,
        summary: item.summary,
        href: item.href,
      })),
    });

    expect(payload.businessContext.totalCount).toBe(8);
    expect(payload.businessContext.includedCount).toBe(6);
    expect(payload.businessContext.isTruncated).toBe(true);
    expect(payload.businessContext.items.map((item) => item.contextId)).toEqual([
      "ctx-gh-linked-101",
      "ctx-jira-linked-321",
      "ctx-confluence-linked-api",
      "ctx-gh-candidate-205",
      "ctx-jira-candidate-998",
      "ctx-confluence-candidate-rollout",
    ]);
  });
});
