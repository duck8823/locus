export type SnapshotRevision = "before" | "after";

export interface SourceSnapshotMetadata {
  codeHost: string;
  repositoryRef?: string;
  changeRequestRef?: string;
  commitSha?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface SourceSnapshot {
  snapshotId: string;
  fileId: string;
  filePath: string;
  language: string | null;
  revision: SnapshotRevision;
  content: string;
  metadata: SourceSnapshotMetadata;
}

export interface SourceSnapshotPair {
  fileId: string;
  filePath: string;
  before: SourceSnapshot | null;
  after: SourceSnapshot | null;
}
