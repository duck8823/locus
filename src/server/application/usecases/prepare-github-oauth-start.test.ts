import { describe, expect, it } from "vitest";
import type {
  OAuthStateRepository,
  PendingOAuthState,
  SavePendingOAuthStateInput,
} from "@/server/application/ports/oauth-state-repository";
import { PrepareGitHubOAuthStartUseCase } from "@/server/application/usecases/prepare-github-oauth-start";

class InMemoryOAuthStateRepository implements OAuthStateRepository {
  states: PendingOAuthState[] = [];

  async savePendingState(input: SavePendingOAuthStateInput): Promise<PendingOAuthState> {
    const pending: PendingOAuthState = {
      ...input,
    };
    this.states.push(pending);
    return pending;
  }

  async consumePendingState(state: string): Promise<PendingOAuthState | null> {
    const index = this.states.findIndex((pending) => pending.state === state);

    if (index < 0) {
      return null;
    }

    const [consumed] = this.states.splice(index, 1);
    return consumed ?? null;
  }
}

describe("PrepareGitHubOAuthStartUseCase", () => {
  it("stores pending state and returns GitHub authorize URL", async () => {
    const oauthStateRepository = new InMemoryOAuthStateRepository();
    const useCase = new PrepareGitHubOAuthStartUseCase({
      oauthStateRepository,
    });

    const result = await useCase.execute({
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
      clientId: "github-client-id",
      redirectUri: "https://locus.test/api/integrations/github/oauth/callback",
      scope: "repo read:org",
    });

    expect(result.state).toHaveLength(43);
    expect(result.redirectPath).toBe("/settings/connections");
    expect(Number.isNaN(Date.parse(result.expiresAt))).toBe(false);
    expect(result.authorizeUrl).toContain(
      "https://github.com/login/oauth/authorize?",
    );

    const authorizeUrl = new URL(result.authorizeUrl);
    expect(authorizeUrl.searchParams.get("client_id")).toBe("github-client-id");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "https://locus.test/api/integrations/github/oauth/callback",
    );
    expect(authorizeUrl.searchParams.get("scope")).toBe("repo read:org");
    expect(authorizeUrl.searchParams.get("state")).toBe(result.state);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("code_challenge")).toBeTruthy();

    expect(oauthStateRepository.states).toHaveLength(1);
    expect(oauthStateRepository.states[0]).toMatchObject({
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
      provider: "github",
      state: result.state,
    });
  });

  it("rejects non-relative redirect paths", async () => {
    const useCase = new PrepareGitHubOAuthStartUseCase({
      oauthStateRepository: new InMemoryOAuthStateRepository(),
    });

    await expect(
      useCase.execute({
        reviewerId: "demo-reviewer",
        redirectPath: "https://example.com",
        clientId: "github-client-id",
        redirectUri: "https://locus.test/callback",
        scope: "repo read:org",
      }),
    ).rejects.toThrow("Invalid redirectPath");
  });
});
