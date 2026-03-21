import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
} from "@/server/application/ports/ai-suggestion-provider";
import type {
  LlmAiSuggestionClient,
  LlmAiSuggestionClientInput,
} from "@/server/infrastructure/ai/llm-ai-suggestion-provider";
import { resolvePromptTemplate } from "@/server/application/ai/prompt-templates/resolve-prompt-template";

interface AnthropicContentBlock {
  type: string;
  text?: string;
  input?: unknown;
}

interface AnthropicMessagesResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

export interface AnthropicAiSuggestionClientInput {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_API_VERSION = "2023-06-01";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = baseUrl?.trim();

  if (!raw) {
    return DEFAULT_ANTHROPIC_BASE_URL;
  }

  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 529 || status >= 500;
}

function extractResponseContent(response: unknown): string {
  const typed = response as AnthropicMessagesResponse;
  const blocks = typed.content;

  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new AiSuggestionProviderPermanentError(
      "Anthropic provider response did not include content blocks.",
    );
  }

  // Prefer tool_use input (structured output) over text
  const toolUseBlock = blocks.find((b) => b.type === "tool_use" && b.input);

  if (toolUseBlock?.input) {
    return JSON.stringify(toolUseBlock.input);
  }

  // Fall back to text content
  const textBlocks = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!.trim())
    .filter((t) => t.length > 0);

  if (textBlocks.length === 0) {
    throw new AiSuggestionProviderPermanentError(
      "Anthropic provider response did not include text content.",
    );
  }

  return textBlocks.join("");
}

export class AnthropicAiSuggestionClient implements LlmAiSuggestionClient {
  private readonly endpointUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: AnthropicAiSuggestionClientInput) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.endpointUrl = `${normalizeBaseUrl(config.baseUrl)}/v1/messages`;
  }

  async complete(input: LlmAiSuggestionClientInput): Promise<unknown> {
    const template = resolvePromptTemplate(input.promptVersion);

    const requestBody = {
      model: this.config.model,
      max_tokens: 4096,
      system: template.buildSystemInstruction(),
      messages: [
        {
          role: "user",
          content: template.buildUserMessage(input.payload),
        },
      ],
      tools: [
        {
          name: "submit_review_suggestions",
          description: "Submit code review suggestions in structured format",
          input_schema: {
            type: "object",
            properties: {
              suggestions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    suggestionId: { type: "string" },
                    category: {
                      type: "string",
                      enum: ["semantic", "architecture", "business", "general"],
                    },
                    confidence: {
                      type: "string",
                      enum: ["high", "medium", "low"],
                    },
                    headline: { type: "string" },
                    recommendation: { type: "string" },
                    rationale: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: [
                    "suggestionId",
                    "category",
                    "confidence",
                    "headline",
                    "recommendation",
                    "rationale",
                  ],
                },
              },
            },
            required: ["suggestions"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_review_suggestions" },
    };

    let response: Response;

    try {
      response = await this.fetchFn(this.endpointUrl, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: input.abortSignal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiSuggestionProviderTemporaryError(
          "Anthropic provider request was aborted.",
          error,
        );
      }

      throw new AiSuggestionProviderTemporaryError(
        "Anthropic provider request failed before receiving a response.",
        error,
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const message = `Anthropic provider failed (${response.status})${bodyText ? `: ${bodyText}` : "."}`;

      if (isTemporaryStatus(response.status)) {
        throw new AiSuggestionProviderTemporaryError(message);
      }

      throw new AiSuggestionProviderPermanentError(message);
    }

    let parsed: unknown;

    try {
      parsed = await response.json();
    } catch (error) {
      throw new AiSuggestionProviderPermanentError(
        "Anthropic provider returned non-JSON response.",
        error,
      );
    }

    const content = extractResponseContent(parsed);

    try {
      return JSON.parse(content);
    } catch (error) {
      throw new AiSuggestionProviderPermanentError(
        "Anthropic provider returned malformed JSON content.",
        error,
      );
    }
  }
}
