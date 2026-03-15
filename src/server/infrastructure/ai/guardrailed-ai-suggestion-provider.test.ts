import { describe, expect, it, vi } from "vitest";
import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
  type AiSuggestionProvider,
} from "@/server/application/ports/ai-suggestion-provider";
import {
  GuardrailedAiSuggestionProvider,
  type AiSuggestionGuardrailReasonCode,
} from "@/server/infrastructure/ai/guardrailed-ai-suggestion-provider";

function createPayload(overrides: Partial<AiSuggestionPayload> = {}): AiSuggestionPayload {
  return {
    generatedAt: "2026-03-15T00:00:00.000Z",
    review: {
      reviewId: "review-guardrail",
      title: "Guardrail review",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/guardrails",
    },
    semanticContext: {
      totalCount: 1,
      includedCount: 1,
      isTruncated: false,
      fallbackMessage: null,
      changes: [
        {
          semanticChangeId: "semantic-1",
          symbolDisplayName: "parseInput",
          symbolKind: "function",
          changeType: "modified",
          signatureSummary: "parseInput(raw: string): ParsedInput",
          bodySummary: "validates payload + coercion",
          location: "src/server/presentation/input.ts",
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
          title: "Guardrail requirement",
          summary: "Fallback should remain deterministic when guardrails trigger.",
          href: "https://github.com/duck8823/locus/issues/137",
        },
      ],
    },
    ...overrides,
  };
}

function createSuggestions(id: string) {
  return [
    {
      suggestionId: id,
      category: "general" as const,
      confidence: "high" as const,
      headline: `${id} headline`,
      recommendation: `${id} recommendation`,
      rationale: [`${id} rationale`],
    },
  ];
}

function createLoggerSpies() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function expectGuardrailReason(
  logger: ReturnType<typeof createLoggerSpies>,
  reasonCode: AiSuggestionGuardrailReasonCode,
) {
  expect(logger.warn).toHaveBeenCalledWith(
    "ai_suggestion_guardrail_triggered",
    expect.objectContaining({
      reviewId: "review-guardrail",
      provider: "llm_primary",
      fallbackProvider: "heuristic_fallback",
      reasonCode,
      estimatedInputTokens: expect.any(Number),
      timeoutMs: expect.any(Number),
    }),
  );
}

describe("GuardrailedAiSuggestionProvider", () => {
  it("returns primary suggestions when guardrails are not violated", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("primary")),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1000,
        maxEstimatedInputTokens: 20_000,
      },
      logger: createLoggerSpies(),
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual(createSuggestions("primary"));
    expect(primaryProvider.generateSuggestions).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.generateSuggestions).not.toHaveBeenCalled();
  });

  it("uses fallback provider when estimated token budget is exceeded", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("primary")),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };
    const logger = createLoggerSpies();

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1000,
        maxEstimatedInputTokens: 1,
      },
      logger,
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual(createSuggestions("fallback"));
    expect(primaryProvider.generateSuggestions).not.toHaveBeenCalled();
    expect(fallbackProvider.generateSuggestions).toHaveBeenCalledTimes(1);
    expectGuardrailReason(logger, "estimated_input_tokens_exceeded");
  });

  it("uses fallback provider when estimated input cost budget is exceeded", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("primary")),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };
    const logger = createLoggerSpies();

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1000,
        maxEstimatedInputCostUsd: 0.000001,
        estimatedInputCostPer1kInputTokensUsd: 0.01,
      },
      logger,
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual(createSuggestions("fallback"));
    expect(primaryProvider.generateSuggestions).not.toHaveBeenCalled();
    expect(fallbackProvider.generateSuggestions).toHaveBeenCalledTimes(1);
    expectGuardrailReason(logger, "estimated_input_cost_exceeded");
  });

  it("uses fallback provider when primary provider hits timeout guardrail", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(createSuggestions("primary")), 30);
          }),
      ),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };
    const logger = createLoggerSpies();

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1,
      },
      logger,
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual(createSuggestions("fallback"));
    expect(primaryProvider.generateSuggestions).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.generateSuggestions).toHaveBeenCalledTimes(1);
    expectGuardrailReason(logger, "timeout");
  });

  it("aborts primary provider request when timeout guardrail fires", async () => {
    let aborted = false;
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockImplementation(
        ({ abortSignal }: { payload: AiSuggestionPayload; abortSignal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            abortSignal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      ),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1,
      },
      logger: createLoggerSpies(),
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual(createSuggestions("fallback"));
    expect(aborted).toBe(true);
  });

  it("uses fallback provider when primary provider throws temporary error", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi
        .fn()
        .mockRejectedValue(
          new AiSuggestionProviderTemporaryError("primary provider unavailable"),
        ),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };
    const logger = createLoggerSpies();

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1000,
      },
      logger,
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).resolves.toEqual(createSuggestions("fallback"));
    expect(fallbackProvider.generateSuggestions).toHaveBeenCalledTimes(1);
    expectGuardrailReason(logger, "provider_temporary_error");
  });

  it("does not invoke fallback when caller abort signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort("caller canceled");

    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("primary")),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };
    const logger = createLoggerSpies();

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1000,
      },
      logger,
    });

    await expect(
      provider.generateSuggestions({
        payload: createPayload(),
        abortSignal: abortController.signal,
      }),
    ).rejects.toBeInstanceOf(AiSuggestionProviderTemporaryError);

    expect(primaryProvider.generateSuggestions).not.toHaveBeenCalled();
    expect(fallbackProvider.generateSuggestions).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("propagates permanent provider errors", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi
        .fn()
        .mockRejectedValue(
          new AiSuggestionProviderPermanentError("invalid output schema"),
        ),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockResolvedValue(createSuggestions("fallback")),
    };

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1000,
      },
      logger: createLoggerSpies(),
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).rejects.toBeInstanceOf(AiSuggestionProviderPermanentError);
    expect(fallbackProvider.generateSuggestions).not.toHaveBeenCalled();
  });

  it("logs fallback failure details when guardrail fallback also fails", async () => {
    const primaryProvider: AiSuggestionProvider = {
      generateSuggestions: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(createSuggestions("primary")), 30);
          }),
      ),
    };
    const fallbackProvider: AiSuggestionProvider = {
      generateSuggestions: vi
        .fn()
        .mockRejectedValue(new AiSuggestionProviderPermanentError("fallback broken")),
    };
    const logger = createLoggerSpies();

    const provider = new GuardrailedAiSuggestionProvider({
      providerName: "llm_primary",
      provider: primaryProvider,
      fallbackProviderName: "heuristic_fallback",
      fallbackProvider,
      guardrailPolicy: {
        timeoutMs: 1,
      },
      logger,
    });

    await expect(
      provider.generateSuggestions({ payload: createPayload() }),
    ).rejects.toBeInstanceOf(AiSuggestionProviderPermanentError);

    expect(logger.error).toHaveBeenCalledWith(
      "ai_suggestion_guardrail_fallback_failed",
      expect.objectContaining({
        reasonCode: "timeout",
        message: "fallback broken",
      }),
    );
  });
});
