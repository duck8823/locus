import type { AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";
import type { PromptTemplate } from "./prompt-template";

export class V1BasicPromptTemplate implements PromptTemplate {
  readonly templateId = "v1-basic";
  readonly version: string;

  constructor(promptVersion: string) {
    this.version = promptVersion;
  }

  buildSystemInstruction(): string {
    return [
      `You are Locus AI reviewer assistant (${this.version}).`,
      "Return JSON only.",
      "Output shape:",
      "{",
      '  "suggestions": [',
      "    {",
      '      "suggestionId": string,',
      '      "category": "semantic" | "architecture" | "business" | "general",',
      '      "confidence": "high" | "medium" | "low",',
      '      "headline": string,',
      '      "recommendation": string,',
      '      "rationale": string[]',
      "    }",
      "  ]",
      "}",
      "Do not include markdown fences.",
    ].join("\n");
  }

  buildUserMessage(payload: AiSuggestionPayload): string {
    return JSON.stringify({
      promptVersion: this.version,
      payload,
    });
  }
}
