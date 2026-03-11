import {
  type ConnectionCapabilities,
  type ConnectionProviderKey,
} from "@/server/application/services/connection-catalog";
import type { ConnectionProviderCatalog } from "@/server/application/ports/connection-provider-catalog";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";
import type { ConnectionStateTransitionRepository } from "@/server/domain/repositories/connection-state-transition-repository";

export interface ConnectionsWorkspaceTransitionRecord {
  transitionId: string;
  previousStatus: string;
  nextStatus: string;
  changedAt: string;
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
}

export interface GetConnectionsWorkspaceInput {
  reviewerId: string;
}

export interface GetConnectionsWorkspaceResult {
  connections: ConnectionsWorkspaceRecord[];
}

export interface GetConnectionsWorkspaceDependencies {
  connectionStateRepository: ConnectionStateRepository;
  connectionStateTransitionRepository: ConnectionStateTransitionRepository;
  connectionProviderCatalog: ConnectionProviderCatalog;
}

const MAX_TRANSITIONS_PER_PROVIDER = 5;
const RECENT_TRANSITIONS_LIMIT = 40;

export class GetConnectionsWorkspaceUseCase {
  constructor(private readonly dependencies: GetConnectionsWorkspaceDependencies) {}

  async execute(input: GetConnectionsWorkspaceInput): Promise<GetConnectionsWorkspaceResult> {
    const [connectionStates, recentTransitions] = await Promise.all([
      this.dependencies.connectionStateRepository.findByReviewerId(input.reviewerId),
      this.dependencies.connectionStateTransitionRepository.listRecentByReviewerId(
        input.reviewerId,
        {
          limit: RECENT_TRANSITIONS_LIMIT,
        },
      ),
    ]);
    const stateByProvider = new Map<string, (typeof connectionStates)[number]>();
    const recentTransitionsByProvider = new Map<
      string,
      ConnectionsWorkspaceTransitionRecord[]
    >();

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

    for (const transition of recentTransitions) {
      const transitions = recentTransitionsByProvider.get(transition.provider) ?? [];

      if (transitions.length >= MAX_TRANSITIONS_PER_PROVIDER) {
        continue;
      }

      transitions.push({
        transitionId: transition.transitionId,
        previousStatus: transition.previousStatus,
        nextStatus: transition.nextStatus,
        changedAt: transition.changedAt,
        connectedAccountLabel: transition.connectedAccountLabel,
      });
      recentTransitionsByProvider.set(transition.provider, transitions);
    }

    return {
      connections: this.dependencies.connectionProviderCatalog.listProviders().map((catalogConnection) => {
        const persistedState = stateByProvider.get(catalogConnection.provider);

        return {
          provider: catalogConnection.provider,
          status: persistedState?.status ?? catalogConnection.status,
          authMode: catalogConnection.authMode,
          statusUpdatedAt: persistedState?.statusUpdatedAt ?? null,
          connectedAccountLabel: persistedState?.connectedAccountLabel ?? null,
          stateSource: persistedState ? "persisted" : "catalog_default",
          capabilities: catalogConnection.capabilities,
          recentTransitions: recentTransitionsByProvider.get(catalogConnection.provider) ?? [],
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
