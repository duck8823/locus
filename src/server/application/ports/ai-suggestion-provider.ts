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
  }): Promise<AiSuggestion[]>;
}
