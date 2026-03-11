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
    options: {
      provider?: string;
      reason?: "manual" | "token-expired" | "webhook";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<PersistedConnectionStateTransition[]> {
    const providerFilter = options.provider?.trim() || null;
    const reasonFilter = options.reason ?? null;
    const offset =
      typeof options.offset === "number" && options.offset > 0
        ? Math.floor(options.offset)
        : 0;
    const limit =
      typeof options.limit === "number" && options.limit > 0
        ? Math.floor(options.limit)
        : 20;

    const transitions = (this.recordsByReviewerId[reviewerId] ?? []).filter((transition) => {
      if (providerFilter && transition.provider !== providerFilter) {
        return false;
      }

      if (reasonFilter && transition.reason !== reasonFilter) {
        return false;
      }

      return true;
    });

    return transitions.slice(offset, offset + limit);
  }

  async countByReviewerId(
    reviewerId: string,
    options: {
      provider?: string;
      reason?: "manual" | "token-expired" | "webhook";
    } = {},
  ): Promise<number> {
    const providerFilter = options.provider?.trim() || null;
    const reasonFilter = options.reason ?? null;

    return (this.recordsByReviewerId[reviewerId] ?? []).filter((transition) => {
      if (providerFilter && transition.provider !== providerFilter) {
        return false;
      }

      if (reasonFilter && transition.reason !== reasonFilter) {
        return false;
      }

      return true;
    }).length;
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
            reason: "manual",
            actorType: "reviewer",
            actorId: "demo-reviewer",
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
            reason: "manual",
            actorType: "reviewer",
            actorId: "demo-reviewer",
            connectedAccountLabel: "duck8823",
          },
        ],
        recentTransitionsTotalCount: 1,
        recentTransitionsHasMore: false,
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
        recentTransitionsTotalCount: 0,
        recentTransitionsHasMore: false,
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
        recentTransitionsTotalCount: 0,
        recentTransitionsHasMore: false,
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
      recentTransitionsTotalCount: 0,
      recentTransitionsHasMore: false,
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
      recentTransitionsTotalCount: 0,
      recentTransitionsHasMore: false,
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
        reason: index % 2 === 0 ? "manual" : "webhook",
        actorType: index % 2 === 0 ? "reviewer" : "system",
        actorId: index % 2 === 0 ? "history-reviewer" : "github-webhook",
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
    expect(result.connections[0].recentTransitionsTotalCount).toBe(7);
    expect(result.connections[0].recentTransitionsHasMore).toBe(true);
  });

  it("filters transitions by reason and paginates per provider", async () => {
    const transitions: PersistedConnectionStateTransition[] = [
      {
        transitionId: "transition-1",
        reviewerId: "filter-reviewer",
        provider: "github",
        previousStatus: "not_connected",
        nextStatus: "connected",
        changedAt: "2026-03-11T00:04:00.000Z",
        reason: "manual",
        actorType: "reviewer",
        actorId: "filter-reviewer",
        connectedAccountLabel: "duck8823",
      },
      {
        transitionId: "transition-2",
        reviewerId: "filter-reviewer",
        provider: "github",
        previousStatus: "connected",
        nextStatus: "reauth_required",
        changedAt: "2026-03-11T00:03:00.000Z",
        reason: "webhook",
        actorType: "system",
        actorId: "github-webhook",
        connectedAccountLabel: "duck8823",
      },
      {
        transitionId: "transition-3",
        reviewerId: "filter-reviewer",
        provider: "github",
        previousStatus: "reauth_required",
        nextStatus: "connected",
        changedAt: "2026-03-11T00:02:00.000Z",
        reason: "manual",
        actorType: "reviewer",
        actorId: "filter-reviewer",
        connectedAccountLabel: "duck8823",
      },
      {
        transitionId: "transition-4",
        reviewerId: "filter-reviewer",
        provider: "github",
        previousStatus: "connected",
        nextStatus: "reauth_required",
        changedAt: "2026-03-11T00:01:00.000Z",
        reason: "webhook",
        actorType: "system",
        actorId: "github-webhook",
        connectedAccountLabel: "duck8823",
      },
    ];

    const useCase = new GetConnectionsWorkspaceUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository({
        "filter-reviewer": [
          {
            provider: "github",
            status: "reauth_required",
            statusUpdatedAt: "2026-03-11T00:04:00.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      }),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository({
        "filter-reviewer": transitions,
      }),
      connectionProviderCatalog,
    });

    const result = await useCase.execute({
      reviewerId: "filter-reviewer",
      transitionReason: "webhook",
      transitionPage: 1,
      transitionPageSize: 1,
    });

    expect(result.connections[0].recentTransitions).toHaveLength(1);
    expect(result.connections[0].recentTransitions[0]).toMatchObject({
      transitionId: "transition-2",
      reason: "webhook",
      actorType: "system",
      actorId: "github-webhook",
    });
    expect(result.connections[0].recentTransitionsTotalCount).toBe(2);
    expect(result.connections[0].recentTransitionsHasMore).toBe(true);

    const secondPage = await useCase.execute({
      reviewerId: "filter-reviewer",
      transitionReason: "webhook",
      transitionPage: 2,
      transitionPageSize: 1,
    });

    expect(secondPage.connections[0].recentTransitions).toHaveLength(1);
    expect(secondPage.connections[0].recentTransitions[0]?.transitionId).toBe("transition-4");
    expect(secondPage.connections[0].recentTransitionsHasMore).toBe(false);
  });

  it("does not expose next-page when request is clamped to max transition page", async () => {
    const transitions: PersistedConnectionStateTransition[] = Array.from(
      { length: 200 },
      (_, index) => ({
        transitionId: `transition-${index}`,
        reviewerId: "clamp-reviewer",
        provider: "github",
        previousStatus: "connected",
        nextStatus: "reauth_required",
        changedAt: `2026-03-11T00:00:${String(200 - index).padStart(2, "0")}.000Z`,
        reason: "manual",
        actorType: "reviewer",
        actorId: "clamp-reviewer",
        connectedAccountLabel: "duck8823",
      }),
    );

    const useCase = new GetConnectionsWorkspaceUseCase({
      connectionStateRepository: new InMemoryConnectionStateRepository({
        "clamp-reviewer": [
          {
            provider: "github",
            status: "reauth_required",
            statusUpdatedAt: "2026-03-11T00:00:59.000Z",
            connectedAccountLabel: "duck8823",
          },
        ],
      }),
      connectionStateTransitionRepository: new InMemoryConnectionStateTransitionRepository({
        "clamp-reviewer": transitions,
      }),
      connectionProviderCatalog,
    });

    const result = await useCase.execute({
      reviewerId: "clamp-reviewer",
      transitionPage: 999,
      transitionPageSize: 5,
    });

    expect(result.connections[0].recentTransitions).toHaveLength(5);
    expect(result.connections[0].recentTransitionsTotalCount).toBe(200);
    expect(result.connections[0].recentTransitionsHasMore).toBe(false);
  });
});
