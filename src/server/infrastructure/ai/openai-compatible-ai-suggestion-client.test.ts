import { describe, expect, it, vi } from "vitest";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
} from "@/server/application/ports/ai-suggestion-provider";
import { OpenAiCompatibleAiSuggestionClient } from "@/server/infrastructure/ai/openai-compatible-ai-suggestion-client";
import type { LlmAiSuggestionClientInput } from "@/server/infrastructure/ai/llm-ai-suggestion-provider";

function createClientInput(): LlmAiSuggestionClientInput {
  return {
    promptVersion: "openai_compat.v1",
    payload: {
      generatedAt: "2026-03-15T00:00:00.000Z",
      review: {
        reviewId: "review-openai-client",
        title: "OpenAI compatible client test",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/openai-client",
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
    },
  };
}

describe("OpenAiCompatibleAiSuggestionClient", () => {
  it("requests chat completions endpoint and parses JSON content", async () => {
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
                      confidence: "medium",
                      headline: "Inspect fallback flow",
                      recommendation: "Validate fallback behavior under provider failures.",
                      rationale: ["Fallback must be deterministic."],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const client = new OpenAiCompatibleAiSuggestionClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://example.local/v1/",
      fetchFn,
    });

    await expect(client.complete(createClientInput())).resolves.toEqual({
      suggestions: [
        {
          suggestionId: "llm-1",
          category: "general",
          confidence: "medium",
          headline: "Inspect fallback flow",
          recommendation: "Validate fallback behavior under provider failures.",
          rationale: ["Fallback must be deterministic."],
        },
      ],
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.local/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("normalizes base url when chat/completions is already included", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ suggestions: [] }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new OpenAiCompatibleAiSuggestionClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      baseUrl: "https://example.local/v1/chat/completions",
      fetchFn,
    });

    await expect(client.complete(createClientInput())).resolves.toEqual({
      suggestions: [],
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://example.local/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("classifies 429 as temporary provider error", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("rate limit", { status: 429 }));
    const client = new OpenAiCompatibleAiSuggestionClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn,
    });

    await expect(client.complete(createClientInput())).rejects.toBeInstanceOf(
      AiSuggestionProviderTemporaryError,
    );
  });

  it("classifies 400 as permanent provider error", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const client = new OpenAiCompatibleAiSuggestionClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn,
    });

    await expect(client.complete(createClientInput())).rejects.toBeInstanceOf(
      AiSuggestionProviderPermanentError,
    );
  });

  it("classifies network failure as temporary provider error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new OpenAiCompatibleAiSuggestionClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn,
    });

    await expect(client.complete(createClientInput())).rejects.toBeInstanceOf(
      AiSuggestionProviderTemporaryError,
    );
  });

  it("classifies invalid JSON content as permanent provider error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "{invalid-json",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new OpenAiCompatibleAiSuggestionClient({
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetchFn,
    });

    await expect(client.complete(createClientInput())).rejects.toBeInstanceOf(
      AiSuggestionProviderPermanentError,
    );
  });
});
