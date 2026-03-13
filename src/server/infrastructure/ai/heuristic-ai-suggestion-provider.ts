import { generateAiSuggestionsFromPayload } from "@/server/application/ai/generate-ai-suggestions";
import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
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

export class HeuristicAiSuggestionProvider implements AiSuggestionProvider {
  constructor(
    private readonly suggestionGenerator: SuggestionGenerator = generateAiSuggestionsFromPayload,
  ) {}

  async generateSuggestions(input: { payload: AiSuggestionPayload }): Promise<AiSuggestion[]> {
    try {
      return await this.suggestionGenerator(input.payload);
    } catch (error) {
      throw toClassifiedProviderError(error);
    }
  }
}
