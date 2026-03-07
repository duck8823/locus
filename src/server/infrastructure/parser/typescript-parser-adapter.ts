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

type MethodScope = "instance" | "static";

interface ParsedCallable {
  symbolKey: string;
  displayName: string;
  kind: "function" | "method";
  container?: string;
  methodScope?: MethodScope;
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
  const normalizedTokens: string[] = [];

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (!isTriviaToken(token)) {
      normalizedTokens.push(scanner.getTokenText());
    }

    token = scanner.scan();
  }

  return JSON.stringify(normalizedTokens);
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

    // Heuristic: treat owner-qualified references as type/container symbols only when
    // the owner starts with an uppercase letter (e.g. UserService.updateProfile()).
    // Instance calls like userService.updateProfile() stay on the root-function fallback.
    // This is intentionally conservative until type-aware symbol resolution is added.
    if (owner && owner !== "this" && /^[A-Z]/.test(owner)) {
      keys.add(`method::${owner.replace(/\./g, "::")}::static::${methodName}`);
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

function createSymbolKey(params: {
  kind: "function" | "method";
  displayName: string;
  containerPath: string[];
  methodScope?: MethodScope;
}): string {
  if (params.kind === "method") {
    return [
      params.kind,
      toContainerLabel(params.containerPath) ?? "<root>",
      params.methodScope ?? "instance",
      params.displayName,
    ].join("::");
  }

  return [params.kind, toContainerLabel(params.containerPath) ?? "<root>", params.displayName].join("::");
}

function isCallableInitializer(
  initializer: ts.Expression | undefined,
): initializer is ts.ArrowFunction | ts.FunctionExpression {
  return !!initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
}

function resolveCallableExpression(
  expression: ts.Expression | undefined,
): ts.ArrowFunction | ts.FunctionExpression | null {
  if (!expression) {
    return null;
  }

  let current: ts.Expression = expression;

  while (true) {
    if (isCallableInitializer(current)) {
      return current;
    }

    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }

    return null;
  }
}

function hasDefaultModifier(node: { modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function resolveClassContainerName(classDeclaration: ts.ClassDeclaration): string | null {
  return readName(classDeclaration.name) ?? (hasDefaultModifier(classDeclaration) ? "default" : null);
}

function resolveFunctionDisplayName(functionDeclaration: ts.FunctionDeclaration): string | null {
  return readName(functionDeclaration.name) ?? (hasDefaultModifier(functionDeclaration) ? "default" : null);
}

function inferMethodScope(node: ts.MethodDeclaration | ts.PropertyDeclaration): MethodScope {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
    ? "static"
    : "instance";
}

function extractSignatureText(
  sourceFile: ts.SourceFile,
  signatureNode: ts.Node,
  body: ts.ConciseBody | undefined,
): string {
  if (!body) {
    // Used for declarations that have no executable body span. In those cases,
    // the whole signature node text is the best available contract surface.
    return signatureNode.getText(sourceFile);
  }

  const signatureStart = signatureNode.getStart(sourceFile);
  const bodyStart = body.getStart(sourceFile);
  return sourceFile.text.slice(signatureStart, bodyStart).trimEnd();
}

function createCallable(params: {
  sourceFile: ts.SourceFile;
  kind: "function" | "method";
  displayName: string;
  containerPath: string[];
  methodScope?: MethodScope;
  parameters: readonly ts.ParameterDeclaration[];
  signatureText: string;
  body: ts.ConciseBody | undefined;
  regionNode: ts.Node;
}): ParsedCallable {
  const signatureSummary = renderSignature(params.displayName, params.parameters);
  const bodyText = params.body ? params.body.getText(params.sourceFile) : "";
  const normalizedSignature = normalizeCode(params.signatureText);
  const normalizedBody = normalizeCode(bodyText);

  return {
    symbolKey: createSymbolKey({
      kind: params.kind,
      displayName: params.displayName,
      containerPath: params.containerPath,
      methodScope: params.methodScope,
    }),
    displayName: params.displayName,
    kind: params.kind,
    container: toContainerLabel(params.containerPath),
    methodScope: params.methodScope,
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
    const callableInitializer = resolveCallableExpression(declaration.initializer);

    if (!callableInitializer) {
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
        parameters: callableInitializer.parameters,
        signatureText: extractSignatureText(sourceFile, declaration, callableInitializer.body),
        body: callableInitializer.body,
        regionNode: declaration,
      }),
    );
  }

  return callables;
}

function collectExportAssignmentCallable(
  sourceFile: ts.SourceFile,
  statement: ts.ExportAssignment,
  containerPath: string[],
): ParsedCallable[] {
  if (statement.isExportEquals) {
    return [];
  }

  const callableExpression = resolveCallableExpression(statement.expression);

  if (!callableExpression) {
    return [];
  }

  return [
    createCallable({
      sourceFile,
      kind: "function",
      displayName: "default",
      containerPath,
      parameters: callableExpression.parameters,
      signatureText: extractSignatureText(sourceFile, callableExpression, callableExpression.body),
      body: callableExpression.body,
      regionNode: statement,
    }),
  ];
}

function collectClassMemberCallables(
  sourceFile: ts.SourceFile,
  classDeclaration: ts.ClassDeclaration,
  containerPath: string[],
): ParsedCallable[] {
  const callables: ParsedCallable[] = [];

  for (const member of classDeclaration.members) {
    if (ts.isMethodDeclaration(member)) {
      const displayName = readName(member.name);
      const methodScope = inferMethodScope(member);

      if (!displayName) {
        continue;
      }

      callables.push(
        createCallable({
          sourceFile,
          kind: "method",
          displayName,
          containerPath,
          methodScope,
          parameters: member.parameters,
          signatureText: extractSignatureText(sourceFile, member, member.body),
          body: member.body,
          regionNode: member,
        }),
      );
      continue;
    }

    if (ts.isPropertyDeclaration(member)) {
      const callableInitializer = resolveCallableExpression(member.initializer);

      if (!callableInitializer) {
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
          methodScope: inferMethodScope(member),
          parameters: callableInitializer.parameters,
          signatureText: extractSignatureText(sourceFile, member, callableInitializer.body),
          body: callableInitializer.body,
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
  if (ts.isClassDeclaration(statement)) {
    const classContainerName = resolveClassContainerName(statement);

    if (!classContainerName) {
      return [];
    }

    const classContainerPath = [...containerPath, classContainerName];
    return collectClassMemberCallables(sourceFile, statement, classContainerPath);
  }

  if (ts.isFunctionDeclaration(statement)) {
    const displayName = resolveFunctionDisplayName(statement);

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
        signatureText: extractSignatureText(sourceFile, statement, statement.body),
        body: statement.body,
        regionNode: statement,
      }),
    ];
  }

  if (ts.isVariableStatement(statement)) {
    return collectVariableCallableDeclarations(sourceFile, statement, containerPath);
  }

  if (ts.isExportAssignment(statement)) {
    return collectExportAssignmentCallable(sourceFile, statement, containerPath);
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

interface CallableMatch {
  before: ParsedCallable | null;
  after: ParsedCallable | null;
}

function groupCallablesBySymbol(callables: ParsedCallable[]): Map<string, ParsedCallable[]> {
  const grouped = new Map<string, ParsedCallable[]>();

  for (const callable of callables) {
    const group = grouped.get(callable.symbolKey) ?? [];
    group.push(callable);
    grouped.set(callable.symbolKey, group);
  }

  return grouped;
}

function consumeMatchingPair(
  beforeCallables: ParsedCallable[],
  afterCallables: ParsedCallable[],
  predicate: (before: ParsedCallable, after: ParsedCallable) => boolean,
): CallableMatch[] {
  const matches: CallableMatch[] = [];

  for (let beforeIndex = beforeCallables.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    const beforeCallable = beforeCallables[beforeIndex];
    const afterIndex = afterCallables.findIndex((afterCallable) =>
      predicate(beforeCallable, afterCallable),
    );

    if (afterIndex < 0) {
      continue;
    }

    const [matchedBefore] = beforeCallables.splice(beforeIndex, 1);
    const [matchedAfter] = afterCallables.splice(afterIndex, 1);
    matches.push({
      before: matchedBefore ?? null,
      after: matchedAfter ?? null,
    });
  }

  return matches;
}

function matchCallableGroup(
  beforeGroup: ParsedCallable[],
  afterGroup: ParsedCallable[],
): CallableMatch[] {
  const remainingBefore = [...beforeGroup];
  const remainingAfter = [...afterGroup];
  const matches: CallableMatch[] = [];

  matches.push(
    ...consumeMatchingPair(
      remainingBefore,
      remainingAfter,
      (beforeCallable, afterCallable) =>
        beforeCallable.normalizedSignature === afterCallable.normalizedSignature &&
        beforeCallable.normalizedBody === afterCallable.normalizedBody,
    ),
  );

  matches.push(
    ...consumeMatchingPair(
      remainingBefore,
      remainingAfter,
      (beforeCallable, afterCallable) =>
        beforeCallable.normalizedSignature === afterCallable.normalizedSignature,
    ),
  );

  matches.push(
    ...consumeMatchingPair(
      remainingBefore,
      remainingAfter,
      (beforeCallable, afterCallable) => beforeCallable.normalizedBody === afterCallable.normalizedBody,
    ),
  );

  remainingBefore.sort((a, b) => a.region.startLine - b.region.startLine);
  remainingAfter.sort((a, b) => a.region.startLine - b.region.startLine);

  while (remainingBefore.length > 0 && remainingAfter.length > 0) {
    matches.push({
      before: remainingBefore.shift() ?? null,
      after: remainingAfter.shift() ?? null,
    });
  }

  for (const callable of remainingBefore) {
    matches.push({
      before: callable,
      after: null,
    });
  }

  for (const callable of remainingAfter) {
    matches.push({
      before: null,
      after: callable,
    });
  }

  return matches;
}

function createInstanceDiscriminator(match: CallableMatch): string {
  const beforeRegion = match.before
    ? `${match.before.region.startLine}-${match.before.region.endLine}`
    : "na";
  const afterRegion = match.after
    ? `${match.after.region.startLine}-${match.after.region.endLine}`
    : "na";
  const beforeSignature = match.before?.normalizedSignature ?? "na";
  const afterSignature = match.after?.normalizedSignature ?? "na";

  return `${beforeRegion}|${afterRegion}|${beforeSignature}|${afterSignature}`;
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
    const beforeBySymbol = groupCallablesBySymbol(before.callables);
    const afterBySymbol = groupCallablesBySymbol(after.callables);
    const symbolKeys = Array.from(new Set([...beforeBySymbol.keys(), ...afterBySymbol.keys()])).sort((a, b) =>
      a.localeCompare(b),
    );
    const items: ParserDiffItem[] = [];

    for (const symbolKey of symbolKeys) {
      const matches = matchCallableGroup(
        beforeBySymbol.get(symbolKey) ?? [],
        afterBySymbol.get(symbolKey) ?? [],
      );

      for (const match of matches) {
        const beforeCallable = match.before;
        const afterCallable = match.after;
        const instanceDiscriminator = createInstanceDiscriminator(match);

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
            metadata: {
              instanceDiscriminator,
            },
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
            metadata: {
              instanceDiscriminator,
            },
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
          metadata: {
            instanceDiscriminator,
          },
        });
      }
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
