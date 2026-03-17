import { posix as pathPosix } from "node:path";
import type { SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";
import { collectRelativeImportSpecifiers } from "./import-graph-analyzer";

export interface FileDependencyContext {
  outgoingByPath: Map<string, Set<string>>;
  incomingByPath: Map<string, Set<string>>;
}

interface SnapshotDependencySource {
  filePath: string;
  content: string;
  language: string | null;
  isRemoved: boolean;
}

const RESOLVABLE_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

export function supportsImportGraphParsing(language: string | null): boolean {
  return (
    language === "typescript" ||
    language === "javascript" ||
    language === "tsx" ||
    language === "jsx" ||
    language === "typescriptreact" ||
    language === "javascriptreact"
  );
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

export function buildFileDependencyContext(snapshotPairs: SourceSnapshotPair[]): FileDependencyContext {
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
