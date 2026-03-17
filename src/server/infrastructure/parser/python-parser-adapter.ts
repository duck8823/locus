import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffItem,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type { CodeRegionRef } from "@/server/domain/value-objects/semantic-change";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";
import { createParser, type TreeSitterNode } from "./tree-sitter-base";

interface PythonSymbol {
  symbolKey: string;
  displayName: string;
  kind: "function" | "method" | "class";
  container?: string;
  startLine: number;
  endLine: number;
  signatureText: string;
  normalizedBody: string;
  decorators: string[];
}

interface PythonParsedRaw {
  symbols: PythonSymbol[];
  parserVersion: string;
}

function extractSymbolsFromNode(
  node: TreeSitterNode,
  source: string,
  filePath: string,
  containerPath: string[],
): PythonSymbol[] {
  const symbols: PythonSymbol[] = [];

  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);

    if (!child) {
      continue;
    }

    if (child.type === "decorated_definition") {
      const decorators = extractDecorators(child);
      const innerDef = findDefinitionInDecorated(child);

      if (innerDef) {
        const innerSymbols = extractSingleDefinition(
          innerDef,
          source,
          filePath,
          containerPath,
          decorators,
        );
        symbols.push(...innerSymbols);
      }

      continue;
    }

    if (child.type === "function_definition" || child.type === "class_definition") {
      symbols.push(
        ...extractSingleDefinition(child, source, filePath, containerPath, []),
      );
      continue;
    }
  }

  return symbols;
}

function extractDecorators(decoratedNode: TreeSitterNode): string[] {
  const decorators: string[] = [];

  for (let i = 0; i < decoratedNode.childCount; i += 1) {
    const child = decoratedNode.child(i);

    if (child?.type === "decorator") {
      decorators.push(child.text.trim());
    }
  }

  return decorators;
}

function findDefinitionInDecorated(
  decoratedNode: TreeSitterNode,
): TreeSitterNode | null {
  for (let i = 0; i < decoratedNode.childCount; i += 1) {
    const child = decoratedNode.child(i);

    if (
      child?.type === "function_definition" ||
      child?.type === "class_definition"
    ) {
      return child;
    }
  }

  return null;
}

function extractSingleDefinition(
  node: TreeSitterNode,
  source: string,
  filePath: string,
  containerPath: string[],
  decorators: string[],
): PythonSymbol[] {
  const symbols: PythonSymbol[] = [];
  const nameNode = node.childForFieldName("name");

  if (!nameNode) {
    return symbols;
  }

  const displayName = nameNode.text;

  if (node.type === "class_definition") {
    const classContainer = [...containerPath, displayName];
    symbols.push({
      symbolKey: `class::${classContainer.join("::")}`,
      displayName,
      kind: "class",
      container: containerPath.length > 0 ? containerPath.join("::") : undefined,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signatureText: extractSignatureLine(node, source),
      normalizedBody: normalizeBody(node, source),
      decorators,
    });

    const body = node.childForFieldName("body");

    if (body) {
      symbols.push(
        ...extractSymbolsFromNode(body, source, filePath, classContainer),
      );
    }
  } else if (node.type === "function_definition") {
    const isMethod = containerPath.length > 0;
    const kind = isMethod ? "method" : "function";
    const scope = isMethod ? "instance" : undefined;
    const prefix = containerPath.length > 0 ? `${containerPath.join("::")}::` : "<root>::";

    symbols.push({
      symbolKey: `${kind}::${prefix}${displayName}`,
      displayName,
      kind,
      container: containerPath.length > 0 ? containerPath.join("::") : undefined,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signatureText: extractSignatureLine(node, source),
      normalizedBody: normalizeBody(node, source),
      decorators,
    });
  }

  return symbols;
}

function extractSignatureLine(node: TreeSitterNode, source: string): string {
  const startOffset = node.startIndex;
  const bodyNode = node.childForFieldName("body");

  if (bodyNode) {
    const bodyOffset = bodyNode.startIndex;
    return source.slice(startOffset, bodyOffset).trim();
  }

  const lines = source.slice(startOffset).split("\n");
  return (lines[0] ?? "").trim();
}

function normalizeBody(node: TreeSitterNode, source: string): string {
  const bodyNode = node.childForFieldName("body");

  if (!bodyNode) {
    return "";
  }

  return bodyNode.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(";");
}

function matchSymbols(
  beforeSymbols: PythonSymbol[],
  afterSymbols: PythonSymbol[],
  filePath: string,
): ParserDiffItem[] {
  const items: ParserDiffItem[] = [];
  const beforeByKey = new Map<string, PythonSymbol>();
  const afterByKey = new Map<string, PythonSymbol>();

  for (const s of beforeSymbols) {
    beforeByKey.set(s.symbolKey, s);
  }

  for (const s of afterSymbols) {
    afterByKey.set(s.symbolKey, s);
  }

  const allKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);

  for (const key of [...allKeys].sort()) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);

    if (!before && after) {
      items.push(toItem(null, after, "added", filePath));
    } else if (before && !after) {
      items.push(toItem(before, null, "removed", filePath));
    } else if (before && after && before.normalizedBody !== after.normalizedBody) {
      const signatureChanged = before.signatureText !== after.signatureText;
      const bodySummary = signatureChanged
        ? "Signature and body changed"
        : "Body changed";
      items.push(toItem(before, after, "modified", filePath, bodySummary));
    }
  }

  return items;
}

function toItem(
  before: PythonSymbol | null,
  after: PythonSymbol | null,
  changeType: "added" | "removed" | "modified",
  filePath: string,
  bodySummary?: string,
): ParserDiffItem {
  const symbol = after ?? before!;

  return {
    symbolKey: symbol.symbolKey,
    displayName: symbol.displayName,
    kind: symbol.kind,
    container: symbol.container,
    changeType,
    signatureSummary: symbol.signatureText,
    bodySummary:
      bodySummary ??
      (changeType === "added"
        ? "Symbol added"
        : changeType === "removed"
          ? "Symbol removed"
          : "Symbol modified"),
    beforeRegion: before
      ? { filePath, startLine: before.startLine, endLine: before.endLine }
      : undefined,
    afterRegion: after
      ? { filePath, startLine: after.startLine, endLine: after.endLine }
      : undefined,
    metadata: {
      decorators: symbol.decorators,
    },
  };
}

export class PythonParserAdapter implements ParserAdapter {
  readonly language = "python";
  readonly adapterName = "python-parser-adapter";

  supports(file: SourceSnapshot): boolean {
    const language = file.language?.toLowerCase();

    if (language === "python") {
      return true;
    }

    return file.filePath.toLowerCase().endsWith(".py");
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    const parser = await createParser("python");
    const tree = parser.parse(snapshot.content);

    if (!tree) {
      return {
        snapshotId: snapshot.snapshotId,
        adapterName: this.adapterName,
        language: this.language,
        raw: { symbols: [], parserVersion: "tree-sitter-python" } satisfies PythonParsedRaw,
      };
    }

    const symbols = extractSymbolsFromNode(
      tree.rootNode,
      snapshot.content,
      snapshot.filePath,
      [],
    );

    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      parserVersion: "tree-sitter-python",
      raw: {
        symbols,
        parserVersion: "tree-sitter-python",
      } satisfies PythonParsedRaw,
    };
  }

  async diff(input: {
    before: ParsedSnapshot | null;
    after: ParsedSnapshot | null;
  }): Promise<ParserDiffResult> {
    const beforeRaw = (input.before?.raw as PythonParsedRaw | undefined) ?? {
      symbols: [],
      parserVersion: "",
    };
    const afterRaw = (input.after?.raw as PythonParsedRaw | undefined) ?? {
      symbols: [],
      parserVersion: "",
    };

    const filePath =
      input.after?.snapshotId ?? input.before?.snapshotId ?? "";

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: matchSymbols(beforeRaw.symbols, afterRaw.symbols, filePath),
    };
  }

  capabilities(): ParserCapabilities {
    return {
      callableDiff: true,
      importGraph: false,
      renameDetection: false,
      moveDetection: false,
      typeAwareSummary: false,
    };
  }
}
