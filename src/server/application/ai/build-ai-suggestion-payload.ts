import type {
  AiSuggestionPayload,
  AiSuggestionPayloadArchitectureNode,
  BuildAiSuggestionPayloadInput,
} from "@/server/application/ai/ai-suggestion-types";

const MAX_SEMANTIC_CHANGES = 12;
const MAX_ARCHITECTURE_NODES_PER_DIRECTION = 8;
const MAX_BUSINESS_CONTEXT_ITEMS = 6;
const MAX_TEXT_LENGTH = 220;

function truncateText(value: string | null | undefined, maxLength = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatLocation(params: {
  before: { filePath: string; startLine: number; endLine: number } | null;
  after: { filePath: string; startLine: number; endLine: number } | null;
}): string {
  if (params.after) {
    return `${params.after.filePath}:${params.after.startLine}-${params.after.endLine}`;
  }

  if (params.before) {
    return `${params.before.filePath}:${params.before.startLine}-${params.before.endLine}`;
  }

  return "unknown";
}

function sortBusinessContextByPriority(
  items: BuildAiSuggestionPayloadInput["businessContextItems"],
): BuildAiSuggestionPayloadInput["businessContextItems"] {
  const statusPriority: Record<BuildAiSuggestionPayloadInput["businessContextItems"][number]["status"], number> = {
    linked: 0,
    candidate: 1,
    unavailable: 2,
  };
  const confidencePriority: Record<BuildAiSuggestionPayloadInput["businessContextItems"][number]["confidence"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return [...items].sort((left, right) => {
    if (statusPriority[left.status] !== statusPriority[right.status]) {
      return statusPriority[left.status] - statusPriority[right.status];
    }

    if (confidencePriority[left.confidence] !== confidencePriority[right.confidence]) {
      return confidencePriority[left.confidence] - confidencePriority[right.confidence];
    }

    return left.contextId.localeCompare(right.contextId);
  });
}

function collectArchitectureContext(input: BuildAiSuggestionPayloadInput): AiSuggestionPayload["architectureContext"] {
  if (!input.selectedGroup) {
    return {
      groupId: null,
      groupTitle: null,
      filePath: null,
      totalUpstreamCount: 0,
      totalDownstreamCount: 0,
      includedUpstreamCount: 0,
      includedDownstreamCount: 0,
      isTruncated: false,
      fallbackMessage: "No selected change group. Use semantic summary for manual triage.",
      upstreamNodes: [],
      downstreamNodes: [],
    };
  }

  const group = input.selectedGroup;
  const centerNodeId = group.architectureGraph.nodes.find((node) => node.role === "center")?.nodeId ?? `group:${group.groupId}`;
  const nodeById = new Map(group.architectureGraph.nodes.map((node) => [node.nodeId, node] as const));
  const upstreamNodeIds = new Set<string>();
  const downstreamNodeIds = new Set<string>();

  for (const edge of group.architectureGraph.edges) {
    if (edge.toNodeId === centerNodeId) {
      upstreamNodeIds.add(edge.fromNodeId);
    }

    if (edge.fromNodeId === centerNodeId) {
      downstreamNodeIds.add(edge.toNodeId);
    }
  }

  const toNode = (nodeId: string): AiSuggestionPayloadArchitectureNode => {
    const node = nodeById.get(nodeId);

    if (node) {
      return {
        nodeId,
        kind: node.kind,
        label: truncateText(node.label) ?? "unknown",
      };
    }

    return {
      nodeId,
      kind: "unknown",
      label: truncateText(nodeId) ?? "unknown",
    };
  };

  const allUpstream = [...upstreamNodeIds].map(toNode).sort((left, right) => left.label.localeCompare(right.label));
  const allDownstream = [...downstreamNodeIds]
    .map(toNode)
    .sort((left, right) => left.label.localeCompare(right.label));
  const upstreamNodes = allUpstream.slice(0, MAX_ARCHITECTURE_NODES_PER_DIRECTION);
  const downstreamNodes = allDownstream.slice(0, MAX_ARCHITECTURE_NODES_PER_DIRECTION);
  const isTruncated =
    allUpstream.length > upstreamNodes.length || allDownstream.length > downstreamNodes.length;

  return {
    groupId: group.groupId,
    groupTitle: truncateText(group.title),
    filePath: truncateText(group.filePath),
    totalUpstreamCount: allUpstream.length,
    totalDownstreamCount: allDownstream.length,
    includedUpstreamCount: upstreamNodes.length,
    includedDownstreamCount: downstreamNodes.length,
    isTruncated,
    fallbackMessage:
      allUpstream.length + allDownstream.length === 0
        ? "No architecture neighbors found. Fall back to semantic-level inspection."
        : null,
    upstreamNodes,
    downstreamNodes,
  };
}

export function buildAiSuggestionPayload(input: BuildAiSuggestionPayloadInput): AiSuggestionPayload {
  const semanticChanges = input.selectedGroup?.semanticChanges ?? [];
  const truncatedSemanticChanges = semanticChanges.slice(0, MAX_SEMANTIC_CHANGES);
  const businessContextItems = sortBusinessContextByPriority(input.businessContextItems);
  const truncatedBusinessContextItems = businessContextItems.slice(0, MAX_BUSINESS_CONTEXT_ITEMS);

  return {
    generatedAt: new Date().toISOString(),
    review: {
      reviewId: input.review.reviewId,
      title: truncateText(input.review.title) ?? "Untitled review",
      repositoryName: truncateText(input.review.repositoryName) ?? "unknown/unknown",
      branchLabel: truncateText(input.review.branchLabel) ?? "unknown",
    },
    semanticContext: {
      totalCount: semanticChanges.length,
      includedCount: truncatedSemanticChanges.length,
      isTruncated: semanticChanges.length > truncatedSemanticChanges.length,
      fallbackMessage:
        truncatedSemanticChanges.length === 0
          ? "No semantic changes were found for the selected group."
          : null,
      changes: truncatedSemanticChanges.map((change) => ({
        semanticChangeId: change.semanticChangeId,
        symbolDisplayName: truncateText(change.symbolDisplayName) ?? "unknown",
        symbolKind: change.symbolKind,
        changeType: change.changeType,
        signatureSummary: truncateText(change.signatureSummary),
        bodySummary: truncateText(change.bodySummary),
        location: truncateText(
          formatLocation({
            before: change.before,
            after: change.after,
          }),
        ) ?? "unknown",
      })),
    },
    architectureContext: collectArchitectureContext(input),
    businessContext: {
      totalCount: businessContextItems.length,
      includedCount: truncatedBusinessContextItems.length,
      isTruncated: businessContextItems.length > truncatedBusinessContextItems.length,
      fallbackMessage:
        truncatedBusinessContextItems.length === 0
          ? "No business context links were found."
          : null,
      items: truncatedBusinessContextItems.map((item) => ({
        contextId: item.contextId,
        sourceType: item.sourceType,
        status: item.status,
        confidence: item.confidence,
        title: truncateText(item.title) ?? "unknown context",
        summary: truncateText(item.summary),
        href: truncateText(item.href),
      })),
    },
  };
}

export const aiSuggestionPayloadLimits = {
  maxSemanticChanges: MAX_SEMANTIC_CHANGES,
  maxArchitectureNodesPerDirection: MAX_ARCHITECTURE_NODES_PER_DIRECTION,
  maxBusinessContextItems: MAX_BUSINESS_CONTEXT_ITEMS,
  maxTextLength: MAX_TEXT_LENGTH,
} as const;
