import { createHash } from "node:crypto";
import {
  OAuthCodeExchangeRejectedError,
  OAuthCodeExchangeTemporaryError,
  type OAuthCodeExchangeProvider,
  type OAuthCodeExchangeResult,
  type ExchangeGitHubOAuthCodeInput,
} from "@/server/application/ports/oauth-code-exchange-provider";

type FetchLike = typeof fetch;

interface GitHubOAuthTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  scope?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export interface GitHubOAuthCodeExchangeProviderOptions {
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  fetchImpl?: FetchLike;
  requestTimeoutMs?: number;
}

const DEFAULT_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class GitHubOAuthCodeExchangeProvider implements OAuthCodeExchangeProvider {
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly tokenEndpoint: string;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(options: GitHubOAuthCodeExchangeProviderOptions = {}) {
    this.clientId = normalizeOptionalString(
      options.clientId ?? process.env.GITHUB_OAUTH_CLIENT_ID ?? null,
    );
    this.clientSecret = normalizeOptionalString(
      options.clientSecret ?? process.env.GITHUB_OAUTH_CLIENT_SECRET ?? null,
    );
    this.tokenEndpoint = options.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = Math.max(
      1,
      Math.floor(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
    );
  }

  async exchangeGitHubCode(input: ExchangeGitHubOAuthCodeInput): Promise<OAuthCodeExchangeResult> {
    const code = requireNonEmpty(input.code, "OAuth code is required.");
    const codeVerifier = requireNonEmpty(
      input.codeVerifier,
      "OAuth PKCE code verifier is required.",
    );
    const redirectUri = requireNonEmpty(input.redirectUri, "OAuth redirect URI is required.");

    if (!this.hasConfiguredClientCredentials()) {
      if (isDemoCode(code)) {
        return createDemoResult({
          code,
          codeVerifier,
        });
      }

      throw new OAuthCodeExchangeRejectedError(
        "GitHub OAuth client credentials are not configured.",
      );
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    let response: Response;

    try {
      response = await this.fetchImpl(this.tokenEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new OAuthCodeExchangeTemporaryError(
          `GitHub OAuth token exchange timed out after ${this.requestTimeoutMs}ms.`,
        );
      }

      throw new OAuthCodeExchangeTemporaryError(
        `GitHub OAuth token exchange failed: ${toErrorMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const rawBody = await response.text().catch(() => "");
    const parsedBody = parseGitHubOAuthTokenResponse(rawBody);

    if (!response.ok) {
      throw classifyExchangeFailure({
        statusCode: response.status,
        responseBody: rawBody,
        parsedBody,
      });
    }

    if (parsedBody.error) {
      const errorCode = normalizeOptionalString(parsedBody.error);
      const errorDescription = normalizeOptionalString(parsedBody.error_description);
      const message = errorDescription
        ? `GitHub OAuth exchange rejected: ${errorDescription}`
        : "GitHub OAuth exchange rejected.";

      if (isTemporaryOAuthErrorCode(errorCode)) {
        throw new OAuthCodeExchangeTemporaryError(message);
      }

      throw new OAuthCodeExchangeRejectedError(message);
    }

    const accessToken = normalizeOptionalString(parsedBody.access_token);

    if (!accessToken) {
      throw new OAuthCodeExchangeRejectedError(
        "GitHub OAuth exchange response is missing access_token.",
      );
    }

    const expiresInSeconds =
      typeof parsedBody.expires_in === "number" && Number.isFinite(parsedBody.expires_in)
        ? Math.max(0, Math.floor(parsedBody.expires_in))
        : null;
    const expiresAt =
      expiresInSeconds === null
        ? null
        : new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    return {
      accessToken,
      tokenType: normalizeOptionalString(parsedBody.token_type),
      scope: normalizeOptionalString(parsedBody.scope),
      refreshToken: normalizeOptionalString(parsedBody.refresh_token),
      expiresAt,
    };
  }

  private hasConfiguredClientCredentials(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }
}

function parseGitHubOAuthTokenResponse(value: string): GitHubOAuthTokenResponse {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed as GitHubOAuthTokenResponse;
  } catch {
    return {};
  }
}

function classifyExchangeFailure(input: {
  statusCode: number;
  responseBody: string;
  parsedBody: GitHubOAuthTokenResponse;
}): OAuthCodeExchangeTemporaryError | OAuthCodeExchangeRejectedError {
  const errorCode = normalizeOptionalString(input.parsedBody.error);
  const errorDescription = normalizeOptionalString(input.parsedBody.error_description);
  const baseMessage =
    errorDescription ??
    (input.responseBody.trim().length > 0
      ? input.responseBody
      : `HTTP ${input.statusCode}`);
  const message = `GitHub OAuth exchange failed (${input.statusCode}): ${baseMessage}`;

  if (
    input.statusCode === 429 ||
    input.statusCode >= 500 ||
    isTemporaryOAuthErrorCode(errorCode)
  ) {
    return new OAuthCodeExchangeTemporaryError(message);
  }

  return new OAuthCodeExchangeRejectedError(message);
}

function createDemoResult(input: {
  code: string;
  codeVerifier: string;
}): OAuthCodeExchangeResult {
  const accessToken = `demo-oauth-token-${createHash("sha256")
    .update(`${input.code}\u0000${input.codeVerifier}`)
    .digest("base64url")
    .slice(0, 48)}`;

  return {
    accessToken,
    tokenType: "bearer",
    scope: "repo read:org",
    refreshToken: null,
    expiresAt: null,
  };
}

function isDemoCode(value: string): boolean {
  return value.startsWith("demo-code-");
}

function isTemporaryOAuthErrorCode(value: string | null): boolean {
  return value === "temporarily_unavailable" || value === "server_error";
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmpty(value: string, errorMessage: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new OAuthCodeExchangeRejectedError(errorMessage);
  }

  return trimmed;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "unknown error";
}
