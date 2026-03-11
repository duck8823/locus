import { NextResponse } from "next/server";
import { CompleteGitHubOAuthCallbackUseCase } from "@/server/application/usecases/complete-github-oauth-callback";
import { getDependencies } from "@/server/composition/dependencies";

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

function toRedirectUrl(input: {
  request: Request;
  path: string;
  params: URLSearchParams;
}): URL {
  const url = new URL(input.path, input.request.url);

  for (const [key, value] of input.params.entries()) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.get("error");
  const { oauthStateRepository, connectionTokenRepository, connectionStateTransitionRepository, connectionProviderCatalog } =
    getDependencies();
  const useCase = new CompleteGitHubOAuthCallbackUseCase({
    oauthStateRepository,
    connectionTokenRepository,
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  });

  if (providerError) {
    const consumed = state ? await oauthStateRepository.consumePendingState(state) : null;
    const redirectPath = resolveRelativeRedirectPath(consumed?.redirectPath ?? null);

    return NextResponse.redirect(
      toRedirectUrl({
        request,
        path: redirectPath,
        params: new URLSearchParams({
          oauthError: "oauth_provider_rejected",
        }),
      }),
    );
  }

  if (!state || !code) {
    return NextResponse.redirect(
      toRedirectUrl({
        request,
        path: DEFAULT_REDIRECT_PATH,
        params: new URLSearchParams({
          oauthError: "oauth_callback_invalid",
        }),
      }),
    );
  }

  try {
    const completed = await useCase.execute({
      state,
      code,
    });

    return NextResponse.redirect(
      toRedirectUrl({
        request,
        path: resolveRelativeRedirectPath(completed.redirectPath),
        params: new URLSearchParams({
          oauthSuccess: "github_connected",
        }),
      }),
    );
  } catch {
    return NextResponse.redirect(
      toRedirectUrl({
        request,
        path: DEFAULT_REDIRECT_PATH,
        params: new URLSearchParams({
          oauthError: "oauth_callback_failed",
        }),
      }),
    );
  }
}
