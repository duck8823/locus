import { describe, expect, it } from "vitest";
import {
  AiSuggestionProviderPermanentError,
  AiSuggestionProviderTemporaryError,
  classifyAiSuggestionProviderError,
} from "@/server/application/ports/ai-suggestion-provider";

describe("classifyAiSuggestionProviderError", () => {
  it("classifies temporary provider failures", () => {
    const error = new AiSuggestionProviderTemporaryError("rate limited");
    expect(classifyAiSuggestionProviderError(error)).toBe("temporary");
  });

  it("classifies permanent provider failures", () => {
    const error = new AiSuggestionProviderPermanentError("invalid provider response");
    expect(classifyAiSuggestionProviderError(error)).toBe("permanent");
  });

  it("returns unknown for non-provider errors", () => {
    expect(classifyAiSuggestionProviderError(new Error("unexpected"))).toBe("unknown");
    expect(classifyAiSuggestionProviderError("error")).toBe("unknown");
  });
});
