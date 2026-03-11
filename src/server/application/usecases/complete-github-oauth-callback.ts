import type { ConnectionTokenRepository } from "@/server/application/ports/connection-token-repository";
import type { OAuthStateRepository } from "@/server/application/ports/oauth-state-repository";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { OAuthCodeExchangeProvider } from "@/server/application/ports/oauth-code-exchange-provider";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import type { ConnectionStateTransitionTransactionalRepository } from "@/server/domain/repositories/connection-state-transition-repository";

export interface CompleteGitHubOAuthCallbackInput {
  state: string;
  code: string;
  redirectUri: string;
}

export interface CompleteGitHubOAuthCallbackDependencies {
  oauthStateRepository: OAuthStateRepository;
  oauthCodeExchangeProvider: OAuthCodeExchangeProvider;
  connectionTokenRepository: ConnectionTokenRepository;
  connectionStateTransitionRepository: ConnectionStateTransitionTransactionalRepository;
  connectionProviderCatalog: ConnectionProviderCatalog;
}

export interface CompleteGitHubOAuthCallbackResult {
  reviewerId: string;
  redirectPath: string;
}

export class CompleteGitHubOAuthCallbackUseCase {
  constructor(private readonly dependencies: CompleteGitHubOAuthCallbackDependencies) {}

  async execute(input: CompleteGitHubOAuthCallbackInput): Promise<CompleteGitHubOAuthCallbackResult> {
    const state = normalizeState(input.state);
    const code = normalizeAuthorizationCode(input.code);
    const redirectUri = normalizeRedirectUri(input.redirectUri);
    const pending = await this.dependencies.oauthStateRepository.consumePendingState(state);

    if (!pending) {
      throw new Error("OAuth state is invalid or expired.");
    }

    if (Date.parse(pending.expiresAt) <= Date.now()) {
      throw new Error("OAuth state has expired.");
    }

    const updatedAt = new Date().toISOString();
    const exchangedToken = await this.dependencies.oauthCodeExchangeProvider.exchangeGitHubCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri,
    });

    await this.dependencies.connectionTokenRepository.upsertToken({
      reviewerId: pending.reviewerId,
      provider: "github",
      accessToken: exchangedToken.accessToken,
      tokenType: exchangedToken.tokenType,
      scope: exchangedToken.scope,
      refreshToken: exchangedToken.refreshToken,
      expiresAt: exchangedToken.expiresAt,
      updatedAt,
    });

    const setConnectionStateUseCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository: this.dependencies.connectionStateTransitionRepository,
      connectionProviderCatalog: this.dependencies.connectionProviderCatalog,
    });

    await setConnectionStateUseCase.execute({
      reviewerId: pending.reviewerId,
      provider: "github",
      nextStatus: "connected",
      connectedAccountLabel: null,
      transitionReason: "manual",
      transitionActorType: "reviewer",
      transitionActorId: pending.reviewerId,
    });

    return {
      reviewerId: pending.reviewerId,
      redirectPath: pending.redirectPath,
    };
  }
}

function normalizeState(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > 512) {
    throw new Error("Invalid OAuth state.");
  }

  return normalized;
}

function normalizeAuthorizationCode(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > 2048) {
    throw new Error("Invalid OAuth code.");
  }

  return normalized;
}

function normalizeRedirectUri(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error("Invalid OAuth redirect URI.");
  }

  try {
    const parsed = new URL(normalized);

    if (!parsed.protocol || !parsed.host) {
      throw new Error("missing URL host");
    }

    return parsed.toString();
  } catch {
    throw new Error("Invalid OAuth redirect URI.");
  }
}
