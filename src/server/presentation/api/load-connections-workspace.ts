import { GetConnectionsWorkspaceUseCase } from "@/server/application/usecases/get-connections-workspace";
import type { ConnectionsWorkspaceDto } from "@/server/presentation/dto/connections-workspace-dto";

export async function loadConnectionsWorkspaceDto(): Promise<ConnectionsWorkspaceDto> {
  const useCase = new GetConnectionsWorkspaceUseCase();
  const result = await useCase.execute();

  return {
    generatedAt: new Date().toISOString(),
    connections: result.connections.map((connection) => ({
      provider: connection.provider,
      status: connection.status,
      authMode: connection.authMode,
    })),
  };
}
