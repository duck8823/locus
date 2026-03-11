import { describe, expect, it } from "vitest";
import type {
  ConnectionTokenRepository,
  PersistedConnectionToken,
  UpsertConnectionTokenInput,
} from "@/server/application/ports/connection-token-repository";
import type {
  OAuthStateRepository,
  PendingOAuthState,
  SavePendingOAuthStateInput,
} from "@/server/application/ports/oauth-state-repository";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type {
  ExchangeGitHubOAuthCodeInput,
  OAuthCodeExchangeProvider,
  OAuthCodeExchangeResult,
} from "@/server/application/ports/oauth-code-exchange-provider";
import type { ConnectionCatalogEntry } from "@/server/application/services/connection-catalog";
import { CompleteGitHubOAuthCallbackUseCase } from "@/server/application/usecases/complete-github-oauth-callback";
import type {
  ConnectionStateTransitionRepository,
  ConnectionStateTransitionTransactionalRepository,
} from "@/server/domain/repositories/connection-state-transition-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type {
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";

class InMemoryOAuthStateRepository implements OAuthStateRepository {
  states = new Map<string, PendingOAuthState>();

  async savePendingState(input: SavePendingOAuthStateInput): Promise<PendingOAuthState> {
    const pending: PendingOAuthState = { ...input };
    this.states.set(pending.state, pending);
    return pending;
  }

  async consumePendingState(state: string): Promise<PendingOAuthState | null> {
    const pending = this.states.get(state) ?? null;

    if (pending) {
      this.states.delete(state);
    }

    return pending;
  }
}

class InMemoryConnectionTokenRepository implements ConnectionTokenRepository {
  private readonly tokens = new Map<string, PersistedConnectionToken>();

  async upsertToken(input: UpsertConnectionTokenInput): Promise<PersistedConnectionToken> {
    const token: PersistedConnectionToken = { ...input };
    this.tokens.set(`${input.reviewerId}:${input.provider}`, token);
    return token;
  }

  async findTokenByReviewerId(
    reviewerId: string,
    provider: "github",
  ): Promise<PersistedConnectionToken | null> {
    return this.tokens.get(`${reviewerId}:${provider}`) ?? null;
  }
}

class InMemoryTransitionRepository
  implements
    ConnectionStateTransitionRepository,
    ConnectionStateTransitionTransactionalRepository
{
  private readonly statesByReviewerId = new Map<string, PersistedConnectionState[]>();
  transitions: PersistedConnectionStateTransition[] = [];

  async appendTransition(
    transition: PersistedConnectionStateTransitionDraft,
  ): Promise<PersistedConnectionStateTransition> {
    const saved: PersistedConnectionStateTransition = {
      transitionId: `transition-${this.transitions.length + 1}`,
      ...transition,
    };
    this.transitions.push(saved);
    return saved;
  }

  async listRecentByReviewerId(
    reviewerId: string,
  ): Promise<PersistedConnectionStateTransition[]> {
    return this.transitions.filter((transition) => transition.reviewerId === reviewerId);
  }

  async countByReviewerId(reviewerId: string): Promise<number> {
    return this.transitions.filter((transition) => transition.reviewerId === reviewerId).length;
  }

  async updateStateAndAppendTransition(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => {
      states: PersistedConnectionState[];
      transition: PersistedConnectionStateTransitionDraft | null;
    },
  ): Promise<{
    states: PersistedConnectionState[];
    transition: PersistedConnectionStateTransition | null;
  }> {
    const next = updater(this.statesByReviewerId.get(reviewerId) ?? []);
    this.statesByReviewerId.set(reviewerId, next.states);

    if (!next.transition) {
      return {
        states: next.states,
        transition: null,
      };
    }

    return {
      states: next.states,
      transition: await this.appendTransition(next.transition),
    };
  }
}

class InMemoryConnectionProviderCatalog implements ConnectionProviderCatalog {
  listProviders(): ConnectionCatalogEntry[] {
    return [
      {
        provider: "github",
        status: "not_connected",
        authMode: "oauth",
        capabilities: {
          supportsWebhook: true,
          supportsIssueContext: true,
        },
      },
    ];
  }
}

class StubOAuthCodeExchangeProvider implements OAuthCodeExchangeProvider {
  lastInput: ExchangeGitHubOAuthCodeInput | null = null;

  constructor(
    private readonly result: OAuthCodeExchangeResult = {
      accessToken: "oauth-access-token",
      tokenType: "bearer",
      scope: "repo read:org",
      refreshToken: null,
      expiresAt: null,
    },
  ) {}

  async exchangeGitHubCode(input: ExchangeGitHubOAuthCodeInput): Promise<OAuthCodeExchangeResult> {
    this.lastInput = input;
    return this.result;
  }
}

describe("CompleteGitHubOAuthCallbackUseCase", () => {
  it("consumes state, exchanges code, and marks connection as connected", async () => {
    const oauthStateRepository = new InMemoryOAuthStateRepository();
    await oauthStateRepository.savePendingState({
      state: "state-1",
      provider: "github",
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
      codeVerifier: "verifier-1",
      createdAt: "2026-03-12T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const connectionTokenRepository = new InMemoryConnectionTokenRepository();
    const transitionRepository = new InMemoryTransitionRepository();
    const oauthCodeExchangeProvider = new StubOAuthCodeExchangeProvider();
    const useCase = new CompleteGitHubOAuthCallbackUseCase({
      oauthStateRepository,
      oauthCodeExchangeProvider,
      connectionTokenRepository,
      connectionStateTransitionRepository: transitionRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    const result = await useCase.execute({
      state: "state-1",
      code: "auth-code-xyz",
      redirectUri: "https://locus.test/api/integrations/github/oauth/callback",
    });

    expect(result).toEqual({
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
    });
    expect(oauthCodeExchangeProvider.lastInput).toEqual({
      code: "auth-code-xyz",
      codeVerifier: "verifier-1",
      redirectUri: "https://locus.test/api/integrations/github/oauth/callback",
    });
    await expect(
      connectionTokenRepository.findTokenByReviewerId("demo-reviewer", "github"),
    ).resolves.toMatchObject({
      reviewerId: "demo-reviewer",
      provider: "github",
      accessToken: "oauth-access-token",
      tokenType: "bearer",
    });
    await expect(
      transitionRepository.listRecentByReviewerId("demo-reviewer"),
    ).resolves.toEqual([
      expect.objectContaining({
        reviewerId: "demo-reviewer",
        provider: "github",
        previousStatus: "not_connected",
        nextStatus: "connected",
        reason: "manual",
        actorType: "reviewer",
      }),
    ]);
  });

  it("rejects unknown state", async () => {
    const useCase = new CompleteGitHubOAuthCallbackUseCase({
      oauthStateRepository: new InMemoryOAuthStateRepository(),
      oauthCodeExchangeProvider: new StubOAuthCodeExchangeProvider(),
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionStateTransitionRepository: new InMemoryTransitionRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    await expect(
      useCase.execute({
        state: "missing-state",
        code: "auth-code",
        redirectUri: "https://locus.test/api/integrations/github/oauth/callback",
      }),
    ).rejects.toThrow("OAuth state is invalid or expired.");
  });

  it("rejects invalid redirect URI", async () => {
    const oauthStateRepository = new InMemoryOAuthStateRepository();
    await oauthStateRepository.savePendingState({
      state: "state-1",
      provider: "github",
      reviewerId: "demo-reviewer",
      redirectPath: "/settings/connections",
      codeVerifier: "verifier-1",
      createdAt: "2026-03-12T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const useCase = new CompleteGitHubOAuthCallbackUseCase({
      oauthStateRepository,
      oauthCodeExchangeProvider: new StubOAuthCodeExchangeProvider(),
      connectionTokenRepository: new InMemoryConnectionTokenRepository(),
      connectionStateTransitionRepository: new InMemoryTransitionRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    await expect(
      useCase.execute({
        state: "state-1",
        code: "auth-code",
        redirectUri: "not-a-url",
      }),
    ).rejects.toThrow("Invalid OAuth redirect URI.");
  });
});
