import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffItem,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";

import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";
import { createParser, type TreeSitterNode } from "./tree-sitter-base";

interface GoSymbol {
  symbolKey: string;
  displayName: string;
  kind: "function" | "method" | "class";
  container?: string;
  startLine: number;
  endLine: number;
  signatureText: string;
  normalizedBody: string;
  receiver?: string;
}

interface GoParsedRaw {
  symbols: GoSymbol[];
}

function extractSymbols(rootNode: TreeSitterNode, source: string): GoSymbol[] {
  const symbols: GoSymbol[] = [];

  for (let i = 0; i < rootNode.childCount; i += 1) {
    const child = rootNode.child(i);

    if (!child) {
      continue;
    }

    if (child.type === "function_declaration") {
      const nameNode = child.childForFieldName("name");

      if (!nameNode) {
        continue;
      }

      symbols.push({
        symbolKey: `function::<root>::${nameNode.text}`,
        displayName: nameNode.text,
        kind: "function",
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        signatureText: extractSignature(child, source),
        normalizedBody: normalizeBody(child, source),
      });
    }

    if (child.type === "method_declaration") {
      const nameNode = child.childForFieldName("name");
      const receiverNode = child.childForFieldName("receiver");

      if (!nameNode) {
        continue;
      }

      const receiverType = receiverNode
        ? extractReceiverType(receiverNode)
        : undefined;
      const container = receiverType ?? "<unknown>";

      symbols.push({
        symbolKey: `method::${container}::instance::${nameNode.text}`,
        displayName: nameNode.text,
        kind: "method",
        container,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        signatureText: extractSignature(child, source),
        normalizedBody: normalizeBody(child, source),
        receiver: receiverType,
      });
    }

    if (child.type === "type_declaration") {
      for (let j = 0; j < child.childCount; j += 1) {
        const spec = child.child(j);

        if (spec?.type !== "type_spec") {
          continue;
        }

        const nameNode = spec.childForFieldName("name");
        const typeNode = spec.childForFieldName("type");

        if (!nameNode) {
          continue;
        }

        const typeKind = typeNode?.type;
        const isStructOrInterface =
          typeKind === "struct_type" || typeKind === "interface_type";

        if (!isStructOrInterface) {
          continue;
        }

        symbols.push({
          symbolKey: `class::<root>::${nameNode.text}`,
          displayName: nameNode.text,
          kind: "class",
          startLine: spec.startPosition.row + 1,
          endLine: spec.endPosition.row + 1,
          signatureText: `type ${nameNode.text} ${typeKind === "struct_type" ? "struct" : "interface"}`,
          normalizedBody: normalizeBody(spec, source),
        });
      }
    }
  }

  return symbols;
}

function extractReceiverType(receiverNode: TreeSitterNode): string | undefined {
  // Go receiver: (r *Config) or (r Config)
  const text = receiverNode.text;
  const match = text.match(/\*?([A-Za-z_]\w*)\s*\)$/);
  return match?.[1] ?? undefined;
}

function extractSignature(node: TreeSitterNode, source: string): string {
  const bodyNode = node.childForFieldName("body");

  if (bodyNode) {
    return source.slice(node.startIndex, bodyNode.startIndex).trim();
  }

  const lines = source.slice(node.startIndex).split("\n");
  return (lines[0] ?? "").trim();
}

function normalizeBody(node: TreeSitterNode, _source: string): string {
  const bodyNode = node.childForFieldName("body") ?? node.childForFieldName("type");

  if (!bodyNode) {
    return "";
  }

  return bodyNode.text
    .split("\n")
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0 && !line.startsWith("//"))
    .join(";");
}

function matchSymbols(
  beforeSymbols: GoSymbol[],
  afterSymbols: GoSymbol[],
  filePath: string,
): ParserDiffItem[] {
  const items: ParserDiffItem[] = [];
  const beforeByKey = new Map<string, GoSymbol>();
  const afterByKey = new Map<string, GoSymbol>();

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
      items.push(
        toItem(before, after, "modified", filePath, signatureChanged ? "Signature and body changed" : "Body changed"),
      );
    }
  }

  return items;
}

function toItem(
  before: GoSymbol | null,
  after: GoSymbol | null,
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
      (changeType === "added" ? "Symbol added" : changeType === "removed" ? "Symbol removed" : "Symbol modified"),
    beforeRegion: before
      ? { filePath, startLine: before.startLine, endLine: before.endLine }
      : undefined,
    afterRegion: after
      ? { filePath, startLine: after.startLine, endLine: after.endLine }
      : undefined,
    metadata: {
      receiver: symbol.receiver,
    },
  };
}

export class GoParserAdapter implements ParserAdapter {
  readonly language = "go";
  readonly adapterName = "go-parser-adapter";

  supports(file: SourceSnapshot): boolean {
    const language = file.language?.toLowerCase();

    if (language === "go") {
      return true;
    }

    return file.filePath.toLowerCase().endsWith(".go");
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    const parser = await createParser("go");
    const tree = parser.parse(snapshot.content);

    if (!tree) {
      return {
        snapshotId: snapshot.snapshotId,
        adapterName: this.adapterName,
        language: this.language,
        raw: { symbols: [] } satisfies GoParsedRaw,
      };
    }

    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      parserVersion: "tree-sitter-go",
      raw: {
        symbols: extractSymbols(tree.rootNode, snapshot.content),
      } satisfies GoParsedRaw,
    };
  }

  async diff(input: {
    before: ParsedSnapshot | null;
    after: ParsedSnapshot | null;
  }): Promise<ParserDiffResult> {
    const beforeRaw = (input.before?.raw as GoParsedRaw | undefined) ?? { symbols: [] };
    const afterRaw = (input.after?.raw as GoParsedRaw | undefined) ?? { symbols: [] };
    const filePath = input.after?.snapshotId ?? input.before?.snapshotId ?? "";

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
