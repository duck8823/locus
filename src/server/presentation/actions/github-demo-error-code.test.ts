import { describe, expect, it } from "vitest";
import {
  GitHubDemoActionError,
  parseGitHubDemoErrorCode,
  toGitHubDemoErrorCode,
} from "./github-demo-error-code";

describe("github-demo-error-code", () => {
  it("parses a supported error code", () => {
    expect(parseGitHubDemoErrorCode("owner_required")).toBe("owner_required");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(parseGitHubDemoErrorCode("  Pull_Request_Number_Invalid ")).toBe(
      "pull_request_number_invalid",
    );
  });

  it("returns null for unsupported values", () => {
    expect(parseGitHubDemoErrorCode("permission_denied")).toBeNull();
    expect(parseGitHubDemoErrorCode("")).toBeNull();
    expect(parseGitHubDemoErrorCode(null)).toBeNull();
  });

  it("maps typed action errors to their explicit code", () => {
    const error = new GitHubDemoActionError("repository_required");
    expect(toGitHubDemoErrorCode(error)).toBe("repository_required");
  });

  it("falls back to start_failed for unknown errors", () => {
    expect(toGitHubDemoErrorCode(new Error("boom"))).toBe("start_failed");
    expect(toGitHubDemoErrorCode("boom")).toBe("start_failed");
  });
});
