import { createHash, randomBytes } from "node:crypto";
import type { OAuthStateRepository } from "@/server/application/ports/oauth-state-repository";

export interface PrepareGitHubOAuthStartInput {
  reviewerId: string;
  redirectPath: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export interface PrepareGitHubOAuthStartDependencies {
  oauthStateRepository: OAuthStateRepository;
}

export interface PrepareGitHubOAuthStartResult {
  state: string;
  authorizeUrl: string;
  redirectPath: string;
  expiresAt: string;
}

const OAUTH_STATE_EXPIRY_MS = 10 * 60 * 1000;

export class PrepareGitHubOAuthStartUseCase {
  constructor(private readonly dependencies: PrepareGitHubOAuthStartDependencies) {}

  async execute(input: PrepareGitHubOAuthStartInput): Promise<PrepareGitHubOAuthStartResult> {
    const reviewerId = normalizeReviewerId(input.reviewerId);
    const redirectPath = assertRelativeRedirectPath(input.redirectPath);
    const clientId = requireNonEmpty(input.clientId, "GitHub OAuth client id is required.");
    const redirectUri = requireNonEmpty(input.redirectUri, "GitHub OAuth redirect URI is required.");
    const scope = requireNonEmpty(input.scope, "GitHub OAuth scope is required.");
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY_MS).toISOString();
    const state = randomToken(32);
    const codeVerifier = randomToken(48);
    const codeChallenge = toCodeChallenge(codeVerifier);

    await this.dependencies.oauthStateRepository.savePendingState({
      state,
      provider: "github",
      reviewerId,
      redirectPath,
      codeVerifier,
      createdAt,
      expiresAt,
    });

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return {
      state,
      authorizeUrl: authorizeUrl.toString(),
      redirectPath,
      expiresAt,
    };
  }
}

function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function toCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function requireNonEmpty(value: string, errorMessage: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function normalizeReviewerId(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error("Invalid reviewerId for OAuth start.");
  }

  return normalized;
}

function assertRelativeRedirectPath(value: string): string {
  const normalized = value.trim();

  if (
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\")
  ) {
    throw new Error(`Invalid redirectPath: ${value}`);
  }

  return normalized;
}
