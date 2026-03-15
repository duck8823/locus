import { generateAiSuggestionsFromPayload } from "@/server/application/ai/generate-ai-suggestions";
import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
  type AiSuggestionExecutionMetadata,
  type AiSuggestionProvider,
} from "@/server/application/ports/ai-suggestion-provider";

type SuggestionGenerator = (
  payload: AiSuggestionPayload,
) => AiSuggestion[] | Promise<AiSuggestion[]>;

function toClassifiedProviderError(error: unknown): Error {
  if (
    error instanceof AiSuggestionProviderTemporaryError ||
    error instanceof AiSuggestionProviderPermanentError
  ) {
    // Keep provider-classified errors unchanged to avoid losing original semantics.
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new AiSuggestionProviderTemporaryError(
      "Heuristic AI suggestion generation was aborted.",
      error,
    );
  }

  return new AiSuggestionProviderPermanentError(
    "Heuristic AI suggestion generation failed.",
    error,
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw new AiSuggestionProviderTemporaryError(
    "Heuristic AI suggestion generation was aborted.",
    signal.reason,
  );
}

export class HeuristicAiSuggestionProvider implements AiSuggestionProvider {
  constructor(
    private readonly suggestionGenerator: SuggestionGenerator = generateAiSuggestionsFromPayload,
  ) {}

  async generateSuggestions(input: {
    payload: AiSuggestionPayload;
    abortSignal?: AbortSignal;
    captureMetadata?: (metadata: AiSuggestionExecutionMetadata) => void;
  }): Promise<AiSuggestion[]> {
    try {
      throwIfAborted(input.abortSignal);
      const suggestions = await this.suggestionGenerator(input.payload);
      input.captureMetadata?.({
        provider: "heuristic",
        fallbackApplied: false,
        reasonCode: null,
      });
      return suggestions;
    } catch (error) {
      throw toClassifiedProviderError(error);
    }
  }
}
