import { NextResponse } from "next/server";
import {
  OAuthCodeExchangeRejectedError,
  OAuthCodeExchangeTemporaryError,
} from "@/server/application/ports/oauth-code-exchange-provider";
import { CompleteGitHubOAuthCallbackUseCase } from "@/server/application/usecases/complete-github-oauth-callback";
import { getDependencies } from "@/server/composition/dependencies";

const DEFAULT_REDIRECT_PATH = "/settings/connections";

function createCallbackUrl(request: Request): string {
  return new URL("/api/integrations/github/oauth/callback", request.url).toString();
}

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
  const callbackUrl = createCallbackUrl(request);
  const state = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");
  const providerError = requestUrl.searchParams.get("error");
  const {
    oauthStateRepository,
    oauthCodeExchangeProvider,
    connectionTokenRepository,
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  } =
    getDependencies();
  const useCase = new CompleteGitHubOAuthCallbackUseCase({
    oauthStateRepository,
    oauthCodeExchangeProvider,
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
      redirectUri: callbackUrl,
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
  } catch (error) {
    if (error instanceof OAuthCodeExchangeTemporaryError) {
      return NextResponse.redirect(
        toRedirectUrl({
          request,
          path: DEFAULT_REDIRECT_PATH,
          params: new URLSearchParams({
            oauthError: "oauth_callback_retryable",
          }),
        }),
      );
    }

    if (error instanceof OAuthCodeExchangeRejectedError) {
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
