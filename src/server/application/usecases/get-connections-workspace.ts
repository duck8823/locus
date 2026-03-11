import {
  type ConnectionCapabilities,
  type ConnectionProviderKey,
} from "@/server/application/services/connection-catalog";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { ConnectionStateTransitionRepository } from "@/server/domain/repositories/connection-state-transition-repository";
import type {
  ConnectionStateTransitionActorType,
  ConnectionStateTransitionReason,
} from "@/server/domain/value-objects/connection-state-transition";

export interface ConnectionsWorkspaceTransitionRecord {
  transitionId: string;
  previousStatus: string;
  nextStatus: string;
  changedAt: string;
  reason: ConnectionStateTransitionReason;
  actorType: ConnectionStateTransitionActorType;
  actorId: string | null;
  connectedAccountLabel: string | null;
}

export interface ConnectionsWorkspaceRecord {
  provider: ConnectionProviderKey;
  status: string;
  authMode: "oauth" | "none";
  statusUpdatedAt: string | null;
  connectedAccountLabel: string | null;
  stateSource: "catalog_default" | "persisted";
  capabilities: ConnectionCapabilities;
  recentTransitions: ConnectionsWorkspaceTransitionRecord[];
  recentTransitionsTotalCount: number;
  recentTransitionsHasMore: boolean;
}

export interface GetConnectionsWorkspaceInput {
  reviewerId: string;
  transitionReason?: ConnectionStateTransitionReason | "all";
  transitionPage?: number;
  transitionPageSize?: number;
}

export interface GetConnectionsWorkspaceResult {
  connections: ConnectionsWorkspaceRecord[];
}

export interface GetConnectionsWorkspaceDependencies {
  connectionStateRepository: ConnectionStateRepository;
  connectionStateTransitionRepository: ConnectionStateTransitionRepository;
  connectionProviderCatalog: ConnectionProviderCatalog;
}

const DEFAULT_TRANSITION_PAGE = 1;
const DEFAULT_TRANSITION_PAGE_SIZE = 5;
const MAX_TRANSITION_PAGE = 30;
const MAX_TRANSITION_PAGE_SIZE = 20;

export class GetConnectionsWorkspaceUseCase {
  constructor(private readonly dependencies: GetConnectionsWorkspaceDependencies) {}

  async execute(input: GetConnectionsWorkspaceInput): Promise<GetConnectionsWorkspaceResult> {
    const transitionReason = normalizeTransitionReasonFilter(input.transitionReason);
    const transitionPage = normalizeTransitionPage(input.transitionPage);
    const transitionPageSize = normalizeTransitionPageSize(input.transitionPageSize);
    const transitionStartIndex = (transitionPage - 1) * transitionPageSize;
    const transitionEndIndex = transitionStartIndex + transitionPageSize;
    const catalogConnections = this.dependencies.connectionProviderCatalog.listProviders();
    const [connectionStates, transitionSnapshots] = await Promise.all([
      this.dependencies.connectionStateRepository.findByReviewerId(input.reviewerId),
      Promise.all(
        catalogConnections.map(async (catalogConnection) => {
          const transitionQuery = {
            provider: catalogConnection.provider,
            reason: transitionReason === "all" ? undefined : transitionReason,
          } as const;
          const [totalCount, transitions] = await Promise.all([
            this.dependencies.connectionStateTransitionRepository.countByReviewerId(
              input.reviewerId,
              transitionQuery,
            ),
            this.dependencies.connectionStateTransitionRepository.listRecentByReviewerId(
              input.reviewerId,
              {
                ...transitionQuery,
                limit: transitionPageSize,
                offset: transitionStartIndex,
              },
            ),
          ]);

          return {
            provider: catalogConnection.provider,
            totalCount,
            recentTransitions: transitions.map((transition) => ({
              transitionId: transition.transitionId,
              previousStatus: transition.previousStatus,
              nextStatus: transition.nextStatus,
              changedAt: transition.changedAt,
              reason: transition.reason,
              actorType: transition.actorType,
              actorId: transition.actorId,
              connectedAccountLabel: transition.connectedAccountLabel,
            })),
          };
        }),
      ),
    ]);
    const stateByProvider = new Map<string, (typeof connectionStates)[number]>();
    const transitionSnapshotByProvider = new Map(
      transitionSnapshots.map((snapshot) => [snapshot.provider, snapshot] as const),
    );

    for (const connectionState of connectionStates) {
      const previous = stateByProvider.get(connectionState.provider);

      if (!previous) {
        stateByProvider.set(connectionState.provider, connectionState);
        continue;
      }

      if (toEpochMs(previous.statusUpdatedAt) <= toEpochMs(connectionState.statusUpdatedAt)) {
        stateByProvider.set(connectionState.provider, connectionState);
      }
    }

    return {
      connections: catalogConnections.map((catalogConnection) => {
        const persistedState = stateByProvider.get(catalogConnection.provider);
        const transitionSnapshot = transitionSnapshotByProvider.get(catalogConnection.provider);
        const recentTransitions = transitionSnapshot?.recentTransitions ?? [];
        const totalCount = transitionSnapshot?.totalCount ?? 0;

        return {
          provider: catalogConnection.provider,
          status: persistedState?.status ?? catalogConnection.status,
          authMode: catalogConnection.authMode,
          statusUpdatedAt: persistedState?.statusUpdatedAt ?? null,
          connectedAccountLabel: persistedState?.connectedAccountLabel ?? null,
          stateSource: persistedState ? "persisted" : "catalog_default",
          capabilities: catalogConnection.capabilities,
          recentTransitions,
          recentTransitionsTotalCount: totalCount,
          recentTransitionsHasMore: totalCount > transitionEndIndex,
        };
      }),
    };
  }
}

function toEpochMs(value: string | null): number {
  if (value === null) {
    return 0;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return parsed;
}

function normalizeTransitionReasonFilter(
  value: ConnectionStateTransitionReason | "all" | undefined,
): ConnectionStateTransitionReason | "all" {
  if (value === "manual" || value === "token-expired" || value === "webhook") {
    return value;
  }

  return "all";
}

function normalizeTransitionPage(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_TRANSITION_PAGE;
  }

  return Math.min(value, MAX_TRANSITION_PAGE);
}

function normalizeTransitionPageSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_TRANSITION_PAGE_SIZE;
  }

  return Math.min(value, MAX_TRANSITION_PAGE_SIZE);
}
