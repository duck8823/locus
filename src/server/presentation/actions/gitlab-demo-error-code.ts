export const gitLabDemoErrorCodeValues = [
  "project_path_required",
  "merge_request_iid_required",
  "merge_request_iid_invalid",
  "start_failed",
] as const;

export type GitLabDemoErrorCode = (typeof gitLabDemoErrorCodeValues)[number];

const gitLabDemoErrorCodeSet = new Set<string>(gitLabDemoErrorCodeValues);

export class GitLabDemoActionError extends Error {
  readonly code: GitLabDemoErrorCode;

  constructor(code: GitLabDemoErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "GitLabDemoActionError";
  }
}

export function parseGitLabDemoErrorCode(
  value: string | null | undefined,
): GitLabDemoErrorCode | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || !gitLabDemoErrorCodeSet.has(normalized)) {
    return null;
  }

  return normalized as GitLabDemoErrorCode;
}

export function toGitLabDemoErrorCode(error: unknown): GitLabDemoErrorCode {
  if (error instanceof GitLabDemoActionError) {
    return error.code;
  }

  return "start_failed";
}
