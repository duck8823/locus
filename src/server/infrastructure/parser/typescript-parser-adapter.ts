import ts from "typescript";
import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffItem,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type { CodeRegionRef } from "@/server/domain/value-objects/semantic-change";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

interface ParsedTypeScriptSnapshotRaw {
  callables: ParsedCallable[];
}

interface ParsedCallable {
  symbolKey: string;
  displayName: string;
  kind: "function" | "method";
  container?: string;
  signatureSummary?: string;
  bodySummary?: string;
  normalizedSignature: string;
  normalizedBody: string;
  normalizedText: string;
  region: CodeRegionRef;
  references: string[];
}

function toScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  return ts.ScriptKind.TS;
}

function isTriviaToken(token: ts.SyntaxKind): boolean {
  return (
    token === ts.SyntaxKind.WhitespaceTrivia ||
    token === ts.SyntaxKind.NewLineTrivia ||
    token === ts.SyntaxKind.SingleLineCommentTrivia ||
    token === ts.SyntaxKind.MultiLineCommentTrivia
  );
}

function normalizeCode(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  let token = scanner.scan();
  let normalized = "";

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (!isTriviaToken(token)) {
      normalized += scanner.getTokenText();
    }

    token = scanner.scan();
  }

  return normalized;
}

function toLineNumber(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function toRegion(sourceFile: ts.SourceFile, node: ts.Node): CodeRegionRef {
  return {
    filePath: sourceFile.fileName,
    startLine: toLineNumber(sourceFile, node.getStart(sourceFile)),
    endLine: toLineNumber(sourceFile, node.getEnd()),
  };
}

function extractCallReferences(sourceFile: ts.SourceFile, node: ts.Node | undefined): string[] {
  if (!node) {
    return [];
  }

  const references = new Set<string>();

  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      references.add(current.expression.getText(sourceFile));
    }

    ts.forEachChild(current, visit);
  };

  visit(node);

  return [...references].sort((a, b) => a.localeCompare(b));
}

function renderSignature(name: string, parameters: readonly ts.ParameterDeclaration[]): string {
  const parameterNames = parameters.map((parameter) => parameter.name.getText()).join(", ");
  return `${name}(${parameterNames})`;
}

function summarizeBody(body: ts.ConciseBody | undefined): string | undefined {
  if (!body) {
    return undefined;
  }

  if (ts.isBlock(body)) {
    return `${body.statements.length} statement(s)`;
  }

  return "expression body";
}

function createSymbolKey(kind: "function" | "method", displayName: string, container?: string): string {
  return [kind, container ?? "<root>", displayName].join("::");
}

function readName(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) {
    return null;
  }

  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }

  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return name.getText();
}

function isCallableInitializer(
  initializer: ts.Expression | undefined,
): initializer is ts.ArrowFunction | ts.FunctionExpression {
  return !!initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
}

function createCallable(params: {
  sourceFile: ts.SourceFile;
  kind: "function" | "method";
  displayName: string;
  container?: string;
  parameters: readonly ts.ParameterDeclaration[];
  body: ts.ConciseBody | undefined;
  regionNode: ts.Node;
}): ParsedCallable {
  const signatureSummary = renderSignature(params.displayName, params.parameters);
  const signatureText = signatureSummary;
  const bodyText = params.body ? params.body.getText(params.sourceFile) : "";
  const normalizedSignature = normalizeCode(signatureText);
  const normalizedBody = normalizeCode(bodyText);

  return {
    symbolKey: createSymbolKey(params.kind, params.displayName, params.container),
    displayName: params.displayName,
    kind: params.kind,
    container: params.container,
    signatureSummary,
    bodySummary: summarizeBody(params.body),
    normalizedSignature,
    normalizedBody,
    normalizedText: `${normalizedSignature}=>${normalizedBody}`,
    region: toRegion(params.sourceFile, params.regionNode),
    references: extractCallReferences(params.sourceFile, params.body),
  };
}

function collectCallables(snapshot: SourceSnapshot): ParsedCallable[] {
  const sourceFile = ts.createSourceFile(
    snapshot.filePath,
    snapshot.content,
    ts.ScriptTarget.Latest,
    true,
    toScriptKind(snapshot.filePath),
  );

  const callables: ParsedCallable[] = [];

  const visit = (node: ts.Node, containers: string[]) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const nextContainers = [...containers, node.name.text];
      ts.forEachChild(node, (child) => visit(child, nextContainers));
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      const displayName = readName(node.name);

      if (displayName) {
        callables.push(
          createCallable({
            sourceFile,
            kind: "function",
            displayName,
            container: containers.at(-1),
            parameters: node.parameters,
            body: node.body,
            regionNode: node,
          }),
        );
      }
    } else if (ts.isMethodDeclaration(node)) {
      const displayName = readName(node.name);

      if (displayName) {
        callables.push(
          createCallable({
            sourceFile,
            kind: "method",
            displayName,
            container: containers.at(-1),
            parameters: node.parameters,
            body: node.body,
            regionNode: node,
          }),
        );
      }
    } else if (ts.isPropertyDeclaration(node) && isCallableInitializer(node.initializer)) {
      const displayName = readName(node.name);

      if (displayName) {
        callables.push(
          createCallable({
            sourceFile,
            kind: "method",
            displayName,
            container: containers.at(-1),
            parameters: node.initializer.parameters,
            body: node.initializer.body,
            regionNode: node,
          }),
        );
      }
    } else if (ts.isVariableDeclaration(node) && isCallableInitializer(node.initializer)) {
      const displayName = readName(node.name);

      if (displayName) {
        callables.push(
          createCallable({
            sourceFile,
            kind: "function",
            displayName,
            container: containers.at(-1),
            parameters: node.initializer.parameters,
            body: node.initializer.body,
            regionNode: node,
          }),
        );
      }
    }

    ts.forEachChild(node, (child) => visit(child, containers));
  };

  visit(sourceFile, []);

  return callables.sort((a, b) => a.symbolKey.localeCompare(b.symbolKey));
}

function assertParsedSnapshot(snapshot: ParsedSnapshot | null): ParsedTypeScriptSnapshotRaw {
  if (!snapshot) {
    return { callables: [] };
  }

  return snapshot.raw as ParsedTypeScriptSnapshotRaw;
}

function createModifiedSummary(before: ParsedCallable, after: ParsedCallable): string {
  const signatureChanged = before.normalizedSignature !== after.normalizedSignature;
  const bodyChanged = before.normalizedBody !== after.normalizedBody;

  if (signatureChanged && bodyChanged) {
    return "Signature and body changed";
  }

  if (signatureChanged) {
    return "Signature changed";
  }

  if (bodyChanged) {
    return "Body changed";
  }

  return "Callable updated";
}

export class TypeScriptParserAdapter implements ParserAdapter {
  readonly language = "typescript";

  readonly adapterName = "typescript-parser-adapter";

  supports(file: SourceSnapshot): boolean {
    const language = file.language?.toLowerCase();

    if (language === "typescript" || language === "tsx") {
      return true;
    }

    return file.filePath.endsWith(".ts") || file.filePath.endsWith(".tsx");
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
    const beforeMap = new Map(before.callables.map((callable) => [callable.symbolKey, callable]));
    const afterMap = new Map(after.callables.map((callable) => [callable.symbolKey, callable]));
    const keys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((a, b) =>
      a.localeCompare(b),
    );
    const items: ParserDiffItem[] = [];

    for (const key of keys) {
      const beforeCallable = beforeMap.get(key);
      const afterCallable = afterMap.get(key);

      if (!beforeCallable && afterCallable) {
        items.push({
          symbolKey: afterCallable.symbolKey,
          displayName: afterCallable.displayName,
          kind: afterCallable.kind,
          container: afterCallable.container,
          changeType: "added",
          signatureSummary: afterCallable.signatureSummary,
          bodySummary: "Callable added",
          references: afterCallable.references,
          afterRegion: afterCallable.region,
        });
        continue;
      }

      if (beforeCallable && !afterCallable) {
        items.push({
          symbolKey: beforeCallable.symbolKey,
          displayName: beforeCallable.displayName,
          kind: beforeCallable.kind,
          container: beforeCallable.container,
          changeType: "removed",
          signatureSummary: beforeCallable.signatureSummary,
          bodySummary: "Callable removed",
          references: beforeCallable.references,
          beforeRegion: beforeCallable.region,
        });
        continue;
      }

      if (!beforeCallable || !afterCallable) {
        continue;
      }

      if (beforeCallable.normalizedText === afterCallable.normalizedText) {
        continue;
      }

      items.push({
        symbolKey: afterCallable.symbolKey,
        displayName: afterCallable.displayName,
        kind: afterCallable.kind,
        container: afterCallable.container,
        changeType: "modified",
        signatureSummary: afterCallable.signatureSummary,
        bodySummary: createModifiedSummary(beforeCallable, afterCallable),
        references: afterCallable.references,
        beforeRegion: beforeCallable.region,
        afterRegion: afterCallable.region,
      });
    }

    return {
      adapterName: this.adapterName,
      language: this.language,
      items,
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
