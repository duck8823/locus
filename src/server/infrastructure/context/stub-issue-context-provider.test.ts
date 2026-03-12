import { describe, expect, it } from "vitest";
import { StubIssueContextProvider } from "@/server/infrastructure/context/stub-issue-context-provider";

describe("StubIssueContextProvider", () => {
  it("returns issue by code-host reference", async () => {
    const provider = new StubIssueContextProvider({
      issues: [
        {
          provider: "github",
          owner: "acme",
          repository: "locus",
          issueNumber: 64,
          title: "Context contract",
          body: null,
          state: "open",
          labels: [{ name: "context", color: "0052cc" }],
          author: { login: "duck8823" },
          htmlUrl: "https://github.com/acme/locus/issues/64",
          updatedAt: "2026-03-12T00:00:00.000Z",
        },
      ],
    });

    await expect(
      provider.fetchIssue({
        reference: {
          provider: "github",
          owner: "ACME",
          repository: "LOCUS",
          issueNumber: 64,
        },
      }),
    ).resolves.toMatchObject({
      provider: "github",
      owner: "acme",
      repository: "locus",
      issueNumber: 64,
      title: "Context contract",
    });
  });

  it("supports batched lookup and ignores invalid numbers", async () => {
    const provider = new StubIssueContextProvider({
      issues: [
        {
          provider: "github",
          owner: "acme",
          repository: "locus",
          issueNumber: 64,
          title: "Context contract",
          body: null,
          state: "open",
          labels: [],
          author: null,
          htmlUrl: "https://github.com/acme/locus/issues/64",
          updatedAt: "2026-03-12T00:00:00.000Z",
        },
        {
          provider: "github",
          owner: "acme",
          repository: "locus",
          issueNumber: 67,
          title: "Context failure UX",
          body: null,
          state: "open",
          labels: [],
          author: null,
          htmlUrl: "https://github.com/acme/locus/issues/67",
          updatedAt: "2026-03-12T00:00:00.000Z",
        },
      ],
    });

    const issues = await provider.fetchIssuesByNumbers({
      provider: "github",
      owner: "acme",
      repository: "locus",
      issueNumbers: [64, 67, 67, -1, 0],
    });

    expect(issues.map((issue) => issue.issueNumber)).toEqual([64, 67]);
  });
});
