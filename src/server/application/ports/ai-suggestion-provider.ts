import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";

export class AiSuggestionProviderTemporaryError extends Error {
  readonly code = "AI_SUGGESTION_PROVIDER_TEMPORARY";

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiSuggestionProviderTemporaryError";
  }
}

export class AiSuggestionProviderPermanentError extends Error {
  readonly code = "AI_SUGGESTION_PROVIDER_PERMANENT";

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiSuggestionProviderPermanentError";
  }
}

export type AiSuggestionProviderErrorType = "temporary" | "permanent" | "unknown";

export function classifyAiSuggestionProviderError(
  error: unknown,
): AiSuggestionProviderErrorType {
  if (error instanceof AiSuggestionProviderTemporaryError) {
    return "temporary";
  }

  if (error instanceof AiSuggestionProviderPermanentError) {
    return "permanent";
  }

  return "unknown";
}

export interface AiSuggestionProvider {
  generateSuggestions(input: {
    payload: AiSuggestionPayload;
    abortSignal?: AbortSignal;
    captureMetadata?: (metadata: AiSuggestionExecutionMetadata) => void;
  }): Promise<AiSuggestion[]>;
}

export interface AiSuggestionExecutionMetadata {
  provider: "heuristic" | "openai_compat";
  fallbackApplied: boolean;
  reasonCode:
    | "timeout"
    | "estimated_input_tokens_exceeded"
    | "estimated_input_cost_exceeded"
    | "provider_temporary_error"
    | null;
}
