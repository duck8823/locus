import path from "node:path";
import { Parser, Language, type Node } from "web-tree-sitter";

let initPromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile: (scriptName: string) => {
        return path.join(
          process.cwd(),
          "node_modules",
          "web-tree-sitter",
          scriptName,
        );
      },
    });
  }

  await initPromise;
}

function resolveWasmPath(languageName: string): string {
  return path.join(
    process.cwd(),
    "node_modules",
    `tree-sitter-${languageName}`,
    `tree-sitter-${languageName}.wasm`,
  );
}

export async function loadLanguage(languageName: string): Promise<Language> {
  await ensureInitialized();

  const cached = languageCache.get(languageName);

  if (cached) {
    return cached;
  }

  const wasmPath = resolveWasmPath(languageName);
  const language = await Language.load(wasmPath);
  languageCache.set(languageName, language);

  return language;
}

export async function createParser(languageName: string): Promise<Parser> {
  const language = await loadLanguage(languageName);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export type TreeSitterNode = Node;
