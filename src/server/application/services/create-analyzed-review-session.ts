import {
  analyzeSourceSnapshots,
  type AnalyzeSourceSnapshotsProgress,
} from "@/server/application/services/analyze-source-snapshots";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import { ReviewSession, type ReviewGroupRecord } from "@/server/domain/entities/review-session";
import type {
  SemanticChange,
  SemanticChangeGroup,
} from "@/server/domain/value-objects/semantic-change";
import type { ReviewSessionSource } from "@/server/domain/value-objects/review-session-source";
import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

export interface CreateAnalyzedReviewSessionInput {
  reviewId: string;
  title: string;
  repositoryName: string;
  branchLabel: string;
  viewerName: string;
  source: ReviewSessionSource;
  createdAt: string;
  snapshotPairs: SourceSnapshotPair[];
  parserAdapters: ParserAdapter[];
  onAnalysisProgress?: (progress: AnalyzeSourceSnapshotsProgress) => Promise<void> | void;
}

function summarizeSemanticChanges(changes: SemanticChange[]): string {
  if (changes.length === 0) {
    return "No semantic changes detected.";
  }

  const labels = changes
    .slice(0, 3)
    .map((change) => `${change.symbol.displayName} (${change.change.type})`)
    .join(", ");

  if (changes.length <= 3) {
    return labels;
  }

  return `${labels}, +${changes.length - 3} more`;
}

function toReviewGroupRecord(
  group: SemanticChangeGroup,
  semanticChanges: SemanticChange[],
): ReviewGroupRecord {
  const groupedChanges = semanticChanges.filter((change) =>
    group.semanticChangeIds.includes(change.semanticChangeId),
  );
  const firstChange = groupedChanges[0];
  const filePath = firstChange?.after?.filePath ?? firstChange?.before?.filePath ?? group.fileIds[0] ?? "unknown";
  const outgoing = new Set<string>();
  const incoming = new Set<string>();

  for (const semanticChange of groupedChanges) {
    for (const nodeId of semanticChange.architecture?.outgoingNodeIds ?? []) {
      outgoing.add(nodeId);
    }

    for (const nodeId of semanticChange.architecture?.incomingNodeIds ?? []) {
      incoming.add(nodeId);
    }
  }

  return {
    groupId: group.groupId,
    title: group.title,
    summary: summarizeSemanticChanges(groupedChanges),
    filePath,
    status: group.status,
    upstream: [...incoming],
    downstream: [...outgoing],
    dominantLayer: group.dominantLayer,
    fileIds: [...group.fileIds],
    semanticChangeIds: [...group.semanticChangeIds],
  };
}

export async function createAnalyzedReviewSession({
  reviewId,
  title,
  repositoryName,
  branchLabel,
  viewerName,
  source,
  createdAt,
  snapshotPairs,
  parserAdapters,
  onAnalysisProgress,
}: CreateAnalyzedReviewSessionInput): Promise<ReviewSession> {
  const analysisResult = await analyzeSourceSnapshots({
    reviewId,
    snapshotPairs,
    parserAdapters,
    onProgress: onAnalysisProgress,
  });
  const groups = analysisResult.groups.map((group) =>
    toReviewGroupRecord(group, analysisResult.semanticChanges),
  );

  return ReviewSession.create({
    reviewId,
    title,
    repositoryName,
    branchLabel,
    viewerName,
    source,
    groups,
    semanticChanges: analysisResult.semanticChanges,
    unsupportedFileAnalyses: analysisResult.unsupportedFiles,
    selectedGroupId: groups[0]?.groupId ?? null,
    lastOpenedAt: createdAt,
    analysisStatus: "ready",
    analysisRequestedAt: createdAt,
    analysisCompletedAt: createdAt,
    analysisTotalFiles: snapshotPairs.length,
    analysisProcessedFiles: snapshotPairs.length,
    analysisError: null,
    lastReanalyzeRequestedAt: null,
  });
}
