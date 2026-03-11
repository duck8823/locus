import { describe, expect, it } from "vitest";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { ConnectionCatalogEntry } from "@/server/application/services/connection-catalog";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { ConnectionStateTransitionRepository } from "@/server/domain/repositories/connection-state-transition-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";
import type { PersistedConnectionStateTransition } from "@/server/domain/value-objects/connection-state-transition";

class InMemoryConnectionStateRepository implements ConnectionStateRepository {
  constructor(
    private readonly recordsByReviewerId: Record<string, PersistedConnectionState[]> = {},
  ) {}

  async findByReviewerId(reviewerId: string): Promise<PersistedConnectionState[]> {
    return this.recordsByReviewerId[reviewerId] ?? [];
  }

  async saveForReviewerId(reviewerId: string, states: PersistedConnectionState[]): Promise<void> {
    this.recordsByReviewerId[reviewerId] = states;
  }

  async updateForReviewerId(
    reviewerId: string,
    updater: (states: PersistedConnectionState[]) => PersistedConnectionState[],
  ): Promise<PersistedConnectionState[]> {
    const nextStates = updater(this.recordsByReviewerId[reviewerId] ?? []);
    this.recordsByReviewerId[reviewerId] = nextStates;
    return nextStates;
  }
}

class InMemoryConnectionStateTransitionRepository
  implements ConnectionStateTransitionRepository
{
  private records: PersistedConnectionStateTransition[] = [];

  async appendTransition(
    transition: Omit<PersistedConnectionStateTransition, "transitionId">,
  ): Promise<PersistedConnectionStateTransition> {
    const saved: PersistedConnectionStateTransition = {
      transitionId: `transition-${this.records.length + 1}`,
      ...transition,
    };

    this.records.push(saved);
    return saved;
  }

  async listRecentByReviewerId(
    reviewerId: string,
  ): Promise<PersistedConnectionStateTransition[]> {
    return this.records.filter((transition) => transition.reviewerId === reviewerId);
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
    const repository = new InMemoryConnectionStateRepository();
    const transitionRepository = new InMemoryConnectionStateTransitionRepository();
    const useCase = new SetConnectionStateUseCase({
      connectionStateRepository: repository,
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
    await expect(repository.findByReviewerId("demo-reviewer")).resolves.toEqual([
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
        connectedAccountLabel: "duck8823",
      },
    ]);
  });

  it("rejects unsupported provider", async () => {
    const useCase = new SetConnectionStateUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository(),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository(),
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
      connectionStateRepository: new InMemoryConnectionStateRepository(),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository(),
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
    const repository = new InMemoryConnectionStateRepository({
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
      connectionStateRepository: repository,
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository(),
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
    const repository = new InMemoryConnectionStateRepository({
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
      connectionStateRepository: repository,
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository(),
      connectionProviderCatalog: new InMemoryConnectionProviderCatalog(),
    });

    const result = await useCase.execute({
      reviewerId: "demo-reviewer",
      provider: "github",
      nextStatus: "not_connected",
      connectedAccountLabel: "should-clear",
    });

    expect(result.connectedAccountLabel).toBeNull();
    await expect(repository.findByReviewerId("demo-reviewer")).resolves.toEqual([
      {
        provider: "github",
        status: "not_connected",
        statusUpdatedAt: result.statusUpdatedAt,
        connectedAccountLabel: null,
      },
    ]);
  });
});
