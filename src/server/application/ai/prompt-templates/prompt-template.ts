import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";

export interface PromptTemplate {
  readonly templateId: string;
  readonly version: string;

  buildSystemInstruction(): string;
  buildUserMessage(payload: AiSuggestionPayload): string;
}
