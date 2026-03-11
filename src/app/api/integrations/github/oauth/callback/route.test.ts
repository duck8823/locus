import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getDependenciesMock,
  executeMock,
  consumePendingStateMock,
} = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
  consumePendingStateMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/application/usecases/complete-github-oauth-callback", () => ({
  CompleteGitHubOAuthCallbackUseCase: class {
    async execute(input: unknown) {
      return executeMock(input);
    }
  },
}));

import { GET } from "./route";

describe("GET /api/integrations/github/oauth/callback", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    consumePendingStateMock.mockReset();
    getDependenciesMock.mockReturnValue({
      oauthStateRepository: {
        consumePendingState: consumePendingStateMock,
      },
      connectionTokenRepository: {},
      connectionStateTransitionRepository: {},
      connectionProviderCatalog: {},
    });
  });

  it("completes callback and redirects with success flag", async () => {
    executeMock.mockResolvedValue({
      reviewerId: "Demo reviewer",
      redirectPath: "/settings/connections",
    });

    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/callback?state=state-1&code=code-1"),
    );

    expect(response.status).toBe(307);
    expect(executeMock).toHaveBeenCalledWith({
      state: "state-1",
      code: "code-1",
    });
    expect(response.headers.get("location")).toBe(
      "https://locus.test/settings/connections?oauthSuccess=github_connected",
    );
  });

  it("redirects with callback-invalid when required params are missing", async () => {
    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/callback?state=state-1"),
    );

    expect(response.status).toBe(307);
    expect(executeMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://locus.test/settings/connections?oauthError=oauth_callback_invalid",
    );
  });

  it("handles provider-denied callbacks with state-aware redirect", async () => {
    consumePendingStateMock.mockResolvedValue({
      state: "state-1",
      provider: "github",
      reviewerId: "Demo reviewer",
      redirectPath: "/settings/connections",
      codeVerifier: "verifier",
      createdAt: "2026-03-12T00:00:00.000Z",
      expiresAt: "2026-03-12T00:10:00.000Z",
    });

    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/callback?error=access_denied&state=state-1"),
    );

    expect(response.status).toBe(307);
    expect(consumePendingStateMock).toHaveBeenCalledWith("state-1");
    expect(executeMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://locus.test/settings/connections?oauthError=oauth_provider_rejected",
    );
  });

  it("redirects with callback-failed when use case throws", async () => {
    executeMock.mockRejectedValue(new Error("state expired"));

    const response = await GET(
      new Request("https://locus.test/api/integrations/github/oauth/callback?state=state-1&code=code-1"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://locus.test/settings/connections?oauthError=oauth_callback_failed",
    );
  });
});
