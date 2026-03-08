import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";
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

interface SnapshotDependencySource {
  filePath: string;
  content: string;
  isRemoved: boolean;
}

interface FileDependencyContext {
  outgoingByPath: Map<string, Set<string>>;
  incomingByPath: Map<string, Set<string>>;
}

const RESOLVABLE_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

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

function collectRelativeImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];

      if (!specifier || !specifier.startsWith(".")) {
        continue;
      }

      specifiers.add(specifier);
    }
  }

  return [...specifiers];
}

function resolveRelativeImportPath(
  currentFilePath: string,
  importSpecifier: string,
  knownFilePaths: Set<string>,
): string | null {
  const baseDirectory = pathPosix.dirname(currentFilePath);
  const resolvedBase = pathPosix.normalize(pathPosix.join(baseDirectory, importSpecifier));
  const candidates = new Set<string>([resolvedBase]);

  if (pathPosix.extname(resolvedBase).length === 0) {
    for (const extension of RESOLVABLE_SOURCE_EXTENSIONS) {
      candidates.add(`${resolvedBase}${extension}`);
      candidates.add(pathPosix.join(resolvedBase, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (knownFilePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function collectDependencySources(snapshotPairs: SourceSnapshotPair[]): SnapshotDependencySource[] {
  const sourcesByPath = new Map<string, SnapshotDependencySource>();

  for (const pair of snapshotPairs) {
    if (pair.after) {
      sourcesByPath.set(pair.after.filePath, {
        filePath: pair.after.filePath,
        content: pair.after.content,
        isRemoved: false,
      });
      continue;
    }

    if (pair.before) {
      sourcesByPath.set(pair.before.filePath, {
        filePath: pair.before.filePath,
        content: pair.before.content,
        isRemoved: true,
      });
    }
  }

  return [...sourcesByPath.values()];
}

function buildFileDependencyContext(snapshotPairs: SourceSnapshotPair[]): FileDependencyContext {
  const sources = collectDependencySources(snapshotPairs);
  const knownFilePaths = new Set(sources.map((source) => source.filePath));
  const outgoingByPath = new Map<string, Set<string>>();
  const incomingByPath = new Map<string, Set<string>>();

  for (const source of sources) {
    const outgoing = outgoingByPath.get(source.filePath) ?? new Set<string>();
    outgoingByPath.set(source.filePath, outgoing);

    for (const importSpecifier of collectRelativeImportSpecifiers(source.content)) {
      const resolvedPath = resolveRelativeImportPath(source.filePath, importSpecifier, knownFilePaths);

      if (!resolvedPath || resolvedPath === source.filePath) {
        continue;
      }

      outgoing.add(resolvedPath);

      if (!source.isRemoved) {
        const incoming = incomingByPath.get(resolvedPath) ?? new Set<string>();
        incoming.add(source.filePath);
        incomingByPath.set(resolvedPath, incoming);
      }
    }
  }

  return {
    outgoingByPath,
    incomingByPath,
  };
}

function mergeArchitectureContext(
  semanticChanges: SemanticChange[],
  dependencies: FileDependencyContext,
): SemanticChange[] {
  return semanticChanges.map((semanticChange) => {
    const filePath = semanticChange.after?.filePath ?? semanticChange.before?.filePath;

    if (!filePath) {
      return semanticChange;
    }

    const outgoing = new Set<string>(semanticChange.architecture?.outgoingNodeIds ?? []);
    const incoming = new Set<string>(semanticChange.architecture?.incomingNodeIds ?? []);
    const currentLayer = inferDominantLayer(filePath);

    for (const dependencyPath of dependencies.outgoingByPath.get(filePath) ?? []) {
      outgoing.add(`file:${dependencyPath}`);
      const downstreamLayer = inferDominantLayer(dependencyPath);

      if (downstreamLayer && downstreamLayer !== currentLayer) {
        outgoing.add(`layer:${downstreamLayer}`);
      }
    }

    for (const dependentPath of dependencies.incomingByPath.get(filePath) ?? []) {
      incoming.add(`file:${dependentPath}`);
      const upstreamLayer = inferDominantLayer(dependentPath);

      if (upstreamLayer && upstreamLayer !== currentLayer) {
        incoming.add(`layer:${upstreamLayer}`);
      }
    }

    const hasArchitecture = outgoing.size > 0 || incoming.size > 0;

    return {
      ...semanticChange,
      architecture: hasArchitecture
        ? {
            ...semanticChange.architecture,
            outgoingNodeIds: [...outgoing].sort(),
            incomingNodeIds: [...incoming].sort(),
          }
        : undefined,
    };
  });
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
  let semanticChanges: SemanticChange[] = [];
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

  semanticChanges = mergeArchitectureContext(
    semanticChanges,
    buildFileDependencyContext(snapshotPairs),
  );

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
