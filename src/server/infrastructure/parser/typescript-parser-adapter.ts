import ts from "typescript";
import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";
import { collectCallables, type ParsedTypeScriptSnapshotRaw } from "./typescript-callable-parser";
import { assertParsedSnapshot, computeDiffItems } from "./typescript-diff-matcher";

export class TypeScriptParserAdapter implements ParserAdapter {
  readonly language = "typescript";

  readonly adapterName = "typescript-parser-adapter";

  supports(file: SourceSnapshot): boolean {
    const language = file.language?.toLowerCase();

    if (
      language === "typescript" ||
      language === "tsx" ||
      language === "javascript" ||
      language === "jsx" ||
      language === "typescriptreact" ||
      language === "javascriptreact"
    ) {
      return true;
    }

    const normalizedPath = file.filePath.toLowerCase();

    return (
      normalizedPath.endsWith(".ts") ||
      normalizedPath.endsWith(".tsx") ||
      normalizedPath.endsWith(".js") ||
      normalizedPath.endsWith(".jsx") ||
      normalizedPath.endsWith(".mjs") ||
      normalizedPath.endsWith(".cjs")
    );
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      parserVersion: ts.version,
      raw: {
        callables: collectCallables(snapshot),
      } satisfies ParsedTypeScriptSnapshotRaw,
    };
  }

  async diff(input: { before: ParsedSnapshot | null; after: ParsedSnapshot | null }): Promise<ParserDiffResult> {
    const before = assertParsedSnapshot(input.before);
    const after = assertParsedSnapshot(input.after);

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: computeDiffItems(before, after),
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
