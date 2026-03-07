import type { SourceSnapshot } from "@/server/domain/value-objects/source-snapshot";
import type {
  CodeRegionRef,
  SemanticChangeType,
  SemanticSymbolKind,
} from "@/server/domain/value-objects/semantic-change";

export interface ParsedSnapshot {
  snapshotId: string;
  adapterName: string;
  language: string;
  parserVersion?: string;
  raw: unknown;
}

export interface ParserDiffItem {
  symbolKey: string;
  displayName: string;
  kind: SemanticSymbolKind;
  container?: string;
  changeType: SemanticChangeType;
  signatureSummary?: string;
  bodySummary?: string;
  references?: string[];
  beforeRegion?: CodeRegionRef;
  afterRegion?: CodeRegionRef;
  metadata?: Record<string, unknown>;
}

export interface ParserDiffResult {
  adapterName: string;
  language: string;
  items: ParserDiffItem[];
}

export interface ParserCapabilities {
  callableDiff: boolean;
  importGraph: boolean;
  renameDetection: boolean;
  moveDetection: boolean;
  typeAwareSummary: boolean;
}

export interface ParserAdapter {
  readonly language: string;
  readonly adapterName: string;

  supports(file: SourceSnapshot): boolean;

  parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot>;

  diff(input: {
    before: ParsedSnapshot | null;
    after: ParsedSnapshot | null;
  }): Promise<ParserDiffResult>;

  capabilities(): ParserCapabilities;
}
