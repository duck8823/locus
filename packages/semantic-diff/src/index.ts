import { createHash } from "node:crypto";
import { basename } from "node:path";

import { parse } from "@babel/parser";
import * as generatorModule from "@babel/generator";
import * as traverseModule from "@babel/traverse";
import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";

export type CallableKind =
  | "function"
  | "arrow-function"
  | "function-expression"
  | "class-method"
  | "class-property-function";

export type ChangeType = "added" | "removed" | "modified";

export interface CallableLocation {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface CallableDefinition {
  id: string;
  name: string;
  kind: CallableKind;
  exported: boolean;
  signatureText: string;
  bodyText: string;
  signatureHash: string;
  bodyHash: string;
  location: CallableLocation;
}

export interface SemanticChange {
  id: string;
  name: string;
  kind: CallableKind;
  changeType: ChangeType;
  signatureChanged: boolean;
  bodyChanged: boolean;
  beforeLocation?: CallableLocation;
  afterLocation?: CallableLocation;
}

const PARSER_PLUGINS: NonNullable<Parameters<typeof parse>[1]>["plugins"] = [
  "typescript",
  "jsx",
  "decorators-legacy",
];

const generate = unwrapCallableModule(
  generatorModule,
) as typeof import("@babel/generator").generate;
const traverse = unwrapCallableModule(
  traverseModule,
) as typeof import("@babel/traverse").default;

export function collectCallables(
  source: string,
  filePath = "unknown.ts",
): Map<string, CallableDefinition> {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: PARSER_PLUGINS,
  });

  const definitions = new Map<string, CallableDefinition>();

  traverse(ast, {
    FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
      if (!isTopLevelDeclaration(path)) {
        return;
      }

      const name = path.node.id?.name ?? inferDefaultName(path);
      if (!name || !path.node.body) {
        return;
      }

      const definition = buildDefinition({
        id: name,
        name,
        kind: "function",
        functionLike: path.node,
        bodyNode: path.node.body,
        filePath,
        exported: isExported(path),
      });

      definitions.set(definition.id, definition);
    },

    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      if (!isTopLevelVariable(path) || !t.isIdentifier(path.node.id)) {
        return;
      }

      const init = path.node.init;
      if (!init || (!t.isArrowFunctionExpression(init) && !t.isFunctionExpression(init))) {
        return;
      }

      const name = path.node.id.name;
      const kind: CallableKind = t.isArrowFunctionExpression(init)
        ? "arrow-function"
        : "function-expression";

      const definition = buildDefinition({
        id: name,
        name,
        kind,
        functionLike: init,
        bodyNode: init.body,
        filePath,
        exported: isExported(path),
      });

      definitions.set(definition.id, definition);
    },

    ClassDeclaration(path: NodePath<t.ClassDeclaration>) {
      if (!isTopLevelDeclaration(path)) {
        return;
      }

      const className = path.node.id?.name ?? inferDefaultName(path);
      if (!className) {
        return;
      }

      for (const member of path.node.body.body) {
        if ((t.isClassMethod(member) || t.isClassPrivateMethod(member)) && member.body) {
          const memberName = getMemberName(member.key);
          if (!memberName) {
            continue;
          }

          const id = `${className}.${memberName}`;
          definitions.set(
            id,
            buildDefinition({
              id,
              name: id,
              kind: "class-method",
              functionLike: member,
              bodyNode: member.body,
              filePath,
              exported: isExported(path),
            }),
          );
        }

        if (t.isClassProperty(member) || t.isClassPrivateProperty(member)) {
          const memberName = getMemberName(member.key);
          if (!memberName) {
            continue;
          }

          const value = member.value;
          if (!value || (!t.isArrowFunctionExpression(value) && !t.isFunctionExpression(value))) {
            continue;
          }

          const id = `${className}.${memberName}`;
          definitions.set(
            id,
            buildDefinition({
              id,
              name: id,
              kind: "class-property-function",
              functionLike: value,
              bodyNode: value.body,
              filePath,
              exported: isExported(path),
            }),
          );
        }
      }
    },
  });

  return definitions;
}

export function diffSources(
  beforeSource: string,
  afterSource: string,
  options: {
    beforePath?: string;
    afterPath?: string;
  } = {},
): SemanticChange[] {
  const beforeDefinitions = collectCallables(
    beforeSource,
    options.beforePath ?? "before.ts",
  );
  const afterDefinitions = collectCallables(
    afterSource,
    options.afterPath ?? "after.ts",
  );

  const ids = [...new Set([...beforeDefinitions.keys(), ...afterDefinitions.keys()])].sort();

  const changes: SemanticChange[] = [];

  for (const id of ids) {
    const before = beforeDefinitions.get(id);
    const after = afterDefinitions.get(id);

    if (!before && after) {
      changes.push({
        id,
        name: after.name,
        kind: after.kind,
        changeType: "added",
        signatureChanged: true,
        bodyChanged: true,
        afterLocation: after.location,
      });
      continue;
    }

    if (before && !after) {
      changes.push({
        id,
        name: before.name,
        kind: before.kind,
        changeType: "removed",
        signatureChanged: true,
        bodyChanged: true,
        beforeLocation: before.location,
      });
      continue;
    }

    if (!before || !after) {
      continue;
    }

    const signatureChanged = before.signatureHash !== after.signatureHash;
    const bodyChanged = before.bodyHash !== after.bodyHash;

    if (!signatureChanged && !bodyChanged) {
      continue;
    }

    changes.push({
      id,
      name: after.name,
      kind: after.kind,
      changeType: "modified",
      signatureChanged,
      bodyChanged,
      beforeLocation: before.location,
      afterLocation: after.location,
    });
  }

  return changes;
}

export function formatChanges(changes: SemanticChange[]): string {
  if (changes.length === 0) {
    return "No semantic changes detected.";
  }

  return [
    `Detected ${changes.length} semantic change${changes.length === 1 ? "" : "s"}.`,
    ...changes.map((change) => formatChange(change)),
  ].join("\n");
}

function formatChange(change: SemanticChange): string {
  const location = change.afterLocation ?? change.beforeLocation;
  const locationText = location
    ? `${basename(location.filePath)}:${location.startLine}`
    : "unknown";

  if (change.changeType === "added") {
    return `+ ${change.kind} ${change.name} (${locationText})`;
  }

  if (change.changeType === "removed") {
    return `- ${change.kind} ${change.name} (${locationText})`;
  }

  const details = [
    change.signatureChanged ? "signature" : undefined,
    change.bodyChanged ? "body" : undefined,
  ].filter(Boolean);

  return `~ ${change.kind} ${change.name} [${details.join(", ")}] (${locationText})`;
}

function buildDefinition(input: {
  id: string;
  name: string;
  kind: CallableKind;
  functionLike:
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression
    | t.ClassMethod
    | t.ClassPrivateMethod;
  bodyNode: t.BlockStatement | t.Expression;
  filePath: string;
  exported: boolean;
}): CallableDefinition {
  const signatureText = buildSignature(input.functionLike, input.kind);
  const bodyText = normalizeNode(input.bodyNode);

  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    exported: input.exported,
    signatureText,
    bodyText,
    signatureHash: hash(signatureText),
    bodyHash: hash(bodyText),
    location: buildLocation(input.functionLike, input.filePath),
  };
}

function buildSignature(
  node:
    | t.FunctionDeclaration
    | t.FunctionExpression
    | t.ArrowFunctionExpression
    | t.ClassMethod
    | t.ClassPrivateMethod,
  kind: CallableKind,
): string {
  const modifiers: string[] = [kind];

  if ("static" in node && node.static) {
    modifiers.push("static");
  }
  if ("kind" in node && (node.kind === "get" || node.kind === "set")) {
    modifiers.push(node.kind);
  }
  if (node.async) {
    modifiers.push("async");
  }
  if (node.generator) {
    modifiers.push("generator");
  }

  const typeParameters = "typeParameters" in node ? normalizeNode(node.typeParameters) : "";
  const params = node.params.map((param) => normalizeNode(param)).join(",");
  const returnType =
    "returnType" in node && hasWrappedTypeAnnotation(node.returnType)
      ? `:${normalizeNode(node.returnType.typeAnnotation)}`
      : "";

  return `${modifiers.join(" ")}${typeParameters}(${params})${returnType}`;
}

function buildLocation(node: t.Node, filePath: string): CallableLocation {
  return {
    filePath,
    startLine: node.loc?.start.line ?? 0,
    endLine: node.loc?.end.line ?? 0,
  };
}

function normalizeNode(node: t.Node | null | undefined): string {
  if (!node) {
    return "";
  }

  return generate(node, {
    comments: false,
    compact: true,
    minified: true,
  }).code;
}

function hasWrappedTypeAnnotation(
  node: t.Noop | t.TSTypeAnnotation | t.TypeAnnotation | null | undefined,
): node is t.TSTypeAnnotation | t.TypeAnnotation {
  return node != null && "typeAnnotation" in node;
}

function unwrapCallableModule(moduleValue: unknown): unknown {
  if (typeof moduleValue === "function") {
    return moduleValue;
  }

  if (
    typeof moduleValue === "object" &&
    moduleValue !== null &&
    "default" in moduleValue
  ) {
    const firstDefault = (moduleValue as { default: unknown }).default;
    if (typeof firstDefault === "function") {
      return firstDefault;
    }
    if (
      typeof firstDefault === "object" &&
      firstDefault !== null &&
      "default" in firstDefault
    ) {
      const secondDefault = (firstDefault as { default: unknown }).default;
      if (typeof secondDefault === "function") {
        return secondDefault;
      }
    }
  }

  throw new TypeError("Expected a callable default export.");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isTopLevelDeclaration(path: NodePath<t.Node>): boolean {
  return isProgramChild(path) || isProgramGrandchildExport(path);
}

function isTopLevelVariable(path: NodePath<t.VariableDeclarator>): boolean {
  const variableDeclaration = path.parentPath;
  if (!variableDeclaration?.isVariableDeclaration()) {
    return false;
  }

  return (
    variableDeclaration.parentPath?.isProgram() ||
    (variableDeclaration.parentPath?.isExportNamedDeclaration() &&
      variableDeclaration.parentPath.parentPath?.isProgram())
  );
}

function isProgramChild(path: NodePath<t.Node>): boolean {
  return Boolean(path.parentPath?.isProgram());
}

function isProgramGrandchildExport(path: NodePath<t.Node>): boolean {
  return Boolean(
    (path.parentPath?.isExportNamedDeclaration() || path.parentPath?.isExportDefaultDeclaration()) &&
      path.parentPath.parentPath?.isProgram(),
  );
}

function inferDefaultName(path: NodePath<t.Node>): string | undefined {
  return path.parentPath?.isExportDefaultDeclaration() ? "default" : undefined;
}

function isExported(path: NodePath<t.Node>): boolean {
  let current: NodePath<t.Node> | null = path;

  while (current && !current.isProgram()) {
    if (current.isExportNamedDeclaration() || current.isExportDefaultDeclaration()) {
      return true;
    }
    current = current.parentPath;
  }

  return false;
}

function getMemberName(key: t.Expression | t.PrivateName | t.Identifier): string | undefined {
  if (t.isIdentifier(key)) {
    return key.name;
  }

  if (t.isPrivateName(key)) {
    return `#${key.id.name}`;
  }

  if (t.isStringLiteral(key) || t.isNumericLiteral(key)) {
    return String(key.value);
  }

  return undefined;
}
