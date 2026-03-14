import { describe, expect, it, vi } from "vitest";
import {
  ConfluenceContextProviderPermanentError,
  ConfluenceContextProviderTemporaryError,
} from "@/server/application/ports/confluence-context-provider";
import { ConfluenceReadonlyContextProvider } from "@/server/infrastructure/context/confluence-readonly-context-provider";

describe("ConfluenceReadonlyContextProvider", () => {
  it("returns empty list when api base url is not configured", async () => {
    const fetchImpl = vi.fn();
    const provider = new ConfluenceReadonlyContextProvider({
      apiBaseUrl: "",
      fetchImpl,
    });

    const results = await provider.searchPagesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-context -> main",
      title: "Demo PR",
      accessToken: "token",
    });

    expect(results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps confluence search response into page context records", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          results: [
            {
              id: "12345",
              title: "Reviewing semantic boundaries",
              _links: {
                base: "https://confluence.example.com/wiki",
                webui: "/spaces/ENG/pages/12345/reviewing-semantic-boundaries",
              },
              space: {
                key: "ENG",
              },
              version: {
                when: "2026-03-13T20:00:00.000Z",
              },
              body: {
                storage: {
                  value:
                    "<p>Boundary design notes for parser and integration behavior.</p>",
                },
              },
            },
          ],
        }),
    });
    const provider = new ConfluenceReadonlyContextProvider({
      apiBaseUrl: "https://confluence.example.com/wiki",
      fetchImpl,
    });

    const results = await provider.searchPagesForReviewContext({
      reviewId: "review-1",
      repositoryName: "duck8823/locus",
      branchLabel: "feature/123-context -> main",
      title: "Demo PR",
      accessToken: "token",
    });

    expect(results).toEqual([
      {
        provider: "confluence",
        pageId: "12345",
        spaceKey: "ENG",
        title: "Reviewing semantic boundaries",
        summary: "Boundary design notes for parser and integration behavior.",
        url: "https://confluence.example.com/wiki/spaces/ENG/pages/12345/reviewing-semantic-boundaries",
        updatedAt: "2026-03-13T20:00:00.000Z",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws temporary typed error for retryable provider failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "upstream timeout",
    });
    const provider = new ConfluenceReadonlyContextProvider({
      apiBaseUrl: "https://confluence.example.com/wiki",
      fetchImpl,
    });

    await expect(
      provider.searchPagesForReviewContext({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-context -> main",
        title: "Demo PR",
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(ConfluenceContextProviderTemporaryError);
  });

  it("throws permanent typed error for terminal provider failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    const provider = new ConfluenceReadonlyContextProvider({
      apiBaseUrl: "https://confluence.example.com/wiki",
      fetchImpl,
    });

    await expect(
      provider.searchPagesForReviewContext({
        reviewId: "review-1",
        repositoryName: "duck8823/locus",
        branchLabel: "feature/123-context -> main",
        title: "Demo PR",
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(ConfluenceContextProviderPermanentError);
  });
});
