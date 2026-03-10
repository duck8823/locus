export const githubDemoErrorCodeValues = [
  "owner_required",
  "repository_required",
  "pull_request_number_required",
  "pull_request_number_invalid",
  "start_failed",
] as const;

export type GitHubDemoErrorCode = (typeof githubDemoErrorCodeValues)[number];

const githubDemoErrorCodeSet = new Set<string>(githubDemoErrorCodeValues);

export class GitHubDemoActionError extends Error {
  readonly code: GitHubDemoErrorCode;

  constructor(code: GitHubDemoErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "GitHubDemoActionError";
  }
}

export function parseGitHubDemoErrorCode(
  value: string | null | undefined,
): GitHubDemoErrorCode | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || !githubDemoErrorCodeSet.has(normalized)) {
    return null;
  }

  return normalized as GitHubDemoErrorCode;
}

export function toGitHubDemoErrorCode(error: unknown): GitHubDemoErrorCode {
  if (error instanceof GitHubDemoActionError) {
    return error.code;
  }

  return "start_failed";
}
