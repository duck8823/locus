import { describe, expect, it } from "vitest";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { ConnectionCatalogEntry } from "@/server/application/services/connection-catalog";
import { SetConnectionStateUseCase } from "@/server/application/usecases/set-connection-state";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { PersistedConnectionState } from "@/server/domain/value-objects/connection-state";

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
    const useCase = new SetConnectionStateUseCase({
      connectionStateRepository: repository,
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
  });

  it("rejects unsupported provider", async () => {
    const useCase = new SetConnectionStateUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository(),
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
