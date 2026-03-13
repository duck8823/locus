import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
} from "@/server/application/ports/connection-token-repository";

export const REQUIRED_GITHUB_ISSUE_READ_SCOPES = ["repo"] as const;
const ALTERNATIVE_GITHUB_ISSUE_READ_SCOPES = ["issues:read", "read:issues"] as const;

export class GitHubIssueContextScopeInsufficientError extends Error {
  readonly requiredAnyOfScopes: readonly string[];
  readonly grantedScopes: readonly string[];

  constructor(input: {
    requiredAnyOfScopes?: readonly string[];
    grantedScopes: readonly string[];
  }) {
    const requiredAnyOfScopes = input.requiredAnyOfScopes ?? REQUIRED_GITHUB_ISSUE_READ_SCOPES;
    const grantedScopes = [...input.grantedScopes];
    const grantedLabel = grantedScopes.length > 0 ? grantedScopes.join(", ") : "none";
    super(
      `GitHub OAuth token is missing issue-read scope. Required any of: ${requiredAnyOfScopes.join(", ")}. Granted: ${grantedLabel}.`,
    );
    this.name = "GitHubIssueContextScopeInsufficientError";
    this.requiredAnyOfScopes = requiredAnyOfScopes;
    this.grantedScopes = grantedScopes;
  }
}

export class GitHubIssueContextTokenTypeUnsupportedError extends Error {
  readonly tokenType: string;

  constructor(tokenType: string) {
    super(
      `GitHub OAuth token type '${tokenType}' is not supported for issue-context requests. Use a bearer token.`,
    );
    this.name = "GitHubIssueContextTokenTypeUnsupportedError";
    this.tokenType = tokenType;
  }
}

export interface GitHubIssueContextAccess {
  accessToken: string | null;
  grantedScopes: string[];
}

export async function resolveGitHubIssueContextAccess(input: {
  reviewerId: string;
  connectionTokenRepository: ConnectionTokenRepository;
}): Promise<GitHubIssueContextAccess> {
  const persistedToken =
    await input.connectionTokenRepository.findTokenByReviewerId(input.reviewerId, "github");

  return toGitHubIssueContextAccess(persistedToken);
}

export function toGitHubIssueContextAccess(
  token: PersistedConnectionToken | null,
): GitHubIssueContextAccess {
  if (!token) {
    return {
      accessToken: null,
      grantedScopes: [],
    };
  }

  const tokenType = token.tokenType?.trim().toLowerCase();

  if (tokenType && tokenType !== "bearer") {
    throw new GitHubIssueContextTokenTypeUnsupportedError(tokenType);
  }

  const accessToken = token.accessToken.trim();

  if (accessToken.length === 0) {
    return {
      accessToken: null,
      grantedScopes: [],
    };
  }

  const grantedScopes = parseGitHubOAuthScopes(token.scope);

  if (!hasGitHubIssueReadScope(grantedScopes)) {
    throw new GitHubIssueContextScopeInsufficientError({
      grantedScopes,
    });
  }

  return {
    accessToken,
    grantedScopes,
  };
}

export function parseGitHubOAuthScopes(scope: string | null): string[] {
  if (!scope) {
    return [];
  }

  const normalizedScopes: string[] = [];
  const seenScopes = new Set<string>();

  for (const segment of scope.split(/[,\s]+/)) {
    const normalized = segment.trim().toLowerCase();

    if (normalized.length === 0 || seenScopes.has(normalized)) {
      continue;
    }

    seenScopes.add(normalized);
    normalizedScopes.push(normalized);
  }

  return normalizedScopes;
}

export function hasGitHubIssueReadScope(scopes: readonly string[]): boolean {
  const normalizedScopes = new Set(scopes.map((scope) => scope.trim().toLowerCase()));

  return [...REQUIRED_GITHUB_ISSUE_READ_SCOPES, ...ALTERNATIVE_GITHUB_ISSUE_READ_SCOPES].some(
    (requiredScope) => normalizedScopes.has(requiredScope),
  );
}
