import {
  ConfluenceContextProviderPermanentError,
  ConfluenceContextProviderTemporaryError,
  type ConfluenceContextProvider,
  type ConfluencePageContextRecord,
} from "@/server/application/ports/confluence-context-provider";
import { classifyIntegrationFailure } from "@/server/application/services/classify-integration-failure";

interface ConfluenceSearchResponse {
  results?: Array<{
    id?: string;
    title?: string;
    _links?: {
      webui?: string;
      base?: string;
    };
    space?: {
      key?: string;
    };
    version?: {
      when?: string;
    };
    body?: {
      storage?: {
        value?: string;
      };
    };
  }>;
}

type ConfluenceSearchResult = NonNullable<ConfluenceSearchResponse["results"]>[number];

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 10_000;

function resolveBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : null;
}

function resolveAccessToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIsoTimestamp(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN;

  if (!Number.isFinite(parsed)) {
    return new Date(0).toISOString();
  }

  return new Date(parsed).toISOString();
}

function stripHtmlSummary(input: string | undefined): string | null {
  if (!input) {
    return null;
  }

  const stripped = input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped.length === 0) {
    return null;
  }

  return stripped.slice(0, 220);
}

function mapConfluenceResult(input: {
  response: ConfluenceSearchResult;
  baseUrl: string;
}): ConfluencePageContextRecord | null {
  if (!input.response) {
    return null;
  }

  const pageId = input.response.id?.trim();
  const title = input.response.title?.trim();
  const webuiPath = input.response._links?.webui?.trim();

  if (!pageId || !title || !webuiPath) {
    return null;
  }

  const base = input.response._links?.base?.trim() || input.baseUrl;
  const url = /^https?:\/\//.test(webuiPath)
    ? webuiPath
    : `${base.replace(/\/+$/, "")}/${webuiPath.replace(/^\/+/, "")}`;

  return {
    provider: "confluence",
    pageId,
    spaceKey: input.response.space?.key?.trim() || null,
    title,
    summary: stripHtmlSummary(input.response.body?.storage?.value),
    url,
    updatedAt: toIsoTimestamp(input.response.version?.when),
  };
}

function classifyAsConfluenceError(error: unknown) {
  const classified = classifyIntegrationFailure(error);
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Confluence context provider failed.";

  if (classified.retryable) {
    return new ConfluenceContextProviderTemporaryError(
      `Confluence context fetch temporary failure: ${message}`,
      classified.reasonCode,
      error,
    );
  }

  return new ConfluenceContextProviderPermanentError(
    `Confluence context fetch permanent failure: ${message}`,
    classified.reasonCode,
    error,
  );
}

function buildSearchCql(input: {
  repositoryName: string;
  branchLabel: string;
  title: string;
}): string {
  const terms = [input.repositoryName, input.branchLabel, input.title]
    .flatMap((value) => value.split(/\s+/))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 8)
    .map((value) => `"${value.replaceAll('"', '\\"')}"`);

  if (terms.length === 0) {
    return "type=page";
  }

  return `type=page and text~${terms.join(" and text~")}`;
}

export interface ConfluenceReadonlyContextProviderOptions {
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  defaultAccessToken?: string | null;
}

export class ConfluenceReadonlyContextProvider implements ConfluenceContextProvider {
  private readonly apiBaseUrl: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly defaultAccessToken: string | null;

  constructor(options: ConfluenceReadonlyContextProviderOptions = {}) {
    this.apiBaseUrl = resolveBaseUrl(
      options.apiBaseUrl ?? process.env.CONFLUENCE_API_BASE_URL,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(
      1,
      Math.floor(options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
    this.defaultAccessToken = resolveAccessToken(
      options.defaultAccessToken ?? process.env.CONFLUENCE_ACCESS_TOKEN ?? null,
    );
  }

  async searchPagesForReviewContext(input: {
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
    accessToken: string | null;
  }): Promise<ConfluencePageContextRecord[]> {
    if (!this.apiBaseUrl) {
      return [];
    }

    const accessToken =
      resolveAccessToken(input.accessToken) ?? this.defaultAccessToken;

    if (!accessToken) {
      return [];
    }

    const cql = buildSearchCql({
      repositoryName: input.repositoryName,
      branchLabel: input.branchLabel,
      title: input.title,
    });
    const endpoint =
      `${this.apiBaseUrl}/rest/api/content/search?` +
      new URLSearchParams({
        cql,
        limit: "20",
        expand: "version,space,body.storage",
      }).toString();
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      this.requestTimeoutMs,
    );

    try {
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        signal: abortController.signal,
      });
      const rawResponse = await response.text();

      if (!response.ok) {
        throw new Error(
          `Confluence API failed (${response.status}): /rest/api/content/search\n${rawResponse}`,
        );
      }

      const parsed = JSON.parse(rawResponse) as ConfluenceSearchResponse;
      const records = (parsed.results ?? [])
        .map((result) =>
          mapConfluenceResult({
            response: result,
            baseUrl: this.apiBaseUrl!,
          }),
        )
        .filter((result): result is ConfluencePageContextRecord => result !== null);

      return records;
    } catch (error) {
      throw classifyAsConfluenceError(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
