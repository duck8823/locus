import { reviewGroupStatuses } from "@/server/domain/value-objects/review-status";
import type { ReviewSession } from "@/server/domain/entities/review-session";
import type {
  SemanticChange,
  UnsupportedFileAnalysis,
  UnsupportedFileReason,
} from "@/server/domain/value-objects/semantic-change";
import { toArchitectureNodeView } from "@/server/presentation/formatters/architecture-node";
import type {
  ReviewWorkspaceUnsupportedFileDto,
  ReviewWorkspaceArchitectureGraphDto,
  ReviewWorkspaceDto,
  ReviewWorkspaceSemanticChangeDto,
  ReviewWorkspaceUnsupportedSummaryDto,
} from "@/server/presentation/dto/review-workspace-dto";

const UNSUPPORTED_SAMPLE_LIMIT = 5;
const UNSUPPORTED_DETAILS_LIMIT = 100;
const FILE_NODE_PREFIX = "file:";

function toSemanticChangeDto(change: SemanticChange): ReviewWorkspaceSemanticChangeDto {
  return {
    semanticChangeId: change.semanticChangeId,
    symbolDisplayName: change.symbol.displayName,
    symbolKind: change.symbol.kind,
    changeType: change.change.type,
    signatureSummary: change.change.signatureSummary ?? null,
    bodySummary: change.change.bodySummary ?? null,
    before: change.before ? { ...change.before } : null,
    after: change.after ? { ...change.after } : null,
  };
}

const SEMANTIC_CHANGE_IMPACT_PRIORITY: Record<ReviewWorkspaceSemanticChangeDto["changeType"], number> = {
  modified: 0,
  added: 1,
  removed: 2,
  moved: 3,
  renamed: 4,
};

function compareSemanticChangeDtos(
  left: ReviewWorkspaceSemanticChangeDto,
  right: ReviewWorkspaceSemanticChangeDto,
): number {
  const leftPriority = SEMANTIC_CHANGE_IMPACT_PRIORITY[left.changeType] ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = SEMANTIC_CHANGE_IMPACT_PRIORITY[right.changeType] ?? Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const symbolNameComparison = left.symbolDisplayName.localeCompare(right.symbolDisplayName);

  if (symbolNameComparison !== 0) {
    return symbolNameComparison;
  }

  return left.semanticChangeId.localeCompare(right.semanticChangeId);
}

function toUnsupportedSummary(
  unsupportedFileAnalyses: UnsupportedFileAnalysis[],
): ReviewWorkspaceUnsupportedSummaryDto {
  const reasonCounts = new Map<UnsupportedFileReason, number>();

  for (const entry of unsupportedFileAnalyses) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }

  const byReason = [...reasonCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reason, count]) => ({
      reason,
      count,
    }));

  const sampleFilePaths = unsupportedFileAnalyses
    .map((entry) => entry.filePath.trim())
    .filter((filePath) => filePath.length > 0)
    .slice(0, UNSUPPORTED_SAMPLE_LIMIT);

  return {
    totalCount: unsupportedFileAnalyses.length,
    byReason,
    sampleFilePaths,
  };
}

function toUnsupportedFiles(
  unsupportedFileAnalyses: UnsupportedFileAnalysis[],
): ReviewWorkspaceUnsupportedFileDto[] {
  const rows: ReviewWorkspaceUnsupportedFileDto[] = [];

  for (const entry of unsupportedFileAnalyses) {
    rows.push({
      filePath: entry.filePath,
      language: entry.language ?? null,
      reason: entry.reason,
      detail: entry.detail ?? null,
    });

    if (rows.length >= UNSUPPORTED_DETAILS_LIMIT) {
      break;
    }
  }

  return rows;
}

function calculateAnalysisDurationMs(params: {
  analysisRequestedAt: string | null | undefined;
  analysisCompletedAt: string | null | undefined;
}): number | null {
  if (!params.analysisRequestedAt || !params.analysisCompletedAt) {
    return null;
  }

  const requestedAtEpochMs = Date.parse(params.analysisRequestedAt);
  const completedAtEpochMs = Date.parse(params.analysisCompletedAt);

  if (Number.isNaN(requestedAtEpochMs) || Number.isNaN(completedAtEpochMs)) {
    return null;
  }

  return Math.max(0, completedAtEpochMs - requestedAtEpochMs);
}

function calculateCoverageMetrics(params: {
  analysisTotalFiles: number | null | undefined;
  unsupportedFileCount: number;
}): {
  supportedFiles: number | null;
  coveragePercent: number | null;
} {
  if (
    typeof params.analysisTotalFiles !== "number" ||
    !Number.isFinite(params.analysisTotalFiles) ||
    params.analysisTotalFiles < 0
  ) {
    return {
      supportedFiles: null,
      coveragePercent: null,
    };
  }

  const totalFiles = Math.floor(params.analysisTotalFiles);
  const unsupportedFiles = Math.max(0, Math.floor(params.unsupportedFileCount));
  const supportedFiles = Math.max(0, totalFiles - unsupportedFiles);

  if (totalFiles === 0) {
    return {
      supportedFiles,
      coveragePercent: 0,
    };
  }

  const rawPercent = (supportedFiles / totalFiles) * 100;
  const boundedPercent =
    supportedFiles < totalFiles ? Math.min(rawPercent, 99.9) : Math.min(rawPercent, 100);
  const coveragePercent = Math.floor(boundedPercent * 10) / 10;

  return {
    supportedFiles,
    coveragePercent,
  };
}

function inferArchitectureRelation(nodeId: string): "imports" | "calls" | "implements" | "uses" {
  if (nodeId.startsWith("symbol:")) {
    return "calls";
  }

  if (nodeId.startsWith("file:")) {
    return "imports";
  }

  return "uses";
}

function resolveLinkedGroupId(nodeId: string, filePathToGroupId: Map<string, string>): string | null {
  if (!nodeId.startsWith(FILE_NODE_PREFIX)) {
    return null;
  }

  const filePath = nodeId.slice(FILE_NODE_PREFIX.length).trim();

  if (filePath.length === 0) {
    return null;
  }

  return filePathToGroupId.get(filePath) ?? null;
}

function toArchitectureGraph(params: {
  groupId: string;
  filePath: string;
  upstream: string[];
  downstream: string[];
  filePathToGroupId: Map<string, string>;
}): ReviewWorkspaceArchitectureGraphDto {
  const centerNodeId = `group:${params.groupId}`;
  const nodes = new Map<string, ReviewWorkspaceArchitectureGraphDto["nodes"][number]>();
  const edges = new Map<string, ReviewWorkspaceArchitectureGraphDto["edges"][number]>();

  nodes.set(centerNodeId, {
    nodeId: centerNodeId,
    kind: "file",
    label: params.filePath,
    role: "center",
    linkedGroupId: params.groupId,
  });

  const normalizedUpstream = [...new Set(params.upstream.map((value) => value.trim()).filter(Boolean))];
  const normalizedDownstream = [...new Set(params.downstream.map((value) => value.trim()).filter(Boolean))];

  for (const nodeId of normalizedUpstream) {
    const nodeView = toArchitectureNodeView(nodeId);
    const existing = nodes.get(nodeId);

    nodes.set(nodeId, {
      nodeId,
      kind: nodeView.kind,
      label: nodeView.label,
      role: existing?.role === "downstream" ? "downstream" : "upstream",
      linkedGroupId: resolveLinkedGroupId(nodeId, params.filePathToGroupId),
    });

    const edgeKey = `${nodeId}->${centerNodeId}`;
    edges.set(edgeKey, {
      fromNodeId: nodeId,
      toNodeId: centerNodeId,
      relation: inferArchitectureRelation(nodeId),
    });
  }

  for (const nodeId of normalizedDownstream) {
    const nodeView = toArchitectureNodeView(nodeId);
    const existing = nodes.get(nodeId);

    nodes.set(nodeId, {
      nodeId,
      kind: nodeView.kind,
      label: nodeView.label,
      role: existing?.role === "upstream" ? "upstream" : "downstream",
      linkedGroupId: resolveLinkedGroupId(nodeId, params.filePathToGroupId),
    });

    const edgeKey = `${centerNodeId}->${nodeId}`;
    edges.set(edgeKey, {
      fromNodeId: centerNodeId,
      toNodeId: nodeId,
      relation: inferArchitectureRelation(nodeId),
    });
  }

  const nodeOrder: Record<ReviewWorkspaceArchitectureGraphDto["nodes"][number]["role"], number> = {
    center: 0,
    upstream: 1,
    downstream: 2,
  };

  return {
    nodes: [...nodes.values()].sort((left, right) => {
      if (nodeOrder[left.role] !== nodeOrder[right.role]) {
        return nodeOrder[left.role] - nodeOrder[right.role];
      }

      return left.label.localeCompare(right.label);
    }),
    edges: [...edges.values()].sort((left, right) => {
      const leftKey = `${left.fromNodeId}->${left.toNodeId}`;
      const rightKey = `${right.fromNodeId}->${right.toNodeId}`;
      return leftKey.localeCompare(rightKey);
    }),
  };
}

export function toReviewWorkspaceDto(reviewSession: ReviewSession): ReviewWorkspaceDto {
  const record = reviewSession.toRecord();
  const semanticChangeMap = new Map(
    (record.semanticChanges ?? []).map((change) => [change.semanticChangeId, change] as const),
  );
  const filePathToGroupId = new Map<string, string>();

  for (const group of record.groups) {
    if (!filePathToGroupId.has(group.filePath)) {
      filePathToGroupId.set(group.filePath, group.groupId);
    }
  }

  const unsupportedSummary = toUnsupportedSummary(record.unsupportedFileAnalyses ?? []);
  const unsupportedFiles = toUnsupportedFiles(record.unsupportedFileAnalyses ?? []);
  const coverageMetrics = calculateCoverageMetrics({
    analysisTotalFiles: record.analysisTotalFiles ?? null,
    unsupportedFileCount: unsupportedSummary.totalCount,
  });

  return {
    reviewId: record.reviewId,
    title: record.title,
    repositoryName: record.repositoryName,
    branchLabel: record.branchLabel,
    viewerName: record.viewerName,
    analysisStatus: record.analysisStatus ?? "ready",
    analysisRequestedAt: record.analysisRequestedAt ?? null,
    analysisCompletedAt: record.analysisCompletedAt ?? null,
    analysisTotalFiles: record.analysisTotalFiles ?? null,
    analysisProcessedFiles: record.analysisProcessedFiles ?? null,
    analysisSupportedFiles: coverageMetrics.supportedFiles,
    analysisUnsupportedFiles: unsupportedSummary.totalCount,
    analysisCoveragePercent: coverageMetrics.coveragePercent,
    analysisAttemptCount: record.analysisAttemptCount ?? 0,
    analysisDurationMs: calculateAnalysisDurationMs({
      analysisRequestedAt: record.analysisRequestedAt ?? null,
      analysisCompletedAt: record.analysisCompletedAt ?? null,
    }),
    analysisError: record.analysisError ?? null,
    activeAnalysisJob: null,
    analysisHistory: [],
    dogfoodingMetrics: {
      averageDurationMs: null,
      failureRatePercent: null,
      recoverySuccessRatePercent: null,
    },
    reanalysisStatus: record.reanalysisStatus ?? "idle",
    lastOpenedAt: record.lastOpenedAt,
    lastReanalyzeRequestedAt: record.lastReanalyzeRequestedAt,
    lastReanalyzeCompletedAt: record.lastReanalyzeCompletedAt ?? null,
    lastReanalyzeError: record.lastReanalyzeError ?? null,
    availableStatuses: [...reviewGroupStatuses],
    unsupportedSummary,
    unsupportedFiles,
    businessContext: {
      generatedAt: new Date().toISOString(),
      provider: "stub",
      diagnostics: {
        status: "ok",
        retryable: true,
        message: null,
        occurredAt: null,
      },
      items: [],
    },
    groups: record.groups.map((group) => ({
      groupId: group.groupId,
      title: group.title,
      summary: group.summary,
      filePath: group.filePath,
      status: group.status,
      isSelected: group.groupId === record.selectedGroupId,
      upstream: [...group.upstream],
      downstream: [...group.downstream],
      architectureGraph: toArchitectureGraph({
        groupId: group.groupId,
        filePath: group.filePath,
        upstream: group.upstream,
        downstream: group.downstream,
        filePathToGroupId,
      }),
      semanticChanges: (group.semanticChangeIds ?? [])
        .map((semanticChangeId) => semanticChangeMap.get(semanticChangeId))
        .filter((semanticChange): semanticChange is SemanticChange => !!semanticChange)
        .map(toSemanticChangeDto)
        .sort(compareSemanticChangeDtos),
    })),
  };
}
