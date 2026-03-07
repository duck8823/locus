import { createHash } from "node:crypto";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type { SourceSnapshot, SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";
import type {
  SemanticChange,
  SemanticChangeGroup,
  UnsupportedFileAnalysis,
} from "@/server/domain/value-objects/semantic-change";

export interface AnalyzeSourceSnapshotsInput {
  reviewId: string;
  snapshotPairs: SourceSnapshotPair[];
  parserAdapters: ParserAdapter[];
}

export interface AnalyzeSourceSnapshotsResult {
  semanticChanges: SemanticChange[];
  groups: SemanticChangeGroup[];
  unsupportedFiles: UnsupportedFileAnalysis[];
}

interface DiffPlan {
  adapter: ParserAdapter;
  beforeSnapshot: SourceSnapshot | null;
  afterSnapshot: SourceSnapshot | null;
}

function createStableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("::")).digest("hex").slice(0, 20);
}

function inferDominantLayer(filePath: string): string | undefined {
  if (filePath.includes("/app/")) {
    return "presentation";
  }

  if (filePath.includes("/domain/")) {
    return "domain";
  }

  if (filePath.includes("/infrastructure/")) {
    return "infrastructure";
  }

  if (filePath.includes("/application/")) {
    return "application";
  }

  return undefined;
}

function selectAdapter(
  adapters: ParserAdapter[],
  snapshots: Array<SourceSnapshot | null>,
): ParserAdapter | null {
  for (const snapshot of snapshots) {
    if (!snapshot) {
      continue;
    }

    const adapter = adapters.find((candidate) => candidate.supports(snapshot));

    if (adapter) {
      return adapter;
    }
  }

  return null;
}

export async function analyzeSourceSnapshots({
  reviewId,
  snapshotPairs,
  parserAdapters,
}: AnalyzeSourceSnapshotsInput): Promise<AnalyzeSourceSnapshotsResult> {
  const semanticChanges: SemanticChange[] = [];
  const unsupportedFiles: UnsupportedFileAnalysis[] = [];

  for (const pair of snapshotPairs) {
    if (!pair.before && !pair.after) {
      unsupportedFiles.push({
        reviewId,
        fileId: pair.fileId,
        filePath: pair.filePath,
        language: null,
        reason: "binary_file",
        detail: "No textual snapshot was provided for this file.",
      });
      continue;
    }

    const beforeAdapter = pair.before ? selectAdapter(parserAdapters, [pair.before]) : null;
    const afterAdapter = pair.after ? selectAdapter(parserAdapters, [pair.after]) : null;

    if (!beforeAdapter && !afterAdapter) {
      const representative = pair.after ?? pair.before;
      unsupportedFiles.push({
        reviewId,
        fileId: pair.fileId,
        filePath: pair.filePath,
        language: representative?.language ?? null,
        reason: "unsupported_language",
      });
      continue;
    }

    const diffPlans: DiffPlan[] = [];

    if (
      pair.before &&
      pair.after &&
      beforeAdapter &&
      afterAdapter &&
      beforeAdapter.adapterName === afterAdapter.adapterName
    ) {
      diffPlans.push({
        adapter: beforeAdapter,
        beforeSnapshot: pair.before,
        afterSnapshot: pair.after,
      });
    } else {
      if (pair.before && beforeAdapter) {
        diffPlans.push({
          adapter: beforeAdapter,
          beforeSnapshot: pair.before,
          afterSnapshot: null,
        });
      }

      if (pair.after && afterAdapter) {
        diffPlans.push({
          adapter: afterAdapter,
          beforeSnapshot: null,
          afterSnapshot: pair.after,
        });
      }
    }

    let failureSnapshot: SourceSnapshot | null = null;

    try {
      const fileSemanticChanges: SemanticChange[] = [];

      for (const plan of diffPlans) {
        if (plan.beforeSnapshot) {
          failureSnapshot = plan.beforeSnapshot;
        }
        const before = plan.beforeSnapshot ? await plan.adapter.parse(plan.beforeSnapshot) : null;

        if (plan.afterSnapshot) {
          failureSnapshot = plan.afterSnapshot;
        }
        const after = plan.afterSnapshot ? await plan.adapter.parse(plan.afterSnapshot) : null;
        failureSnapshot = plan.afterSnapshot ?? plan.beforeSnapshot ?? failureSnapshot;
        const diff = await plan.adapter.diff({ before, after });

        for (const item of diff.items) {
          const instanceDiscriminator =
            typeof item.metadata?.instanceDiscriminator === "string"
              ? item.metadata.instanceDiscriminator
              : "";
          const semanticChangeId = createStableId(
            reviewId,
            pair.fileId,
            diff.adapterName,
            item.symbolKey,
            item.changeType,
            item.signatureSummary ?? "",
            item.bodySummary ?? "",
            instanceDiscriminator,
          );

          const references = Array.from(new Set(item.references ?? []));

          fileSemanticChanges.push({
            semanticChangeId,
            reviewId,
            fileId: pair.fileId,
            language: diff.language,
            adapterName: diff.adapterName,
            symbol: {
              stableKey: item.symbolKey,
              displayName: item.displayName,
              kind: item.kind,
              container: item.container,
            },
            change: {
              type: item.changeType,
              signatureSummary: item.signatureSummary,
              bodySummary: item.bodySummary,
            },
            before: item.beforeRegion,
            after: item.afterRegion,
            architecture:
              references.length > 0
                ? {
                    outgoingNodeIds: references.map((reference) => `symbol:${reference}`),
                    incomingNodeIds: [],
                  }
                : undefined,
            metadata: {
              parser: {
                adapterName: diff.adapterName,
                parserVersion: before?.parserVersion ?? after?.parserVersion,
              },
              languageSpecific: item.metadata ?? {},
            },
          });
        }
      }

      semanticChanges.push(...fileSemanticChanges);
    } catch (error) {
      const representative = failureSnapshot ?? pair.after ?? pair.before;
      unsupportedFiles.push({
        reviewId,
        fileId: pair.fileId,
        filePath: representative?.filePath ?? pair.filePath,
        language: representative?.language ?? null,
        reason: "parser_failed",
        detail: error instanceof Error ? error.message : "Unknown parser error",
      });
    }
  }

  const groupedByFile = new Map<string, SemanticChange[]>();

  for (const semanticChange of semanticChanges) {
    const changes = groupedByFile.get(semanticChange.fileId) ?? [];
    changes.push(semanticChange);
    groupedByFile.set(semanticChange.fileId, changes);
  }

  const groups: SemanticChangeGroup[] = Array.from(groupedByFile.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fileId, changes]) => {
      const sortedChanges = [...changes].sort((a, b) =>
        a.symbol.displayName.localeCompare(b.symbol.displayName),
      );
      const first = sortedChanges[0];
      const filePath = first?.after?.filePath ?? first?.before?.filePath ?? fileId;

      return {
        groupId: `group-${createStableId(reviewId, fileId)}`,
        reviewId,
        title: `${filePath} semantic changes`,
        fileIds: [fileId],
        semanticChangeIds: sortedChanges.map((change) => change.semanticChangeId),
        dominantLayer: inferDominantLayer(filePath),
        status: "unread",
      };
    });

  return {
    semanticChanges: [...semanticChanges].sort((a, b) =>
      a.semanticChangeId.localeCompare(b.semanticChangeId),
    ),
    groups,
    unsupportedFiles: [...unsupportedFiles].sort((a, b) => a.fileId.localeCompare(b.fileId)),
  };
}
