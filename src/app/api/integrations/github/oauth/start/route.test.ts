import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDependenciesMock,
  cookiesMock,
  executeMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  cookiesMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/server/application/usecases/prepare-github-oauth-start", () => ({
  PrepareGitHubOAuthStartUseCase: class {
    async execute(input: unknown) {
      return executeMock(input);
    }
  },
}));

import { GET } from "./route";

describe("GET /api/integrations/github/oauth/start", () => {
  const originalClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const originalScope = process.env.GITHUB_OAUTH_SCOPE;

  beforeEach(() => {
    getDependenciesMock.mockReset();
    cookiesMock.mockReset();
    executeMock.mockReset();
    getDependenciesMock.mockReturnValue({
      oauthStateRepository: {},
    });
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "locus-demo-viewer" ? { value: "Demo reviewer" } : undefined,
      ),
    });
    process.env.GITHUB_OAUTH_CLIENT_ID = "";
    process.env.GITHUB_OAUTH_SCOPE = "";
  });

  it("redirects to GitHub authorize URL when client id is configured", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "github-client-id";
    executeMock.mockResolvedValue({
      state: "state-1",
      authorizeUrl: "https://github.com/login/oauth/authorize?state=state-1",
      redirectPath: "/settings/connections",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/start?redirectPath=/settings/connections"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/login/oauth/authorize?state=state-1",
    );
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewerId: "Demo reviewer",
        clientId: "github-client-id",
        redirectPath: "/settings/connections",
      }),
    );
  });

  it("falls back to local demo callback when client id is missing", async () => {
    executeMock.mockResolvedValue({
      state: "state-2",
      authorizeUrl: "https://github.com/login/oauth/authorize?state=state-2",
      redirectPath: "/settings/connections",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/start?redirectPath=/settings/connections"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://locus.test/api/integrations/github/oauth/callback?state=state-2&code=demo-code-state-2",
    );
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "locus-demo-oauth-client-id",
      }),
    );
  });

  it("falls back to default redirect path when given an invalid redirect path", async () => {
    executeMock.mockResolvedValue({
      state: "state-3",
      authorizeUrl: "https://github.com/login/oauth/authorize?state=state-3",
      redirectPath: "/settings/connections",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    await GET(
      new Request("https://locus.test/api/integrations/github/oauth/start?redirectPath=https://evil.example"),
    );

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectPath: "/settings/connections",
      }),
    );
  });

  it("returns settings error redirect when prepare use case fails", async () => {
    executeMock.mockRejectedValue(new Error("failed"));

    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/start?redirectPath=/settings/connections"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://locus.test/settings/connections?oauthError=oauth_start_failed",
    );
  });

  afterEach(() => {
    process.env.GITHUB_OAUTH_CLIENT_ID = originalClientId;
    process.env.GITHUB_OAUTH_SCOPE = originalScope;
  });
});
