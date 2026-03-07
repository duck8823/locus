import { describe, expect, it } from "vitest";
import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import { createSeedReviewSession } from "@/server/application/services/review-session-seed";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

class TestParserAdapter implements ParserAdapter {
  readonly language = "typescript";
  readonly adapterName = "seed-test-adapter";

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
    const snapshot = (input.after?.raw as SourceSnapshot | undefined) ?? (input.before?.raw as SourceSnapshot);

    return {
      adapterName: this.adapterName,
      language: this.language,
      items: [
        {
          symbolKey: `function::<root>::${snapshot.fileId}`,
          displayName: snapshot.fileId,
          kind: "function",
          changeType: "modified",
          beforeRegion: {
            filePath: snapshot.filePath,
            startLine: 1,
            endLine: 1,
          },
          afterRegion: {
            filePath: snapshot.filePath,
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

describe("createSeedReviewSession", () => {
  it("builds semantic groups from fixture snapshots", async () => {
    const session = await createSeedReviewSession({
      reviewId: "demo-review",
      viewerName: "Demo reviewer",
      createdAt: "2026-03-08T00:00:00.000Z",
      parserAdapters: [new TestParserAdapter()],
    });

    const record = session.toRecord();

    expect(record.groups.length).toBeGreaterThan(0);
    expect(record.semanticChanges?.length).toBeGreaterThan(0);
    expect(record.unsupportedFileAnalyses).toHaveLength(1);
    expect(record.groups.every((group) => (group.semanticChangeIds?.length ?? 0) > 0)).toBe(true);
  });
});
