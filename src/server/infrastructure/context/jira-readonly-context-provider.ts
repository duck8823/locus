import {
  JiraContextProviderPermanentError,
  JiraContextProviderTemporaryError,
  type JiraContextProvider,
  type JiraIssueContextRecord,
} from "@/server/application/ports/jira-context-provider";
import { classifyIntegrationFailure } from "@/server/application/services/classify-integration-failure";

interface JiraSearchResponse {
  issues?: Array<{
    key?: string;
    fields?: {
      summary?: string;
      description?: unknown;
      status?: {
        name?: string;
      };
      updated?: string;
    };
  }>;
}

type FetchLike = typeof fetch;
type JiraAuthScheme = "bearer" | "basic";

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

function toSummary(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized.slice(0, 220) : null;
  }

  if (typeof value === "object") {
    const extracted = extractJiraDocumentText(value);
    const normalized = extracted.replace(/\s+/g, " ").trim();

    return normalized.length > 0 ? normalized.slice(0, 220) : null;
  }

  return null;
}

function extractJiraDocumentText(node: unknown): string {
  if (!node) {
    return "";
  }

  if (Array.isArray(node)) {
    return node
      .map((entry) => extractJiraDocumentText(entry))
      .filter((entry) => entry.length > 0)
      .join(" ");
  }

  if (typeof node !== "object") {
    return "";
  }

  const current = node as {
    type?: unknown;
    text?: unknown;
    attrs?: { text?: unknown };
    content?: unknown;
  };
  const segments: string[] = [];

  if (typeof current.text === "string") {
    segments.push(current.text);
  }

  if (typeof current.attrs?.text === "string") {
    segments.push(current.attrs.text);
  }

  if (current.type === "hardBreak") {
    segments.push("\n");
  }

  if (Array.isArray(current.content)) {
    const childText = current.content
      .map((child) => extractJiraDocumentText(child))
      .filter((entry) => entry.length > 0)
      .join(" ");

    if (childText.length > 0) {
      segments.push(childText);
    }
  }

  return segments.join(" ");
}

function toJql(input: {
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
    return "order by updated DESC";
  }

  return `text ~ ${terms.join(" AND text ~ ")}`;
}

export interface JiraReadonlyContextProviderOptions {
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
  defaultAccessToken?: string | null;
  authScheme?: JiraAuthScheme;
}

function resolveAuthScheme(value: string | undefined): JiraAuthScheme {
  return value?.toLowerCase() === "basic" ? "basic" : "bearer";
}

function buildAuthorizationHeaderValue(
  accessToken: string,
  authScheme: JiraAuthScheme,
): string {
  if (authScheme === "basic") {
    return `Basic ${Buffer.from(accessToken).toString("base64")}`;
  }

  return `Bearer ${accessToken}`;
}

export class JiraReadonlyContextProvider implements JiraContextProvider {
  private readonly apiBaseUrl: string | null;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly defaultAccessToken: string | null;
  private readonly authScheme: JiraAuthScheme;

  constructor(options: JiraReadonlyContextProviderOptions = {}) {
    this.apiBaseUrl = resolveBaseUrl(
      options.apiBaseUrl ?? process.env.JIRA_API_BASE_URL,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(
      1,
      Math.floor(options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
    this.defaultAccessToken = resolveAccessToken(
      options.defaultAccessToken ?? process.env.JIRA_ACCESS_TOKEN ?? null,
    );
    this.authScheme = resolveAuthScheme(
      options.authScheme ?? process.env.JIRA_AUTH_SCHEME,
    );
  }

  async searchIssuesForReviewContext(input: {
    reviewId: string;
    repositoryName: string;
    branchLabel: string;
    title: string;
    accessToken: string | null;
  }): Promise<JiraIssueContextRecord[]> {
    if (!this.apiBaseUrl) {
      return [];
    }

    const accessToken =
      resolveAccessToken(input.accessToken) ?? this.defaultAccessToken;

    if (!accessToken) {
      return [];
    }

    const authorizationHeaderValue = buildAuthorizationHeaderValue(
      accessToken,
      this.authScheme,
    );

    const endpoint = `${this.apiBaseUrl}/rest/api/3/search`;
    const requestBody = JSON.stringify({
      jql: toJql({
        repositoryName: input.repositoryName,
        branchLabel: input.branchLabel,
        title: input.title,
      }),
      maxResults: 20,
      fields: ["summary", "description", "status", "updated"],
    });
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      this.requestTimeoutMs,
    );

    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: authorizationHeaderValue,
        },
        body: requestBody,
        signal: abortController.signal,
      });
      const rawResponse = await response.text();

      if (!response.ok) {
        throw new Error(
          `Jira API failed (${response.status}): /rest/api/3/search\n${rawResponse}`,
        );
      }

      const parsed = JSON.parse(rawResponse) as JiraSearchResponse;

      return (parsed.issues ?? [])
        .map((issue) => {
          const issueKey = issue.key?.trim();
          const title = issue.fields?.summary?.trim();

          if (!issueKey || !title) {
            return null;
          }

          return {
            provider: "jira" as const,
            issueKey,
            title,
            summary: toSummary(issue.fields?.description),
            url: `${this.apiBaseUrl}/browse/${issueKey}`,
            status: issue.fields?.status?.name?.trim() || null,
            updatedAt: toIsoTimestamp(issue.fields?.updated),
          };
        })
        .filter((issue): issue is JiraIssueContextRecord => issue !== null);
    } catch (error) {
      const classified = classifyIntegrationFailure(error);
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Jira context provider failed.";

      if (classified.retryable) {
        throw new JiraContextProviderTemporaryError(
          `Jira context fetch temporary failure: ${message}`,
          classified.reasonCode,
          error,
        );
      }

      throw new JiraContextProviderPermanentError(
        `Jira context fetch permanent failure: ${message}`,
        classified.reasonCode,
        error,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
