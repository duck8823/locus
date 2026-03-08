import { describe, expect, it } from "vitest";
import { analyzeSourceSnapshots } from "@/server/application/services/analyze-source-snapshots";
import { createSeedSourceSnapshotPairs } from "@/server/application/services/seed-source-snapshot-fixture";
import { DeterministicSeedParserAdapter } from "@/server/application/testing/deterministic-seed-parser-adapter";
import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

class FailingParserAdapter implements ParserAdapter {
  readonly language = "typescript";
  readonly adapterName = "failing-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "typescript";
  }

  async parse(): Promise<ParsedSnapshot> {
    throw new Error("intentional parser failure");
  }

  async diff(): Promise<ParserDiffResult> {
    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [],
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

class TransitionAwareParserAdapter implements ParserAdapter {
  readonly language = "typescript";
  readonly adapterName = "transition-aware-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "typescript";
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      raw: snapshot,
    };
  }

  async diff(input: { before: ParsedSnapshot | null; after: ParsedSnapshot | null }): Promise<ParserDiffResult> {
    const beforeSnapshot = input.before?.raw as SourceSnapshot | undefined;
    const afterSnapshot = input.after?.raw as SourceSnapshot | undefined;

    if (beforeSnapshot && !afterSnapshot) {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [
          {
            symbolKey: "function::<root>::migratedCallable",
            displayName: "migratedCallable",
            kind: "function",
            changeType: "removed",
            beforeRegion: {
              filePath: beforeSnapshot.filePath,
              startLine: 1,
              endLine: 3,
            },
          },
        ],
      };
    }

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [],
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

class PythonTransitionAdapter implements ParserAdapter {
  readonly language = "python";
  readonly adapterName = "python-transition-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "python";
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      raw: snapshot,
    };
  }

  async diff(input: { before: ParsedSnapshot | null; after: ParsedSnapshot | null }): Promise<ParserDiffResult> {
    const beforeSnapshot = input.before?.raw as SourceSnapshot | undefined;
    const afterSnapshot = input.after?.raw as SourceSnapshot | undefined;

    if (!beforeSnapshot && afterSnapshot) {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [
          {
            symbolKey: "function::<root>::pythonCallable",
            displayName: "pythonCallable",
            kind: "function",
            changeType: "added",
            afterRegion: {
              filePath: afterSnapshot.filePath,
              startLine: 1,
              endLine: 3,
            },
          },
        ],
      };
    }

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [],
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

class FailingPythonTransitionAdapter implements ParserAdapter {
  readonly language = "python";
  readonly adapterName = "failing-python-transition-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "python";
  }

  async parse(): Promise<ParsedSnapshot> {
    throw new Error("python parse failed");
  }

  async diff(): Promise<ParserDiffResult> {
    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [],
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

class OverloadDiscriminatorAdapter implements ParserAdapter {
  readonly language = "typescript";
  readonly adapterName = "overload-discriminator-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "typescript";
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      raw: snapshot,
    };
  }

  async diff(input: { before: ParsedSnapshot | null; after: ParsedSnapshot | null }): Promise<ParserDiffResult> {
    const beforeSnapshot = input.before?.raw as SourceSnapshot | undefined;
    const afterSnapshot = input.after?.raw as SourceSnapshot | undefined;
    const filePath = afterSnapshot?.filePath ?? beforeSnapshot?.filePath ?? "src/overload.ts";

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [
        {
          symbolKey: "function::<root>::parse",
          displayName: "parse",
          kind: "function",
          changeType: "modified",
          signatureSummary: "parse(value)",
          bodySummary: "Signature changed",
          beforeRegion: {
            filePath,
            startLine: 1,
            endLine: 1,
          },
          afterRegion: {
            filePath,
            startLine: 1,
            endLine: 1,
          },
          metadata: {
            instanceDiscriminator: "overload:1",
          },
        },
        {
          symbolKey: "function::<root>::parse",
          displayName: "parse",
          kind: "function",
          changeType: "modified",
          signatureSummary: "parse(value)",
          bodySummary: "Signature changed",
          beforeRegion: {
            filePath,
            startLine: 2,
            endLine: 2,
          },
          afterRegion: {
            filePath,
            startLine: 2,
            endLine: 2,
          },
          metadata: {
            instanceDiscriminator: "overload:2",
          },
        },
      ],
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

class BasicArchitectureParserAdapter implements ParserAdapter {
  readonly language = "typescript";
  readonly adapterName = "basic-architecture-adapter";

  supports(file: SourceSnapshot): boolean {
    return file.language === "typescript";
  }

  async parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot> {
    return {
      snapshotId: snapshot.snapshotId,
      adapterName: this.adapterName,
      language: this.language,
      raw: snapshot,
    };
  }

  async diff(input: { before: ParsedSnapshot | null; after: ParsedSnapshot | null }): Promise<ParserDiffResult> {
    const beforeSnapshot = input.before?.raw as SourceSnapshot | undefined;
    const afterSnapshot = input.after?.raw as SourceSnapshot | undefined;
    const filePath = afterSnapshot?.filePath ?? beforeSnapshot?.filePath ?? "src/unknown.ts";

    if (!beforeSnapshot && afterSnapshot) {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [
          {
            symbolKey: `function::<root>::added::${filePath}`,
            displayName: "addedSymbol",
            kind: "function",
            changeType: "added",
            afterRegion: {
              filePath,
              startLine: 1,
              endLine: 1,
            },
          },
        ],
      };
    }

    if (beforeSnapshot && !afterSnapshot) {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [
          {
            symbolKey: `function::<root>::removed::${filePath}`,
            displayName: "removedSymbol",
            kind: "function",
            changeType: "removed",
            beforeRegion: {
              filePath,
              startLine: 1,
              endLine: 1,
            },
          },
        ],
      };
    }

    if (!beforeSnapshot || !afterSnapshot || beforeSnapshot.content === afterSnapshot.content) {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [],
      };
    }

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [
        {
          symbolKey: `function::<root>::modified::${filePath}`,
          displayName: "modifiedSymbol",
          kind: "function",
          changeType: "modified",
          beforeRegion: {
            filePath,
            startLine: 1,
            endLine: 1,
          },
          afterRegion: {
            filePath,
            startLine: 1,
            endLine: 1,
          },
        },
      ],
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

describe("analyzeSourceSnapshots", () => {
  it("creates semantic changes, groups, and unsupported file records", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "demo-review",
      snapshotPairs: createSeedSourceSnapshotPairs("demo-review"),
      parserAdapters: [new DeterministicSeedParserAdapter()],
    });

    expect(result.semanticChanges).toHaveLength(3);
    expect(result.groups.map((group) => group.fileIds[0])).toEqual([
      "file-email-validator",
      "file-user-service",
    ]);
    expect(result.unsupportedFiles).toEqual([
      {
        detail: undefined,
        fileId: "file-rules-md",
        filePath: "docs/review-rules.md",
        language: "markdown",
        reason: "unsupported_language",
        reviewId: "demo-review",
      },
    ]);

    const userServiceChange = result.semanticChanges.find(
      (change) => change.fileId === "file-user-service",
    );
    expect(userServiceChange?.architecture?.outgoingNodeIds).toContain(
      "symbol:function::<root>::formatPhone",
    );
  });

  it("records parser failures as unsupported files", async () => {
    const snapshotPairs = createSeedSourceSnapshotPairs("demo-review").filter(
      (pair) => pair.fileId === "file-user-service",
    );

    const result = await analyzeSourceSnapshots({
      reviewId: "demo-review",
      snapshotPairs,
      parserAdapters: [new FailingParserAdapter()],
    });

    expect(result.semanticChanges).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.unsupportedFiles).toEqual([
      {
        detail: "intentional parser failure",
        fileId: "file-user-service",
        filePath: "src/core/user-service.ts",
        language: "typescript",
        reason: "parser_failed",
        reviewId: "demo-review",
      },
    ]);
  });

  it("attributes parser_failed metadata to the snapshot that actually failed", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "failing-before-review",
      snapshotPairs: [
        {
          fileId: "file-failing-before",
          filePath: "src/migration-target",
          before: {
            snapshotId: "failing-before-review:file-failing-before:before",
            fileId: "file-failing-before",
            filePath: "src/legacy-service.ts",
            language: "typescript",
            revision: "before",
            content: "export function legacy() { return 1; }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "failing-before-review:file-failing-before:after",
            fileId: "file-failing-before",
            filePath: "docs/legacy-service.md",
            language: "markdown",
            revision: "after",
            content: "# migrated",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new FailingParserAdapter()],
    });

    expect(result.semanticChanges).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.unsupportedFiles).toEqual([
      {
        detail: "intentional parser failure",
        fileId: "file-failing-before",
        filePath: "src/legacy-service.ts",
        language: "typescript",
        reason: "parser_failed",
        reviewId: "failing-before-review",
      },
    ]);
  });

  it("keeps removals when a file transitions from supported to unsupported language", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "migration-review",
      snapshotPairs: [
        {
          fileId: "file-language-migration",
          filePath: "src/migrated-file.ts",
          before: {
            snapshotId: "migration-review:file-language-migration:before",
            fileId: "file-language-migration",
            filePath: "src/migrated-file.ts",
            language: "typescript",
            revision: "before",
            content: "export function migratedCallable() { return 1; }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "migration-review:file-language-migration:after",
            fileId: "file-language-migration",
            filePath: "docs/migrated-file.md",
            language: "markdown",
            revision: "after",
            content: "# migrated",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new TransitionAwareParserAdapter()],
    });

    expect(result.semanticChanges).toHaveLength(1);
    expect(result.semanticChanges[0]?.change.type).toBe("removed");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.fileIds).toEqual(["file-language-migration"]);
    expect(result.unsupportedFiles).toEqual([]);
  });

  it("combines before/after diffs when each revision uses a different supported adapter", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "cross-language-review",
      snapshotPairs: [
        {
          fileId: "file-cross-language",
          filePath: "src/cross-language",
          before: {
            snapshotId: "cross-language-review:file-cross-language:before",
            fileId: "file-cross-language",
            filePath: "src/cross-language.ts",
            language: "typescript",
            revision: "before",
            content: "export function migratedCallable() { return 1; }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "cross-language-review:file-cross-language:after",
            fileId: "file-cross-language",
            filePath: "src/cross-language.py",
            language: "python",
            revision: "after",
            content: "def python_callable():\n    return 2\n",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new TransitionAwareParserAdapter(), new PythonTransitionAdapter()],
    });

    expect(result.semanticChanges.map((change) => change.change.type).sort()).toEqual([
      "added",
      "removed",
    ]);
    expect(result.semanticChanges.map((change) => change.adapterName).sort()).toEqual([
      "python-transition-adapter",
      "transition-aware-adapter",
    ]);
    expect(result.unsupportedFiles).toEqual([]);
    expect(result.groups).toHaveLength(1);
  });

  it("drops buffered semantic changes when a later diff plan fails", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "cross-language-failure-review",
      snapshotPairs: [
        {
          fileId: "file-cross-language-failure",
          filePath: "src/cross-language-failure",
          before: {
            snapshotId: "cross-language-failure-review:file-cross-language-failure:before",
            fileId: "file-cross-language-failure",
            filePath: "src/cross-language-failure.ts",
            language: "typescript",
            revision: "before",
            content: "export function migratedCallable() { return 1; }",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "cross-language-failure-review:file-cross-language-failure:after",
            fileId: "file-cross-language-failure",
            filePath: "src/cross-language-failure.py",
            language: "python",
            revision: "after",
            content: "def python_callable():\n    return 2\n",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new TransitionAwareParserAdapter(), new FailingPythonTransitionAdapter()],
    });

    expect(result.semanticChanges).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.unsupportedFiles).toEqual([
      {
        detail: "python parse failed",
        fileId: "file-cross-language-failure",
        filePath: "src/cross-language-failure.py",
        language: "python",
        reason: "parser_failed",
        reviewId: "cross-language-failure-review",
      },
    ]);
  });

  it("generates unique semanticChangeId values for overload-like diff items", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "overload-review",
      snapshotPairs: [
        {
          fileId: "file-overload",
          filePath: "types/parse.d.ts",
          before: {
            snapshotId: "overload-review:file-overload:before",
            fileId: "file-overload",
            filePath: "types/parse.d.ts",
            language: "typescript",
            revision: "before",
            content: "export declare function parse(value: string): string;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "overload-review:file-overload:after",
            fileId: "file-overload",
            filePath: "types/parse.d.ts",
            language: "typescript",
            revision: "after",
            content: "export declare function parse(value: string): string;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new OverloadDiscriminatorAdapter()],
    });

    expect(result.semanticChanges).toHaveLength(2);
    const semanticChangeIds = result.semanticChanges.map((change) => change.semanticChangeId);
    expect(new Set(semanticChangeIds).size).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(new Set(result.groups[0]?.semanticChangeIds ?? []).size).toBe(2);
  });

  it("attaches immediate file/layer neighbors from relative imports", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "architecture-review",
      snapshotPairs: [
        {
          fileId: "file-controller",
          filePath: "src/application/user-controller.ts",
          before: {
            snapshotId: "architecture-review:file-controller:before",
            fileId: "file-controller",
            filePath: "src/application/user-controller.ts",
            language: "typescript",
            revision: "before",
            content: "import { createUser } from '../domain/user-service';\nexport const run = () => createUser();",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "architecture-review:file-controller:after",
            fileId: "file-controller",
            filePath: "src/application/user-controller.ts",
            language: "typescript",
            revision: "after",
            content:
              "import { createUser } from '../domain/user-service';\nexport const run = () => createUser('active');",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-service",
          filePath: "src/domain/user-service.ts",
          before: {
            snapshotId: "architecture-review:file-service:before",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "before",
            content: "import { insertUser } from '../infrastructure/user-repository';\nexport const createUser = () => insertUser();",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "architecture-review:file-service:after",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "after",
            content:
              "import { insertUser } from '../infrastructure/user-repository';\nexport const createUser = (status:string) => insertUser(status);",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-repository",
          filePath: "src/infrastructure/user-repository.ts",
          before: {
            snapshotId: "architecture-review:file-repository:before",
            fileId: "file-repository",
            filePath: "src/infrastructure/user-repository.ts",
            language: "typescript",
            revision: "before",
            content: "export const insertUser = () => true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "architecture-review:file-repository:after",
            fileId: "file-repository",
            filePath: "src/infrastructure/user-repository.ts",
            language: "typescript",
            revision: "after",
            content: "export const insertUser = (_status:string) => true;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const byFileId = new Map(result.semanticChanges.map((change) => [change.fileId, change]));

    expect(byFileId.get("file-controller")?.architecture?.outgoingNodeIds).toEqual(
      expect.arrayContaining(["file:src/domain/user-service.ts", "layer:domain"]),
    );
    expect(byFileId.get("file-service")?.architecture?.incomingNodeIds).toEqual(
      expect.arrayContaining(["file:src/application/user-controller.ts", "layer:application"]),
    );
    expect(byFileId.get("file-service")?.architecture?.outgoingNodeIds).toEqual(
      expect.arrayContaining(["file:src/infrastructure/user-repository.ts", "layer:infrastructure"]),
    );
    expect(byFileId.get("file-repository")?.architecture?.incomingNodeIds).toEqual(
      expect.arrayContaining(["file:src/domain/user-service.ts", "layer:domain"]),
    );
    expect(byFileId.get("file-controller")?.architecture?.incomingNodeIds ?? []).toEqual([]);
    expect(byFileId.get("file-repository")?.architecture?.outgoingNodeIds ?? []).toEqual([]);
  });

  it("does not attach removed-file dependents as incoming neighbors", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "removed-dependent-review",
      snapshotPairs: [
        {
          fileId: "file-consumer",
          filePath: "src/application/consumer.ts",
          before: {
            snapshotId: "removed-dependent-review:file-consumer:before",
            fileId: "file-consumer",
            filePath: "src/application/consumer.ts",
            language: "typescript",
            revision: "before",
            content:
              "import { createUser } from '../domain/user-service';\nexport const run = () => createUser();",
            metadata: { codeHost: "github" },
          },
          after: null,
        },
        {
          fileId: "file-service",
          filePath: "src/domain/user-service.ts",
          before: {
            snapshotId: "removed-dependent-review:file-service:before",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "before",
            content: "export const createUser = () => 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "removed-dependent-review:file-service:after",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "after",
            content: "export const createUser = () => 2;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const serviceChange = result.semanticChanges.find((change) => change.fileId === "file-service");
    expect(serviceChange?.architecture?.incomingNodeIds ?? []).not.toContain(
      "file:src/application/consumer.ts",
    );
  });

  it("ignores import-like text in comments and string literals", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "import-sanitization-review",
      snapshotPairs: [
        {
          fileId: "file-main",
          filePath: "src/application/main.ts",
          before: {
            snapshotId: "import-sanitization-review:file-main:before",
            fileId: "file-main",
            filePath: "src/application/main.ts",
            language: "typescript",
            revision: "before",
            content: "export const run = () => true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "import-sanitization-review:file-main:after",
            fileId: "file-main",
            filePath: "src/application/main.ts",
            language: "typescript",
            revision: "after",
            content: `
// import { fakeOne } from '../domain/fake-one';
const message = "import { fakeTwo } from '../domain/fake-two'";
const dep = require('../domain/real-dep');
export const run = async () => import('../domain/real-dynamic');
`.trim(),
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-real-dep",
          filePath: "src/domain/real-dep.ts",
          before: {
            snapshotId: "import-sanitization-review:file-real-dep:before",
            fileId: "file-real-dep",
            filePath: "src/domain/real-dep.ts",
            language: "typescript",
            revision: "before",
            content: "export const value = 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "import-sanitization-review:file-real-dep:after",
            fileId: "file-real-dep",
            filePath: "src/domain/real-dep.ts",
            language: "typescript",
            revision: "after",
            content: "export const value = 1;",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-real-dynamic",
          filePath: "src/domain/real-dynamic.ts",
          before: {
            snapshotId: "import-sanitization-review:file-real-dynamic:before",
            fileId: "file-real-dynamic",
            filePath: "src/domain/real-dynamic.ts",
            language: "typescript",
            revision: "before",
            content: "export const dynamicValue = 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "import-sanitization-review:file-real-dynamic:after",
            fileId: "file-real-dynamic",
            filePath: "src/domain/real-dynamic.ts",
            language: "typescript",
            revision: "after",
            content: "export const dynamicValue = 1;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const mainChange = result.semanticChanges.find((change) => change.fileId === "file-main");
    const outgoing = mainChange?.architecture?.outgoingNodeIds ?? [];

    expect(outgoing).toEqual(
      expect.arrayContaining([
        "file:src/domain/real-dep.ts",
        "file:src/domain/real-dynamic.ts",
      ]),
    );
    expect(outgoing).not.toEqual(
      expect.arrayContaining([
        "file:src/domain/fake-one.ts",
        "file:src/domain/fake-two.ts",
      ]),
    );
  });

  it("resolves .js import specifiers to TypeScript file paths", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "esm-resolution-review",
      snapshotPairs: [
        {
          fileId: "file-main",
          filePath: "src/application/main.ts",
          before: {
            snapshotId: "esm-resolution-review:file-main:before",
            fileId: "file-main",
            filePath: "src/application/main.ts",
            language: "typescript",
            revision: "before",
            content: "export const run = () => true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "esm-resolution-review:file-main:after",
            fileId: "file-main",
            filePath: "src/application/main.ts",
            language: "typescript",
            revision: "after",
            content: "import { service } from '../domain/user-service.js';\nexport const run = () => service();",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-service",
          filePath: "src/domain/user-service.ts",
          before: {
            snapshotId: "esm-resolution-review:file-service:before",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "before",
            content: "export const service = () => 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "esm-resolution-review:file-service:after",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "after",
            content: "export const service = () => 1;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const mainChange = result.semanticChanges.find((change) => change.fileId === "file-main");
    expect(mainChange?.architecture?.outgoingNodeIds ?? []).toContain(
      "file:src/domain/user-service.ts",
    );
  });

  it("keeps outgoing architecture context for removed files", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "removed-file-outgoing-review",
      snapshotPairs: [
        {
          fileId: "file-removed-consumer",
          filePath: "src/application/removed-consumer.ts",
          before: {
            snapshotId: "removed-file-outgoing-review:file-removed-consumer:before",
            fileId: "file-removed-consumer",
            filePath: "src/application/removed-consumer.ts",
            language: "typescript",
            revision: "before",
            content:
              "import { createUser } from '../domain/user-service';\nexport const run = () => createUser();",
            metadata: { codeHost: "github" },
          },
          after: null,
        },
        {
          fileId: "file-service",
          filePath: "src/domain/user-service.ts",
          before: {
            snapshotId: "removed-file-outgoing-review:file-service:before",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "before",
            content: "export const createUser = () => 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "removed-file-outgoing-review:file-service:after",
            fileId: "file-service",
            filePath: "src/domain/user-service.ts",
            language: "typescript",
            revision: "after",
            content: "export const createUser = () => 2;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const removedChange = result.semanticChanges.find(
      (change) => change.fileId === "file-removed-consumer",
    );
    expect(removedChange?.architecture?.outgoingNodeIds ?? []).toEqual(
      expect.arrayContaining(["file:src/domain/user-service.ts", "layer:domain"]),
    );
    expect(removedChange?.architecture?.incomingNodeIds ?? []).toEqual([]);
  });

  it("does not add layer hints when import stays within the same layer", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "same-layer-review",
      snapshotPairs: [
        {
          fileId: "file-a",
          filePath: "src/domain/a.ts",
          before: {
            snapshotId: "same-layer-review:file-a:before",
            fileId: "file-a",
            filePath: "src/domain/a.ts",
            language: "typescript",
            revision: "before",
            content: "export const a = () => true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "same-layer-review:file-a:after",
            fileId: "file-a",
            filePath: "src/domain/a.ts",
            language: "typescript",
            revision: "after",
            content: "import { b } from './b';\nexport const a = () => b();",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-b",
          filePath: "src/domain/b.ts",
          before: {
            snapshotId: "same-layer-review:file-b:before",
            fileId: "file-b",
            filePath: "src/domain/b.ts",
            language: "typescript",
            revision: "before",
            content: "export const b = () => true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "same-layer-review:file-b:after",
            fileId: "file-b",
            filePath: "src/domain/b.ts",
            language: "typescript",
            revision: "after",
            content: "export const b = () => true;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const change = result.semanticChanges.find((semanticChange) => semanticChange.fileId === "file-a");
    const outgoing = change?.architecture?.outgoingNodeIds ?? [];
    expect(outgoing).toContain("file:src/domain/b.ts");
    expect(outgoing).not.toContain("layer:domain");
  });

  it("parses imports that contain a symbol literally named from", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "from-symbol-review",
      snapshotPairs: [
        {
          fileId: "file-main",
          filePath: "src/application/main.ts",
          before: {
            snapshotId: "from-symbol-review:file-main:before",
            fileId: "file-main",
            filePath: "src/application/main.ts",
            language: "typescript",
            revision: "before",
            content: "export const run = () => true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "from-symbol-review:file-main:after",
            fileId: "file-main",
            filePath: "src/application/main.ts",
            language: "typescript",
            revision: "after",
            content: "import { from } from '../domain/keyword-target';\nexport const run = () => from();",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-target",
          filePath: "src/domain/keyword-target.ts",
          before: {
            snapshotId: "from-symbol-review:file-target:before",
            fileId: "file-target",
            filePath: "src/domain/keyword-target.ts",
            language: "typescript",
            revision: "before",
            content: "export const from = () => 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "from-symbol-review:file-target:after",
            fileId: "file-target",
            filePath: "src/domain/keyword-target.ts",
            language: "typescript",
            revision: "after",
            content: "export const from = () => 1;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const mainChange = result.semanticChanges.find((change) => change.fileId === "file-main");
    expect(mainChange?.architecture?.outgoingNodeIds ?? []).toContain(
      "file:src/domain/keyword-target.ts",
    );
  });

  it("parses re-export statements for architecture context", async () => {
    const result = await analyzeSourceSnapshots({
      reviewId: "re-export-review",
      snapshotPairs: [
        {
          fileId: "file-barrel",
          filePath: "src/application/barrel.ts",
          before: {
            snapshotId: "re-export-review:file-barrel:before",
            fileId: "file-barrel",
            filePath: "src/application/barrel.ts",
            language: "typescript",
            revision: "before",
            content: "export const noop = true;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "re-export-review:file-barrel:after",
            fileId: "file-barrel",
            filePath: "src/application/barrel.ts",
            language: "typescript",
            revision: "after",
            content: "export { helper } from '../domain/helper';\nexport * from '../domain/shared';",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-helper",
          filePath: "src/domain/helper.ts",
          before: {
            snapshotId: "re-export-review:file-helper:before",
            fileId: "file-helper",
            filePath: "src/domain/helper.ts",
            language: "typescript",
            revision: "before",
            content: "export const helper = () => 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "re-export-review:file-helper:after",
            fileId: "file-helper",
            filePath: "src/domain/helper.ts",
            language: "typescript",
            revision: "after",
            content: "export const helper = () => 1;",
            metadata: { codeHost: "github" },
          },
        },
        {
          fileId: "file-shared",
          filePath: "src/domain/shared.ts",
          before: {
            snapshotId: "re-export-review:file-shared:before",
            fileId: "file-shared",
            filePath: "src/domain/shared.ts",
            language: "typescript",
            revision: "before",
            content: "export const shared = () => 1;",
            metadata: { codeHost: "github" },
          },
          after: {
            snapshotId: "re-export-review:file-shared:after",
            fileId: "file-shared",
            filePath: "src/domain/shared.ts",
            language: "typescript",
            revision: "after",
            content: "export const shared = () => 1;",
            metadata: { codeHost: "github" },
          },
        },
      ],
      parserAdapters: [new BasicArchitectureParserAdapter()],
    });

    const barrelChange = result.semanticChanges.find((change) => change.fileId === "file-barrel");
    expect(barrelChange?.architecture?.outgoingNodeIds ?? []).toEqual(
      expect.arrayContaining([
        "file:src/domain/helper.ts",
        "file:src/domain/shared.ts",
      ]),
    );
  });
});
