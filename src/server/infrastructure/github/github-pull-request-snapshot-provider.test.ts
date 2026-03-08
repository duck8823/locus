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

  it("supports added and removed file snapshots", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;

      switch (path) {
        case "/repos/octocat/locus/pulls/8":
          return jsonResponse({
            title: "Add and remove files",
            base: { ref: "main", sha: "base-sha" },
            head: { ref: "feature/files", sha: "head-sha" },
          });
        case "/repos/octocat/locus/pulls/8/files?per_page=100&page=1":
          return jsonResponse([
            { filename: "src/new-file.ts", status: "added" },
            { filename: "src/removed-file.ts", status: "removed" },
            {
              filename: "src/copied-file.ts",
              previous_filename: "src/source-file.ts",
              status: "copied",
            },
            {
              filename: "src/copied-without-source.ts",
              status: "copied",
            },
          ]);
        case "/repos/octocat/locus/pulls/8/files?per_page=100&page=2":
          return jsonResponse([]);
        case "/repos/octocat/locus/git/trees/base-sha?recursive=1":
          return jsonResponse({
            truncated: false,
            tree: [
              { path: "src/removed-file.ts", type: "blob", sha: "blob-base-removed" },
              { path: "src/source-file.ts", type: "blob", sha: "blob-base-source" },
            ],
          });
        case "/repos/octocat/locus/git/trees/head-sha?recursive=1":
          return jsonResponse({
            truncated: false,
            tree: [
              { path: "src/new-file.ts", type: "blob", sha: "blob-head-new" },
              { path: "src/copied-file.ts", type: "blob", sha: "blob-head-copied" },
              { path: "src/copied-without-source.ts", type: "blob", sha: "blob-head-copied-missing-source" },
            ],
          });
        case "/repos/octocat/locus/git/blobs/blob-base-removed":
          return jsonResponse({ encoding: "base64", content: toBase64("export const removed = true;\n") });
        case "/repos/octocat/locus/git/blobs/blob-base-source":
          return jsonResponse({ encoding: "base64", content: toBase64("export const source = true;\n") });
        case "/repos/octocat/locus/git/blobs/blob-head-new":
          return jsonResponse({ encoding: "base64", content: toBase64("export const added = true;\n") });
        case "/repos/octocat/locus/git/blobs/blob-head-copied":
          return jsonResponse({ encoding: "base64", content: toBase64("export const source = true;\n") });
        case "/repos/octocat/locus/git/blobs/blob-head-copied-missing-source":
          return jsonResponse({ encoding: "base64", content: toBase64("export const copiedOnly = true;\n") });
        default:
          return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
      }
    };
    const provider = new GitHubPullRequestSnapshotProvider({
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
    });
    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "github-pr-8",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 8,
      },
    });

    const added = bundle.snapshotPairs.find((pair) => pair.filePath === "src/new-file.ts");
    const removed = bundle.snapshotPairs.find((pair) => pair.filePath === "src/removed-file.ts");
    const copied = bundle.snapshotPairs.find((pair) => pair.filePath === "src/copied-file.ts");
    const copiedWithoutSource = bundle.snapshotPairs.find((pair) => pair.filePath === "src/copied-without-source.ts");

    expect(added?.before).toBeNull();
    expect(added?.after?.content).toContain("added = true");
    expect(removed?.before?.content).toContain("removed = true");
    expect(removed?.after).toBeNull();
    expect(copied?.before?.filePath).toBe("src/source-file.ts");
    expect(copied?.after?.filePath).toBe("src/copied-file.ts");
    expect(copied?.before?.content).toContain("source = true");
    expect(copied?.after?.content).toContain("source = true");
    expect(copiedWithoutSource?.before).toBeNull();
    expect(copiedWithoutSource?.after?.content).toContain("copiedOnly = true");
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

  it("throws with request path when GitHub API returns a non-success response", async () => {
    const provider = new GitHubPullRequestSnapshotProvider({
      apiBaseUrl: "https://api.github.com",
      fetchImpl: async () => jsonResponse({ message: "Internal Server Error" }, 500),
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "github-pr-500",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 500,
        },
      }),
    ).rejects.toThrow("/repos/octocat/locus/pulls/500");
  });

  it("falls back to content API when recursive trees are truncated", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;

      switch (path) {
        case "/repos/octocat/locus/pulls/314":
          return jsonResponse({
            title: "Refactor entrypoint",
            base: { ref: "main", sha: "base-sha" },
            head: { ref: "feature/refactor", sha: "head-sha" },
          });
        case "/repos/octocat/locus/pulls/314/files?per_page=100&page=1":
          return jsonResponse([
            {
              filename: "src/main.ts",
              status: "modified",
            },
          ]);
        case "/repos/octocat/locus/pulls/314/files?per_page=100&page=2":
          return jsonResponse([]);
        case "/repos/octocat/locus/git/trees/base-sha?recursive=1":
          return jsonResponse({
            truncated: true,
            tree: [],
          });
        case "/repos/octocat/locus/git/trees/head-sha?recursive=1":
          return jsonResponse({
            truncated: true,
            tree: [],
          });
        case "/repos/octocat/locus/contents/src/main.ts?ref=base-sha":
          return jsonResponse({ type: "file", encoding: "base64", content: toBase64("export const value = 1;\n") });
        case "/repos/octocat/locus/contents/src/main.ts?ref=head-sha":
          return jsonResponse({ type: "file", encoding: "base64", content: toBase64("export const value = 2;\n") });
        default:
          return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
      }
    };

    const provider = new GitHubPullRequestSnapshotProvider({
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
    });
    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "github-pr-314",
      source: {
        provider: "github",
        owner: "octocat",
        repository: "locus",
        pullRequestNumber: 314,
      },
    });

    expect(bundle.snapshotPairs).toHaveLength(1);
    expect(bundle.snapshotPairs[0]?.before?.content).toContain("value = 1");
    expect(bundle.snapshotPairs[0]?.after?.content).toContain("value = 2");
  });

  it("rejects pull requests with too many changed files", async () => {
    const hundredFiles = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: "modified",
    }));
    const singleFile = [{ filename: "src/file-300.ts", status: "modified" }];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;

      switch (path) {
        case "/repos/octocat/locus/pulls/9000":
          return jsonResponse({
            title: "Big refactor",
            base: { ref: "main", sha: "base-sha" },
            head: { ref: "feature/big-refactor", sha: "head-sha" },
          });
        case "/repos/octocat/locus/pulls/9000/files?per_page=100&page=1":
        case "/repos/octocat/locus/pulls/9000/files?per_page=100&page=2":
        case "/repos/octocat/locus/pulls/9000/files?per_page=100&page=3":
          return jsonResponse(hundredFiles);
        case "/repos/octocat/locus/pulls/9000/files?per_page=100&page=4":
          return jsonResponse(singleFile);
        default:
          return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
      }
    };
    const provider = new GitHubPullRequestSnapshotProvider({
      apiBaseUrl: "https://api.github.com",
      fetchImpl,
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "github-pr-9000",
        source: {
          provider: "github",
          owner: "octocat",
          repository: "locus",
          pullRequestNumber: 9000,
        },
      }),
    ).rejects.toThrow("Pull request changed files exceed maximum supported count (300).");
  });
});
