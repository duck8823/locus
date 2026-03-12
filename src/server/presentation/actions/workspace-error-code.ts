import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";

export const workspaceErrorCodeValues = [
  "workspace_not_found",
  "source_unavailable",
  "action_failed",
] as const;

export type WorkspaceErrorCode = (typeof workspaceErrorCodeValues)[number];

const workspaceErrorCodeSet = new Set<string>(workspaceErrorCodeValues);

export function parseWorkspaceErrorCode(
  value: string | null | undefined,
): WorkspaceErrorCode | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || !workspaceErrorCodeSet.has(normalized)) {
    return null;
  }

  return normalized as WorkspaceErrorCode;
}

export function toWorkspaceErrorCode(error: unknown): WorkspaceErrorCode {
  if (error instanceof ReviewSessionNotFoundError) {
    return "workspace_not_found";
  }

  if (error instanceof ReanalyzeSourceUnavailableError) {
    return "source_unavailable";
  }

  return "action_failed";
}
