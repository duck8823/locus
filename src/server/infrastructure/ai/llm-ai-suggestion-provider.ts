import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import {
  type AiSuggestionExecutionMetadata,
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
  type AiSuggestionProvider,
} from "@/server/application/ports/ai-suggestion-provider";

export interface LlmAiSuggestionClientInput {
  payload: AiSuggestionPayload;
  promptVersion: string;
  abortSignal?: AbortSignal;
}

export interface LlmAiSuggestionClient {
  complete(input: LlmAiSuggestionClientInput): Promise<unknown>;
}

export interface LlmAiSuggestionProviderInput {
  promptVersion: string;
  client: LlmAiSuggestionClient;
}

const VALID_CATEGORY = new Set<AiSuggestion["category"]>([
  "semantic",
  "architecture",
  "business",
  "general",
]);
const VALID_CONFIDENCE = new Set<AiSuggestion["confidence"]>(["high", "medium", "low"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRationale(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const lines = value
    .map((line) => toStringValue(line))
    .filter((line): line is string => line !== null);

  return lines.length > 0 ? lines : null;
}

function parseSuggestion(value: unknown, index: number): AiSuggestion {
  if (!isRecord(value)) {
    throw new AiSuggestionProviderPermanentError(
      `LLM provider returned invalid suggestion item at index ${index}.`,
    );
  }

  const suggestionId = toStringValue(value.suggestionId);
  const category = toStringValue(value.category);
  const confidence = toStringValue(value.confidence);
  const headline = toStringValue(value.headline);
  const recommendation = toStringValue(value.recommendation);
  const rationale = toRationale(value.rationale);

  if (!suggestionId || !headline || !recommendation || !rationale) {
    throw new AiSuggestionProviderPermanentError(
      `LLM provider returned incomplete suggestion shape at index ${index}.`,
    );
  }

  if (!category || !VALID_CATEGORY.has(category as AiSuggestion["category"])) {
    throw new AiSuggestionProviderPermanentError(
      `LLM provider returned unsupported category at index ${index}.`,
    );
  }

  if (!confidence || !VALID_CONFIDENCE.has(confidence as AiSuggestion["confidence"])) {
    throw new AiSuggestionProviderPermanentError(
      `LLM provider returned unsupported confidence at index ${index}.`,
    );
  }

  return {
    suggestionId,
    category: category as AiSuggestion["category"],
    confidence: confidence as AiSuggestion["confidence"],
    headline,
    recommendation,
    rationale,
  };
}

function parseSuggestionsPayload(value: unknown): AiSuggestion[] {
  const items = (() => {
    if (Array.isArray(value)) {
      return value;
    }

    if (isRecord(value) && Array.isArray(value.suggestions)) {
      return value.suggestions;
    }

    throw new AiSuggestionProviderPermanentError(
      "LLM provider response must be an array or an object with suggestions[].",
    );
  })();

  return items.map((item, index) => parseSuggestion(item, index));
}

function toClassifiedProviderError(error: unknown): Error {
  if (
    error instanceof AiSuggestionProviderTemporaryError ||
    error instanceof AiSuggestionProviderPermanentError
  ) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new AiSuggestionProviderTemporaryError(
      "LLM AI suggestion request was aborted.",
      error,
    );
  }

  return new AiSuggestionProviderPermanentError(
    "LLM AI suggestion provider failed to produce valid output.",
    error,
  );
}

export class LlmAiSuggestionProvider implements AiSuggestionProvider {
  constructor(private readonly input: LlmAiSuggestionProviderInput) {}

  async generateSuggestions(input: {
    payload: AiSuggestionPayload;
    abortSignal?: AbortSignal;
    captureMetadata?: (metadata: AiSuggestionExecutionMetadata) => void;
  }): Promise<AiSuggestion[]> {
    try {
      const raw = await this.input.client.complete({
        payload: input.payload,
        promptVersion: this.input.promptVersion,
        abortSignal: input.abortSignal,
      });
      return parseSuggestionsPayload(raw);
    } catch (error) {
      throw toClassifiedProviderError(error);
    }
  }
}
