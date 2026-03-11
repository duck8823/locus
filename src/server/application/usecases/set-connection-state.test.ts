import { describe, expect, it } from "vitest";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { ConnectionCatalogEntry } from "@/server/application/services/connection-catalog";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import type {
  ConnectionStateTransitionRepository,
  ConnectionStateTransitionTransactionalRepository,
} from "@/server/domain/repositories/connection-state-transition-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type {
  PersistedConnectionStateTransition,
  PersistedConnectionStateTransitionDraft,
} from "@/server/domain/value-objects/connection-state-transition";

class InMemoryTransactionalConnectionStateTransitionRepository
  implements
    ConnectionStateTransitionRepository,
    ConnectionStateTransitionTransactionalRepository
{
  private readonly recordsByReviewerId: Record<string, PersistedConnectionState[]>;
  private transitions: PersistedConnectionStateTransition[] = [];
  transactionalCallCount = 0;

  constructor(initialStatesByReviewerId: Record<string, PersistedConnectionState[]> = {}) {
    this.recordsByReviewerId = { ...initialStatesByReviewerId };
  }

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

  async findStatesByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    return this.recordsByReviewerId[reviewerId] ?? [];
  }

  async updateStateAndAppendTransition(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => {
      states: PersistedConnectionState[];
      transition: PersistedConnectionStateTransitionDraft | null;
    },
  ): Promise<{ states: PersistedConnectionState[]; transition: PersistedConnectionStateTransition | null }> {
    this.transactionalCallCount += 1;

    const next = updater(this.recordsByReviewerId[reviewerId] ?? []);
    this.recordsByReviewerId[reviewerId] = next.states;

    if (!next.transition) {
      return {
        states: next.states,
        transition: null,
      };
    }

    const transition = await this.appendTransition(next.transition);

    return {
      states: next.states,
      transition,
    };
  }
}

class InMemoryConnectionProviderCatalog implements ConnectionProviderCatalog {
  listProviders(): ConnectionCatalogEntry[] {
    return [
      {
        provider: "github" as const,
        status: "not_connected" as const,
        authMode: "oauth" as const,
        capabilities: {
          supportsWebhook: true,
          supportsIssueContext: true,
        },
      },
      {
        provider: "confluence" as const,
        status: "planned" as const,
        authMode: "oauth" as const,
        capabilities: {
          supportsWebhook: false,
          supportsIssueContext: true,
        },
      },
    ];
  }
}

describe("SetConnectionStateUseCase", () => {
  it("persists state transition from catalog default not_connected to connected", async () => {
    const transitionRepository = new InMemoryTransactionalConnectionStateTransitionRepository();
    const useCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository: transitionRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    const result = await useCase.execute({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "connected",
      connectedAccountLabel: "duck8823",
    });

    expect(result.provider).toBe("github");
    expect(result.status).toBe("connected");
    expect(result.connectedAccountLabel).toBe("duck8823");
    expect(Number.isNaN(Date.parse(result.statusUpdatedAt))).toBe(false);
    await expect(transitionRepository.findStatesByReviewerId("demo-reviewer")).resolves.toEqual([
      {
        provider: "github",
        status: "connected",
        statusUpdatedAt: result.statusUpdatedAt,
        connectedAccountLabel: "duck8823",
      },
    ]);
    await expect(transitionRepository.listRecentByReviewerId("demo-reviewer")).resolves.toEqual([
      {
        transitionId: "transition-1",
        reviewerId: "demo-reviewer",
        provider: "github",
        previousStatus: "not_connected",
        nextStatus: "connected",
        changedAt: result.statusUpdatedAt,
        reason: "manual",
        actorType: "reviewer",
        actorId: "demo-reviewer",
        connectedAccountLabel: "duck8823",
      },
    ]);
    expect(transitionRepository.transactionalCallCount).toBe(1);
  });

  it("rejects unsupported provider", async () => {
    const useCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository:
        new InMemoryTransactionalConnectionStateTransitionRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    await expect(
      useCase.execute({
        reviewerId: "demo-reviewer",
        provider: "jira",
        nextStatus: "connected",
        connectedAccountLabel: "duck8823",
      }),
    ).rejects.toThrow("Unsupported connection provider: jira");
  });

  it("rejects invalid transition from planned provider status", async () => {
    const useCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository:
        new InMemoryTransactionalConnectionStateTransitionRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    await expect(
      useCase.execute({
        reviewerId: "demo-reviewer",
        provider: "confluence",
        nextStatus: "connected",
        connectedAccountLabel: "duck8823",
      }),
    ).rejects.toThrow("Invalid connection status transition: planned -> connected");
  });

  it("uses latest persisted state when validating transition", async () => {
    const transitionRepository = new InMemoryTransactionalConnectionStateTransitionRepository({
      "demo-reviewer": [
        {
          provider: "github",
          status: "connected",
          statusUpdatedAt: "2026-03-11T01:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
        {
          provider: "github",
          status: "reauth_required",
          statusUpdatedAt: "2026-03-11T02:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
      ],
    });

    const useCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository: transitionRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    const result = await useCase.execute({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "connected",
      connectedAccountLabel: null,
    });

    expect(result.status).toBe("connected");
    expect(result.connectedAccountLabel).toBe("duck8823");
  });

  it("clears account label when status moves to not_connected", async () => {
    const transitionRepository = new InMemoryTransactionalConnectionStateTransitionRepository({
      "demo-reviewer": [
        {
          provider: "github",
          status: "connected",
          statusUpdatedAt: "2026-03-11T01:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
      ],
    });
    const useCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository: transitionRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    const result = await useCase.execute({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "not_connected",
      connectedAccountLabel: "should-clear",
    });

    expect(result.connectedAccountLabel).toBeNull();
    await expect(transitionRepository.findStatesByReviewerId("demo-reviewer")).resolves.toEqual([
      {
        provider: "github",
        status: "not_connected",
        statusUpdatedAt: result.statusUpdatedAt,
        connectedAccountLabel: null,
      },
    ]);
  });

  it("persists explicit transition reason and actor metadata", async () => {
    const transitionRepository = new InMemoryTransactionalConnectionStateTransitionRepository({
      "demo-reviewer": [
        {
          provider: "github",
          status: "connected",
          statusUpdatedAt: "2026-03-11T01:00:00.000Z",
          connectedAccountLabel: "duck8823",
        },
      ],
    });
    const useCase = new SetConnectionStateUseCase({
      connectionStateTransitionRepository: transitionRepository,
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    const result = await useCase.execute({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "reauth_required",
      connectedAccountLabel: null,
      transitionReason: "token-expired",
      transitionActorType: "system",
      transitionActorId: "oauth-token-monitor",
    });

    expect(result.status).toBe("reauth_required");
    await expect(transitionRepository.listRecentByReviewerId("demo-reviewer")).resolves.toEqual([
      {
        transitionId: "transition-1",
        reviewerId: "demo-reviewer",
        provider: "github",
        previousStatus: "connected",
        nextStatus: "reauth_required",
        changedAt: result.statusUpdatedAt,
        reason: "token-expired",
        actorType: "system",
        actorId: "oauth-token-monitor",
        connectedAccountLabel: "duck8823",
      },
    ]);
  });
});
