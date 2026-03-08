import { describe, expect, it } from "vitest";
import { GitHubPullRequestSnapshotProvider } from "@/server/infrastructure/github/github-pull-request-snapshot-provider";

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function toBinaryBase64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("GitHubPullRequestSnapshotProvider", () => {
  it("converts pull request files into snapshot pairs without requiring a token", async () => {
    const seenAuthorizationHeaders: Array<string | null> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;
      seenAuthorizationHeaders.push(new Headers(init?.headers).get("authorization"));

      switch (path) {
        case "/repos/octocat/locus/pulls/42":
          return jsonResponse({
            title: "Improve callable extraction",
            base: { ref: "main", sha: "base-sha" },
            head: { ref: "feature/parser", sha: "head-sha" },
          });
        case "/repos/octocat/locus/pulls/42/files?per_page=100&page=1":
          return jsonResponse([
            {
              filename: "src/service.ts",
              status: "modified",
              additions: 2,
              deletions: 1,
              changes: 3,
            },
            {
              filename: "src/new-name.ts",
              previous_filename: "src/old-name.ts",
              status: "renamed",
              additions: 3,
              deletions: 2,
              changes: 5,
            },
          ]);
        case "/repos/octocat/locus/pulls/42/files?per_page=100&page=2":
          return jsonResponse([]);
        case "/repos/octocat/locus/git/trees/base-sha?recursive=1":
          return jsonResponse({
            truncated: false,
            tree: [
              { path: "src/service.ts", type: "blob", sha: "blob-base-service" },
              { path: "src/old-name.ts", type: "blob", sha: "blob-base-old" },
            ],
          });
        case "/repos/octocat/locus/git/trees/head-sha?recursive=1":
          return jsonResponse({
            truncated: false,
            tree: [
              { path: "src/service.ts", type: "blob", sha: "blob-head-service" },
              { path: "src/new-name.ts", type: "blob", sha: "blob-head-new" },
            ],
          });
        case "/repos/octocat/locus/git/blobs/blob-base-service":
          return jsonResponse({ encoding: "base64", content: toBase64("export function run(){return 1;}\n") });
        case "/repos/octocat/locus/git/blobs/blob-head-service":
          return jsonResponse({ encoding: "base64", content: toBase64("export function run(){return 2;}\n") });
        case "/repos/octocat/locus/git/blobs/blob-base-old":
          return jsonResponse({ encoding: "base64", content: toBase64("export function oldName(){return 1;}\n") });
        case "/repos/octocat/locus/git/blobs/blob-head-new":
          return jsonResponse({ encoding: "base64", content: toBase64("export function newName(){return 2;}\n") });
        default:
          return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
      }
    };

    const provider = new GitHubPullRequestSnapshotProvider({
      token: "",
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
    });
    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "github-pr-42",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 42,
      },
    });

    expect(bundle.title).toBe("PR #42: Improve callable extraction");
    expect(bundle.repositoryName).toBe("octocat/locus");
    expect(bundle.branchLabel).toBe("feature/parser → main");
    expect(bundle.snapshotPairs).toHaveLength(2);

    const modifiedPair = bundle.snapshotPairs.find((pair) => pair.filePath === "src/service.ts");
    expect(modifiedPair?.before?.content).toContain("return 1");
    expect(modifiedPair?.after?.content).toContain("return 2");
    expect(modifiedPair?.before?.language).toBe("typescript");
    expect(modifiedPair?.after?.language).toBe("typescript");

    const renamedPair = bundle.snapshotPairs.find((pair) => pair.filePath === "src/new-name.ts");
    expect(renamedPair?.before?.filePath).toBe("src/old-name.ts");
    expect(renamedPair?.after?.filePath).toBe("src/new-name.ts");
    expect(seenAuthorizationHeaders.every((header) => header === null)).toBe(true);
  });

  it("treats binary blobs as unsupported snapshots", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;

      switch (path) {
        case "/repos/octocat/locus/pulls/7":
          return jsonResponse({
            title: "Update logo",
            base: { ref: "main", sha: "base-sha" },
            head: { ref: "feature/logo", sha: "head-sha" },
          });
        case "/repos/octocat/locus/pulls/7/files?per_page=100&page=1":
          return jsonResponse([
            {
              filename: "assets/logo.png",
              status: "modified",
            },
          ]);
        case "/repos/octocat/locus/pulls/7/files?per_page=100&page=2":
          return jsonResponse([]);
        case "/repos/octocat/locus/git/trees/base-sha?recursive=1":
          return jsonResponse({
            truncated: false,
            tree: [{ path: "assets/logo.png", type: "blob", sha: "blob-base-logo" }],
          });
        case "/repos/octocat/locus/git/trees/head-sha?recursive=1":
          return jsonResponse({
            truncated: false,
            tree: [{ path: "assets/logo.png", type: "blob", sha: "blob-head-logo" }],
          });
        case "/repos/octocat/locus/git/blobs/blob-base-logo":
          return jsonResponse({ encoding: "base64", content: toBinaryBase64([0, 1, 2, 3]) });
        case "/repos/octocat/locus/git/blobs/blob-head-logo":
          return jsonResponse({ encoding: "base64", content: toBinaryBase64([0, 10, 20, 30]) });
        default:
          return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
      }
    };

    const provider = new GitHubPullRequestSnapshotProvider({
      token: "test-token",
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
    });
    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "github-pr-7",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 7,
      },
    });

    expect(bundle.snapshotPairs).toHaveLength(1);
    expect(bundle.snapshotPairs[0]).toEqual({
      fileId: expect.any(String),
      filePath: "assets/logo.png",
      before: null,
      after: null,
    });
  });

  it("fails fast when a GitHub API request times out", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const provider = new GitHubPullRequestSnapshotProvider({
      token: "",
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
      requestTimeoutMs: 5,
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "github-pr-timeout",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 99,
        },
      }),
    ).rejects.toThrow("timed out");
  });
});
