import { createHash } from "node:crypto";
import type {
  PullRequestSnapshotProvider,
  GitHubPullRequestRef,
  PullRequestSnapshotBundle,
} from "@/server/application/ports/pull-request-snapshot-provider";
import type { SourceSnapshot, SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

interface GitHubPullRequestApiResponse {
  title: string;
  base: {
    ref: string;
    sha: string;
  };
  head: {
    ref: string;
    sha: string;
  };
}

interface GitHubPullRequestFileApiResponse {
  filename: string;
  status: string;
  previous_filename?: string;
  sha?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
}

interface GitHubTreeApiResponse {
  truncated: boolean;
  tree: Array<{
    path?: string;
    sha?: string;
    type?: string;
  }>;
}

interface GitHubBlobApiResponse {
  content?: string;
  encoding?: string;
}

type FetchLike = typeof fetch;

export interface GitHubPullRequestSnapshotProviderOptions {
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
}

function createStableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("::")).digest("hex").slice(0, 20);
}

function detectLanguage(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const normalized = filePath.toLowerCase();

  if (normalized.endsWith(".tsx")) {
    return "tsx";
  }

  if (normalized.endsWith(".ts") || normalized.endsWith(".d.ts")) {
    return "typescript";
  }

  if (normalized.endsWith(".jsx")) {
    return "jsx";
  }

  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return "javascript";
  }

  if (normalized.endsWith(".py")) {
    return "python";
  }

  if (normalized.endsWith(".go")) {
    return "go";
  }

  if (normalized.endsWith(".java")) {
    return "java";
  }

  if (normalized.endsWith(".rb")) {
    return "ruby";
  }

  if (normalized.endsWith(".rs")) {
    return "rust";
  }

  if (normalized.endsWith(".php")) {
    return "php";
  }

  return null;
}

function isLikelyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  for (const byte of buffer) {
    if (byte === 0) {
      return true;
    }
  }

  let controlCharacterCount = 0;

  for (const byte of buffer) {
    if ((byte >= 0 && byte <= 8) || byte === 11 || byte === 12 || (byte >= 14 && byte <= 31) || byte === 127) {
      controlCharacterCount += 1;
    }
  }

  return controlCharacterCount / buffer.length > 0.3;
}

function resolveBeforePath(file: GitHubPullRequestFileApiResponse): string | null {
  if (file.status === "added") {
    return null;
  }

  if (file.status === "renamed") {
    return file.previous_filename ?? null;
  }

  return file.filename;
}

function resolveAfterPath(file: GitHubPullRequestFileApiResponse): string | null {
  if (file.status === "removed") {
    return null;
  }

  return file.filename;
}

export class GitHubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  private readonly token: string | null;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GitHubPullRequestSnapshotProviderOptions = {}) {
    const configuredToken = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
    this.token = configuredToken && configuredToken.trim().length > 0 ? configuredToken.trim() : null;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
  }): Promise<PullRequestSnapshotBundle> {
    const pullRequest = await this.requestJson<GitHubPullRequestApiResponse>(
      `/repos/${encodeURIComponent(input.source.owner)}/${encodeURIComponent(input.source.repository)}/pulls/${input.source.pullRequestNumber}`,
    );
    const changedFiles = await this.fetchPullRequestFiles(input.source);
    const [baseTree, headTree] = await Promise.all([
      this.fetchTreeMap(input.source, pullRequest.base.sha),
      this.fetchTreeMap(input.source, pullRequest.head.sha),
    ]);
    const blobContentCache = new Map<string, Promise<string | null>>();
    const snapshotPairs: SourceSnapshotPair[] = [];

    for (const file of changedFiles) {
      const beforePath = resolveBeforePath(file);
      const afterPath = resolveAfterPath(file);
      const pairPath = afterPath ?? beforePath ?? file.filename;
      const language = detectLanguage(afterPath ?? beforePath);
      const beforeBlobSha = beforePath ? baseTree.get(beforePath) ?? null : null;
      const afterBlobSha = afterPath ? headTree.get(afterPath) ?? null : null;
      const beforeContent = beforeBlobSha
        ? await this.getBlobText(input.source, beforeBlobSha, blobContentCache)
        : null;
      const afterContent = afterBlobSha
        ? await this.getBlobText(input.source, afterBlobSha, blobContentCache)
        : null;
      const fileId = createStableId(input.reviewId, beforePath ?? "", afterPath ?? "", file.status);
      const providerMetadata = {
        status: file.status,
        previousFilePath: file.previous_filename,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
      };

      const before = beforeContent === null
        ? null
        : this.createSnapshot({
            reviewId: input.reviewId,
            fileId,
            filePath: beforePath ?? pairPath,
            language,
            revision: "before",
            content: beforeContent,
            source: input.source,
            commitSha: pullRequest.base.sha,
            providerMetadata: {
              ...providerMetadata,
              blobSha: beforeBlobSha,
            },
          });
      const after = afterContent === null
        ? null
        : this.createSnapshot({
            reviewId: input.reviewId,
            fileId,
            filePath: afterPath ?? pairPath,
            language,
            revision: "after",
            content: afterContent,
            source: input.source,
            commitSha: pullRequest.head.sha,
            providerMetadata: {
              ...providerMetadata,
              blobSha: afterBlobSha,
            },
          });

      snapshotPairs.push({
        fileId,
        filePath: pairPath,
        before,
        after,
      });
    }

    return {
      title: `PR #${input.source.pullRequestNumber}: ${pullRequest.title}`,
      repositoryName: `${input.source.owner}/${input.source.repository}`,
      branchLabel: `${pullRequest.head.ref} → ${pullRequest.base.ref}`,
      snapshotPairs,
      source: input.source,
    };
  }

  private createSnapshot(params: {
    reviewId: string;
    fileId: string;
    filePath: string;
    language: string | null;
    revision: "before" | "after";
    content: string;
    source: GitHubPullRequestRef;
    commitSha: string;
    providerMetadata: Record<string, unknown>;
  }): SourceSnapshot {
    return {
      snapshotId: `${params.reviewId}:${params.fileId}:${params.revision}`,
      fileId: params.fileId,
      filePath: params.filePath,
      language: params.language,
      revision: params.revision,
      content: params.content,
      metadata: {
        codeHost: "github",
        repositoryRef: `${params.source.owner}/${params.source.repository}`,
        changeRequestRef: `pulls/${params.source.pullRequestNumber}`,
        commitSha: params.commitSha,
        providerMetadata: params.providerMetadata,
      },
    };
  }

  private async fetchPullRequestFiles(source: GitHubPullRequestRef): Promise<GitHubPullRequestFileApiResponse[]> {
    const files: GitHubPullRequestFileApiResponse[] = [];
    let page = 1;

    while (true) {
      const currentPageFiles = await this.requestJson<GitHubPullRequestFileApiResponse[]>(
        `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/pulls/${source.pullRequestNumber}/files?per_page=100&page=${page}`,
      );

      if (currentPageFiles.length === 0) {
        break;
      }

      files.push(...currentPageFiles);

      if (currentPageFiles.length < 100) {
        break;
      }

      page += 1;
    }

    return files;
  }

  private async fetchTreeMap(source: GitHubPullRequestRef, commitSha: string): Promise<Map<string, string>> {
    const treeResponse = await this.requestJson<GitHubTreeApiResponse>(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/git/trees/${commitSha}?recursive=1`,
    );

    if (treeResponse.truncated) {
      throw new Error(`GitHub tree response was truncated for commit ${commitSha}.`);
    }

    const tree = new Map<string, string>();

    for (const entry of treeResponse.tree) {
      if (entry.type !== "blob" || typeof entry.path !== "string" || typeof entry.sha !== "string") {
        continue;
      }

      tree.set(entry.path, entry.sha);
    }

    return tree;
  }

  private async getBlobText(
    source: GitHubPullRequestRef,
    blobSha: string,
    cache: Map<string, Promise<string | null>>,
  ): Promise<string | null> {
    const cached = cache.get(blobSha);

    if (cached) {
      return cached;
    }

    const loader = this.requestJson<GitHubBlobApiResponse>(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/git/blobs/${blobSha}`,
    ).then((blob) => {
      if (blob.encoding !== "base64" || typeof blob.content !== "string") {
        return null;
      }

      const raw = Buffer.from(blob.content.replaceAll("\n", ""), "base64");

      if (isLikelyBinary(raw)) {
        return null;
      }

      return raw.toString("utf8");
    });
    cache.set(blobSha, loader);
    return loader;
  }

  private async requestJson<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };

    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitHub API request failed (${response.status}): ${path}\n${body}`);
    }

    return (await response.json()) as T;
  }
}
