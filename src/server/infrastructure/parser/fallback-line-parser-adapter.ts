import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffItem,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type { CodeRegionRef } from "@/server/domain/value-objects/semantic-change";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

interface DetectedSymbol {
  symbolKey: string;
  displayName: string;
  kind: "function" | "method" | "class" | "unknown";
  container?: string;
  startLine: number;
  endLine: number;
  signatureText: string;
  bodyHash: string;
}

interface FallbackParsedRaw {
  symbols: DetectedSymbol[];
}

const SYMBOL_PATTERNS: Array<{
  pattern: RegExp;
  kind: "function" | "method" | "class";
  nameGroup: number;
}> = [
  // Python: def function_name(
  { pattern: /^(\s*)def\s+([A-Za-z_]\w*)\s*\(/, kind: "function", nameGroup: 2 },
  // Python: class ClassName
  { pattern: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class", nameGroup: 2 },
  // Go: func FuncName(
  { pattern: /^func\s+([A-Za-z_]\w*)\s*\(/, kind: "function", nameGroup: 1 },
  // Go: func (receiver) MethodName(
  { pattern: /^func\s+\([^)]*\)\s+([A-Za-z_]\w*)\s*\(/, kind: "method", nameGroup: 1 },
  // Go: type TypeName struct/interface
  { pattern: /^type\s+([A-Za-z_]\w*)\s+(struct|interface)/, kind: "class", nameGroup: 1 },
  // Ruby: def method_name
  { pattern: /^(\s*)def\s+([A-Za-z_]\w*[?!=]?)/, kind: "function", nameGroup: 2 },
  // Ruby: class ClassName
  { pattern: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class", nameGroup: 2 },
  // Rust: fn function_name(
  { pattern: /^(\s*)(pub\s+)?fn\s+([A-Za-z_]\w*)\s*[<(]/, kind: "function", nameGroup: 3 },
  // Rust: struct/enum/trait TypeName
  { pattern: /^(\s*)(pub\s+)?(struct|enum|trait)\s+([A-Za-z_]\w*)/, kind: "class", nameGroup: 4 },
  // Java/C#/PHP: access modifier + return type + methodName(
  { pattern: /^(\s*)(public|private|protected|static|final|abstract|override|async|virtual)\s+.*?\s+([A-Za-z_]\w*)\s*\(/, kind: "method", nameGroup: 3 },
  // Java/C#: class ClassName
  { pattern: /^(\s*)(public|private|protected|abstract|final|static)?\s*class\s+([A-Za-z_]\w*)/, kind: "class", nameGroup: 3 },
  // PHP: function functionName(
  { pattern: /^(\s*)(public|private|protected|static)?\s*function\s+([A-Za-z_]\w*)\s*\(/, kind: "function", nameGroup: 3 },
];

function simpleHash(text: string): string {
  let hash = 0;

  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + (text.charCodeAt(i) | 0)) | 0;
  }

  return hash.toString(36);
}

function detectSymbols(content: string, _filePath: string): DetectedSymbol[] {
  const lines = content.split("\n");
  const symbols: DetectedSymbol[] = [];
  let currentContainer: string | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    for (const { pattern, kind, nameGroup } of SYMBOL_PATTERNS) {
      const match = line.match(pattern);

      if (!match) {
        continue;
      }

      const displayName = match[nameGroup];

      if (!displayName) {
        continue;
      }

      if (kind === "class") {
        currentContainer = displayName;
      }

      const startLine = lineIndex + 1;
      const endLine = findBlockEnd(lines, lineIndex);
      const bodyLines = lines.slice(lineIndex, endLine);
      const bodyHash = simpleHash(bodyLines.join("\n").trim());

      const container = kind === "method" ? currentContainer : undefined;
      const prefix = kind === "method" && container ? `${container}::` : "";
      const symbolKey = `${kind}::${prefix}${displayName}`;

      symbols.push({
        symbolKey,
        displayName,
        kind,
        container,
        startLine,
        endLine,
        signatureText: line.trim(),
        bodyHash,
      });

      break;
    }
  }

  return symbols;
}

function findBlockEnd(lines: string[], startIndex: number): number {
  const startLine = lines[startIndex] ?? "";
  const startIndent = startLine.length - startLine.trimStart().length;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.length === 0) {
      continue;
    }

    const currentIndent = line.length - trimmed.length;

    if (currentIndent <= startIndent && trimmed.length > 0) {
      return i;
    }
  }

  return lines.length;
}

function matchSymbols(
  beforeSymbols: DetectedSymbol[],
  afterSymbols: DetectedSymbol[],
): ParserDiffItem[] {
  const items: ParserDiffItem[] = [];
  const beforeByKey = new Map<string, DetectedSymbol[]>();
  const afterByKey = new Map<string, DetectedSymbol[]>();

  for (const s of beforeSymbols) {
    const group = beforeByKey.get(s.symbolKey) ?? [];
    group.push(s);
    beforeByKey.set(s.symbolKey, group);
  }

  for (const s of afterSymbols) {
    const group = afterByKey.get(s.symbolKey) ?? [];
    group.push(s);
    afterByKey.set(s.symbolKey, group);
  }

  const allKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

  for (const key of [...allKeys].sort()) {
    const befores = beforeByKey.get(key) ?? [];
    const afters = afterByKey.get(key) ?? [];

    const maxLen = Math.max(befores.length, afters.length);

    for (let i = 0; i < maxLen; i += 1) {
      const before = befores[i];
      const after = afters[i];

      if (!before && after) {
        items.push(toDiffItem(null, after, "added"));
      } else if (before && !after) {
        items.push(toDiffItem(before, null, "removed"));
      } else if (before && after && before.bodyHash !== after.bodyHash) {
        items.push(toDiffItem(before, after, "modified"));
      }
    }
  }

  return items;
}

function toDiffItem(
  before: DetectedSymbol | null,
  after: DetectedSymbol | null,
  changeType: "added" | "removed" | "modified",
): ParserDiffItem {
  const symbol = after ?? before!;

  const beforeRegion: CodeRegionRef | undefined = before
    ? { filePath: "", startLine: before.startLine, endLine: before.endLine }
    : undefined;
  const afterRegion: CodeRegionRef | undefined = after
    ? { filePath: "", startLine: after.startLine, endLine: after.endLine }
    : undefined;

  const bodySummary =
    changeType === "added"
      ? "Symbol added"
      : changeType === "removed"
        ? "Symbol removed"
        : "Symbol modified";

  return {
    symbolKey: symbol.symbolKey,
    displayName: symbol.displayName,
    kind: symbol.kind,
    container: symbol.container,
    changeType,
    signatureSummary: symbol.signatureText,
    bodySummary,
    beforeRegion,
    afterRegion,
    metadata: {},
  };
}

export class FallbackLineParserAdapter implements ParserAdapter {
  readonly language = "fallback";
  readonly adapterName = "fallback-line-parser-adapter";

  supports(_file: SourceSnapshot): boolean {
    return true;
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: snapshot.language ?? this.language,
      raw: {
        symbols: detectSymbols(snapshot.content, snapshot.filePath),
      } satisfies FallbackParsedRaw,
    };
  }

  async diff(input: {
    before: ParsedSnapshot | null;
    after: ParsedSnapshot | null;
  }): Promise<ParserDiffResult> {
    const beforeRaw = (input.before?.raw as FallbackParsedRaw | undefined) ?? { symbols: [] };
    const afterRaw = (input.after?.raw as FallbackParsedRaw | undefined) ?? { symbols: [] };

    return {
      adapterName: this.adapterName,
      language: input.after?.language ?? input.before?.language ?? this.language,
      items: matchSymbols(beforeRaw.symbols, afterRaw.symbols),
    };
  }

  capabilities(): ParserCapabilities {
    return {
      callableDiff: false,
      importGraph: false,
      renameDetection: false,
      moveDetection: false,
      typeAwareSummary: false,
    };
  }
}
