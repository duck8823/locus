import type {
  AiSuggestion,
  AiSuggestionPayload,
} from "@/server/application/ai/ai-suggestion-types";

const MAX_SUGGESTIONS = 5;

function collectSymbolList(payload: AiSuggestionPayload): string {
  return payload.semanticContext.changes
    .slice(0, 3)
    .map((change) => change.symbolDisplayName)
    .join(", ");
}

export function generateAiSuggestionsFromPayload(payload: AiSuggestionPayload): AiSuggestion[] {
  const suggestions: AiSuggestion[] = [];
  const removedChange = payload.semanticContext.changes.find((change) => change.changeType === "removed");
  const modifiedChange = payload.semanticContext.changes.find((change) => change.changeType === "modified");
  const addedChange = payload.semanticContext.changes.find((change) => change.changeType === "added");
  const highSignalContext = payload.businessContext.items.find(
    (item) => item.status === "linked" || item.status === "candidate",
  );

  if (removedChange) {
    suggestions.push({
      suggestionId: "verify-removed-symbol-references",
      category: "semantic",
      confidence: "high",
      headline: "Verify deleted-symbol callers",
      recommendation:
        "A removed symbol was detected. Confirm all direct/indirect callers are deleted, migrated, or guarded by feature flags.",
      rationale: [
        `Removed: ${removedChange.symbolDisplayName}`,
        `Location: ${removedChange.location}`,
        `Architecture downstream count: ${payload.architectureContext.totalDownstreamCount}`,
      ],
    });
  }

  if (modifiedChange && payload.architectureContext.totalDownstreamCount > 0) {
    suggestions.push({
      suggestionId: "check-downstream-callers",
      category: "architecture",
      confidence: "medium",
      headline: "Review downstream behavior changes",
      recommendation:
        "The modified symbol has downstream dependencies. Validate regression risk for callers and contract assumptions.",
      rationale: [
        `Modified: ${modifiedChange.symbolDisplayName}`,
        `Downstream neighbors: ${payload.architectureContext.totalDownstreamCount}`,
        `Representative symbols: ${collectSymbolList(payload) || "n/a"}`,
      ],
    });
  }

  if (addedChange) {
    suggestions.push({
      suggestionId: "review-input-validation",
      category: "semantic",
      confidence: "medium",
      headline: "Check validation and edge handling on new paths",
      recommendation:
        "A new callable was added. Confirm boundary conditions, invalid inputs, and authentication/authorization assumptions.",
      rationale: [
        `Added: ${addedChange.symbolDisplayName}`,
        `Signature: ${addedChange.signatureSummary ?? "(no signature summary)"}`,
        `Location: ${addedChange.location}`,
      ],
    });
  }

  if (highSignalContext) {
    suggestions.push({
      suggestionId: "trace-requirement-context",
      category: "business",
      confidence: highSignalContext.status === "linked" ? "high" : "medium",
      headline: "Trace implementation back to requirement context",
      recommendation:
        "Cross-check this change against linked requirement context and confirm acceptance criteria coverage in tests.",
      rationale: [
        `Context: ${highSignalContext.title}`,
        `Source: ${highSignalContext.sourceType}`,
        `Confidence: ${highSignalContext.confidence}`,
      ],
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      suggestionId: "baseline-manual-review",
      category: "general",
      confidence: "low",
      headline: "No high-signal heuristics detected",
      recommendation:
        "Run baseline checks: API compatibility, test coverage delta, error handling, and security-sensitive data flow.",
      rationale: [
        payload.semanticContext.fallbackMessage ?? "Semantic context was limited.",
        payload.architectureContext.fallbackMessage ?? "Architecture context was limited.",
        payload.businessContext.fallbackMessage ?? "Business context was limited.",
      ],
    });
  }

  return suggestions.slice(0, MAX_SUGGESTIONS);
}
