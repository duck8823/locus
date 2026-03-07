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

function readName(name: ts.PropertyName | ts.BindingName | ts.ModuleName | undefined): string | null {
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

function normalizeMemberChain(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) {
    return expression.text;
  }

  if (expression.kind === ts.SyntaxKind.ThisKeyword) {
    return "this";
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const base = normalizeMemberChain(expression.expression);

    if (!base) {
      return null;
    }

    return `${base}.${expression.name.text}`;
  }

  return null;
}

function toReferenceSymbolKeys(expression: ts.Expression): string[] {
  if (ts.isIdentifier(expression)) {
    return [`function::<root>::${expression.text}`];
  }

  if (ts.isPropertyAccessExpression(expression)) {
    const owner = normalizeMemberChain(expression.expression);
    const methodName = expression.name.text;
    const keys = new Set<string>([`function::<root>::${methodName}`]);

    if (owner && owner !== "this") {
      keys.add(`method::${owner.replace(/\./g, "::")}::${methodName}`);
    }

    return [...keys];
  }

  return [];
}

function extractCallReferences(node: ts.Node | undefined): string[] {
  if (!node) {
    return [];
  }

  const references = new Set<string>();

  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      for (const reference of toReferenceSymbolKeys(current.expression)) {
        references.add(reference);
      }
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

function toContainerLabel(containerPath: string[]): string | undefined {
  return containerPath.length > 0 ? containerPath.join("::") : undefined;
}

function createSymbolKey(kind: "function" | "method", displayName: string, containerPath: string[]): string {
  return [kind, toContainerLabel(containerPath) ?? "<root>", displayName].join("::");
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
  containerPath: string[];
  parameters: readonly ts.ParameterDeclaration[];
  body: ts.ConciseBody | undefined;
  regionNode: ts.Node;
}): ParsedCallable {
  const signatureSummary = renderSignature(params.displayName, params.parameters);
  const bodyText = params.body ? params.body.getText(params.sourceFile) : "";
  const normalizedSignature = normalizeCode(signatureSummary);
  const normalizedBody = normalizeCode(bodyText);

  return {
    symbolKey: createSymbolKey(params.kind, params.displayName, params.containerPath),
    displayName: params.displayName,
    kind: params.kind,
    container: toContainerLabel(params.containerPath),
    signatureSummary,
    bodySummary: summarizeBody(params.body),
    normalizedSignature,
    normalizedBody,
    normalizedText: `${normalizedSignature}=>${normalizedBody}`,
    region: toRegion(params.sourceFile, params.regionNode),
    references: extractCallReferences(params.body),
  };
}

function collectVariableCallableDeclarations(
  sourceFile: ts.SourceFile,
  statement: ts.VariableStatement,
  containerPath: string[],
): ParsedCallable[] {
  const callables: ParsedCallable[] = [];

  for (const declaration of statement.declarationList.declarations) {
    if (!isCallableInitializer(declaration.initializer)) {
      continue;
    }

    const displayName = readName(declaration.name);

    if (!displayName) {
      continue;
    }

    callables.push(
      createCallable({
        sourceFile,
        kind: "function",
        displayName,
        containerPath,
        parameters: declaration.initializer.parameters,
        body: declaration.initializer.body,
        regionNode: declaration,
      }),
    );
  }

  return callables;
}

function collectClassMemberCallables(
  sourceFile: ts.SourceFile,
  classDeclaration: ts.ClassDeclaration,
  containerPath: string[],
): ParsedCallable[] {
  const callables: ParsedCallable[] = [];

  for (const member of classDeclaration.members) {
    if (ts.isMethodDeclaration(member)) {
      if (!member.body) {
        continue;
      }

      const displayName = readName(member.name);

      if (!displayName) {
        continue;
      }

      callables.push(
        createCallable({
          sourceFile,
          kind: "method",
          displayName,
          containerPath,
          parameters: member.parameters,
          body: member.body,
          regionNode: member,
        }),
      );
      continue;
    }

    if (ts.isPropertyDeclaration(member) && isCallableInitializer(member.initializer)) {
      const displayName = readName(member.name);

      if (!displayName) {
        continue;
      }

      callables.push(
        createCallable({
          sourceFile,
          kind: "method",
          displayName,
          containerPath,
          parameters: member.initializer.parameters,
          body: member.initializer.body,
          regionNode: member,
        }),
      );
    }
  }

  return callables;
}

function collectCallablesFromStatement(
  sourceFile: ts.SourceFile,
  statement: ts.Statement | ts.ModuleDeclaration,
  containerPath: string[],
): ParsedCallable[] {
  if (ts.isClassDeclaration(statement) && statement.name) {
    const classContainerPath = [...containerPath, statement.name.text];
    return collectClassMemberCallables(sourceFile, statement, classContainerPath);
  }

  if (ts.isFunctionDeclaration(statement)) {
    if (!statement.body) {
      return [];
    }

    const displayName = readName(statement.name);

    if (!displayName) {
      return [];
    }

    return [
      createCallable({
        sourceFile,
        kind: "function",
        displayName,
        containerPath,
        parameters: statement.parameters,
        body: statement.body,
        regionNode: statement,
      }),
    ];
  }

  if (ts.isVariableStatement(statement)) {
    return collectVariableCallableDeclarations(sourceFile, statement, containerPath);
  }

  if (ts.isModuleDeclaration(statement)) {
    const moduleName = readName(statement.name);
    const nextContainerPath = moduleName ? [...containerPath, moduleName] : containerPath;

    if (!statement.body) {
      return [];
    }

    if (ts.isModuleBlock(statement.body)) {
      return statement.body.statements.flatMap((nestedStatement) =>
        collectCallablesFromStatement(sourceFile, nestedStatement, nextContainerPath),
      );
    }

    if (ts.isModuleDeclaration(statement.body)) {
      return collectCallablesFromStatement(sourceFile, statement.body, nextContainerPath);
    }

    return [];
  }

  return [];
}

function collectCallables(snapshot: SourceSnapshot): ParsedCallable[] {
  const sourceFile = ts.createSourceFile(
    snapshot.filePath,
    snapshot.content,
    ts.ScriptTarget.Latest,
    true,
    toScriptKind(snapshot.filePath),
  );

  const callables = sourceFile.statements.flatMap((statement) =>
    collectCallablesFromStatement(sourceFile, statement, []),
  );

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
