import type { SemanticChangeType, SemanticSymbolKind } from "@/server/domain/value-objects/semantic-change";

export type AiSuggestionCategory = "semantic" | "architecture" | "business" | "general";

export type AiSuggestionConfidence = "high" | "medium" | "low";

export interface AiSuggestionPayloadSemanticChange {
  semanticChangeId: string;
  symbolDisplayName: string;
  symbolKind: SemanticSymbolKind;
  changeType: SemanticChangeType;
  signatureSummary: string | null;
  bodySummary: string | null;
  location: string;
}

export interface AiSuggestionPayloadArchitectureNode {
  nodeId: string;
  kind: "layer" | "file" | "symbol" | "unknown";
  label: string;
}

export interface AiSuggestionPayloadBusinessContextItem {
  contextId: string;
  sourceType: "github_issue" | "confluence_page";
  status: "linked" | "candidate" | "unavailable";
  confidence: AiSuggestionConfidence;
  title: string;
  summary: string | null;
  href: string | null;
}

export interface AiSuggestionPayload {
  generatedAt: string;
  review: {
    reviewId: string;
    title: string;
    repositoryName: string;
    branchLabel: string;
  };
  semanticContext: {
    totalCount: number;
    includedCount: number;
    isTruncated: boolean;
    fallbackMessage: string | null;
    changes: AiSuggestionPayloadSemanticChange[];
  };
  architectureContext: {
    groupId: string | null;
    groupTitle: string | null;
    filePath: string | null;
    totalUpstreamCount: number;
    totalDownstreamCount: number;
    includedUpstreamCount: number;
    includedDownstreamCount: number;
    isTruncated: boolean;
    fallbackMessage: string | null;
    upstreamNodes: AiSuggestionPayloadArchitectureNode[];
    downstreamNodes: AiSuggestionPayloadArchitectureNode[];
  };
  businessContext: {
    totalCount: number;
    includedCount: number;
    isTruncated: boolean;
    fallbackMessage: string | null;
    items: AiSuggestionPayloadBusinessContextItem[];
  };
}

export interface BuildAiSuggestionPayloadInput {
  review: {
    reviewId: string;
    title: string;
    repositoryName: string;
    branchLabel: string;
  };
  selectedGroup: {
    groupId: string;
    title: string;
    filePath: string;
    semanticChanges: Array<{
      semanticChangeId: string;
      symbolDisplayName: string;
      symbolKind: SemanticSymbolKind;
      changeType: SemanticChangeType;
      signatureSummary: string | null;
      bodySummary: string | null;
      before: { filePath: string; startLine: number; endLine: number } | null;
      after: { filePath: string; startLine: number; endLine: number } | null;
    }>;
    architectureGraph: {
      nodes: Array<{
        nodeId: string;
        kind: "layer" | "file" | "symbol" | "unknown";
        label: string;
        role: "center" | "upstream" | "downstream";
      }>;
      edges: Array<{
        fromNodeId: string;
        toNodeId: string;
      }>;
    };
  } | null;
  businessContextItems: Array<{
    contextId: string;
    sourceType: "github_issue" | "confluence_page";
    status: "linked" | "candidate" | "unavailable";
    confidence: AiSuggestionConfidence;
    title: string;
    summary: string | null;
    href: string | null;
  }>;
}

export interface AiSuggestion {
  suggestionId: string;
  category: AiSuggestionCategory;
  confidence: AiSuggestionConfidence;
  headline: string;
  recommendation: string;
  rationale: string[];
}
