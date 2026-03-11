import { GetConnectionsWorkspaceUseCase } from "@/server/application/usecases/get-connections-workspace";
import { getDependencies } from "@/server/composition/dependencies";
import type { ConnectionStateTransitionReason } from "@/server/domain/value-objects/connection-state-transition";
import type { ConnectionsWorkspaceDto } from "@/server/presentation/dto/connections-workspace-dto";

export interface LoadConnectionsWorkspaceInput {
  reviewerId: string;
  transitionReason?: ConnectionStateTransitionReason | "all";
  transitionPage?: number;
  transitionPageSize?: number;
}

export async function loadConnectionsWorkspaceDto(
  input: LoadConnectionsWorkspaceInput,
): Promise<ConnectionsWorkspaceDto> {
  const {
    connectionStateRepository,
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  } = getDependencies();
  const useCase = new GetConnectionsWorkspaceUseCase({
    connectionStateRepository,
    connectionStateTransitionRepository,
    connectionProviderCatalog,
  });
  const result = await useCase.execute({
    reviewerId: input.reviewerId,
    transitionReason: input.transitionReason,
    transitionPage: input.transitionPage,
    transitionPageSize: input.transitionPageSize,
  });

  return {
    generatedAt: new Date().toISOString(),
    connections: result.connections.map((connection) => ({
      provider: connection.provider,
      status: connection.status,
      authMode: connection.authMode,
      statusUpdatedAt: connection.statusUpdatedAt,
      connectedAccountLabel: connection.connectedAccountLabel,
      stateSource: connection.stateSource,
      capabilities: connection.capabilities,
      recentTransitions: connection.recentTransitions,
      recentTransitionsTotalCount: connection.recentTransitionsTotalCount,
      recentTransitionsHasMore: connection.recentTransitionsHasMore,
    })),
  };
}
