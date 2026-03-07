import { analyzeSourceSnapshots } from "@/server/application/services/analyze-source-snapshots";
import { createSeedSourceSnapshotPairs } from "@/server/application/services/seed-source-snapshot-fixture";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import { ReviewSession, type ReviewGroupRecord } from "@/server/domain/entities/review-session";
import type { SemanticChange, SemanticChangeGroup } from "@/server/domain/value-objects/semantic-change";

export interface CreateSeedReviewSessionInput {
  reviewId: string;
  viewerName: string;
  createdAt: string;
  parserAdapters: ParserAdapter[];
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

export async function createSeedReviewSession({
  reviewId,
  viewerName,
  createdAt,
  parserAdapters,
}: CreateSeedReviewSessionInput): Promise<ReviewSession> {
  const analysisResult = await analyzeSourceSnapshots({
    reviewId,
    snapshotPairs: createSeedSourceSnapshotPairs(reviewId),
    parserAdapters,
  });
  const groups = analysisResult.groups.map((group) =>
    toReviewGroupRecord(group, analysisResult.semanticChanges),
  );

  return ReviewSession.create({
    reviewId,
    title: "Demo semantic review workspace",
    repositoryName: "duck8823/locus",
    branchLabel: "feat/semantic-analysis-spike",
    viewerName,
    groups,
    semanticChanges: analysisResult.semanticChanges,
    unsupportedFileAnalyses: analysisResult.unsupportedFiles,
    selectedGroupId: groups[0]?.groupId ?? null,
    lastOpenedAt: createdAt,
    lastReanalyzeRequestedAt: null,
  });
}
