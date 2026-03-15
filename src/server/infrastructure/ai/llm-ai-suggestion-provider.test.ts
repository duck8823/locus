import { describe, expect, it, vi } from "vitest";
import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
} from "@/server/application/ports/ai-suggestion-provider";
import { LlmAiSuggestionProvider } from "@/server/infrastructure/ai/llm-ai-suggestion-provider";

function createPayload(): AiSuggestionPayload {
  return {
    generatedAt: "2026-03-15T00:00:00.000Z",
    review: {
      reviewId: "review-llm-provider",
      title: "LLM provider test",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/llm-provider",
    },
    semanticContext: {
      totalCount: 1,
      includedCount: 1,
      isTruncated: false,
      fallbackMessage: null,
      changes: [
        {
          semanticChangeId: "semantic-1",
          symbolDisplayName: "runAnalysis",
          symbolKind: "function",
          changeType: "modified",
          signatureSummary: "runAnalysis(input: Input): Output",
          bodySummary: "adds timeout handling",
          location: "src/server/app.ts",
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
          title: "Add LLM abstraction",
          summary: "Need provider-agnostic adapter boundary.",
          href: "https://github.com/duck8823/locus/issues/120",
        },
      ],
    },
  };
}

describe("LlmAiSuggestionProvider", () => {
  it("returns validated suggestions from client response object", async () => {
    const provider = new LlmAiSuggestionProvider({
      promptVersion: "openai_compat.v1",
      client: {
        complete: vi.fn().mockResolvedValue({
          suggestions: [
            {
              suggestionId: "llm-1",
              category: "semantic",
              confidence: "high",
              headline: "Check timeout propagation",
              recommendation: "Ensure provider timeout maps to typed transient failure.",
              rationale: ["Timeout guardrails are now configurable per provider."],
            },
          ],
        }),
      },
    });

    await expect(provider.generateSuggestions({ payload: createPayload() })).resolves.toEqual([
      {
        suggestionId: "llm-1",
        category: "semantic",
        confidence: "high",
        headline: "Check timeout propagation",
        recommendation: "Ensure provider timeout maps to typed transient failure.",
        rationale: ["Timeout guardrails are now configurable per provider."],
      },
    ]);
  });

  it("accepts top-level array response", async () => {
    const provider = new LlmAiSuggestionProvider({
      promptVersion: "openai_compat.v1",
      client: {
        complete: vi.fn().mockResolvedValue([
          {
            suggestionId: "llm-2",
            category: "general",
            confidence: "low",
            headline: "Keep baseline checks",
            recommendation: "Use fallback checklists while tuning prompts.",
            rationale: ["Model output can fluctuate during early rollout."],
          },
        ]),
      },
    });

    await expect(provider.generateSuggestions({ payload: createPayload() })).resolves.toEqual([
      {
        suggestionId: "llm-2",
        category: "general",
        confidence: "low",
        headline: "Keep baseline checks",
        recommendation: "Use fallback checklists while tuning prompts.",
        rationale: ["Model output can fluctuate during early rollout."],
      },
    ]);
  });

  it("throws permanent error when response shape is invalid", async () => {
    const provider = new LlmAiSuggestionProvider({
      promptVersion: "openai_compat.v1",
      client: {
        complete: vi.fn().mockResolvedValue({
          suggestions: [{ suggestionId: "broken" }],
        }),
      },
    });

    await expect(provider.generateSuggestions({ payload: createPayload() })).rejects.toBeInstanceOf(
      AiSuggestionProviderPermanentError,
    );
  });

  it("preserves temporary errors from client", async () => {
    const provider = new LlmAiSuggestionProvider({
      promptVersion: "openai_compat.v1",
      client: {
        complete: vi
          .fn()
          .mockRejectedValue(new AiSuggestionProviderTemporaryError("rate limited")),
      },
    });

    await expect(provider.generateSuggestions({ payload: createPayload() })).rejects.toBeInstanceOf(
      AiSuggestionProviderTemporaryError,
    );
  });

  it("wraps unknown client failure into permanent error", async () => {
    const provider = new LlmAiSuggestionProvider({
      promptVersion: "openai_compat.v1",
      client: {
        complete: vi.fn().mockRejectedValue(new Error("unexpected client crash")),
      },
    });

    await expect(provider.generateSuggestions({ payload: createPayload() })).rejects.toBeInstanceOf(
      AiSuggestionProviderPermanentError,
    );
  });
});
