import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
} from "@/server/application/ports/ai-suggestion-provider";
import type { LlmAiSuggestionClient, LlmAiSuggestionClientInput } from "@/server/infrastructure/ai/llm-ai-suggestion-provider";
import { resolvePromptTemplate } from "@/server/application/ai/prompt-templates/resolve-prompt-template";

interface OpenAiCompatibleChatChoiceMessage {
  content?: unknown;
}

interface OpenAiCompatibleChatChoice {
  message?: OpenAiCompatibleChatChoiceMessage | null;
}

interface OpenAiCompatibleChatCompletionResponse {
  choices?: OpenAiCompatibleChatChoice[];
}

export interface OpenAiCompatibleAiSuggestionClientInput {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = baseUrl?.trim();
  if (!raw) {
    return DEFAULT_OPENAI_BASE_URL;
  }

  const withoutTrailingSlash = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (withoutTrailingSlash.endsWith("/chat/completions")) {
    return withoutTrailingSlash.slice(
      0,
      withoutTrailingSlash.length - "/chat/completions".length,
    );
  }

  return withoutTrailingSlash;
}

function isTemporaryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function extractChatCompletionContent(response: unknown): string {
  const typed = response as OpenAiCompatibleChatCompletionResponse;
  const firstChoice = typed.choices?.[0];
  const content = firstChoice?.message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const combined = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string") {
            return text;
          }
        }

        return "";
      })
      .join("")
      .trim();

    if (combined.length > 0) {
      return combined;
    }
  }

  throw new AiSuggestionProviderPermanentError(
    "OpenAI-compatible provider response did not include text content.",
  );
}


export class OpenAiCompatibleAiSuggestionClient implements LlmAiSuggestionClient {
  private readonly endpointUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly input: OpenAiCompatibleAiSuggestionClientInput) {
    this.fetchFn = input.fetchFn ?? fetch;
    this.endpointUrl = `${normalizeBaseUrl(input.baseUrl)}/chat/completions`;
  }

  async complete(input: LlmAiSuggestionClientInput): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.input.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.input.organization) {
      headers["OpenAI-Organization"] = this.input.organization;
    }
    if (this.input.project) {
      headers["OpenAI-Project"] = this.input.project;
    }

    const template = resolvePromptTemplate(input.promptVersion);
    const requestBody = {
      model: this.input.model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: template.buildSystemInstruction(),
        },
        {
          role: "user",
          content: template.buildUserMessage(input.payload),
        },
      ],
    };

    let response: Response;

    try {
      response = await this.fetchFn(this.endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: input.abortSignal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiSuggestionProviderTemporaryError(
          "OpenAI-compatible provider request was aborted.",
          error,
        );
      }

      throw new AiSuggestionProviderTemporaryError(
        "OpenAI-compatible provider request failed before receiving a response.",
        error,
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const message = `OpenAI-compatible provider failed (${response.status})${bodyText ? `: ${bodyText}` : "."}`;

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
        "OpenAI-compatible provider returned non-JSON response.",
        error,
      );
    }

    const content = extractChatCompletionContent(parsed);

    try {
      return JSON.parse(content);
    } catch (error) {
      throw new AiSuggestionProviderPermanentError(
        "OpenAI-compatible provider returned malformed JSON content.",
        error,
      );
    }
  }
}
