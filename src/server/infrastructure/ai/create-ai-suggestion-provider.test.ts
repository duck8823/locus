import { describe, expect, it, vi } from "vitest";
import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import { createAiSuggestionProvider } from "@/server/infrastructure/ai/create-ai-suggestion-provider";

function createPayload(): AiSuggestionPayload {
  return {
    generatedAt: "2026-03-15T00:00:00.000Z",
    review: {
      reviewId: "review-provider-factory",
      title: "Factory test",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/provider-factory",
    },
    semanticContext: {
      totalCount: 1,
      includedCount: 1,
      isTruncated: false,
      fallbackMessage: null,
      changes: [
        {
          semanticChangeId: "semantic-1",
          symbolDisplayName: "createAiSuggestionProvider",
          symbolKind: "function",
          changeType: "added",
          signatureSummary: "createAiSuggestionProvider(input?): AiSuggestionProvider",
          bodySummary: "selects heuristic/openai provider by env",
          location: "src/server/infrastructure/ai/create-ai-suggestion-provider.ts",
        },
      ],
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
  };
}

describe("createAiSuggestionProvider", () => {
  it("uses heuristic provider by default", async () => {
    const provider = createAiSuggestionProvider({ env: {} });

    const suggestions = await provider.generateSuggestions({
      payload: createPayload(),
    });

    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("falls back to heuristic provider when openai mode has no api key", async () => {
    const warn = vi.fn();
    const provider = createAiSuggestionProvider({
      env: {
        LOCUS_AI_SUGGESTION_PROVIDER: "openai_compat",
      },
      logger: { warn },
    });

    const suggestions = await provider.generateSuggestions({
      payload: createPayload(),
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith(
      "ai_suggestion_provider_config_fallback",
      expect.objectContaining({
        reason: "missing_openai_api_key",
        mode: "openai_compat",
      }),
    );
  });

  it("uses openai-compatible provider when mode and api key are configured", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  suggestions: [
                    {
                      suggestionId: "llm-1",
                      category: "general",
                      confidence: "high",
                      headline: "LLM suggestion",
                      recommendation: "Use typed provider error mapping.",
                      rationale: ["Adapter boundary allows backend swap."],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createAiSuggestionProvider({
      env: {
        LOCUS_AI_SUGGESTION_PROVIDER: "openai_compat",
        LOCUS_AI_SUGGESTION_OPENAI_API_KEY: "test-key",
        LOCUS_AI_SUGGESTION_OPENAI_BASE_URL: "https://example.local/v1",
        LOCUS_AI_SUGGESTION_PROVIDER_OPENAI_COMPAT_TIMEOUT_MS: "3000",
      },
      fetchFn,
    });

    const suggestions = await provider.generateSuggestions({
      payload: createPayload(),
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([
      {
        suggestionId: "llm-1",
        category: "general",
        confidence: "high",
        headline: "LLM suggestion",
        recommendation: "Use typed provider error mapping.",
        rationale: ["Adapter boundary allows backend swap."],
      },
    ]);
  });

  it("applies guardrail fallback when openai token budget is exceeded", async () => {
    const fetchFn = vi.fn();
    const provider = createAiSuggestionProvider({
      env: {
        LOCUS_AI_SUGGESTION_PROVIDER: "openai_compat",
        LOCUS_AI_SUGGESTION_OPENAI_API_KEY: "test-key",
        LOCUS_AI_SUGGESTION_PROVIDER_OPENAI_COMPAT_MAX_ESTIMATED_INPUT_TOKENS: "1",
      },
      fetchFn,
    });

    const suggestions = await provider.generateSuggestions({
      payload: createPayload(),
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(suggestions.length).toBeGreaterThan(0);
  });
});
