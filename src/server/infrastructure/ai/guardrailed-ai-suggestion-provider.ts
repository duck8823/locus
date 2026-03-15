import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  type AiSuggestionExecutionMetadata,
  AiSuggestionProviderTemporaryError,
  classifyAiSuggestionProviderError,
  type AiSuggestionProvider,
} from "@/server/application/ports/ai-suggestion-provider";

export type AiSuggestionGuardrailReasonCode =
  | "timeout"
  | "estimated_input_tokens_exceeded"
  | "estimated_input_cost_exceeded"
  | "provider_temporary_error";

export interface AiSuggestionProviderGuardrailPolicy {
  timeoutMs: number;
  maxEstimatedInputTokens?: number;
  maxEstimatedInputCostUsd?: number;
  estimatedInputCostPer1kInputTokensUsd?: number;
}

interface GuardrailEventPayload {
  reviewId: string;
  provider: string;
  fallbackProvider: string;
  reasonCode: AiSuggestionGuardrailReasonCode;
  timeoutMs: number;
  estimatedInputTokens: number;
  estimatedInputCostUsd: number | null;
  maxEstimatedInputTokens: number | null;
  maxEstimatedInputCostUsd: number | null;
}

interface GuardrailedAiSuggestionProviderLogger {
  warn(event: string, payload: GuardrailEventPayload): void;
  error(event: string, payload: GuardrailEventPayload & { message: string }): void;
}

interface GuardrailedAiSuggestionProviderInput {
  providerName: string;
  provider: AiSuggestionProvider;
  fallbackProviderName: string;
  fallbackProvider: AiSuggestionProvider;
  guardrailPolicy: AiSuggestionProviderGuardrailPolicy;
  logger?: GuardrailedAiSuggestionProviderLogger;
}

const DEFAULT_TIMEOUT_MS = 3000;
const ESTIMATED_JSON_CHARS_PER_TOKEN = 4;

const defaultLogger: GuardrailedAiSuggestionProviderLogger = {
  warn(event, payload) {
    console.warn(event, payload);
  },
  error(event, payload) {
    console.error(event, payload);
  },
};

export class AiSuggestionGuardrailTriggeredError extends AiSuggestionProviderTemporaryError {
  constructor(
    readonly reasonCode: AiSuggestionGuardrailReasonCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "AiSuggestionGuardrailTriggeredError";
  }
}

function toFinitePositiveNumberOrUndefined(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function normalizeGuardrailPolicy(
  policy: AiSuggestionProviderGuardrailPolicy,
): Required<Pick<AiSuggestionProviderGuardrailPolicy, "timeoutMs">> &
  Pick<
    AiSuggestionProviderGuardrailPolicy,
    "maxEstimatedInputTokens" | "maxEstimatedInputCostUsd" | "estimatedInputCostPer1kInputTokensUsd"
  > {
  return {
    timeoutMs:
      toFinitePositiveNumberOrUndefined(policy.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    maxEstimatedInputTokens: toFinitePositiveNumberOrUndefined(
      policy.maxEstimatedInputTokens,
    ),
    maxEstimatedInputCostUsd: toFinitePositiveNumberOrUndefined(
      policy.maxEstimatedInputCostUsd,
    ),
    estimatedInputCostPer1kInputTokensUsd: toFinitePositiveNumberOrUndefined(
      policy.estimatedInputCostPer1kInputTokensUsd,
    ),
  };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateAiSuggestionInputTokens(payload: AiSuggestionPayload): number {
  const json = JSON.stringify(payload);

  if (json.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(json.length / ESTIMATED_JSON_CHARS_PER_TOKEN));
}

function estimateAiSuggestionInputCostUsd(input: {
  estimatedInputTokens: number;
  policy: ReturnType<typeof normalizeGuardrailPolicy>;
}): number | null {
  if (
    input.policy.estimatedInputCostPer1kInputTokensUsd === undefined
  ) {
    return null;
  }

  return roundUsd(
    (input.estimatedInputTokens / 1000) *
      input.policy.estimatedInputCostPer1kInputTokensUsd,
  );
}

function withTimeout<T>(input: {
  timeoutMs: number;
  operation: (abortSignal: AbortSignal) => Promise<T>;
  onTimeout: () => Error;
  upstreamAbortSignal?: AbortSignal;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutController = new AbortController();
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const rejectIfPending = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      input.upstreamAbortSignal?.removeEventListener("abort", onUpstreamAbort);
      reject(error);
    };
    const resolveIfPending = (value: T) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      input.upstreamAbortSignal?.removeEventListener("abort", onUpstreamAbort);
      resolve(value);
    };
    const onUpstreamAbort = () => {
      timeoutController.abort(input.upstreamAbortSignal?.reason);
      const reason = input.upstreamAbortSignal?.reason;
      if (reason instanceof Error) {
        rejectIfPending(reason);
        return;
      }

      const abortError = new Error("AI suggestion generation was aborted by caller.");
      abortError.name = "AbortError";
      rejectIfPending(abortError);
    };
    if (input.upstreamAbortSignal?.aborted) {
      onUpstreamAbort();
      return;
    } else {
      input.upstreamAbortSignal?.addEventListener("abort", onUpstreamAbort, {
        once: true,
      });
    }
    timeoutId = setTimeout(() => {
      timeoutController.abort();
      rejectIfPending(input.onTimeout());
    }, input.timeoutMs);

    input
      .operation(timeoutController.signal)
      .then((value) => resolveIfPending(value))
      .catch((error) => rejectIfPending(error));
  });
}

function buildGuardrailEventPayload(input: {
  payload: AiSuggestionPayload;
  providerName: string;
  fallbackProviderName: string;
  reasonCode: AiSuggestionGuardrailReasonCode;
  guardrailPolicy: ReturnType<typeof normalizeGuardrailPolicy>;
  estimatedInputTokens: number;
  estimatedInputCostUsd: number | null;
}): GuardrailEventPayload {
  return {
    reviewId: input.payload.review.reviewId,
    provider: input.providerName,
    fallbackProvider: input.fallbackProviderName,
    reasonCode: input.reasonCode,
    timeoutMs: input.guardrailPolicy.timeoutMs,
    estimatedInputTokens: input.estimatedInputTokens,
    estimatedInputCostUsd: input.estimatedInputCostUsd,
    maxEstimatedInputTokens: input.guardrailPolicy.maxEstimatedInputTokens ?? null,
    maxEstimatedInputCostUsd: input.guardrailPolicy.maxEstimatedInputCostUsd ?? null,
  };
}

function buildCallerAbortedError(cause: unknown): AiSuggestionProviderTemporaryError {
  return new AiSuggestionProviderTemporaryError(
    "AI suggestion generation was aborted by caller.",
    cause,
  );
}

function toAuditProviderName(value: string): "heuristic" | "openai_compat" {
  return value === "openai_compat" ? "openai_compat" : "heuristic";
}

export class GuardrailedAiSuggestionProvider implements AiSuggestionProvider {
  private readonly guardrailPolicy: ReturnType<typeof normalizeGuardrailPolicy>;
  private readonly logger: GuardrailedAiSuggestionProviderLogger;

  constructor(private readonly input: GuardrailedAiSuggestionProviderInput) {
    this.guardrailPolicy = normalizeGuardrailPolicy(input.guardrailPolicy);
    this.logger = input.logger ?? defaultLogger;
  }

  async generateSuggestions(input: {
    payload: AiSuggestionPayload;
    abortSignal?: AbortSignal;
    captureMetadata?: (metadata: AiSuggestionExecutionMetadata) => void;
  }): Promise<AiSuggestion[]> {
    if (input.abortSignal?.aborted) {
      throw buildCallerAbortedError(input.abortSignal.reason);
    }

    const estimatedInputTokens = estimateAiSuggestionInputTokens(input.payload);
    const estimatedInputCostUsd = estimateAiSuggestionInputCostUsd({
      estimatedInputTokens,
      policy: this.guardrailPolicy,
    });

    if (
      this.guardrailPolicy.maxEstimatedInputTokens !== undefined &&
      estimatedInputTokens > this.guardrailPolicy.maxEstimatedInputTokens
    ) {
      return this.generateFallbackSuggestions({
        payload: input.payload,
        reasonCode: "estimated_input_tokens_exceeded",
        estimatedInputTokens,
        estimatedInputCostUsd,
        captureMetadata: input.captureMetadata,
      });
    }

    if (
      this.guardrailPolicy.maxEstimatedInputCostUsd !== undefined &&
      estimatedInputCostUsd !== null &&
      estimatedInputCostUsd > this.guardrailPolicy.maxEstimatedInputCostUsd
    ) {
      return this.generateFallbackSuggestions({
        payload: input.payload,
        reasonCode: "estimated_input_cost_exceeded",
        estimatedInputTokens,
        estimatedInputCostUsd,
        captureMetadata: input.captureMetadata,
      });
    }

    try {
      const suggestions = await withTimeout({
        timeoutMs: this.guardrailPolicy.timeoutMs,
        operation: (abortSignal) =>
          this.input.provider.generateSuggestions({
            payload: input.payload,
            abortSignal,
          }),
        upstreamAbortSignal: input.abortSignal,
        onTimeout: () =>
          new AiSuggestionGuardrailTriggeredError(
            "timeout",
            `AI suggestion provider timed out after ${this.guardrailPolicy.timeoutMs}ms.`,
          ),
      });
      input.captureMetadata?.({
        provider: toAuditProviderName(this.input.providerName),
        fallbackApplied: false,
        reasonCode: null,
      });
      return suggestions;
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw buildCallerAbortedError(error);
      }

      if (error instanceof AiSuggestionGuardrailTriggeredError) {
        return this.generateFallbackSuggestions({
          payload: input.payload,
          reasonCode: error.reasonCode,
          estimatedInputTokens,
          estimatedInputCostUsd,
          abortSignal: input.abortSignal,
          captureMetadata: input.captureMetadata,
        });
      }

      if (classifyAiSuggestionProviderError(error) === "temporary") {
        return this.generateFallbackSuggestions({
          payload: input.payload,
          reasonCode: "provider_temporary_error",
          estimatedInputTokens,
          estimatedInputCostUsd,
          abortSignal: input.abortSignal,
          captureMetadata: input.captureMetadata,
        });
      }

      throw error;
    }
  }

  private async generateFallbackSuggestions(input: {
    payload: AiSuggestionPayload;
    reasonCode: AiSuggestionGuardrailReasonCode;
    estimatedInputTokens: number;
    estimatedInputCostUsd: number | null;
    abortSignal?: AbortSignal;
    captureMetadata?: (metadata: AiSuggestionExecutionMetadata) => void;
  }): Promise<AiSuggestion[]> {
    if (input.abortSignal?.aborted) {
      throw buildCallerAbortedError(input.abortSignal.reason);
    }

    const eventPayload = buildGuardrailEventPayload({
      payload: input.payload,
      providerName: this.input.providerName,
      fallbackProviderName: this.input.fallbackProviderName,
      reasonCode: input.reasonCode,
      guardrailPolicy: this.guardrailPolicy,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedInputCostUsd: input.estimatedInputCostUsd,
    });

    this.logger.warn("ai_suggestion_guardrail_triggered", eventPayload);
    input.captureMetadata?.({
      provider: toAuditProviderName(this.input.fallbackProviderName),
      fallbackApplied: true,
      reasonCode: input.reasonCode,
    });

    try {
      const suggestions = await this.input.fallbackProvider.generateSuggestions({
        payload: input.payload,
        abortSignal: input.abortSignal,
      });
      if (input.abortSignal?.aborted) {
        throw buildCallerAbortedError(input.abortSignal.reason);
      }
      return suggestions;
    } catch (error) {
      if (input.abortSignal?.aborted) {
        throw buildCallerAbortedError(error);
      }
      this.logger.error("ai_suggestion_guardrail_fallback_failed", {
        ...eventPayload,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
