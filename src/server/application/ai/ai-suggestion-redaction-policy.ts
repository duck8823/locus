import type { AiSuggestion, AiSuggestionPayload } from "@/server/application/ai/ai-suggestion-types";

export const AI_SUGGESTION_REDACTION_POLICY_VERSION = "ai_suggestion_redaction.v1";

function redactText(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return value;
  }

  return `[redacted:${trimmed.length}]`;
}

function redactOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return redactText(value);
}

export function redactAiSuggestionPayload(payload: AiSuggestionPayload): AiSuggestionPayload {
  return {
    generatedAt: payload.generatedAt,
    review: {
      reviewId: payload.review.reviewId,
      title: redactText(payload.review.title),
      repositoryName: payload.review.repositoryName,
      branchLabel: redactText(payload.review.branchLabel),
    },
    semanticContext: {
      totalCount: payload.semanticContext.totalCount,
      includedCount: payload.semanticContext.includedCount,
      isTruncated: payload.semanticContext.isTruncated,
      fallbackMessage: redactOptionalText(payload.semanticContext.fallbackMessage),
      changes: payload.semanticContext.changes.map((change) => ({
        semanticChangeId: change.semanticChangeId,
        symbolDisplayName: redactText(change.symbolDisplayName),
        symbolKind: change.symbolKind,
        changeType: change.changeType,
        signatureSummary: redactOptionalText(change.signatureSummary),
        bodySummary: redactOptionalText(change.bodySummary),
        location: redactText(change.location),
      })),
    },
    architectureContext: {
      groupId: payload.architectureContext.groupId,
      groupTitle: redactOptionalText(payload.architectureContext.groupTitle),
      filePath: redactOptionalText(payload.architectureContext.filePath),
      totalUpstreamCount: payload.architectureContext.totalUpstreamCount,
      totalDownstreamCount: payload.architectureContext.totalDownstreamCount,
      includedUpstreamCount: payload.architectureContext.includedUpstreamCount,
      includedDownstreamCount: payload.architectureContext.includedDownstreamCount,
      isTruncated: payload.architectureContext.isTruncated,
      fallbackMessage: redactOptionalText(payload.architectureContext.fallbackMessage),
      upstreamNodes: payload.architectureContext.upstreamNodes.map((node) => ({
        nodeId: node.nodeId,
        kind: node.kind,
        label: redactText(node.label),
      })),
      downstreamNodes: payload.architectureContext.downstreamNodes.map((node) => ({
        nodeId: node.nodeId,
        kind: node.kind,
        label: redactText(node.label),
      })),
    },
    businessContext: {
      totalCount: payload.businessContext.totalCount,
      includedCount: payload.businessContext.includedCount,
      isTruncated: payload.businessContext.isTruncated,
      fallbackMessage: redactOptionalText(payload.businessContext.fallbackMessage),
      items: payload.businessContext.items.map((item) => ({
        contextId: item.contextId,
        sourceType: item.sourceType,
        status: item.status,
        confidence: item.confidence,
        title: redactText(item.title),
        summary: redactOptionalText(item.summary),
        href: redactOptionalText(item.href),
      })),
    },
  };
}

export function redactAiSuggestions(suggestions: AiSuggestion[]): AiSuggestion[] {
  return suggestions.map((suggestion) => ({
    suggestionId: suggestion.suggestionId,
    category: suggestion.category,
    confidence: suggestion.confidence,
    headline: redactText(suggestion.headline),
    recommendation: redactText(suggestion.recommendation),
    rationale: suggestion.rationale.map((line) => redactText(line)),
  }));
}
