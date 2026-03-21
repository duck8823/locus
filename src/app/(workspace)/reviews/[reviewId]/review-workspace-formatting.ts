import type { ArchitectureNodeGroups } from "@/server/presentation/formatters/architecture-node";

export interface ArchitectureColumn {
  label: "upstream" | "downstream";
  nodes: Array<{
    nodeId: string;
    linkedGroupId: string | null;
  }>;
  relationByNodeId: Map<string, "imports" | "calls" | "implements" | "uses">;
}

const ARCHITECTURE_CATEGORY_FLAGS: Record<keyof ArchitectureNodeGroups, true> = {
  layer: true,
  file: true,
  symbol: true,
  unknown: true,
};

export const ARCHITECTURE_CATEGORY_ORDER = Object.keys(
  ARCHITECTURE_CATEGORY_FLAGS,
) as Array<keyof ArchitectureNodeGroups>;

export interface ArchitectureGraphInput {
  nodes: Array<{
    nodeId: string;
    role: string;
    label: string;
    linkedGroupId: string | null;
  }>;
  edges: Array<{
    fromNodeId: string;
    toNodeId: string;
    relation: "imports" | "calls" | "implements" | "uses";
  }>;
}

export function buildArchitectureColumns(
  graph: ArchitectureGraphInput,
  groupId: string,
): ArchitectureColumn[] {
  const nodeById = new Map(
    graph.nodes.map((node) => [node.nodeId, node] as const),
  );
  const centerNodeId =
    graph.nodes.find((node) => node.role === "center")?.nodeId ??
    `group:${groupId}`;
  const upstreamRelations = new Map<string, "imports" | "calls" | "implements" | "uses">();
  const downstreamRelations = new Map<string, "imports" | "calls" | "implements" | "uses">();
  const upstreamNodeIds = new Set<string>();
  const downstreamNodeIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.toNodeId === centerNodeId) {
      upstreamRelations.set(edge.fromNodeId, edge.relation);
      upstreamNodeIds.add(edge.fromNodeId);
    }

    if (edge.fromNodeId === centerNodeId) {
      downstreamRelations.set(edge.toNodeId, edge.relation);
      downstreamNodeIds.add(edge.toNodeId);
    }
  }

  const upstreamNodes = [...upstreamNodeIds]
    .map((nodeId) => nodeById.get(nodeId))
    .filter(
      (node): node is NonNullable<typeof node> => !!node,
    )
    .sort((left, right) => left.label.localeCompare(right.label));
  const downstreamNodes = [...downstreamNodeIds]
    .map((nodeId) => nodeById.get(nodeId))
    .filter(
      (node): node is NonNullable<typeof node> => !!node,
    )
    .sort((left, right) => left.label.localeCompare(right.label));

  return [
    {
      label: "upstream" as const,
      nodes: upstreamNodes.map((node) => ({
        nodeId: node.nodeId,
        linkedGroupId: node.linkedGroupId,
      })),
      relationByNodeId: upstreamRelations,
    },
    {
      label: "downstream" as const,
      nodes: downstreamNodes.map((node) => ({
        nodeId: node.nodeId,
        linkedGroupId: node.linkedGroupId,
      })),
      relationByNodeId: downstreamRelations,
    },
  ];
}

export function formatCodeRegion(
  region: { filePath: string; startLine: number; endLine: number } | null,
): string {
  if (!region) {
    return "—";
  }

  return `${region.filePath}:${region.startLine}-${region.endLine}`;
}

export function formatAnalysisDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

export function formatCoveragePercent(coveragePercent: number): string {
  const formatted = coveragePercent.toFixed(1);

  return formatted.endsWith(".0") ? `${formatted.slice(0, -2)}%` : `${formatted}%`;
}

export function formatNullablePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const formatted = value.toFixed(1);
  return formatted.endsWith(".0") ? `${formatted.slice(0, -2)}%` : `${formatted}%`;
}

export function compactTextItems(items: Array<string | null | undefined>): string[] {
  return items.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function calculateAnalysisProgressPercent(params: {
  analysisProcessedFiles: number | null;
  analysisTotalFiles: number | null;
}): number | null {
  const totalFiles = params.analysisTotalFiles;
  const processedFiles = params.analysisProcessedFiles;

  if (
    typeof totalFiles !== "number" ||
    !Number.isFinite(totalFiles) ||
    totalFiles <= 0 ||
    typeof processedFiles !== "number" ||
    !Number.isFinite(processedFiles) ||
    processedFiles < 0
  ) {
    return null;
  }

  const boundedProcessedFiles = Math.min(processedFiles, totalFiles);
  const rawPercent = (boundedProcessedFiles / totalFiles) * 100;
  return Math.floor(rawPercent * 10) / 10;
}
