import type { ReviewGroupStatus } from "@/server/domain/value-objects/review-status";

export type SemanticSymbolKind = "function" | "method" | "class" | "module" | "unknown";

export type SemanticChangeType = "added" | "removed" | "modified" | "moved" | "renamed";

export interface CodeRegionRef {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface SemanticChange {
  semanticChangeId: string;
  reviewId: string;
  fileId: string;
  language: string;
  adapterName: string;
  symbol: {
    stableKey: string;
    displayName: string;
    kind: SemanticSymbolKind;
    container?: string;
  };
  change: {
    type: SemanticChangeType;
    signatureSummary?: string;
    bodySummary?: string;
  };
  before?: CodeRegionRef;
  after?: CodeRegionRef;
  architecture?: {
    outgoingNodeIds: string[];
    incomingNodeIds: string[];
  };
  metadata: {
    parser: Record<string, unknown>;
    languageSpecific: Record<string, unknown>;
  };
}

export interface SemanticChangeGroup {
  groupId: string;
  reviewId: string;
  title: string;
  fileIds: string[];
  semanticChangeIds: string[];
  dominantLayer?: string;
  status: ReviewGroupStatus;
}

export type UnsupportedFileReason =
  | "unsupported_language"
  | "parser_failed"
  | "binary_file";

export interface UnsupportedFileAnalysis {
  reviewId: string;
  fileId: string;
  filePath: string;
  language: string | null;
  reason: UnsupportedFileReason;
  detail?: string;
}

export interface ArchitectureEdge {
  fromNodeId: string;
  toNodeId: string;
  relation: "imports" | "calls" | "implements" | "uses";
}
