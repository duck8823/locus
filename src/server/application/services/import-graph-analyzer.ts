/**
 * Regex-based import/export/require statement parser for JavaScript/TypeScript.
 * Extracts relative import specifiers without requiring a full AST.
 */

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

export function collectRelativeImportSpecifiers(content: string): string[] {
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
