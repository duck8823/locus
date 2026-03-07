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
});
