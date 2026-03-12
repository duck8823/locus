import { describe, expect, it } from "vitest";
import { GitHubIssueContextProvider } from "@/server/infrastructure/github/github-issue-context-provider";

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHubIssueContextProvider", () => {
  it("maps GitHub issue payload into provider-agnostic contract", async () => {
    const requestedPaths: string[] = [];
    const provider = new GitHubIssueContextProvider({
      apiBaseUrl: "https://api.github.local",
      fetchImpl: async (input) => {
        requestedPaths.push(String(input));
        return createJsonResponse({
          number: 64,
          title: "Issue context contract",
          body: "Define the read-only contract.",
          state: "open",
          html_url: "https://github.com/acme/locus/issues/64",
          updated_at: "2026-03-12T00:00:00.000Z",
          labels: [
            { name: "architecture", color: "0052cc" },
            { name: "phase-2" },
          ],
          user: { login: "duck8823" },
        });
      },
    });

    const issue = await provider.fetchIssue({
      reference: {
        provider: "github",
        owner: "acme",
        repository: "locus",
        issueNumber: 64,
      },
    });

    expect(requestedPaths).toEqual(["https://api.github.local/repos/acme/locus/issues/64"]);
    expect(issue).toEqual({
      provider: "github",
      owner: "acme",
      repository: "locus",
      issueNumber: 64,
      title: "Issue context contract",
      body: "Define the read-only contract.",
      state: "open",
      labels: [
        { name: "architecture", color: "0052cc" },
        { name: "phase-2", color: null },
      ],
      author: { login: "duck8823" },
      htmlUrl: "https://github.com/acme/locus/issues/64",
      updatedAt: "2026-03-12T00:00:00.000Z",
    });
  });

  it("returns null for missing issues and filters pull-request payloads", async () => {
    const provider = new GitHubIssueContextProvider({
      apiBaseUrl: "https://api.github.local",
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.endsWith("/issues/404")) {
          return createJsonResponse({ message: "Not Found" }, 404);
        }

        return createJsonResponse({
          number: 65,
          title: "PR disguised as issue",
          state: "open",
          html_url: "https://github.com/acme/locus/pull/65",
          updated_at: "2026-03-12T00:00:00.000Z",
          pull_request: { url: "https://api.github.local/repos/acme/locus/pulls/65" },
        });
      },
    });

    await expect(
      provider.fetchIssue({
        reference: {
          provider: "github",
          owner: "acme",
          repository: "locus",
          issueNumber: 404,
        },
      }),
    ).resolves.toBeNull();

    await expect(
      provider.fetchIssue({
        reference: {
          provider: "github",
          owner: "acme",
          repository: "locus",
          issueNumber: 65,
        },
      }),
    ).resolves.toBeNull();
  });
});
