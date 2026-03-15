import { createHash } from "node:crypto";
import {
  PullRequestProviderAuthError,
  type GitLabPullRequestRef,
  type PullRequestSnapshotBundle,
  type PullRequestSnapshotProviderContract,
} from "@/server/application/ports/pull-request-snapshot-provider";
import type { SourceSnapshot, SourceSnapshotPair } from "@/server/domain/value-objects/source-snapshot";

interface GitLabMergeRequestApiResponse {
  title: string;
  source_branch: string;
  target_branch: string;
  diff_refs?: {
    base_sha?: string;
    head_sha?: string;
  };
}

interface GitLabMergeRequestChangesResponse {
  changes?: GitLabMergeRequestChangeApiResponse[];
  diff_refs?: {
    base_sha?: string;
    head_sha?: string;
  };
}

interface GitLabMergeRequestChangeApiResponse {
  old_path?: string;
  new_path?: string;
  new_file?: boolean;
  deleted_file?: boolean;
  renamed_file?: boolean;
  too_large?: boolean;
}

type FetchLike = typeof fetch;

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_FILE_FETCH_CONCURRENCY = 8;
const MAX_MERGE_REQUEST_CHANGES = 500;
const BINARY_CONTROL_CHAR_THRESHOLD = 0.3;

class GitLabApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly path: string,
    readonly responseBody: string,
  ) {
    super(`GitLab API request failed (${statusCode}): ${path}\n${responseBody}`);
    this.name = "GitLabApiError";
  }
}

export interface GitLabPullRequestSnapshotProviderOptions {
  token?: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  maxFileFetchConcurrency?: number;
}

function createStableId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("::")).digest("hex").slice(0, 20);
}

function resolveAccessToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function resolveChangeStatus(change: GitLabMergeRequestChangeApiResponse): string {
  if (change.deleted_file) {
    return "removed";
  }

  if (change.new_file) {
    return "added";
  }

  if (change.renamed_file) {
    return "renamed";
  }

  return "modified";
}

function resolveBeforePath(change: GitLabMergeRequestChangeApiResponse): string | null {
  if (change.new_file) {
    return null;
  }

  return change.old_path ?? null;
}

function resolveAfterPath(change: GitLabMergeRequestChangeApiResponse): string | null {
  if (change.deleted_file) {
    return null;
  }

  return change.new_path ?? null;
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

export class GitLabPullRequestSnapshotProvider
  implements PullRequestSnapshotProviderContract<GitLabPullRequestRef>
{
  private readonly token: string | null;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly maxFileFetchConcurrency: number;

  constructor(options: GitLabPullRequestSnapshotProviderOptions = {}) {
    const configuredToken = options.token ?? process.env.GITLAB_TOKEN ?? process.env.GL_TOKEN ?? null;
    this.token = configuredToken && configuredToken.trim().length > 0 ? configuredToken.trim() : null;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://gitlab.com/api/v4";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.maxFileFetchConcurrency = Math.max(
      1,
      Math.floor(options.maxFileFetchConcurrency ?? DEFAULT_FILE_FETCH_CONCURRENCY),
    );
  }

  async fetchPullRequestSnapshots(input: {
    reviewId: string;
    source: GitLabPullRequestRef;
    accessToken?: string | null;
  }): Promise<PullRequestSnapshotBundle<GitLabPullRequestRef>> {
    const accessToken = resolveAccessToken(input.accessToken) ?? this.token;
    const projectPath = encodeURIComponent(input.source.projectPath);
    const mergeRequestPath = `/projects/${projectPath}/merge_requests/${input.source.mergeRequestIid}`;

    const [mergeRequest, mergeRequestChanges] = await Promise.all([
      this.requestJson<GitLabMergeRequestApiResponse>(mergeRequestPath, accessToken),
      this.requestJson<GitLabMergeRequestChangesResponse>(`${mergeRequestPath}/changes`, accessToken),
    ]);

    const changes = mergeRequestChanges.changes ?? [];

    if (changes.length > MAX_MERGE_REQUEST_CHANGES) {
      throw new Error(
        `Merge request changed files exceed maximum supported count (${MAX_MERGE_REQUEST_CHANGES}).`,
      );
    }

    const beforeRef =
      mergeRequest.diff_refs?.base_sha ??
      mergeRequestChanges.diff_refs?.base_sha ??
      mergeRequest.target_branch;
    const afterRef = mergeRequest.diff_refs?.head_sha ?? mergeRequestChanges.diff_refs?.head_sha ?? mergeRequest.source_branch;

    if (!beforeRef || !afterRef) {
      throw new Error(
        `GitLab merge request !${input.source.mergeRequestIid} does not expose resolvable before/after refs for snapshot fetch.`,
      );
    }

    const pathContentCache = new Map<string, Promise<string | null>>();
    const snapshotPairs = await mapWithConcurrencyLimit(
      changes,
      this.maxFileFetchConcurrency,
      async (change): Promise<SourceSnapshotPair> => {
        const beforePath = resolveBeforePath(change);
        const afterPath = resolveAfterPath(change);
        const pairPath = afterPath ?? beforePath ?? change.new_path ?? change.old_path ?? "unknown";
        const status = resolveChangeStatus(change);
        const language = detectLanguage(afterPath ?? beforePath);
        const [beforeContent, afterContent] = await Promise.all([
          this.getContentByPath({
            source: input.source,
            filePath: beforePath,
            ref: beforeRef,
            cache: pathContentCache,
            accessToken,
          }),
          this.getContentByPath({
            source: input.source,
            filePath: afterPath,
            ref: afterRef,
            cache: pathContentCache,
            accessToken,
          }),
        ]);
        const fileId = createStableId(input.reviewId, beforePath ?? "", afterPath ?? "", status);
        const providerMetadata = {
          status,
          oldPath: change.old_path,
          newPath: change.new_path,
          newFile: change.new_file ?? false,
          deletedFile: change.deleted_file ?? false,
          renamedFile: change.renamed_file ?? false,
          tooLarge: change.too_large ?? false,
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
                commitSha: beforeRef,
                providerMetadata,
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
                commitSha: afterRef,
                providerMetadata,
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
      title: `MR !${input.source.mergeRequestIid}: ${mergeRequest.title}`,
      repositoryName: input.source.projectPath,
      branchLabel: `${mergeRequest.source_branch} → ${mergeRequest.target_branch}`,
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
    source: GitLabPullRequestRef;
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
        codeHost: "gitlab",
        repositoryRef: params.source.projectPath,
        changeRequestRef: `merge_requests/${params.source.mergeRequestIid}`,
        commitSha: params.commitSha,
        providerMetadata: params.providerMetadata,
      },
    };
  }

  private async getContentByPath(params: {
    source: GitLabPullRequestRef;
    filePath: string | null;
    ref: string;
    cache: Map<string, Promise<string | null>>;
    accessToken: string | null;
  }): Promise<string | null> {
    if (!params.filePath) {
      return null;
    }

    const cacheKey = `${params.ref}:${params.filePath}`;
    const cached = params.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const encodedProjectPath = encodeURIComponent(params.source.projectPath);
    const encodedFilePath = encodeURIComponent(params.filePath);
    const loader = this.requestBuffer(
      `/projects/${encodedProjectPath}/repository/files/${encodedFilePath}/raw?ref=${encodeURIComponent(params.ref)}`,
      params.accessToken,
    )
      .then((raw) => {
        if (isLikelyBinary(raw)) {
          return null;
        }

        return raw.toString("utf8");
      })
      .catch((error: unknown) => {
        if (error instanceof GitLabApiError && error.statusCode === 404) {
          return null;
        }

        params.cache.delete(cacheKey);
        throw error;
      });
    params.cache.set(cacheKey, loader);
    return loader;
  }

  private async requestJson<T>(path: string, accessToken: string | null): Promise<T> {
    const response = await this.request(path, accessToken, "application/json");
    return (await response.json()) as T;
  }

  private async requestBuffer(path: string, accessToken: string | null): Promise<Buffer> {
    const response = await this.request(path, accessToken, "*/*");
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async request(path: string, accessToken: string | null, accept: string): Promise<Response> {
    const headers: Record<string, string> = {
      accept,
    };

    if (accessToken) {
      if (accessToken.toLowerCase().startsWith("glpat-")) {
        headers["private-token"] = accessToken;
      } else {
        headers.authorization = `Bearer ${accessToken}`;
      }
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
        throw new Error(`GitLab API request timed out after ${this.requestTimeoutMs}ms: ${path}`);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");

      if (response.status === 401 || response.status === 403) {
        throw new PullRequestProviderAuthError("gitlab", response.status, path, body);
      }

      throw new GitLabApiError(response.status, path, body);
    }

    return response;
  }
}
