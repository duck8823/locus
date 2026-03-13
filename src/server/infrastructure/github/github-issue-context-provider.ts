import type {
  CodeHostIssueContextRef,
  IssueContextProvider,
  IssueContextRecord,
} from "@/server/application/ports/issue-context-provider";

interface GitHubIssueApiResponse {
  number?: number;
  title?: string;
  body?: string | null;
  state?: "open" | "closed" | string;
  html_url?: string;
  updated_at?: string;
  labels?: Array<{ name?: string; color?: string }>;
  pull_request?: unknown;
  user?: {
    login?: string;
  };
}

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 10_000;

function resolveAccessToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUpdatedAt(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN;

  if (!Number.isFinite(parsed)) {
    return new Date(0).toISOString();
  }

  return new Date(parsed).toISOString();
}

function mapIssue(input: {
  response: GitHubIssueApiResponse;
  owner: string;
  repository: string;
  issueNumber: number;
}): IssueContextRecord | null {
  if (input.response.pull_request) {
    return null;
  }

  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    return null;
  }

  const title = input.response.title?.trim();
  const htmlUrl = input.response.html_url?.trim();
  const state = input.response.state === "closed" ? "closed" : "open";

  if (!title || !htmlUrl) {
    return null;
  }

  return {
    provider: "github",
    owner: input.owner,
    repository: input.repository,
    issueNumber: input.issueNumber,
    title,
    body: input.response.body ?? null,
    state,
    labels: (input.response.labels ?? [])
      .filter((label): label is { name?: string; color?: string } => Boolean(label))
      .map((label) => ({
        name: label.name?.trim() ?? "",
        color: label.color?.trim() ?? null,
      }))
      .filter((label) => label.name.length > 0),
    author: input.response.user?.login ? { login: input.response.user.login } : null,
    htmlUrl,
    updatedAt: normalizeUpdatedAt(input.response.updated_at),
  };
}

export class GitHubIssueContextProvider implements IssueContextProvider {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;
  private readonly token: string | null;

  constructor(options: {
    token?: string | null;
    apiBaseUrl?: string;
    fetchImpl?: FetchLike;
    requestTimeoutMs?: number;
  } = {}) {
    this.token = resolveAccessToken(options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null);
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.github.com";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(1, Math.floor(options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS));
  }

  async fetchIssue(input: {
    reference: CodeHostIssueContextRef;
    accessToken?: string | null;
  }): Promise<IssueContextRecord | null> {
    if (input.reference.provider !== "github") {
      return null;
    }

    const accessToken =
      input.accessToken === undefined
        ? this.token
        : resolveAccessToken(input.accessToken);
    const response = await this.requestJson<GitHubIssueApiResponse>({
      path: `/repos/${encodeURIComponent(input.reference.owner)}/${encodeURIComponent(input.reference.repository)}/issues/${input.reference.issueNumber}`,
      accessToken,
    });

    if (response.status === 404) {
      return null;
    }

    const record = mapIssue({
      response: response.body,
      owner: input.reference.owner,
      repository: input.reference.repository,
      issueNumber: input.reference.issueNumber,
    });

    return record;
  }

  async fetchIssuesByNumbers(input: {
    provider: CodeHostIssueContextRef["provider"];
    owner: string;
    repository: string;
    issueNumbers: number[];
    accessToken?: string | null;
  }): Promise<IssueContextRecord[]> {
    if (input.provider !== "github") {
      return [];
    }

    const uniqueNumbers = [...new Set(input.issueNumbers.filter((number) => Number.isInteger(number) && number > 0))];
    const issues = await Promise.all(
      uniqueNumbers.map((issueNumber) =>
        this.fetchIssue({
          reference: {
            provider: "github",
            owner: input.owner,
            repository: input.repository,
            issueNumber,
          },
          accessToken: input.accessToken,
        }),
      ),
    );

    return issues.filter((issue): issue is IssueContextRecord => issue !== null);
  }

  private async requestJson<T>(input: {
    path: string;
    accessToken: string | null;
  }): Promise<{ status: number; body: T }> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${input.path}`, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "locus-dev",
          ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
        },
        signal: controller.signal,
      });
      const responseText = await response.text();

      if (!response.ok && response.status !== 404) {
        throw new Error(`GitHub issue API failed (${response.status}): ${input.path}\n${responseText}`);
      }

      return {
        status: response.status,
        body: (responseText ? JSON.parse(responseText) : {}) as T,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
