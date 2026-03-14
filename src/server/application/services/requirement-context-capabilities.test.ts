import { describe, expect, it } from "vitest";
import { resolveRequirementContextCapabilityFlags } from "@/server/application/services/requirement-context-capabilities";

describe("resolveRequirementContextCapabilityFlags", () => {
  it("returns provider-specific capability flags for github", () => {
    expect(resolveRequirementContextCapabilityFlags("github")).toEqual({
      supportsIssueLinks: true,
      supportsSpecPages: false,
      supportsTaskTickets: false,
      supportsLiveFetch: true,
      supportsCandidateInference: true,
    });
  });

  it("returns provider-specific capability flags for confluence", () => {
    expect(resolveRequirementContextCapabilityFlags("confluence")).toEqual({
      supportsIssueLinks: false,
      supportsSpecPages: true,
      supportsTaskTickets: false,
      supportsLiveFetch: false,
      supportsCandidateInference: false,
    });
  });

  it("returns provider-specific capability flags for jira", () => {
    expect(resolveRequirementContextCapabilityFlags("jira")).toEqual({
      supportsIssueLinks: true,
      supportsSpecPages: false,
      supportsTaskTickets: true,
      supportsLiveFetch: false,
      supportsCandidateInference: false,
    });
  });

  it("returns cloned objects so mutations do not leak", () => {
    const first = resolveRequirementContextCapabilityFlags("jira");
    first.supportsLiveFetch = true;

    expect(resolveRequirementContextCapabilityFlags("jira")).toEqual({
      supportsIssueLinks: true,
      supportsSpecPages: false,
      supportsTaskTickets: true,
      supportsLiveFetch: false,
      supportsCandidateInference: false,
    });
  });
});
