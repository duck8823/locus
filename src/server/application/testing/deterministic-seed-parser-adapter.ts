import type {
  ParsedSnapshot,
  ParserAdapter,
  ParserCapabilities,
  ParserDiffResult,
} from "@/server/application/ports/parser-adapter";
import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";

export class DeterministicSeedParserAdapter implements ParserAdapter {
  readonly language = "typescript";

  readonly adapterName = "deterministic-seed-parser-adapter";

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

    if (snapshot.fileId === "file-user-service") {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [
          {
            symbolKey: "method::UserService::updateProfile",
            displayName: "updateProfile",
            kind: "method",
            container: "UserService",
            changeType: "modified",
            bodySummary: "Body changed",
            references: ["function::<root>::formatPhone"],
            beforeRegion: {
              filePath: snapshot.filePath,
              startLine: 2,
              endLine: 9,
            },
            afterRegion: {
              filePath: snapshot.filePath,
              startLine: 2,
              endLine: 11,
            },
          },
        ],
      };
    }

    if (snapshot.fileId === "file-email-validator") {
      return {
        adapterName: this.adapterName,
        language: this.language,
        items: [
          {
            symbolKey: "function::<root>::isLegacyDomain",
            displayName: "isLegacyDomain",
            kind: "function",
            changeType: "removed",
            beforeRegion: {
              filePath: snapshot.filePath,
              startLine: 5,
              endLine: 7,
            },
          },
          {
            symbolKey: "function::<root>::validatePhone",
            displayName: "validatePhone",
            kind: "function",
            changeType: "added",
            afterRegion: {
              filePath: snapshot.filePath,
              startLine: 5,
              endLine: 7,
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
