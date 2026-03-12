import { describe, expect, it } from "vitest";
import { ReanalyzeSourceUnavailableError } from "@/server/application/errors/reanalyze-source-unavailable-error";
import { ReviewSessionNotFoundError } from "@/server/application/errors/review-session-not-found-error";
import {
  parseWorkspaceErrorCode,
  toWorkspaceErrorCode,
} from "@/server/presentation/actions/workspace-error-code";

describe("workspace-error-code", () => {
  it("parses known codes only", () => {
    expect(parseWorkspaceErrorCode("source_unavailable")).toBe("source_unavailable");
    expect(parseWorkspaceErrorCode("WORKSPACE_NOT_FOUND")).toBe("workspace_not_found");
    expect(parseWorkspaceErrorCode("unknown")).toBeNull();
  });

  it("maps action errors to stable workspace codes", () => {
    expect(toWorkspaceErrorCode(new ReviewSessionNotFoundError("review-1"))).toBe("workspace_not_found");
    expect(toWorkspaceErrorCode(new ReanalyzeSourceUnavailableError("review-1"))).toBe("source_unavailable");
    expect(toWorkspaceErrorCode(new Error("random"))).toBe("action_failed");
  });
});
