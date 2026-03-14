import { describe, expect, it, vi } from "vitest";
import { JiraReadonlyContextProvider } from "@/server/infrastructure/context/jira-readonly-context-provider";

describe("JiraReadonlyContextProvider", () => {
  it("returns empty list when base url is not configured", async () => {
    const fetchImpl = vi.fn();
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "",
      fetchImpl,
    });

    const results = await provider.searchIssuesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-context -> main",
      title: "Demo PR",
      accessToken: "token",
    });

    expect(results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns empty list when access token is not available", async () => {
    const fetchImpl = vi.fn();
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "https://jira.example.com",
      fetchImpl,
    });

    const results = await provider.searchIssuesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-context -> main",
      title: "Demo PR",
      accessToken: null,
    });

    expect(results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps jira search response into issue context records", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          issues: [
            {
              key: "LOC-123",
              fields: {
                summary: "Harden queue diagnostics",
                description: {
                  type: "doc",
                  version: 1,
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Add retry reason code",
                        },
                        {
                          type: "text",
                          text: "for queue health incidents.",
                        },
                      ],
                    },
                  ],
                },
                status: {
                  name: "In Progress",
                },
                updated: "2026-03-13T22:00:00.000Z",
              },
            },
          ],
        }),
    });
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "https://jira.example.com",
      fetchImpl,
    });

    const results = await provider.searchIssuesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-context -> main",
      title: "Demo PR",
      accessToken: "token",
    });

    expect(results).toEqual([
      {
        provider: "jira",
        issueKey: "LOC-123",
        title: "Harden queue diagnostics",
        summary: "Add retry reason code for queue health incidents.",
        url: "https://jira.example.com/browse/LOC-123",
        status: "In Progress",
        updatedAt: "2026-03-13T22:00:00.000Z",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer token",
      }),
    });
  });

  it("supports basic authorization mode for jira api token credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ issues: [] }),
    });
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "https://jira.example.com",
      fetchImpl,
      authScheme: "basic",
    });

    await provider.searchIssuesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-context -> main",
      title: "Demo PR",
      accessToken: "reviewer@example.com:api-token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Basic cmV2aWV3ZXJAZXhhbXBsZS5jb206YXBpLXRva2Vu",
      }),
    });
  });

  it("sanitizes reserved jql characters in generated query terms", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ issues: [] }),
    });
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "https://jira.example.com",
      fetchImpl,
    });

    await provider.searchIssuesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/(123)-queue:*retry",
      title: "Fix parser: [queue] {retry}?",
      accessToken: "token",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const requestInit = fetchImpl.mock.calls[0]?.[1];
    const parsedBody =
      typeof requestInit?.body === "string"
        ? (JSON.parse(requestInit.body) as { jql?: string })
        : null;
    const quotedTerms = Array.from(
      (parsedBody?.jql ?? "").matchAll(/"([^"]+)"/g),
      (match) => match[1],
    );

    expect(quotedTerms.length).toBeGreaterThan(0);

    for (const term of quotedTerms) {
      expect(term).not.toMatch(/[+\-&|!(){}\[\]^~*?:\\]/);
    }
  });

  it("throws temporary typed error for retryable provider failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "https://jira.example.com",
      fetchImpl,
    });

    await expect(
      provider.searchIssuesForReviewContext({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-context -> main",
        title: "Demo PR",
        accessToken: "token",
      }),
    ).rejects.toMatchObject({
      code: "JIRA_CONTEXT_PROVIDER_TEMPORARY",
      retryable: true,
      reasonCode: "rate_limit",
    });
  });

  it("throws permanent typed error for terminal provider failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });
    const provider = new JiraReadonlyContextProvider({
      apiBaseUrl: "https://jira.example.com",
      fetchImpl,
    });

    await expect(
      provider.searchIssuesForReviewContext({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-context -> main",
        title: "Demo PR",
        accessToken: "token",
      }),
    ).rejects.toMatchObject({
      code: "JIRA_CONTEXT_PROVIDER_PERMANENT",
      retryable: false,
      reasonCode: "auth",
    });
  });
});
