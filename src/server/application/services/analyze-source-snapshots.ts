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
  onProgress?: (progress: AnalyzeSourceSnapshotsProgress) => Promise<void> | void;
}

export interface AnalyzeSourceSnapshotsResult {
  semanticChanges: SemanticChange[];
  groups: SemanticChangeGroup[];
  unsupportedFiles: UnsupportedFileAnalysis[];
}

export interface AnalyzeSourceSnapshotsProgress {
  reviewId: string;
  fileId: string;
  filePath: string;
  processedCount: number;
  totalCount: number;
}

interface DiffPlan {
  adapter: ParserAdapter;
  beforeSnapshot: SourceSnapshot | null;
  afterSnapshot: SourceSnapshot | null;
}

interface SnapshotDependencySource {
  filePath: string;
  content: string;
  language: string | null;
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
  const pathSegments = filePath.split("/").filter((segment) => segment.length > 0);

  if (pathSegments.includes("app")) {
    return "presentation";
  }

  if (pathSegments.includes("domain")) {
    return "domain";
  }

  if (pathSegments.includes("infrastructure")) {
    return "infrastructure";
  }

  if (pathSegments.includes("application")) {
    return "application";
  }

  return undefined;
}

function supportsImportGraphParsing(language: string | null): boolean {
  return (
    language === "typescript" ||
    language === "javascript" ||
    language === "tsx" ||
    language === "jsx" ||
    language === "typescriptreact" ||
    language === "javascriptreact"
  );
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return typeof value === "string" && /[A-Za-z0-9_$]/.test(value);
}

function hasWordBoundary(source: string, index: number, word: string): boolean {
  if (!source.startsWith(word, index)) {
    return false;
  }

  const previous = index === 0 ? undefined : source[index - 1];
  const next = source[index + word.length];
  return previous !== "." && !isIdentifierCharacter(previous) && !isIdentifierCharacter(next);
}

function skipWhitespace(source: string, startIndex: number): number {
  let index = startIndex;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function readStringLiteral(
  source: string,
  startIndex: number,
): { value: string; nextIndex: number; hasInterpolation: boolean } | null {
  const quote = source[startIndex];

  if (quote !== "'" && quote !== '"' && quote !== "`") {
    return null;
  }

  let value = "";
  let index = startIndex + 1;
  let hasInterpolation = false;

  while (index < source.length) {
    const character = source[index];

    if (!character) {
      break;
    }

    if (character === "\\") {
      const escaped = source[index + 1];

      if (!escaped) {
        break;
      }

      value += escaped;
      index += 2;
      continue;
    }

    if (quote === "`" && character === "$" && source[index + 1] === "{") {
      hasInterpolation = true;
      index += 2;
      let braceDepth = 1;

      while (index < source.length && braceDepth > 0) {
        const nestedCharacter = source[index];

        if (!nestedCharacter) {
          break;
        }

        if (nestedCharacter === "/" && source[index + 1] === "/") {
          index = skipLineComment(source, index + 2);
          continue;
        }

        if (nestedCharacter === "/" && source[index + 1] === "*") {
          index = skipBlockComment(source, index + 2);
          continue;
        }

        if (
          nestedCharacter === "/" &&
          source[index + 1] !== "/" &&
          source[index + 1] !== "*" &&
          isLikelyRegexLiteralStart(source, index)
        ) {
          index = skipRegularExpressionLiteral(source, index);
          continue;
        }

        if (nestedCharacter === "'" || nestedCharacter === '"' || nestedCharacter === "`") {
          const nestedLiteral = readStringLiteral(source, index);
          index = nestedLiteral?.nextIndex ?? index + 1;
          continue;
        }

        if (nestedCharacter === "{") {
          braceDepth += 1;
        } else if (nestedCharacter === "}") {
          braceDepth -= 1;
        }

        index += 1;
      }

      continue;
    }

    if (character === quote) {
      return {
        value,
        nextIndex: index + 1,
        hasInterpolation,
      };
    }

    value += character;
    index += 1;
  }

  return null;
}

function skipLineComment(source: string, startIndex: number): number {
  let index = startIndex;

  while (index < source.length && source[index] !== "\n") {
    index += 1;
  }

  return index;
}

function skipBlockComment(source: string, startIndex: number): number {
  let index = startIndex;

  while (index < source.length) {
    if (source[index] === "*" && source[index + 1] === "/") {
      return index + 2;
    }

    index += 1;
  }

  return index;
}

function previousNonWhitespaceCharacter(source: string, startIndex: number): string | null {
  let index = startIndex;

  while (index >= 0) {
    const character = source[index];

    if (character && !/\s/.test(character)) {
      return character;
    }

    index -= 1;
  }

  return null;
}

function isLikelyRegexLiteralStart(source: string, slashIndex: number): boolean {
  const previousCharacter = previousNonWhitespaceCharacter(source, slashIndex - 1);

  if (previousCharacter === null) {
    return true;
  }

  return "([{=,:;!?&|+-*%^~<>".includes(previousCharacter);
}

function skipRegularExpressionLiteral(source: string, startIndex: number): number {
  let index = startIndex + 1;
  let inCharacterClass = false;

  while (index < source.length) {
    const character = source[index];

    if (!character || character === "\n") {
      return index;
    }

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === "[" && !inCharacterClass) {
      inCharacterClass = true;
      index += 1;
      continue;
    }

    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      index += 1;
      continue;
    }

    if (character === "/" && !inCharacterClass) {
      index += 1;

      while (/[A-Za-z]/.test(source[index] ?? "")) {
        index += 1;
      }

      return index;
    }

    index += 1;
  }

  return index;
}

function tryExtractRelativeSpecifier(specifier: string): string | null {
  return specifier.startsWith(".") ? specifier : null;
}

function parseImportStatement(
  source: string,
  startIndex: number,
): { specifier: string; nextIndex: number } | null {
  let index = skipWhitespace(source, startIndex + "import".length);
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;

  if (source[index] === ".") {
    return null;
  }

  if (source[index] === "(") {
    index = skipWhitespace(source, index + 1);
    const literal = readStringLiteral(source, index);

    if (!literal || literal.hasInterpolation) {
      return null;
    }

    const specifier = tryExtractRelativeSpecifier(literal.value);

    if (!specifier) {
      return null;
    }

    return {
      specifier,
      nextIndex: literal.nextIndex,
    };
  }

  const sideEffectLiteral = readStringLiteral(source, index);

  if (sideEffectLiteral && !sideEffectLiteral.hasInterpolation) {
    const specifier = tryExtractRelativeSpecifier(sideEffectLiteral.value);

    if (!specifier) {
      return null;
    }

    return {
      specifier,
      nextIndex: sideEffectLiteral.nextIndex,
    };
  }

  while (index < source.length) {
    const character = source[index];

    if (!character) {
      break;
    }

    if (character === "/" && source[index + 1] === "/") {
      index = skipLineComment(source, index + 2);
      continue;
    }

    if (character === "/" && source[index + 1] === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      const literal = readStringLiteral(source, index);
      index = literal?.nextIndex ?? index + 1;
      continue;
    }

    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      hasWordBoundary(source, index, "from")
    ) {
      const literal = readStringLiteral(source, skipWhitespace(source, index + "from".length));

      if (!literal || literal.hasInterpolation) {
        index += "from".length;
        continue;
      }

      const specifier = tryExtractRelativeSpecifier(literal.value);

      if (!specifier) {
        return null;
      }

      return {
        specifier,
        nextIndex: literal.nextIndex,
      };
    }

    if (character === "{") {
      braceDepth += 1;
    } else if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")" && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    }

    index += 1;
  }

  return null;
}

function parseExportStatement(
  source: string,
  startIndex: number,
): { specifier: string; nextIndex: number } | null {
  let index = skipWhitespace(source, startIndex + "export".length);
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let sawStatementContent = false;

  while (index < source.length) {
    const character = source[index];

    if (!character) {
      break;
    }

    if (character === "/" && source[index + 1] === "/") {
      index = skipLineComment(source, index + 2);
      continue;
    }

    if (character === "/" && source[index + 1] === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      const literal = readStringLiteral(source, index);
      index = literal?.nextIndex ?? index + 1;
      continue;
    }

    if (character === ";" && braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0) {
      return null;
    }

    if (
      character === "\n" &&
      sawStatementContent &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0
    ) {
      return null;
    }

    if (
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0 &&
      hasWordBoundary(source, index, "from")
    ) {
      const literal = readStringLiteral(source, skipWhitespace(source, index + "from".length));

      if (!literal || literal.hasInterpolation) {
        index += "from".length;
        continue;
      }

      const specifier = tryExtractRelativeSpecifier(literal.value);

      if (!specifier) {
        return null;
      }

      return {
        specifier,
        nextIndex: literal.nextIndex,
      };
    }

    if (character === "{") {
      braceDepth += 1;
    } else if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")" && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    }

    if (!/\s/.test(character)) {
      sawStatementContent = true;
    }

    index += 1;
  }

  return null;
}

function parseRequireCall(
  source: string,
  startIndex: number,
): { specifier: string; nextIndex: number } | null {
  let index = skipWhitespace(source, startIndex + "require".length);

  if (source[index] !== "(") {
    return null;
  }

  index = skipWhitespace(source, index + 1);
  const literal = readStringLiteral(source, index);

  if (!literal || literal.hasInterpolation) {
    return null;
  }

  const specifier = tryExtractRelativeSpecifier(literal.value);

  if (!specifier) {
    return null;
  }

  return {
    specifier,
    nextIndex: literal.nextIndex,
  };
}

function collectRelativeImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (!character) {
      break;
    }

    if (character === "/" && content[index + 1] === "/") {
      index = skipLineComment(content, index + 2);
      continue;
    }

    if (character === "/" && content[index + 1] === "*") {
      index = skipBlockComment(content, index + 2);
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      const literal = readStringLiteral(content, index);
      index = literal?.nextIndex ?? index + 1;
      continue;
    }

    if (hasWordBoundary(content, index, "import")) {
      const parsed = parseImportStatement(content, index);

      if (parsed) {
        specifiers.add(parsed.specifier);
        index = Math.max(parsed.nextIndex, index + 1);
        continue;
      }
    } else if (hasWordBoundary(content, index, "export")) {
      const parsed = parseExportStatement(content, index);

      if (parsed) {
        specifiers.add(parsed.specifier);
        index = Math.max(parsed.nextIndex, index + 1);
        continue;
      }
    } else if (hasWordBoundary(content, index, "require")) {
      const parsed = parseRequireCall(content, index);

      if (parsed) {
        specifiers.add(parsed.specifier);
        index = Math.max(parsed.nextIndex, index + 1);
        continue;
      }
    }

    index += 1;
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
  const extension = pathPosix.extname(resolvedBase).toLowerCase();

  if (extension.length === 0) {
    for (const ext of RESOLVABLE_SOURCE_EXTENSIONS) {
      candidates.add(`${resolvedBase}${ext}`);
      candidates.add(pathPosix.join(resolvedBase, `index${ext}`));
    }
  } else if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
    const baseWithoutExtension = resolvedBase.slice(0, -extension.length);
    candidates.add(`${baseWithoutExtension}.ts`);
    candidates.add(`${baseWithoutExtension}.tsx`);
    candidates.add(pathPosix.join(baseWithoutExtension, "index.ts"));
    candidates.add(pathPosix.join(baseWithoutExtension, "index.tsx"));
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
        language: pair.after.language,
        isRemoved: false,
      });
      continue;
    }

    if (pair.before) {
      sourcesByPath.set(pair.before.filePath, {
        filePath: pair.before.filePath,
        content: pair.before.content,
        language: pair.before.language,
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
    if (!supportsImportGraphParsing(source.language)) {
      continue;
    }

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
    const shouldKeepArchitecture = hasArchitecture || semanticChange.architecture !== undefined;

    return {
      ...semanticChange,
      architecture: shouldKeepArchitecture
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
  onProgress,
}: AnalyzeSourceSnapshotsInput): Promise<AnalyzeSourceSnapshotsResult> {
  let semanticChanges: SemanticChange[] = [];
  const unsupportedFiles: UnsupportedFileAnalysis[] = [];
  const totalCount = snapshotPairs.length;
  let processedCount = 0;

  for (const pair of snapshotPairs) {
    try {
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
    } finally {
      processedCount += 1;
      if (onProgress) {
        try {
          await onProgress({
            reviewId,
            fileId: pair.fileId,
            filePath: pair.filePath,
            processedCount,
            totalCount,
          });
        } catch {
          // Progress reporting errors must not abort semantic analysis.
        }
      }
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
