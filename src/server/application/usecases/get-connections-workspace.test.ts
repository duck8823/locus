import { describe, expect, it } from "vitest";
import { PrototypeConnectionProviderCatalog } from "@/server/application/services/connection-catalog";
import { GetConnectionsWorkspaceUseCase } from "@/server/application/usecases/get-connections-workspace";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { ConnectionStateTransitionRepository } from "@/server/domain/repositories/connection-state-transition-repository";
import type { PersistedConnectionStateTransition } from "@/server/domain/value-objects/connection-state-transition";

class InMemoryConnectionStateRepository implements ConnectionStateRepository {
  constructor(
    private readonly recordsByReviewerId: Record<
      string,
      {
        provider: string;
        status: string;
        statusUpdatedAt: string | null;
        connectedAccountLabel: string | null;
      }[]
    > = {},
  ) {}

  async findByReviewerId(reviewerId: string) {
    return this.recordsByReviewerId[reviewerId] ?? [];
  }

  async saveForReviewerId(
    reviewerId: string,
    states: {
      provider: string;
      status: string;
      statusUpdatedAt: string | null;
      connectedAccountLabel: string | null;
    }[],
  ): Promise<void> {
    this.recordsByReviewerId[reviewerId] = states;
  }

  async updateForReviewerId(
    reviewerId: string,
    updater: (
      states: {
        provider: string;
        status: string;
        statusUpdatedAt: string | null;
        connectedAccountLabel: string | null;
      }[],
    ) => {
      provider: string;
      status: string;
      statusUpdatedAt: string | null;
      connectedAccountLabel: string | null;
    }[],
  ) {
    const nextStates = updater(this.recordsByReviewerId[reviewerId] ?? []);
    this.recordsByReviewerId[reviewerId] = nextStates;
    return nextStates;
  }
}

class InMemoryConnectionStateTransitionRepository
  implements ConnectionStateTransitionRepository
{
  constructor(
    private readonly recordsByReviewerId: Record<string, PersistedConnectionStateTransition[]> = {},
  ) {}

  async appendTransition(
    transition: Omit<PersistedConnectionStateTransition, "transitionId">,
  ): Promise<PersistedConnectionStateTransition> {
    const saved: PersistedConnectionStateTransition = {
      transitionId: `transition-${Math.random().toString(36).slice(2, 9)}`,
      ...transition,
    };

    const next = this.recordsByReviewerId[transition.reviewerId]
      ? [...this.recordsByReviewerId[transition.reviewerId], saved]
      : [saved];
    this.recordsByReviewerId[transition.reviewerId] = next;
    return saved;
  }

  async listRecentByReviewerId(
    reviewerId: string,
  ): Promise<PersistedConnectionStateTransition[]> {
    return this.recordsByReviewerId[reviewerId] ?? [];
  }
}

const connectionProviderCatalog = new PrototypeConnectionProviderCatalog();

describe("GetConnectionsWorkspaceUseCase", () => {
  it("merges persisted reviewer state and recent transitions with catalog defaults", async () => {
    const useCase = new GetConnectionsWorkspaceUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository({
        "demo-reviewer": [
          {
            provider: "github",
            status: "connected",
            statusUpdatedAt: "2026-03-11T00:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      }),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository({
        "demo-reviewer": [
          {
            transitionId: "transition-1",
            reviewerId: "demo-reviewer",
            provider: "github",
            previousStatus: "not_connected",
            nextStatus: "connected",
            changedAt: "2026-03-11T00:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      }),
      connectionProviderCatalog,
    });

    const result = await useCase.execute({ reviewerId: "demo-reviewer" });

    expect(result.connections).toEqual([
      {
        provider: "github",
        status: "connected",
        authMode: "oauth",
        statusUpdatedAt: "2026-03-11T00:00:00.000Z",
        connectedAccountLabel: "duck8823",
        stateSource: "persisted",
        capabilities: {
          supportsWebhook: true,
          supportsIssueContext: true,
        },
        recentTransitions: [
          {
            transitionId: "transition-1",
            previousStatus: "not_connected",
            nextStatus: "connected",
            changedAt: "2026-03-11T00:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      },
      {
        provider: "confluence",
        status: "planned",
        authMode: "oauth",
        statusUpdatedAt: null,
        connectedAccountLabel: null,
        stateSource: "catalog_default",
        capabilities: {
          supportsWebhook: false,
          supportsIssueContext: true,
        },
        recentTransitions: [],
      },
      {
        provider: "jira",
        status: "planned",
        authMode: "oauth",
        statusUpdatedAt: null,
        connectedAccountLabel: null,
        stateSource: "catalog_default",
        capabilities: {
          supportsWebhook: false,
          supportsIssueContext: true,
        },
        recentTransitions: [],
      },
    ]);
  });

  it("passes through unknown future persisted status values", async () => {
    const useCase = new GetConnectionsWorkspaceUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository({
        "future-reviewer": [
          {
            provider: "github",
            status: "temporarily_locked",
            statusUpdatedAt: "2026-03-11T02:00:00.000Z",
            connectedAccountLabel: null,
          },
        ],
      }),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository(),
      connectionProviderCatalog,
    });

    const result = await useCase.execute({ reviewerId: "future-reviewer" });

    expect(result.connections[0]).toMatchObject({
      provider: "github",
      status: "temporarily_locked",
      stateSource: "persisted",
    });
  });

  it("prefers the latest persisted status when multiple states exist for one provider", async () => {
    const useCase = new GetConnectionsWorkspaceUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository({
        "transition-reviewer": [
          {
            provider: "github",
            status: "connected",
            statusUpdatedAt: "2026-03-11T00:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
          {
            provider: "github",
            status: "reauth_required",
            statusUpdatedAt: "2026-03-11T01:00:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      }),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository(),
      connectionProviderCatalog,
    });

    const result = await useCase.execute({ reviewerId: "transition-reviewer" });

    expect(result.connections[0]).toMatchObject({
      provider: "github",
      status: "reauth_required",
      statusUpdatedAt: "2026-03-11T01:00:00.000Z",
    });
  });

  it("keeps only the five latest transitions per provider", async () => {
    const transitions: PersistedConnectionStateTransition[] = Array.from(
      { length: 7 },
      (_, index) => ({
        transitionId: `transition-${index}`,
        reviewerId: "history-reviewer",
        provider: "github",
        previousStatus: "connected",
        nextStatus: "reauth_required",
        changedAt: `2026-03-11T00:00:0${index}.000Z`,
        connectedAccountLabel: "duck8823",
      }),
    );

    const useCase = new GetConnectionsWorkspaceUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository({
        "history-reviewer": [
          {
            provider: "github",
            status: "reauth_required",
            statusUpdatedAt: "2026-03-11T00:00:06.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      }),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository({
        "history-reviewer": transitions,
      }),
      connectionProviderCatalog,
    });

    const result = await useCase.execute({ reviewerId: "history-reviewer" });

    expect(result.connections[0].recentTransitions).toHaveLength(5);
    expect(result.connections[0].recentTransitions.map((item) => item.transitionId)).toEqual([
      "transition-0",
      "transition-1",
      "transition-2",
      "transition-3",
      "transition-4",
    ]);
  });
});
