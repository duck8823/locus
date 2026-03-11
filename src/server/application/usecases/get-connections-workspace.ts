import {
  listPrototypeConnectionCatalog,
  type ConnectionCapabilities,
  type ConnectionProviderKey,
} from "@/server/application/services/connection-catalog";
import type { ConnectionStateRepository } from "@/server/domain/repositories/connection-state-repository";

export interface ConnectionsWorkspaceRecord {
  provider: ConnectionProviderKey;
  status: string;
  authMode: "oauth" | "none";
  statusUpdatedAt: string | null;
  connectedAccountLabel: string | null;
  stateSource: "catalog_default" | "persisted";
  capabilities: ConnectionCapabilities;
}

export interface GetConnectionsWorkspaceInput {
  reviewerId: string;
}

export interface GetConnectionsWorkspaceResult {
  connections: ConnectionsWorkspaceRecord[];
}

export interface GetConnectionsWorkspaceDependencies {
  connectionStateRepository: ConnectionStateRepository;
}

export class GetConnectionsWorkspaceUseCase {
  constructor(private readonly dependencies: GetConnectionsWorkspaceDependencies) {}

  async execute(input: GetConnectionsWorkspaceInput): Promise<GetConnectionsWorkspaceResult> {
    const connectionStates = await this.dependencies.connectionStateRepository.findByReviewerId(
      input.reviewerId,
    );
    const stateByProvider = new Map<string, (typeof connectionStates)[number]>();

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
      connections: listPrototypeConnectionCatalog().map((catalogConnection) => {
        const persistedState = stateByProvider.get(catalogConnection.provider);

        return {
          provider: catalogConnection.provider,
          status: persistedState?.status ?? catalogConnection.status,
          authMode: catalogConnection.authMode,
          statusUpdatedAt: persistedState?.statusUpdatedAt ?? null,
          connectedAccountLabel: persistedState?.connectedAccountLabel ?? null,
          stateSource: persistedState ? "persisted" : "catalog_default",
          capabilities: catalogConnection.capabilities,
        };
      }),
    };
  }
}

function toEpochMs(value: string): number {
  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return parsed;
}
