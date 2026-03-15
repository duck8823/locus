import { describe, expect, it } from "vitest";
import {
  GitLabDemoActionError,
  parseGitLabDemoErrorCode,
  toGitLabDemoErrorCode,
} from "./gitlab-demo-error-code";

describe("gitlab-demo-error-code", () => {
  it("parses supported error codes", () => {
    expect(parseGitLabDemoErrorCode("project_path_required")).toBe("project_path_required");
    expect(parseGitLabDemoErrorCode("MERGE_REQUEST_IID_INVALID")).toBe("merge_request_iid_invalid");
  });

  it("returns null for unknown or empty values", () => {
    expect(parseGitLabDemoErrorCode(undefined)).toBeNull();
    expect(parseGitLabDemoErrorCode(null)).toBeNull();
    expect(parseGitLabDemoErrorCode(" ")).toBeNull();
    expect(parseGitLabDemoErrorCode("unsupported")).toBeNull();
  });

  it("maps GitLabDemoActionError to its code", () => {
    expect(toGitLabDemoErrorCode(new GitLabDemoActionError("merge_request_iid_required"))).toBe(
      "merge_request_iid_required",
    );
  });

  it("falls back to start_failed for unexpected errors", () => {
    expect(toGitLabDemoErrorCode(new Error("boom"))).toBe("start_failed");
    expect(toGitLabDemoErrorCode("boom")).toBe("start_failed");
  });
});
