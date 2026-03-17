import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PrepareGitHubOAuthStartUseCase } from "@/server/application/usecases/prepare-github-oauth-start";
import { getDependencies } from "@/server/composition/dependencies";
import { DEMO_VIEWER_COOKIE_NAME } from "@/server/presentation/actions/demo-viewer-cookie-name";
import { resolveAuthenticatedReviewerId } from "@/server/presentation/actions/reviewer-identity";

const DEFAULT_REDIRECT_PATH = "/settings/connections";

function resolveRelativeRedirectPath(pathValue: string | null): string {
  if (
    !pathValue ||
    !pathValue.startsWith("/") ||
    pathValue.startsWith("//") ||
    pathValue.includes("\\")
  ) {
    return DEFAULT_REDIRECT_PATH;
  }

  return pathValue;
}

function createCallbackUrl(request: Request): string {
  return new URL("/api/integrations/github/oauth/callback", request.url).toString();
}

function readOptionalEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function createRedirectUrl(request: Request, path: string, params: URLSearchParams): URL {
  const url = new URL(path, request.url);

  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const redirectPath = resolveRelativeRedirectPath(requestUrl.searchParams.get("redirectPath"));
  const callbackUrl = createCallbackUrl(request);
  const scope = readOptionalEnvironmentVariable("GITHUB_OAUTH_SCOPE") || "repo read:org";
  const clientId = readOptionalEnvironmentVariable("GITHUB_OAUTH_CLIENT_ID");
  const cookieStore = await cookies();
  const { reviewerId } = await resolveAuthenticatedReviewerId(
    cookieStore.get(DEMO_VIEWER_COOKIE_NAME)?.value,
  );
  const { oauthStateRepository } = getDependencies();
  const useCase = new PrepareGitHubOAuthStartUseCase({
    oauthStateRepository,
  });

  try {
    const prepared = await useCase.execute({
      reviewerId,
      redirectPath,
      clientId: clientId || "locus-demo-oauth-client-id",
      redirectUri: callbackUrl,
      scope,
    });

    if (clientId.length > 0) {
      return NextResponse.redirect(prepared.authorizeUrl);
    }

    const demoCallbackUrl = new URL(callbackUrl);
    demoCallbackUrl.searchParams.set("state", prepared.state);
    demoCallbackUrl.searchParams.set("code", `demo-code-${prepared.state.slice(0, 12)}`);
    return NextResponse.redirect(demoCallbackUrl);
  } catch {
    return NextResponse.redirect(
      createRedirectUrl(request, redirectPath, new URLSearchParams({
        oauthError: "oauth_start_failed",
      })),
    );
  }
}
