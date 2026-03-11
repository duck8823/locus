import { createHash } from "node:crypto";
import type {
  PullRequestSnapshotProvider,
  GitHubPullRequestRef,
  PullRequestSnapshotBundle,
} from "@/server/application/ports/pull-request-snapshot-provider";
import { PullRequestProviderAuthError } from "@/server/application/ports/pull-request-snapshot-provider";
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
  additions?: number;
  deletions?: number;
  changes?: number;
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

interface GitHubContentApiResponse {
  type?: string;
  content?: string;
  encoding?: string;
}

type FetchLike = typeof fetch;

const BINARY_CONTROL_CHAR_THRESHOLD = 0.3;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BLOB_FETCH_CONCURRENCY = 8;
const MAX_PULL_REQUEST_FILES = 300;

class GitHubApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`GitHub API request failed (${statusCode}): ${path}\n${responseBody}`);
    this.name = "GitHubApiError";
  }
}

export interface GitHubPullRequestSnapshotProviderOptions {
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  maxBlobFetchConcurrency?: number;
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

  if (normalized.endsWith(".ts")) {
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

  return controlCharacterCount / buffer.length > BINARY_CONTROL_CHAR_THRESHOLD;
}

function resolveBeforePath(file: GitHubPullRequestFileApiResponse): string | null {
  if (file.status === "added") {
    return null;
  }

  if (file.status === "renamed" || file.status === "copied") {
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

async function mapWithConcurrencyLimit<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(safeConcurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resolveAccessToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class GitHubPullRequestSnapshotProvider implements PullRequestSnapshotProvider {
  private readonly token: string | null;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly maxBlobFetchConcurrency: number;

  constructor(options: GitHubPullRequestSnapshotProviderOptions = {}) {
    const configuredToken = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
    this.token = configuredToken && configuredToken.trim().length > 0 ? configuredToken.trim() : null;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.maxBlobFetchConcurrency = Math.max(
      1,
      Math.floor(options.maxBlobFetchConcurrency ?? DEFAULT_BLOB_FETCH_CONCURRENCY),
    );
  }

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitHubPullRequestRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle> {
    const accessToken = resolveAccessToken(input.accessToken) ?? this.token;
    const pullRequest = await this.requestJson<GitHubPullRequestApiResponse>(
      `/repos/${encodeURIComponent(input.source.owner)}/${encodeURIComponent(input.source.repository)}/pulls/${input.source.pullRequestNumber}`,
      accessToken,
    );
    const changedFiles = await this.fetchPullRequestFiles(input.source, accessToken);
    const [baseTree, headTree] = await Promise.all([
      this.fetchTreeMap(input.source, pullRequest.base.sha, accessToken),
      this.fetchTreeMap(input.source, pullRequest.head.sha, accessToken),
    ]);
    const blobContentCache = new Map<string, Promise<string | null>>();
    const pathContentCache = new Map<string, Promise<string | null>>();

    const snapshotPairs = await mapWithConcurrencyLimit(
      changedFiles,
      this.maxBlobFetchConcurrency,
      async (file): Promise<SourceSnapshotPair> => {
        const beforePath = resolveBeforePath(file);
        const afterPath = resolveAfterPath(file);
        const pairPath = afterPath ?? beforePath ?? file.filename;
        const language = detectLanguage(afterPath ?? beforePath);
        const beforeBlobSha = beforePath && baseTree ? baseTree.get(beforePath) ?? null : null;
        const afterBlobSha = afterPath && headTree ? headTree.get(afterPath) ?? null : null;
        const [beforeContent, afterContent] = await Promise.all([
          this.resolveSnapshotContent({
            source: input.source,
            blobSha: beforeBlobSha,
            filePath: beforePath,
            commitSha: pullRequest.base.sha,
            blobCache: blobContentCache,
            pathCache: pathContentCache,
            accessToken,
          }),
          this.resolveSnapshotContent({
            source: input.source,
            blobSha: afterBlobSha,
            filePath: afterPath,
            commitSha: pullRequest.head.sha,
            blobCache: blobContentCache,
            pathCache: pathContentCache,
            accessToken,
          }),
        ]);
        const fileId = createStableId(input.reviewId, beforePath ?? "", afterPath ?? "", file.status);
        const providerMetadata = {
          status: file.status,
          previousFilePath: file.previous_filename,
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
        };

        const before =
          beforeContent === null
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
        const after =
          afterContent === null
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

        return {
          fileId,
          filePath: pairPath,
          before,
          after,
        };
      },
    );

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

  private async fetchPullRequestFiles(
    source: GitHubPullRequestRef,
    accessToken: string | null,
  ): Promise<GitHubPullRequestFileApiResponse[]> {
    const files: GitHubPullRequestFileApiResponse[] = [];
    let page = 1;

    while (true) {
      const currentPageFiles = await this.requestJson<GitHubPullRequestFileApiResponse[]>(
        `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/pulls/${source.pullRequestNumber}/files?per_page=100&page=${page}`,
        accessToken,
      );

      if (currentPageFiles.length === 0) {
        break;
      }

      files.push(...currentPageFiles);
      if (files.length > MAX_PULL_REQUEST_FILES) {
        throw new Error(
          `Pull request changed files exceed maximum supported count (${MAX_PULL_REQUEST_FILES}).`,
        );
      }

      if (currentPageFiles.length < 100) {
        break;
      }

      page += 1;
    }

    return files;
  }

  private async fetchTreeMap(
    source: GitHubPullRequestRef,
    commitSha: string,
    accessToken: string | null,
  ): Promise<Map<string, string> | null> {
    const treeResponse = await this.requestJson<GitHubTreeApiResponse>(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/git/trees/${commitSha}?recursive=1`,
      accessToken,
    );

    if (treeResponse.truncated) {
      return null;
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

  private async resolveSnapshotContent(params: {
    source: GitHubPullRequestRef;
    blobSha: string | null;
    filePath: string | null;
    commitSha: string;
    blobCache: Map<string, Promise<string | null>>;
    pathCache: Map<string, Promise<string | null>>;
    accessToken: string | null;
  }): Promise<string | null> {
    if (params.blobSha) {
      return this.getBlobText(
        params.source,
        params.blobSha,
        params.blobCache,
        params.accessToken,
      );
    }

    if (!params.filePath) {
      return null;
    }

    return this.getContentByPath({
      source: params.source,
      filePath: params.filePath,
      commitSha: params.commitSha,
      cache: params.pathCache,
      accessToken: params.accessToken,
    });
  }

  private async getContentByPath(params: {
    source: GitHubPullRequestRef;
    filePath: string;
    commitSha: string;
    cache: Map<string, Promise<string | null>>;
    accessToken: string | null;
  }): Promise<string | null> {
    const cacheKey = `${params.commitSha}:${params.filePath}`;
    const cached = params.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const encodedPath = params.filePath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const loader = this.requestJson<GitHubContentApiResponse>(
      `/repos/${encodeURIComponent(params.source.owner)}/${encodeURIComponent(params.source.repository)}/contents/${encodedPath}?ref=${encodeURIComponent(params.commitSha)}`,
      params.accessToken,
    )
      .then((content) => {
        if (content.type !== "file" || content.encoding !== "base64" || typeof content.content !== "string") {
          return null;
        }

        const raw = Buffer.from(content.content.replaceAll("\n", ""), "base64");

        if (isLikelyBinary(raw)) {
          return null;
        }

        return raw.toString("utf8");
      })
      .catch((error: unknown) => {
        if (error instanceof GitHubApiError && error.statusCode === 404) {
          return null;
        }

        params.cache.delete(cacheKey);
        throw error;
      });
    params.cache.set(cacheKey, loader);
    return loader;
  }

  private async getBlobText(
    source: GitHubPullRequestRef,
    blobSha: string,
    cache: Map<string, Promise<string | null>>,
    accessToken: string | null,
  ): Promise<string | null> {
    const cached = cache.get(blobSha);

    if (cached) {
      return cached;
    }

    const loader = this.requestJson<GitHubBlobApiResponse>(
      `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/git/blobs/${blobSha}`,
      accessToken,
    )
      .then((blob) => {
        if (blob.encoding !== "base64" || typeof blob.content !== "string") {
          return null;
        }

        const raw = Buffer.from(blob.content.replaceAll("\n", ""), "base64");

        if (isLikelyBinary(raw)) {
          return null;
        }

        return raw.toString("utf8");
      })
      .catch((error: unknown) => {
        if (error instanceof GitHubApiError && error.statusCode === 404) {
          return null;
        }

        cache.delete(blobSha);
        throw error;
      });
    cache.set(blobSha, loader);
    return loader;
  }

  private async requestJson<T>(path: string, accessToken: string | null): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };

    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        headers,
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(`GitHub API request timed out after ${this.requestTimeoutMs}ms: ${path}`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");

      if (response.status === 401 || response.status === 403) {
        throw new PullRequestProviderAuthError("github", response.status, path, body);
      }

      throw new GitHubApiError(response.status, path, body);
    }

    return (await response.json()) as T;
  }
}
