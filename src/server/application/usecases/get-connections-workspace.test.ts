import { describe, expect, it } from "vitest";
import { PrototypeConnectionProviderCatalog } from "@/server/application/services/connection-catalog";
import { GetConnectionsWorkspaceUseCase } from "@/server/application/usecases/get-connections-workspace";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";

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

const connectionProviderCatalog = new PrototypeConnectionProviderCatalog();

describe("GetConnectionsWorkspaceUseCase", () => {
  it("merges persisted reviewer state with catalog defaults", async () => {
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
      connectionProviderCatalog,
    });

    const result = await useCase.execute({ reviewerId: "transition-reviewer" });

    expect(result.connections[0]).toMatchObject({
      provider: "github",
      status: "reauth_required",
      statusUpdatedAt: "2026-03-11T01:00:00.000Z",
    });
  });
});
