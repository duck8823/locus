import { describe, expect, it } from "vitest";
import {
  OAuthCodeExchangeRejectedError,
  OAuthCodeExchangeTemporaryError,
} from "@/server/application/ports/oauth-code-exchange-provider";
import { GitHubOAuthCodeExchangeProvider } from "@/server/infrastructure/github/github-oauth-code-exchange-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("GitHubOAuthCodeExchangeProvider", () => {
  it("returns demo token when client credentials are not configured and code is demo", async () => {
    const provider = new GitHubOAuthCodeExchangeProvider({
      clientId: "",
      clientSecret: "",
    });

    const result = await provider.exchangeGitHubCode({
      code: "demo-code-state-1",
      codeVerifier: "verifier-1",
      redirectUri: "https://locus.test/api/integrations/github/oauth/callback",
    });

    expect(result).toMatchObject({
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: null,
      expiresAt: null,
    });
    expect(result.accessToken).toMatch(/^demo-oauth-token-/);
  });

  it("rejects non-demo code when client credentials are not configured", async () => {
    const provider = new GitHubOAuthCodeExchangeProvider({
      clientId: "",
      clientSecret: "",
    });

    await expect(
      provider.exchangeGitHubCode({
        code: "real-code",
        codeVerifier: "verifier-1",
        redirectUri: "https://locus.test/callback",
      }),
    ).rejects.toBeInstanceOf(OAuthCodeExchangeRejectedError);
  });

  it("exchanges token using GitHub endpoint when credentials are configured", async () => {
    const seenRequestBodies: unknown[] = [];
    const provider = new GitHubOAuthCodeExchangeProvider({
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      tokenEndpoint: "https://github.test/login/oauth/access_token",
      fetchImpl: async (_input, init) => {
        seenRequestBodies.push(JSON.parse(String(init?.body)));

        return jsonResponse({
          access_token: "oauth-access-token",
          token_type: "bearer",
          scope: "repo read:org",
          refresh_token: "oauth-refresh-token",
          expires_in: 3600,
        });
      },
    });

    const result = await provider.exchangeGitHubCode({
      code: "real-code",
      codeVerifier: "verifier-1",
      redirectUri: "https://locus.test/callback",
    });

    expect(result.accessToken).toBe("oauth-access-token");
    expect(result.refreshToken).toBe("oauth-refresh-token");
    expect(result.expiresAt).toBeTruthy();
    expect(seenRequestBodies[0]).toMatchObject({
      client_id: "github-client-id",
      client_secret: "github-client-secret",
      code: "real-code",
      code_verifier: "verifier-1",
      redirect_uri: "https://locus.test/callback",
    });
  });

  it("classifies 5xx exchange failures as temporary", async () => {
    const provider = new GitHubOAuthCodeExchangeProvider({
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      fetchImpl: async () =>
        jsonResponse(
          {
            error: "server_error",
            error_description: "upstream unavailable",
          },
          503,
        ),
    });

    await expect(
      provider.exchangeGitHubCode({
        code: "real-code",
        codeVerifier: "verifier-1",
        redirectUri: "https://locus.test/callback",
      }),
    ).rejects.toBeInstanceOf(OAuthCodeExchangeTemporaryError);
  });

  it("classifies invalid_grant exchange failures as rejected", async () => {
    const provider = new GitHubOAuthCodeExchangeProvider({
      clientId: "github-client-id",
      clientSecret: "github-client-secret",
      fetchImpl: async () =>
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: "authorization code has expired",
          },
          400,
        ),
    });

    await expect(
      provider.exchangeGitHubCode({
        code: "real-code",
        codeVerifier: "verifier-1",
        redirectUri: "https://locus.test/callback",
      }),
    ).rejects.toBeInstanceOf(OAuthCodeExchangeRejectedError);
  });
});
