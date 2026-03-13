import { describe, expect, it } from "vitest";
import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
} from "@/server/application/ports/ai-suggestion-provider";
import { HeuristicAiSuggestionProvider } from "@/server/infrastructure/ai/heuristic-ai-suggestion-provider";

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
      groupId: null,
      groupTitle: null,
      filePath: null,
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

describe("HeuristicAiSuggestionProvider", () => {
  it("returns generated suggestions", async () => {
    const provider = new HeuristicAiSuggestionProvider(() => [
      {
        suggestionId: "suggestion-1",
        category: "general",
        confidence: "low",
        headline: "Headline",
        recommendation: "Recommendation",
        rationale: ["Rationale"],
      },
    ]);

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual([
      {
        suggestionId: "suggestion-1",
        category: "general",
        confidence: "low",
        headline: "Headline",
        recommendation: "Recommendation",
        rationale: ["Rationale"],
      },
    ]);
  });

  it("classifies aborted generation as temporary provider error", async () => {
    const provider = new HeuristicAiSuggestionProvider(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).rejects.toBeInstanceOf(AiSuggestionProviderTemporaryError);
  });

  it("classifies unknown failure as permanent provider error", async () => {
    const provider = new HeuristicAiSuggestionProvider(() => {
      throw new Error("unexpected parser shape");
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).rejects.toBeInstanceOf(AiSuggestionProviderPermanentError);
  });
});
