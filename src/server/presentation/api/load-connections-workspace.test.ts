import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDependenciesMock, executeMock } = vi.hoisted(() => ({
  getDependenciesMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock("@/server/composition/dependencies", () => ({
  getDependencies: getDependenciesMock,
}));

vi.mock("@/server/application/usecases/get-connections-workspace", () => ({
  GetConnectionsWorkspaceUseCase: class {
    async execute(input: { reviewerId: string }) {
      return executeMock(input);
    }
  },
}));

import { loadConnectionsWorkspaceDto } from "@/server/presentation/api/load-connections-workspace";

describe("loadConnectionsWorkspaceDto", () => {
  beforeEach(() => {
    getDependenciesMock.mockReset();
    executeMock.mockReset();
    getDependenciesMock.mockReturnValue({
      connectionStateRepository: {},
      connectionStateTransitionRepository: {},
      connectionProviderCatalog: {},
    });
    executeMock.mockResolvedValue({
      connections: [
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
      ],
    });
  });

  it("loads connection workspace dto with persisted fields", async () => {
    const dto = await loadConnectionsWorkspaceDto({ reviewerId: "demo-reviewer" });

    expect(executeMock).toHaveBeenCalledWith({
      reviewerId: "demo-reviewer",
      transitionReason: undefined,
      transitionPage: undefined,
      transitionPageSize: undefined,
    });
    expect(dto.connections).toEqual([
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
    ]);
    expect(Number.isNaN(Date.parse(dto.generatedAt))).toBe(false);
  });

  it("forwards transition history filter and paging inputs", async () => {
    await loadConnectionsWorkspaceDto({
      reviewerId: "demo-reviewer",
      transitionReason: "webhook",
      transitionPage: 2,
      transitionPageSize: 10,
    });

    expect(executeMock).toHaveBeenLastCalledWith({
      reviewerId: "demo-reviewer",
      transitionReason: "webhook",
      transitionPage: 2,
      transitionPageSize: 10,
    });
  });
});
