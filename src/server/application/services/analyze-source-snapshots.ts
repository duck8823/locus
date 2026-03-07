import { createHash } from "node:crypto";
import type { ParserAdapter } from "@/server/application/ports/parser-adapter";
import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";
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

function createStableId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("::")).digest("hex").slice(0, 16);
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

function selectAdapter(adapters: ParserAdapter[], pair: SourceSnapshotPair): ParserAdapter | null {
  const representative = pair.after ?? pair.before;

  if (!representative) {
    return null;
  }

  return adapters.find((adapter) => adapter.supports(representative)) ?? null;
}

export async function analyzeSourceSnapshots({
  reviewId,
  snapshotPairs,
  parserAdapters,
}: AnalyzeSourceSnapshotsInput): Promise<AnalyzeSourceSnapshotsResult> {
  const semanticChanges: SemanticChange[] = [];
  const unsupportedFiles: UnsupportedFileAnalysis[] = [];

  for (const pair of snapshotPairs) {
    const representative = pair.after ?? pair.before;

    if (!representative) {
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

    const adapter = selectAdapter(parserAdapters, pair);

    if (!adapter) {
      unsupportedFiles.push({
        reviewId,
        fileId: pair.fileId,
        filePath: pair.filePath,
        language: representative.language,
        reason: "unsupported_language",
      });
      continue;
    }

    try {
      const before = pair.before ? await adapter.parse(pair.before) : null;
      const after = pair.after ? await adapter.parse(pair.after) : null;
      const diff = await adapter.diff({ before, after });

      for (const item of diff.items) {
        const semanticChangeId = createStableId(
          reviewId,
          pair.fileId,
          item.symbolKey,
          item.changeType,
          item.signatureSummary ?? "",
          item.bodySummary ?? "",
        );

        const references = Array.from(new Set(item.references ?? []));

        semanticChanges.push({
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
    } catch (error) {
      unsupportedFiles.push({
        reviewId,
        fileId: pair.fileId,
        filePath: pair.filePath,
        language: representative.language,
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
