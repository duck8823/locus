import { describe, expect, it } from "vitest";
import { analyzeSourceSnapshots } from "@/server/application/services/analyze-source-snapshots";
import { TypeScriptParserAdapter } from "@/server/infrastructure/parser/typescript-parser-adapter";

describe("TypeScriptParserAdapter pipeline integration", () => {
  it("analyzes mixed TS/JS/JSX snapshots without unsupported-language records", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "mixed-language-pipeline-review",
      snapshotPairs: [
        {
          fileId: "file-ts",
          filePath: "src/services/normalize-input.ts",
          before: {
            snapshotId: "mixed-language-pipeline-review:file-ts:before",
            fileId: "file-ts",
            filePath: "src/services/normalize-input.ts",
            language: "typescript",
            revision: "before",
            content: "export function normalizeInput(value: string): string { return value; }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "mixed-language-pipeline-review:file-ts:after",
            fileId: "file-ts",
            filePath: "src/services/normalize-input.ts",
            language: "typescript",
            revision: "after",
            content: "export function normalizeInput(value: string): string { return value.trim(); }",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-js",
          filePath: "src/services/run-workflow.js",
          before: {
            snapshotId: "mixed-language-pipeline-review:file-js:before",
            fileId: "file-js",
            filePath: "src/services/run-workflow.js",
            language: "javascript",
            revision: "before",
            content:
              "import { normalizeInput as normalize } from './normalize-input'; export function runWorkflow(value) { return normalize(value); }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "mixed-language-pipeline-review:file-js:after",
            fileId: "file-js",
            filePath: "src/services/run-workflow.js",
            language: "javascript",
            revision: "after",
            content:
              "import { normalizeInput as normalize } from './normalize-input'; export function runWorkflow(value) { return normalize(value.trim()); }",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-jsx",
          filePath: "src/components/header.jsx",
          before: {
            snapshotId: "mixed-language-pipeline-review:file-jsx:before",
            fileId: "file-jsx",
            filePath: "src/components/header.jsx",
            language: "jsx",
            revision: "before",
            content: "export function Header() { return <h1>Locus</h1>; }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "mixed-language-pipeline-review:file-jsx:after",
            fileId: "file-jsx",
            filePath: "src/components/header.jsx",
            language: "jsx",
            revision: "after",
            content: "export function Header() { return <h1 data-locale='ja'>Locus</h1>; }",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new TypeScriptParserAdapter()],
    });

    expect(result.unsupportedFiles).toEqual([]);
    expect(result.semanticChanges.map((change) => change.fileId).sort()).toEqual([
      "file-js",
      "file-jsx",
      "file-ts",
    ]);
  });

  it("retains alias and canonical symbol references in pipeline architecture context", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "alias-pipeline-review",
      snapshotPairs: [
        {
          fileId: "file-alias",
          filePath: "src/services/runner.ts",
          before: {
            snapshotId: "alias-pipeline-review:file-alias:before",
            fileId: "file-alias",
            filePath: "src/services/runner.ts",
            language: "typescript",
            revision: "before",
            content: `
import { validateEmail as validateInput } from "./validator";

export function run(value: string): boolean {
  return validateInput(value);
}
`.trim(),
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "alias-pipeline-review:file-alias:after",
            fileId: "file-alias",
            filePath: "src/services/runner.ts",
            language: "typescript",
            revision: "after",
            content: `
import { validateEmail as validateInput } from "./validator";

export function run(value: string): boolean {
  const normalized = value.trim();
  return validateInput(normalized);
}
`.trim(),
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new TypeScriptParserAdapter()],
    });
    const change = result.semanticChanges.find((candidate) => candidate.fileId === "file-alias");
    const outgoing = change?.architecture?.outgoingNodeIds ?? [];

    expect(change).toBeDefined();
    expect(outgoing).toEqual(
      expect.arrayContaining([
        "symbol:function::<root>::validateInput",
        "symbol:function::<root>::validateEmail",
      ]),
    );
  });
});
