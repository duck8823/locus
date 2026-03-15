import { describe, expect, it } from "vitest";
import { PullRequestProviderAuthError } from "@/server/application/ports/pull-request-snapshot-provider";
import { GitLabPullRequestSnapshotProvider } from "@/server/infrastructure/gitlab/gitlab-pull-request-snapshot-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(body: string | ArrayBuffer, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

describe("GitLabPullRequestSnapshotProvider", () => {
  it("maps merge request changes into snapshot pairs", async () => {
    const seenAuthorizationHeaders: Array<string | null> = [];
    const seenPrivateTokenHeaders: Array<string | null> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const path = `${url.pathname}${url.search}`;
      const headers = new Headers(init?.headers);
      seenAuthorizationHeaders.push(headers.get("authorization"));
      seenPrivateTokenHeaders.push(headers.get("private-token"));

      switch (path) {
        case "/api/v4/projects/duck8823%2Flocus/merge_requests/42":
          return jsonResponse({
            title: "Improve parser integration",
            source_branch: "feature/parser",
            target_branch: "main",
            diff_refs: {
              base_sha: "base-sha",
              head_sha: "head-sha",
            },
          });
        case "/api/v4/projects/duck8823%2Flocus/merge_requests/42/changes":
          return jsonResponse({
            changes: [
              {
                old_path: "src/service.ts",
                new_path: "src/service.ts",
                new_file: false,
                deleted_file: false,
                renamed_file: false,
              },
              {
                old_path: "src/old-name.ts",
                new_path: "src/new-name.ts",
                new_file: false,
                deleted_file: false,
                renamed_file: true,
              },
              {
                old_path: "src/removed.ts",
                new_path: "src/removed.ts",
                new_file: false,
                deleted_file: true,
                renamed_file: false,
              },
              {
                old_path: "src/added.ts",
                new_path: "src/added.ts",
                new_file: true,
                deleted_file: false,
                renamed_file: false,
              },
            ],
          });
        case "/api/v4/projects/duck8823%2Flocus/repository/files/src%2Fservice.ts/raw?ref=base-sha":
          return textResponse("export function run(){return 1;}\n");
        case "/api/v4/projects/duck8823%2Flocus/repository/files/src%2Fservice.ts/raw?ref=head-sha":
          return textResponse("export function run(){return 2;}\n");
        case "/api/v4/projects/duck8823%2Flocus/repository/files/src%2Fold-name.ts/raw?ref=base-sha":
          return textResponse("export function oldName(){return 1;}\n");
        case "/api/v4/projects/duck8823%2Flocus/repository/files/src%2Fnew-name.ts/raw?ref=head-sha":
          return textResponse("export function newName(){return 2;}\n");
        case "/api/v4/projects/duck8823%2Flocus/repository/files/src%2Fremoved.ts/raw?ref=base-sha":
          return textResponse("export const removed = true;\n");
        case "/api/v4/projects/duck8823%2Flocus/repository/files/src%2Fadded.ts/raw?ref=head-sha":
          return textResponse("export const added = true;\n");
        default:
          return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
      }
    };

    const provider = new GitLabPullRequestSnapshotProvider({
      token: "",
      apiBaseUrl: "https://gitlab.com/api/v4",
      fetchImpl,
    });

    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "gitlab-mr-42",
      source: {
        provider: "gitlab",
        projectPath: "duck8823/locus",
        mergeRequestIid: 42,
      },
    });

    expect(bundle.title).toBe("MR !42: Improve parser integration");
    expect(bundle.repositoryName).toBe("duck8823/locus");
    expect(bundle.branchLabel).toBe("feature/parser → main");
    expect(bundle.snapshotPairs).toHaveLength(4);

    const modified = bundle.snapshotPairs.find((pair) => pair.filePath === "src/service.ts");
    expect(modified?.before?.content).toContain("return 1");
    expect(modified?.after?.content).toContain("return 2");
    expect(modified?.after?.metadata.codeHost).toBe("gitlab");

    const renamed = bundle.snapshotPairs.find((pair) => pair.filePath === "src/new-name.ts");
    expect(renamed?.before?.filePath).toBe("src/old-name.ts");
    expect(renamed?.after?.filePath).toBe("src/new-name.ts");

    const removed = bundle.snapshotPairs.find((pair) => pair.filePath === "src/removed.ts");
    expect(removed?.before?.content).toContain("removed = true");
    expect(removed?.after).toBeNull();

    const added = bundle.snapshotPairs.find((pair) => pair.filePath === "src/added.ts");
    expect(added?.before).toBeNull();
    expect(added?.after?.content).toContain("added = true");

    expect(seenAuthorizationHeaders.every((value) => value === null)).toBe(true);
    expect(seenPrivateTokenHeaders.every((value) => value === null)).toBe(true);
  });

  it("falls back to branch refs when diff refs are missing", async () => {
    const requestedPaths: string[] = [];
    const provider = new GitLabPullRequestSnapshotProvider({
      token: "test-token",
      apiBaseUrl: "https://gitlab.com/api/v4",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const path = `${url.pathname}${url.search}`;
        requestedPaths.push(path);

        switch (path) {
          case "/api/v4/projects/duck8823%2Flocus/merge_requests/7":
            return jsonResponse({
              title: "Fallback refs",
              source_branch: "feature/fallback",
              target_branch: "main",
            });
          case "/api/v4/projects/duck8823%2Flocus/merge_requests/7/changes":
            return jsonResponse({
              changes: [
                {
                  old_path: "docs/readme.md",
                  new_path: "docs/readme.md",
                },
              ],
            });
          case "/api/v4/projects/duck8823%2Flocus/repository/files/docs%2Freadme.md/raw?ref=main":
            return textResponse("before\n");
          case "/api/v4/projects/duck8823%2Flocus/repository/files/docs%2Freadme.md/raw?ref=feature%2Ffallback":
            return textResponse("after\n");
          default:
            return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
        }
      },
    });

    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "gitlab-mr-7",
      source: {
        provider: "gitlab",
        projectPath: "duck8823/locus",
        mergeRequestIid: 7,
      },
    });

    expect(bundle.snapshotPairs).toHaveLength(1);
    expect(requestedPaths).toContain(
      "/api/v4/projects/duck8823%2Flocus/repository/files/docs%2Freadme.md/raw?ref=main",
    );
    expect(requestedPaths).toContain(
      "/api/v4/projects/duck8823%2Flocus/repository/files/docs%2Freadme.md/raw?ref=feature%2Ffallback",
    );
  });

  it("treats binary file contents as unsupported snapshots", async () => {
    const provider = new GitLabPullRequestSnapshotProvider({
      apiBaseUrl: "https://gitlab.com/api/v4",
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const path = `${url.pathname}${url.search}`;

        switch (path) {
          case "/api/v4/projects/duck8823%2Flocus/merge_requests/9":
            return jsonResponse({
              title: "Binary logo update",
              source_branch: "feature/logo",
              target_branch: "main",
              diff_refs: { base_sha: "base", head_sha: "head" },
            });
          case "/api/v4/projects/duck8823%2Flocus/merge_requests/9/changes":
            return jsonResponse({
              changes: [
                {
                  old_path: "assets/logo.png",
                  new_path: "assets/logo.png",
                },
              ],
            });
          case "/api/v4/projects/duck8823%2Flocus/repository/files/assets%2Flogo.png/raw?ref=base":
          case "/api/v4/projects/duck8823%2Flocus/repository/files/assets%2Flogo.png/raw?ref=head":
            return textResponse(new Uint8Array([0, 1, 2, 3]).buffer);
          default:
            return jsonResponse({ error: `unexpected URL: ${path}` }, 404);
        }
      },
    });

    const bundle = await provider.fetchPullRequestSnapshots({
      reviewId: "gitlab-mr-9",
      source: {
        provider: "gitlab",
        projectPath: "duck8823/locus",
        mergeRequestIid: 9,
      },
    });

    expect(bundle.snapshotPairs).toEqual([
      {
        fileId: expect.any(String),
        filePath: "assets/logo.png",
        before: null,
        after: null,
      },
    ]);
  });

  it("uses request token ahead of configured token and raises auth errors", async () => {
    const seenAuthorizationHeaders: Array<string | null> = [];
    const seenPrivateTokenHeaders: Array<string | null> = [];
    const provider = new GitLabPullRequestSnapshotProvider({
      token: "configured-token",
      apiBaseUrl: "https://gitlab.com/api/v4",
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers);
        seenAuthorizationHeaders.push(headers.get("authorization"));
        seenPrivateTokenHeaders.push(headers.get("private-token"));
        return jsonResponse({ message: "Unauthorized" }, 401);
      },
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "gitlab-auth",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 401,
        },
        accessToken: "request-token",
      }),
    ).rejects.toBeInstanceOf(PullRequestProviderAuthError);

    expect(seenAuthorizationHeaders[0]).toBe("Bearer request-token");
    expect(seenPrivateTokenHeaders[0]).toBe("request-token");
  });

  it("fails fast when a request times out", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const provider = new GitLabPullRequestSnapshotProvider({
      token: "",
      apiBaseUrl: "https://gitlab.com/api/v4",
      fetchImpl,
      requestTimeoutMs: 5,
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "gitlab-timeout",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 13,
        },
      }),
    ).rejects.toThrow("timed out");
  });

  it("throws with request path when GitLab API responds with non-success", async () => {
    const provider = new GitLabPullRequestSnapshotProvider({
      apiBaseUrl: "https://gitlab.com/api/v4",
      fetchImpl: async () => jsonResponse({ message: "Internal Server Error" }, 500),
    });

    await expect(
      provider.fetchPullRequestSnapshots({
        reviewId: "gitlab-500",
        source: {
          provider: "gitlab",
          projectPath: "duck8823/locus",
          mergeRequestIid: 500,
        },
      }),
    ).rejects.toThrow("/projects/duck8823%2Flocus/merge_requests/500");
  });
});
